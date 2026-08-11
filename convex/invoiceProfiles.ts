import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  assertNotMonitoring,
  canViewCompany,
  isCeoOrHob,
} from "./authorization";

type Ctx = QueryCtx | MutationCtx;
type InvoiceProfileInput = {
  name: string;
  countryId?: Id<"countries">;
  region?: string;
  isDefault: boolean;
  isActive: boolean;
  legalName: string;
  logoPath?: string;
  slogan?: string;
  addressLines: string[];
  phone: string;
  email: string;
  website: string;
  taxId?: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  bankLocation: string;
  currency?: string;
  currencyNote: string;
  paymentInstructions: string;
  footerText?: string;
};

const invoiceProfileFieldsValidator = {
  name: v.string(),
  countryId: v.optional(v.id("countries")),
  region: v.optional(v.string()),
  isDefault: v.boolean(),
  isActive: v.boolean(),
  legalName: v.string(),
  logoPath: v.optional(v.string()),
  slogan: v.optional(v.string()),
  addressLines: v.array(v.string()),
  phone: v.string(),
  email: v.string(),
  website: v.string(),
  taxId: v.optional(v.string()),
  bankName: v.string(),
  bankAccountNumber: v.string(),
  bankAccountName: v.string(),
  bankLocation: v.string(),
  currency: v.optional(v.string()),
  currencyNote: v.string(),
  paymentInstructions: v.string(),
  footerText: v.optional(v.string()),
};

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
  assertNotMonitoring(user);
  return user;
}

function assertCanManageInvoiceProfiles(user: Doc<"users">) {
  if (isCeoOrHob(user)) return;
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "Only CEO or Head of Business can manage invoice profiles",
  });
}

function requiredText(value: string, fieldName: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${fieldName} is required`,
    });
  }
  return trimmed;
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAddressLines(addressLines: string[]) {
  const normalized = addressLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (normalized.length === 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "At least one invoice profile address line is required",
    });
  }
  return normalized;
}

function normalizeProfileInput(args: InvoiceProfileInput) {
  return {
    name: requiredText(args.name, "Profile name"),
    countryId: args.countryId,
    region: optionalText(args.region),
    isDefault: args.isDefault,
    isActive: args.isActive,
    legalName: requiredText(args.legalName, "Legal name"),
    logoPath: optionalText(args.logoPath),
    slogan: optionalText(args.slogan),
    addressLines: normalizeAddressLines(args.addressLines),
    phone: requiredText(args.phone, "Phone"),
    email: requiredText(args.email, "Email"),
    website: requiredText(args.website, "Website"),
    taxId: optionalText(args.taxId),
    bankName: requiredText(args.bankName, "Bank name"),
    bankAccountNumber: requiredText(
      args.bankAccountNumber,
      "Bank account number",
    ),
    bankAccountName: requiredText(args.bankAccountName, "Bank account name"),
    bankLocation: requiredText(args.bankLocation, "Bank location"),
    currency: optionalText(args.currency) ?? "USD",
    currencyNote: requiredText(args.currencyNote, "Currency note"),
    paymentInstructions: requiredText(
      args.paymentInstructions,
      "Payment instructions",
    ),
    footerText: optionalText(args.footerText),
  };
}

async function unsetOtherActiveDefaults(
  ctx: MutationCtx,
  currentProfileId: Id<"invoiceProfiles"> | undefined,
) {
  const activeDefaults = await ctx.db
    .query("invoiceProfiles")
    .withIndex("by_default_active", (q) =>
      q.eq("isDefault", true).eq("isActive", true),
    )
    .collect();
  for (const profile of activeDefaults) {
    if (profile._id !== currentProfileId) {
      await ctx.db.patch(profile._id, { isDefault: false });
    }
  }
}

export const listInvoiceProfiles = query({
  args: {
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await getCurrentUserOrThrow(ctx);
    const profiles = await ctx.db.query("invoiceProfiles").collect();
    return profiles
      .filter((profile) => args.includeInactive || profile.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createInvoiceProfile = mutation({
  args: invoiceProfileFieldsValidator,
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageInvoiceProfiles(user);
    const fields = normalizeProfileInput(args);
    const now = Date.now();
    const profileId = await ctx.db.insert("invoiceProfiles", {
      ...fields,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    if (fields.isDefault && fields.isActive) {
      await unsetOtherActiveDefaults(ctx, profileId);
    }
    return profileId;
  },
});

export const updateInvoiceProfile = mutation({
  args: {
    profileId: v.id("invoiceProfiles"),
    ...invoiceProfileFieldsValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanManageInvoiceProfiles(user);
    const existing = await ctx.db.get(args.profileId);
    if (!existing) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Invoice profile not found",
      });
    }
    const fields = normalizeProfileInput(args);
    await ctx.db.patch(args.profileId, {
      ...fields,
      updatedAt: Date.now(),
    });
    if (fields.isDefault && fields.isActive) {
      await unsetOtherActiveDefaults(ctx, args.profileId);
    }
  },
});

export const getDefaultInvoiceProfile = query({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    const defaults = await ctx.db
      .query("invoiceProfiles")
      .withIndex("by_default_active", (q) =>
        q.eq("isDefault", true).eq("isActive", true),
      )
      .collect();
    return defaults[0] ?? null;
  },
});

export const resolveInvoiceProfileForCompany = query({
  args: {
    companyId: v.id("companies"),
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
    if (!canViewCompany(user, company)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You do not have permission to view this company",
      });
    }
    const countryProfiles = await ctx.db
      .query("invoiceProfiles")
      .withIndex("by_country", (q) => q.eq("countryId", company.countryId))
      .collect();
    const countryMatch = countryProfiles.find((profile) => profile.isActive);
    if (countryMatch) return countryMatch;

    const defaults = await ctx.db
      .query("invoiceProfiles")
      .withIndex("by_default_active", (q) =>
        q.eq("isDefault", true).eq("isActive", true),
      )
      .collect();
    return defaults[0] ?? null;
  },
});
