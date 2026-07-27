import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

async function getCurrentUserOrThrow(ctx: MutationCtx): Promise<Doc<"users">> {
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

/** Bulk-create leads from validated import data */
export const bulkCreate = mutation({
  args: {
    leads: v.array(
      v.object({
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
      }),
    ),
  },
  handler: async (ctx, args): Promise<number> => {
    const user = await getCurrentUserOrThrow(ctx);

    // Only CEO or Head of Business can bulk import
    if (user.role !== "ceo" && user.role !== "head_of_business") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can bulk import leads",
      });
    }

    for (const lead of args.leads) {
      await ctx.db.insert("leads", lead);
    }

    return args.leads.length;
  },
});
