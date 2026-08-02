import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { assertCanManageCompany } from "./authorization";
import { buildCloudAdvisorRecommendationKey } from "./cloudAdvisorKeys";

const statusValidator = v.union(
  v.literal("acknowledged"),
  v.literal("in_progress"),
  v.literal("snoozed"),
  v.literal("dismissed"),
  v.literal("resolved"),
);
const MAX_NOTE_LENGTH = 300;

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

function timestampFieldsForStatus(
  status: Doc<"cloudAdvisorStatuses">["status"],
  now: number,
  snoozedUntil?: number,
) {
  if (status === "acknowledged") {
    return { acknowledgedAt: now };
  }
  if (status === "in_progress") {
    return { inProgressAt: now };
  }
  if (status === "dismissed") {
    return { dismissedAt: now };
  }
  if (status === "resolved") {
    return { resolvedAt: now };
  }
  if (snoozedUntil === undefined) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "snoozedUntil is required when snoozing a recommendation",
    });
  }
  return { snoozedUntil };
}

export const setRecommendationStatus = mutation({
  args: {
    recommendationKey: v.string(),
    companyId: v.id("companies"),
    rule: v.string(),
    recommendedService: v.string(),
    status: statusValidator,
    snoozedUntil: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const company = await ctx.db.get(args.companyId);
    if (!company) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Company not found",
      });
    }
    assertCanManageCompany(user, company);

    const expectedKey = buildCloudAdvisorRecommendationKey(
      args.companyId,
      args.rule,
      args.recommendedService,
    );
    if (args.recommendationKey !== expectedKey) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Recommendation key does not match company/rule/service",
      });
    }

    const now = Date.now();
    const statusFields = timestampFieldsForStatus(
      args.status,
      now,
      args.snoozedUntil,
    );
    const trimmedNote =
      args.note === undefined ? undefined : args.note.trim();
    if (trimmedNote && trimmedNote.length > MAX_NOTE_LENGTH) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Note must be ${MAX_NOTE_LENGTH} characters or fewer`,
      });
    }
    const existing = await ctx.db
      .query("cloudAdvisorStatuses")
      .withIndex("by_key", (q) => q.eq("recommendationKey", args.recommendationKey))
      .unique();

    const fields = {
      recommendationKey: args.recommendationKey,
      companyId: args.companyId,
      rule: args.rule,
      recommendedService: args.recommendedService,
      status: args.status,
      updatedAt: now,
      updatedBy: user._id,
      ...(args.note !== undefined ? { note: trimmedNote || undefined } : {}),
      ...statusFields,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }

    return await ctx.db.insert("cloudAdvisorStatuses", fields);
  },
});

export const reopenRecommendation = mutation({
  args: {
    recommendationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db
      .query("cloudAdvisorStatuses")
      .withIndex("by_key", (q) => q.eq("recommendationKey", args.recommendationKey))
      .unique();

    if (!existing) {
      return { deleted: false };
    }

    const company = await ctx.db.get(existing.companyId);
    if (!company) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Company not found",
      });
    }
    assertCanManageCompany(user, company);

    await ctx.db.delete(existing._id);
    return { deleted: true };
  },
});
