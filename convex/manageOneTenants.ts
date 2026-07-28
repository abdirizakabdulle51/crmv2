import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

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

  return user;
}

export const bulkUpsert = internalMutation({
  args: {
    tenants: v.array(
      v.object({
        vdcId: v.string(),
        domainId: v.optional(v.string()),
        name: v.string(),
        level: v.optional(v.number()),
        upperVdcId: v.optional(v.string()),
        enabled: v.optional(v.boolean()),
        managerName: v.optional(v.string()),
        managerPhone: v.optional(v.string()),
        managerEmail: v.optional(v.string()),
        ecsUsed: v.optional(v.number()),
        evsUsed: v.optional(v.number()),
        projectCount: v.optional(v.number()),
        resources: v.optional(
          v.array(
            v.object({
              serviceId: v.string(),
              resource: v.string(),
              used: v.number(),
              total: v.optional(v.number()),
            }),
          ),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let upserted = 0;

    for (const tenant of args.tenants) {
      const existing = await ctx.db
        .query("manageOneTenants")
        .withIndex("by_vdc_id", (q) => q.eq("vdcId", tenant.vdcId))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, { ...tenant, lastSyncedAt: now });
      } else {
        await ctx.db.insert("manageOneTenants", {
          ...tenant,
          lastSyncedAt: now,
        });
      }

      upserted++;
    }

    return upserted;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can view ManageOne tenants",
      });
    }

    return await ctx.db.query("manageOneTenants").collect();
  },
});

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(vdc|system|test|ltd|inc|co)$/g, "");
}

export const listWithSuggestions = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can view this",
      });
    }

    const tenants = await ctx.db.query("manageOneTenants").collect();
    const companies = await ctx.db.query("companies").collect();

    return tenants.map((tenant) => {
      const linkedCompany = tenant.linkedCompanyId
        ? companies.find((company) => company._id === tenant.linkedCompanyId)
        : undefined;

      if (tenant.linkedCompanyId) {
        return {
          ...tenant,
          linkedCompanyName: linkedCompany?.name ?? null,
          suggestedCompanyId: null,
          suggestedCompanyName: null,
        };
      }

      const norm = normalizeName(tenant.name);
      const match = companies.find((company) => {
        const companyNorm = normalizeName(company.name);
        return (
          companyNorm === norm ||
          (norm.length >= 4 &&
            (companyNorm.includes(norm) || norm.includes(companyNorm)))
        );
      });

      return {
        ...tenant,
        linkedCompanyName: null,
        suggestedCompanyId: match?._id ?? null,
        suggestedCompanyName: match?.name ?? null,
      };
    });
  },
});

export const linkToCompany = mutation({
  args: { tenantId: v.id("manageOneTenants"), companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can link tenants",
      });
    }

    await ctx.db.patch(args.tenantId, { linkedCompanyId: args.companyId });
  },
});

export const createCompanyFromTenant = mutation({
  args: {
    tenantId: v.id("manageOneTenants"),
    sectorId: v.id("sectors"),
    countryId: v.id("countries"),
    accountManagerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can create companies",
      });
    }

    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Tenant not found" });
    }

    const companyId = await ctx.db.insert("companies", {
      name: tenant.name,
      sectorId: args.sectorId,
      countryId: args.countryId,
      accountManagerId: args.accountManagerId,
      contractStatus: "pending",
      contactName: tenant.managerName,
      contactEmail: tenant.managerEmail,
    });

    await ctx.db.patch(args.tenantId, { linkedCompanyId: companyId });
    return companyId;
  },
});

export const getByCompanyId = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    await getCurrentUserOrThrow(ctx);
    return await ctx.db
      .query("manageOneTenants")
      .withIndex("by_linked_company", (q) =>
        q.eq("linkedCompanyId", args.companyId),
      )
      .collect();
  },
});
