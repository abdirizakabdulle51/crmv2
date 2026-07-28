import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { canViewCompany } from "./authorization";

const ruleSnapshotValidator = v.array(
  v.object({
    companyId: v.id("companies"),
    companyName: v.string(),
    rule: v.string(),
    triggerReason: v.string(),
    recommendedService: v.string(),
    estimatedValue: v.string(),
    priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  }),
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

  return user;
}

export const listVisible = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const rows = await ctx.db.query("aiRecommendations").collect();
    const companies = await ctx.db.query("companies").collect();
    const visibleCompanyIds = new Set(
      companies
        .filter((company) => canViewCompany(user, company))
        .map((company) => company._id),
    );

    return rows.filter((row) => visibleCompanyIds.has(row.companyId));
  },
});

export const bulkUpsert = internalMutation({
  args: {
    items: v.array(
      v.object({
        companyId: v.id("companies"),
        narrative: v.string(),
        topPriority: v.optional(v.string()),
        ruleSnapshot: ruleSnapshotValidator,
        generatedAt: v.number(),
        model: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let upserted = 0;

    for (const item of args.items) {
      const existing = await ctx.db
        .query("aiRecommendations")
        .withIndex("by_company", (q) => q.eq("companyId", item.companyId))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, item);
      } else {
        await ctx.db.insert("aiRecommendations", item);
      }

      upserted++;
    }

    return upserted;
  },
});
