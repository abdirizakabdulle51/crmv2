import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import {
  assertAccountManagerIsInActorScope,
  assertCanManageCompany,
  assertNotMonitoring,
  canViewCompany,
  isCeoOrHob,
} from "./authorization";

const paymentTermDaysValidator = v.optional(
  v.union(v.literal(7), v.literal(15), v.literal(30)),
);
const lifecycleStatusValidator = v.optional(
  v.union(v.literal("prospect"), v.literal("customer"), v.literal("lost")),
);
const normalizeCompanyName = (name: string) => name.trim().toLowerCase();

function derivedLifecycle(
  company: Doc<"companies">,
  leads: Doc<"leads">[],
  hasContract: boolean,
) {
  if (company.lifecycleStatus) return company.lifecycleStatus;
  const related = leads.filter((lead) => lead.companyId === company._id);
  if (hasContract || related.some((lead) => lead.stage === "won"))
    return "customer" as const;
  if (related.some((lead) => lead.stage !== "lost")) return "prospect" as const;
  if (related.length) return "lost" as const;
  return "customer" as const;
}

function latestLostOpportunity(
  companyId: Doc<"companies">["_id"],
  leads: Doc<"leads">[],
) {
  return leads
    .filter((lead) => lead.companyId === companyId && lead.stage === "lost")
    .sort(
      (a, b) =>
        (b.updatedAt ?? b._creationTime) - (a.updatedAt ?? a._creationTime),
    )[0];
}

async function getCurrentUserOrThrow(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "User not logged in",
    });
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "User profile not found",
    });
  }
  assertNotMonitoring(user);
  return user;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUserOrThrow(ctx);

    let companies: Doc<"companies">[];

    // Role-based visibility
    if (currentUser.role === "ceo" || currentUser.role === "head_of_business") {
      // See all companies
      companies = await ctx.db.query("companies").collect();
    } else if (currentUser.role === "country_gm" && currentUser.countryId) {
      // See companies in their country
      companies = await ctx.db
        .query("companies")
        .withIndex("by_country", (q) =>
          q.eq("countryId", currentUser.countryId!),
        )
        .collect();
    } else {
      // Account managers see only their own companies
      companies = await ctx.db
        .query("companies")
        .withIndex("by_account_manager", (q) =>
          q.eq("accountManagerId", currentUser._id),
        )
        .collect();
    }

    const activeContracts = await ctx.db
      .query("customerContracts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const contracted = new Set(activeContracts.map((row) => row.companyId));
    const leads = await ctx.db.query("leads").collect();
    return companies.map((company) => {
      const lifecycleStatus = derivedLifecycle(
        company,
        leads,
        contracted.has(company._id),
      );
      const latestLost =
        lifecycleStatus === "lost"
          ? latestLostOpportunity(company._id, leads)
          : undefined;
      return {
        ...company,
        lifecycleStatus,
        lostReason: company.lostReason ?? latestLost?.lossReason,
        lostAt: company.lostAt ?? latestLost?.updatedAt,
        commercialModel:
          contracted.has(company._id) ||
          company.commercialModel === "contracted"
            ? ("contracted" as const)
            : ("payg" as const),
      };
    });
  },
});

export const getById = query({
  args: { id: v.id("companies") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const company = await ctx.db.get(args.id);
    if (!company) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Company not found",
      });
    }
    if (!canViewCompany(currentUser, company)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You do not have permission to view this company",
      });
    }
    const activeContract = (
      await ctx.db
        .query("customerContracts")
        .withIndex("by_company", (q) => q.eq("companyId", company._id))
        .collect()
    ).some((contract) => contract.status === "active");
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_company", (q) => q.eq("companyId", company._id))
      .collect();
    const lifecycleStatus = derivedLifecycle(company, leads, activeContract);
    const latestLost =
      lifecycleStatus === "lost"
        ? latestLostOpportunity(company._id, leads)
        : undefined;
    return {
      ...company,
      lifecycleStatus,
      lostReason: company.lostReason ?? latestLost?.lossReason,
      lostAt: company.lostAt ?? latestLost?.updatedAt,
      commercialModel:
        activeContract || company.commercialModel === "contracted"
          ? ("contracted" as const)
          : ("payg" as const),
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    sectorId: v.id("sectors"),
    countryId: v.id("countries"),
    accountManagerId: v.id("users"),
    contractStatus: v.union(
      v.literal("active"),
      v.literal("pending"),
      v.literal("expired"),
      v.literal("terminated"),
    ),
    paymentStatus: v.optional(
      v.union(
        v.literal("current"),
        v.literal("overdue"),
        v.literal("delinquent"),
      ),
    ),
    paymentTermDays: paymentTermDaysValidator,
    notes: v.optional(v.string()),
    website: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    lifecycleStatus: lifecycleStatusValidator,
    lostReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    if (
      currentUser.role === "country_gm" &&
      (!currentUser.countryId || args.countryId !== currentUser.countryId)
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Country GMs can only create companies in their country",
      });
    }

    const accountManagerId =
      currentUser.role === "account_manager"
        ? currentUser._id
        : args.accountManagerId;
    await assertAccountManagerIsInActorScope(
      ctx,
      currentUser,
      accountManagerId,
      args.countryId,
    );

    const name = args.name.trim();
    if (!name)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Company name is required",
      });
    if (args.lifecycleStatus === "lost" && !args.lostReason?.trim())
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Add a loss reason before marking the company lost",
      });
    const normalizedName = normalizeCompanyName(name);
    const duplicate =
      (await ctx.db
        .query("companies")
        .withIndex("by_country_normalized_name", (q) =>
          q
            .eq("countryId", args.countryId)
            .eq("normalizedName", normalizedName),
        )
        .first()) ??
      (
        await ctx.db
          .query("companies")
          .withIndex("by_country", (q) => q.eq("countryId", args.countryId))
          .collect()
      ).find(
        (company) => normalizeCompanyName(company.name) === normalizedName,
      );
    if (duplicate)
      throw new ConvexError({
        code: "CONFLICT",
        message: "A company with this name already exists in this country",
      });
    return await ctx.db.insert("companies", {
      name,
      normalizedName,
      sectorId: args.sectorId,
      countryId: args.countryId,
      accountManagerId,
      contractStatus: args.contractStatus,
      paymentStatus: args.paymentStatus,
      paymentTermDays: args.paymentTermDays,
      notes: args.notes,
      website: args.website,
      contactName: args.contactName,
      contactEmail: args.contactEmail,
      lifecycleStatus: args.lifecycleStatus ?? "customer",
      lostReason:
        args.lifecycleStatus === "lost" ? args.lostReason?.trim() : undefined,
      lostAt: args.lifecycleStatus === "lost" ? Date.now() : undefined,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("companies"),
    name: v.string(),
    sectorId: v.id("sectors"),
    countryId: v.id("countries"),
    accountManagerId: v.id("users"),
    contractStatus: v.union(
      v.literal("active"),
      v.literal("pending"),
      v.literal("expired"),
      v.literal("terminated"),
    ),
    paymentStatus: v.optional(
      v.union(
        v.literal("current"),
        v.literal("overdue"),
        v.literal("delinquent"),
      ),
    ),
    paymentTermDays: paymentTermDaysValidator,
    notes: v.optional(v.string()),
    website: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    lifecycleStatus: lifecycleStatusValidator,
    lostReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const company = await ctx.db.get(args.id);
    if (!company) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Company not found",
      });
    }
    assertCanManageCompany(currentUser, company);
    if (
      currentUser.role === "country_gm" &&
      (!currentUser.countryId || args.countryId !== currentUser.countryId)
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Country GMs can only keep companies in their country",
      });
    }
    const accountManagerId =
      currentUser.role === "account_manager"
        ? currentUser._id
        : args.accountManagerId;
    await assertAccountManagerIsInActorScope(
      ctx,
      currentUser,
      accountManagerId,
      args.countryId,
    );
    const { id, ...fields } = args;
    const lifecycleStatus = fields.lifecycleStatus ?? company.lifecycleStatus;
    if (lifecycleStatus === "lost" && !fields.lostReason?.trim()) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Add a loss reason before marking the company lost",
      });
    }
    if (lifecycleStatus === "lost") {
      const [opportunities, contracts] = await Promise.all([
        ctx.db
          .query("leads")
          .withIndex("by_company", (q) => q.eq("companyId", company._id))
          .collect(),
        ctx.db
          .query("customerContracts")
          .withIndex("by_company", (q) => q.eq("companyId", company._id))
          .collect(),
      ]);
      if (
        opportunities.some((opportunity) => opportunity.stage === "won") ||
        contracts.some((contract) => contract.status === "active")
      )
        throw new ConvexError({
          code: "BAD_REQUEST",
          message:
            "An active or won customer cannot be marked as a lost prospect",
        });
    }
    await ctx.db.patch(id, {
      ...fields,
      name: company.name,
      accountManagerId,
      countryId: isCeoOrHob(currentUser) ? fields.countryId : company.countryId,
      lifecycleStatus,
      lostReason:
        lifecycleStatus === "lost" ? fields.lostReason?.trim() : undefined,
      lostAt:
        lifecycleStatus === "lost"
          ? company.lifecycleStatus === "lost"
            ? company.lostAt
            : Date.now()
          : undefined,
    });
  },
});

export const backfillLifecycleAndNames = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await getCurrentUserOrThrow(ctx);
    if (!isCeoOrHob(actor))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only global leadership can run reconciliation",
      });
    const [companies, leads, activeContracts] = await Promise.all([
      ctx.db.query("companies").collect(),
      ctx.db.query("leads").collect(),
      ctx.db
        .query("customerContracts")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .collect(),
    ]);
    const contracted = new Set(
      activeContracts.map((contract) => contract.companyId),
    );
    let updated = 0;
    for (const company of companies) {
      if (company.lifecycleStatus && company.normalizedName) continue;
      const lifecycleStatus =
        company.lifecycleStatus ??
        derivedLifecycle(company, leads, contracted.has(company._id));
      const latestLost =
        lifecycleStatus === "lost"
          ? latestLostOpportunity(company._id, leads)
          : undefined;
      await ctx.db.patch(company._id, {
        normalizedName:
          company.normalizedName ?? normalizeCompanyName(company.name),
        lifecycleStatus,
        lostReason: company.lostReason ?? latestLost?.lossReason,
        lostAt: company.lostAt ?? latestLost?.updatedAt,
      });
      updated += 1;
    }
    return { scanned: companies.length, updated };
  },
});

export const remove = mutation({
  args: { id: v.id("companies") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const company = await ctx.db.get(args.id);
    if (!company) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Company not found",
      });
    }
    assertCanManageCompany(currentUser, company);
    await ctx.db.delete(args.id);
  },
});
