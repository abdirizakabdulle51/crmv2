import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import {
  assertAccountManagerIsInActorScope,
  assertCanManageLead,
  assertNotMonitoring,
  canViewCompany,
} from "./authorization";

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

    let leads: Doc<"leads">[];

    // Role-based visibility
    if (currentUser.role === "ceo" || currentUser.role === "head_of_business") {
      leads = await ctx.db.query("leads").collect();
    } else if (currentUser.role === "country_gm" && currentUser.countryId) {
      // Get all companies in this country, then filter leads
      const countryCompanies = await ctx.db
        .query("companies")
        .withIndex("by_country", (q) =>
          q.eq("countryId", currentUser.countryId!),
        )
        .collect();
      const companyIds = new Set(countryCompanies.map((c) => c._id));
      const allLeads = await ctx.db.query("leads").collect();
      leads = allLeads.filter((l) => companyIds.has(l.companyId));
    } else {
      // Account managers see only their own leads
      leads = await ctx.db
        .query("leads")
        .withIndex("by_account_manager", (q) =>
          q.eq("accountManagerId", currentUser._id),
        )
        .collect();
    }

    return leads;
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    companyId: v.id("companies"),
    accountManagerId: v.id("users"),
    stage: v.union(
      v.literal("new_lead"),
      v.literal("qualified"),
      v.literal("discovery"),
      v.literal("proposal"),
      v.literal("negotiation"),
      v.literal("won"),
      v.literal("lost"),
    ),
    potentialValue: v.number(),
    expectedCloseDate: v.string(),
    nextAction: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const company = await ctx.db.get(args.companyId);
    if (!company) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Company not found",
      });
    }
    if (!canViewCompany(currentUser, company)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You do not have permission to create a lead for this company",
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
      company.countryId,
    );

    return await ctx.db.insert("leads", {
      title: args.title,
      companyId: args.companyId,
      accountManagerId,
      stage: args.stage,
      potentialValue: args.potentialValue,
      expectedCloseDate: args.expectedCloseDate,
      nextAction: args.nextAction,
      notes: args.notes,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("leads"),
    title: v.string(),
    companyId: v.id("companies"),
    accountManagerId: v.id("users"),
    stage: v.union(
      v.literal("new_lead"),
      v.literal("qualified"),
      v.literal("discovery"),
      v.literal("proposal"),
      v.literal("negotiation"),
      v.literal("won"),
      v.literal("lost"),
    ),
    potentialValue: v.number(),
    expectedCloseDate: v.string(),
    nextAction: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const lead = await ctx.db.get(args.id);
    if (!lead) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    await assertCanManageLead(ctx, currentUser, lead);
    const company = await ctx.db.get(args.companyId);
    if (!company) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Company not found",
      });
    }
    if (!canViewCompany(currentUser, company)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You do not have permission to move this lead to that company",
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
      company.countryId,
    );
    const { id, ...fields } = args;
    await ctx.db.patch(id, { ...fields, accountManagerId });
  },
});

export const updateStage = mutation({
  args: {
    id: v.id("leads"),
    stage: v.union(
      v.literal("new_lead"),
      v.literal("qualified"),
      v.literal("discovery"),
      v.literal("proposal"),
      v.literal("negotiation"),
      v.literal("won"),
      v.literal("lost"),
    ),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const lead = await ctx.db.get(args.id);
    if (!lead) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    await assertCanManageLead(ctx, currentUser, lead);
    await ctx.db.patch(args.id, { stage: args.stage });
  },
});

export const remove = mutation({
  args: { id: v.id("leads") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const lead = await ctx.db.get(args.id);
    if (!lead) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    await assertCanManageLead(ctx, currentUser, lead);
    await ctx.db.delete(args.id);
  },
});
