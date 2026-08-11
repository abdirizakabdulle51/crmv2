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

    return companies;
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
    return company;
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

    return await ctx.db.insert("companies", {
      name: args.name,
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
    await ctx.db.patch(id, {
      ...fields,
      accountManagerId,
      countryId: isCeoOrHob(currentUser) ? fields.countryId : company.countryId,
    });
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
