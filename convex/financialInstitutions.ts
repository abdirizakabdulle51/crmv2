import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assertNotMonitoring, isCeoOrHob } from "./authorization";

const normalize = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

async function user(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity)
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "User not logged in",
    });
  const result = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!result)
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "User profile not found",
    });
  assertNotMonitoring(result);
  return result;
}

export const list = query({
  args: {
    countryId: v.optional(v.id("countries")),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const current = await user(ctx);
    const rows = args.countryId
      ? await ctx.db
          .query("financialInstitutions")
          .withIndex("by_country", (q) => q.eq("countryId", args.countryId!))
          .collect()
      : await ctx.db.query("financialInstitutions").collect();
    return rows
      .filter(
        (row) =>
          (args.includeInactive || row.isActive) &&
          (isCeoOrHob(current) ||
            (!!current.countryId && row.countryId === current.countryId)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    countryId: v.id("countries"),
    name: v.string(),
    code: v.optional(v.string()),
    swiftCode: v.optional(v.string()),
    type: v.union(v.literal("bank"), v.literal("mobile_money")),
  },
  handler: async (ctx, args) => {
    const current = await user(ctx);
    if (!isCeoOrHob(current))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can manage banks",
      });
    if (!(await ctx.db.get(args.countryId)))
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Country not found",
      });
    const normalizedName = normalize(args.name);
    if (!normalizedName)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Institution name is required",
      });
    const duplicate = await ctx.db
      .query("financialInstitutions")
      .withIndex("by_country_name", (q) =>
        q.eq("countryId", args.countryId).eq("normalizedName", normalizedName),
      )
      .unique();
    if (duplicate)
      throw new ConvexError({
        code: "CONFLICT",
        message: "This institution is already registered in the country",
      });
    const now = Date.now();
    return ctx.db.insert("financialInstitutions", {
      ...args,
      name: args.name.trim(),
      normalizedName,
      code: args.code?.trim().toUpperCase() || undefined,
      swiftCode: args.swiftCode?.trim().toUpperCase() || undefined,
      isActive: true,
      createdBy: current._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const setActive = mutation({
  args: { institutionId: v.id("financialInstitutions"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const current = await user(ctx);
    if (!isCeoOrHob(current))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can manage banks",
      });
    if (!(await ctx.db.get(args.institutionId)))
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Institution not found",
      });
    if (!args.isActive) {
      const linked = (await ctx.db.query("receivingAccounts").collect()).some(
        (account) =>
          account.institutionId === args.institutionId && account.isActive,
      );
      if (linked)
        throw new ConvexError({
          code: "CONFLICT",
          message: "Deactivate linked finance accounts before this institution",
        });
    }
    await ctx.db.patch(args.institutionId, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    institutionId: v.id("financialInstitutions"),
    name: v.string(),
    code: v.optional(v.string()),
    swiftCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const current = await user(ctx);
    if (!isCeoOrHob(current))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can manage banks",
      });
    const institution = await ctx.db.get(args.institutionId);
    if (!institution)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Institution not found",
      });
    const normalizedName = normalize(args.name);
    if (!normalizedName)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Institution name is required",
      });
    const duplicate = await ctx.db
      .query("financialInstitutions")
      .withIndex("by_country_name", (q) =>
        q
          .eq("countryId", institution.countryId)
          .eq("normalizedName", normalizedName),
      )
      .unique();
    if (duplicate && duplicate._id !== institution._id)
      throw new ConvexError({
        code: "CONFLICT",
        message: "This institution is already registered in the country",
      });
    await ctx.db.patch(args.institutionId, {
      name: args.name.trim(),
      normalizedName,
      code: args.code?.trim().toUpperCase() || undefined,
      swiftCode: args.swiftCode?.trim().toUpperCase() || undefined,
      updatedAt: Date.now(),
    });
    const linkedAccounts = (
      await ctx.db.query("receivingAccounts").collect()
    ).filter((account) => account.institutionId === args.institutionId);
    for (const account of linkedAccounts)
      await ctx.db.patch(account._id, {
        providerName: args.name.trim(),
        searchText:
          `${account.name} ${args.name.trim()} ${account.accountNumber}`
            .trim()
            .toLowerCase(),
        updatedAt: Date.now(),
      });
  },
});
