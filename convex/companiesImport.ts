import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { assertNotMonitoring } from "./authorization";

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
  assertNotMonitoring(user);
  return user;
}

/** Bulk-create companies from validated import data */
export const bulkCreate = mutation({
  args: {
    companies: v.array(
      v.object({
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
        website: v.optional(v.string()),
        contactName: v.optional(v.string()),
        contactEmail: v.optional(v.string()),
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
        message: "Only CEO or Head of Business can bulk import companies",
      });
    }

    for (const company of args.companies) {
      await ctx.db.insert("companies", company);
    }

    return args.companies.length;
  },
});
