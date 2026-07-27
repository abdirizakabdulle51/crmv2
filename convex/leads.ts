import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
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

async function assertCanTouchLead(
  ctx: QueryCtx | MutationCtx,
  currentUser: Doc<"users">,
  lead: Doc<"leads">,
) {
  if (
    currentUser.role === "ceo" ||
    currentUser.role === "head_of_business"
  ) {
    return;
  }

  if (currentUser.role === "country_gm" && currentUser.countryId) {
    const company = await ctx.db.get(lead.companyId);
    if (company?.countryId === currentUser.countryId) {
      return;
    }
  }

  if (
    currentUser.role === "account_manager" &&
    lead.accountManagerId === currentUser._id
  ) {
    return;
  }

  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to modify this lead",
  });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUserOrThrow(ctx);

    let leads: Doc<"leads">[];

    // Role-based visibility
    if (
      currentUser.role === "ceo" ||
      currentUser.role === "head_of_business"
    ) {
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
    const accountManagerId =
      currentUser.role === "account_manager"
        ? currentUser._id
        : args.accountManagerId;

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
    await assertCanTouchLead(ctx, currentUser, lead);
    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
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
    await assertCanTouchLead(ctx, currentUser, lead);
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
    await assertCanTouchLead(ctx, currentUser, lead);
    await ctx.db.delete(args.id);
  },
});
