import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

type Ctx = QueryCtx | MutationCtx;

async function getCurrentUserOrThrow(ctx: Ctx): Promise<Doc<"users">> {
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

function assertCanViewTenantUsageHistory(user: Doc<"users">) {
  if (
    user.role === "ceo" ||
    user.role === "head_of_business" ||
    user.role === "country_gm"
  ) {
    return;
  }

  throw new ConvexError({
    code: "FORBIDDEN",
    message:
      "Only Country GM, Head of Business, or CEO can view tenant usage history",
  });
}

const usageHistoryItem = {
  linkedCompanyId: v.id("companies"),
  tenantName: v.string(),
  ecsInstances: v.number(),
  ecsCores: v.number(),
  ecsRamGb: v.number(),
  rdsInstances: v.number(),
  cceClusters: v.number(),
  evsGb: v.number(),
  obsGb: v.number(),
  sfsGb: v.number(),
  publicIps: v.number(),
  wafInstances: v.number(),
  syncedAt: v.number(),
};

export const bulkInsert = internalMutation({
  args: {
    rows: v.array(v.object(usageHistoryItem)),
  },
  handler: async (ctx, args) => {
    let inserted = 0;

    for (const row of args.rows) {
      await ctx.db.insert("tenantUsageHistory", row);
      inserted++;
    }

    return inserted;
  },
});

export const history = query({
  args: {
    companyId: v.id("companies"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanViewTenantUsageHistory(user);

    const limit = Math.min(Math.max(Math.floor(args.limit ?? 90), 1), 365);
    const rows = await ctx.db
      .query("tenantUsageHistory")
      .withIndex("by_company_synced_at", (q) =>
        q.eq("linkedCompanyId", args.companyId),
      )
      .order("desc")
      .take(limit);

    return rows.reverse();
  },
});
