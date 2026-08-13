import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertCanManageUsage,
  assertNotMonitoring,
  canViewCompany,
} from "./authorization";
import { buildUsageHintsForCompany } from "./manageOneTenants";

type CatalogItem = Doc<"serviceCatalog">;
type ManageOneTenant = Doc<"manageOneTenants">;
type RollupRow = {
  companyId: Id<"companies">;
  companyName: string;
  serviceType: string;
  itemName: string;
  unit: string;
  catalogItemId?: Id<"serviceCatalog">;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
  dailyQuantityTotal: number;
  capturedDays: number;
  billableQuantity: number;
  monthlyUnitPrice?: number;
  estimatedAmount?: number;
};

export type DailyUsageSnapshotInput = {
  companyId: Id<"companies">;
  tenantId: Id<"manageOneTenants">;
  tenantName: string;
  tenantVdcId: string;
  tenantDomainId?: string;
  usageDate: string;
  month: string;
  serviceType: string;
  itemName: string;
  serviceCategory: string;
  quantity: number;
  unit: string;
  catalogItemId?: Id<"serviceCatalog">;
  source: "manageone";
  sourceKey: string;
  sourceSyncedAt?: number;
  capturedAt: number;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
};

const BUSINESS_TIME_ZONE = "Africa/Mogadishu";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getCurrentUserOrThrow(ctx: QueryCtx | MutationCtx) {
  return ctx.auth.getUserIdentity().then(async (identity) => {
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
  });
}

export function dateKeyForTimestamp(
  timestamp: number,
  timeZone = BUSINESS_TIME_ZONE,
) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to format daily usage date");
  }

  return `${year}-${month}-${day}`;
}

function assertValidDateKey(value: string) {
  if (!DATE_KEY_PATTERN.test(value)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "usageDate must use YYYY-MM-DD format",
    });
  }
}

function optionalRegionFields(source: {
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
}) {
  return {
    ...(source.regionId ? { regionId: source.regionId } : {}),
    ...(source.regionName ? { regionName: source.regionName } : {}),
    ...(source.dataCenterName ? { dataCenterName: source.dataCenterName } : {}),
  };
}

function stableSegment(value: string | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function defaultUnitForService(serviceCategory: string) {
  const normalized = serviceCategory.toLowerCase();
  if (
    normalized.includes("obs") ||
    normalized.includes("evs") ||
    normalized.includes("sfs")
  ) {
    return "GB/day snapshot";
  }
  if (normalized.includes("bandwidth")) {
    return "Mbps/day snapshot";
  }
  if (normalized.includes("eip")) {
    return "IP/day snapshot";
  }
  return "unit/day snapshot";
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) {
    return 30;
  }
  return new Date(year, monthNumber, 0).getDate();
}

function monthEndTimestamp(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Source month must use YYYY-MM format",
    });
  }
  return Date.UTC(year, monthNumber, 0, 23, 59, 59, 999);
}

function dailyUsageSourceReference(month: string) {
  return `Daily usage ${month}`;
}

async function resolveInvoiceProfileForCompany(
  ctx: QueryCtx | MutationCtx,
  company: Doc<"companies">,
) {
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
}

function sellerSnapshotFromProfile(profile: Doc<"invoiceProfiles">) {
  return {
    sellerLegalName: profile.legalName,
    sellerAddressLines: [...profile.addressLines],
    sellerPhone: profile.phone,
    sellerEmail: profile.email,
    sellerWebsite: profile.website,
    sellerSlogan: profile.slogan,
    sellerTaxId: profile.taxId,
    sellerBankName: profile.bankName,
    sellerBankAccountNumber: profile.bankAccountNumber,
    sellerBankAccountName: profile.bankAccountName,
    sellerBankLocation: profile.bankLocation,
    sellerCurrency: profile.currency,
    sellerCurrencyNote: profile.currencyNote,
    sellerPaymentInstructions: profile.paymentInstructions,
    sellerFooterText: profile.footerText,
  } satisfies Partial<Doc<"invoices">>;
}

function buildMonthlyRollupRows(args: {
  rows: Doc<"dailyUsageSnapshots">[];
  catalogById: Map<Id<"serviceCatalog">, CatalogItem>;
  companyNameById: Map<Id<"companies">, string>;
  month: string;
}) {
  const monthDayCount = daysInMonth(args.month);
  const rollupByKey = new Map<
    string,
    Omit<RollupRow, "capturedDays" | "billableQuantity" | "estimatedAmount"> & {
      capturedDays: Set<string>;
    }
  >();

  for (const row of args.rows) {
    const groupKey = [
      row.companyId,
      row.catalogItemId ?? row.itemName,
      row.serviceType,
      row.unit,
      row.regionName ?? row.dataCenterName ?? "",
    ].join("|");
    const existing = rollupByKey.get(groupKey) ?? {
      companyId: row.companyId,
      companyName: args.companyNameById.get(row.companyId) ?? "Unknown",
      serviceType: row.serviceType,
      itemName: row.itemName,
      unit: row.unit,
      ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
      ...(row.regionId ? { regionId: row.regionId } : {}),
      ...(row.regionName ? { regionName: row.regionName } : {}),
      ...(row.dataCenterName ? { dataCenterName: row.dataCenterName } : {}),
      dailyQuantityTotal: 0,
      capturedDays: new Set<string>(),
      monthlyUnitPrice: row.catalogItemId
        ? args.catalogById.get(row.catalogItemId)?.monthlyPrice
        : undefined,
    };

    existing.dailyQuantityTotal += row.quantity;
    existing.capturedDays.add(row.usageDate);
    rollupByKey.set(groupKey, existing);
  }

  return [...rollupByKey.values()]
    .map((row) => {
      const billableQuantity = row.dailyQuantityTotal / monthDayCount;
      const estimatedAmount =
        row.monthlyUnitPrice === undefined
          ? undefined
          : roundMoney(billableQuantity * row.monthlyUnitPrice);
      return {
        companyId: row.companyId,
        companyName: row.companyName,
        serviceType: row.serviceType,
        itemName: row.itemName,
        unit: row.unit,
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        ...(row.regionId ? { regionId: row.regionId } : {}),
        ...(row.regionName ? { regionName: row.regionName } : {}),
        ...(row.dataCenterName ? { dataCenterName: row.dataCenterName } : {}),
        capturedDays: row.capturedDays.size,
        dailyQuantityTotal: row.dailyQuantityTotal,
        billableQuantity,
        monthlyUnitPrice: row.monthlyUnitPrice,
        estimatedAmount,
      } satisfies RollupRow;
    })
    .sort((a, b) => {
      const companyCompare = a.companyName.localeCompare(b.companyName);
      if (companyCompare !== 0) return companyCompare;
      const serviceCompare = a.serviceType.localeCompare(b.serviceType);
      if (serviceCompare !== 0) return serviceCompare;
      return a.itemName.localeCompare(b.itemName);
    });
}

function sourceKeyFor(input: {
  companyId: Id<"companies">;
  tenantId: Id<"manageOneTenants">;
  usageDate: string;
  serviceType: string;
  itemName: string;
  catalogItemId?: Id<"serviceCatalog">;
  regionId?: string;
  regionName?: string;
  dataCenterName?: string;
}) {
  return [
    "manageone",
    input.usageDate,
    input.companyId,
    input.tenantId,
    stableSegment(input.serviceType),
    input.catalogItemId ?? stableSegment(input.itemName),
    stableSegment(input.regionId ?? input.regionName ?? input.dataCenterName),
  ].join("|");
}

export function buildDailyUsageRowsFromManageOneTenants(
  tenants: ManageOneTenant[],
  catalog: CatalogItem[],
  usageDate: string,
  capturedAt: number,
): DailyUsageSnapshotInput[] {
  const month = usageDate.slice(0, 7);
  const rows: DailyUsageSnapshotInput[] = [];

  for (const tenant of tenants) {
    if (!tenant.linkedCompanyId) {
      continue;
    }

    const hints = buildUsageHintsForCompany([tenant], catalog);
    for (const hint of hints) {
      const lineItems =
        hint.lineItems ??
        (hint.suggestedCatalogItemId
          ? [
              {
                label: hint.serviceCategory,
                serviceCategory: hint.serviceCategory,
                quantity: hint.quantity,
                pricing: hint.pricing,
                suggestedCatalogItemId: hint.suggestedCatalogItemId,
                ...optionalRegionFields(hint),
              },
            ]
          : []);

      for (const lineItem of lineItems) {
        if (lineItem.quantity <= 0) {
          continue;
        }

        const serviceCategory =
          lineItem.serviceCategory ?? hint.serviceCategory;
        const catalogItem = lineItem.suggestedCatalogItemId
          ? catalog.find((item) => item._id === lineItem.suggestedCatalogItemId)
          : undefined;
        const itemName = catalogItem?.itemName ?? lineItem.label;
        const regionFields = optionalRegionFields({
          ...optionalRegionFields(hint),
          ...optionalRegionFields(lineItem),
        });

        rows.push({
          companyId: tenant.linkedCompanyId,
          tenantId: tenant._id,
          tenantName: tenant.name,
          tenantVdcId: tenant.vdcId,
          ...(tenant.domainId ? { tenantDomainId: tenant.domainId } : {}),
          usageDate,
          month,
          serviceType: serviceCategory,
          itemName,
          serviceCategory,
          quantity: lineItem.quantity,
          unit:
            catalogItem?.billingUnit ?? defaultUnitForService(serviceCategory),
          ...(catalogItem ? { catalogItemId: catalogItem._id } : {}),
          source: "manageone",
          sourceKey: sourceKeyFor({
            companyId: tenant.linkedCompanyId,
            tenantId: tenant._id,
            usageDate,
            serviceType: serviceCategory,
            itemName,
            catalogItemId: catalogItem?._id,
            ...regionFields,
          }),
          sourceSyncedAt: tenant.lastSyncedAt,
          capturedAt,
          ...regionFields,
        });
      }
    }
  }

  return rows;
}

export const captureFromManageOneSnapshots = internalMutation({
  args: {
    usageDate: v.optional(v.string()),
    capturedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const capturedAt = args.capturedAt ?? Date.now();
    const usageDate = args.usageDate ?? dateKeyForTimestamp(capturedAt);
    assertValidDateKey(usageDate);

    const tenants = await ctx.db.query("manageOneTenants").collect();
    const catalog = await ctx.db.query("serviceCatalog").collect();
    const rows = buildDailyUsageRowsFromManageOneTenants(
      tenants,
      catalog,
      usageDate,
      capturedAt,
    );

    let inserted = 0;
    let updated = 0;
    let skippedLocked = 0;

    for (const row of rows) {
      const existing = await ctx.db
        .query("dailyUsageSnapshots")
        .withIndex("by_source_key", (q) => q.eq("sourceKey", row.sourceKey))
        .unique();

      if (existing?.lockedAt || existing?.invoiceId) {
        skippedLocked++;
        continue;
      }

      if (existing) {
        await ctx.db.patch(existing._id, row);
        updated++;
      } else {
        await ctx.db.insert("dailyUsageSnapshots", row);
        inserted++;
      }
    }

    return {
      usageDate,
      inspectedTenants: tenants.length,
      capturedRows: rows.length,
      inserted,
      updated,
      skippedLocked,
    };
  },
});

export const listByCompanyMonth = query({
  args: {
    companyId: v.id("companies"),
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    await assertCanManageUsage(ctx, user, args.companyId);

    return await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.companyId).eq("month", args.month),
      )
      .collect();
  },
});

export const createDraftInvoiceFromRollup = mutation({
  args: {
    companyId: v.id("companies"),
    month: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const company = await assertCanManageUsage(ctx, user, args.companyId);
    const sourceReference = dailyUsageSourceReference(args.month);

    const existingInvoice = (
      await ctx.db
        .query("invoices")
        .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
        .collect()
    ).find(
      (invoice) =>
        invoice.sourceMonth === args.month &&
        invoice.sourceReference === sourceReference &&
        invoice.status !== "cancelled" &&
        invoice.status !== "void",
    );
    if (existingInvoice) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `A daily usage invoice already exists for ${company.name} and ${args.month}`,
      });
    }

    const rows = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_company_month", (q) =>
        q.eq("companyId", args.companyId).eq("month", args.month),
      )
      .collect();
    if (rows.length === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "No daily usage rows found for this customer and month",
      });
    }
    const attachedRows = rows.filter((row) => row.invoiceId || row.lockedAt);
    if (attachedRows.length > 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Some daily usage rows are already attached to an invoice for this month",
      });
    }

    const catalogById = new Map(
      (await ctx.db.query("serviceCatalog").collect()).map((item) => [
        item._id,
        item,
      ]),
    );
    const companyNameById = new Map<Id<"companies">, string>([
      [company._id, company.name],
    ]);
    const rollupRows = buildMonthlyRollupRows({
      rows,
      catalogById,
      companyNameById,
      month: args.month,
    });
    const unpriced = rollupRows.filter(
      (row) =>
        row.monthlyUnitPrice === undefined || row.estimatedAmount === undefined,
    );
    if (unpriced.length > 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "All daily usage rollup rows must have catalog pricing before creating an invoice",
      });
    }

    const lineItems = rollupRows.map((row) => {
      const monthlyTotal = roundMoney(row.estimatedAmount ?? 0);
      return {
        ...(row.catalogItemId ? { catalogItemId: row.catalogItemId } : {}),
        itemName: row.itemName,
        serviceCategory: row.serviceType,
        billingUnit: row.unit,
        quantity: roundMoney(row.billableQuantity),
        monthlyUnitPrice: row.monthlyUnitPrice ?? 0,
        monthlyTotal,
        yearlyTotal: roundMoney(monthlyTotal * 12),
        ...(row.regionId ? { regionId: row.regionId } : {}),
        ...(row.regionName ? { regionName: row.regionName } : {}),
        ...(row.dataCenterName ? { dataCenterName: row.dataCenterName } : {}),
      };
    });
    const grandTotal = roundMoney(
      lineItems.reduce((total, line) => total + line.monthlyTotal, 0),
    );
    const invoiceProfile = await resolveInvoiceProfileForCompany(ctx, company);
    const sellerSnapshot = invoiceProfile
      ? sellerSnapshotFromProfile(invoiceProfile)
      : {};
    const now = Date.now();
    const dueDate =
      company.paymentTermDays === undefined
        ? undefined
        : monthEndTimestamp(args.month) + company.paymentTermDays * MS_PER_DAY;

    const invoiceId = await ctx.db.insert("invoices", {
      companyId: company._id,
      sourceMonth: args.month,
      sourceReference,
      invoiceProfileId: invoiceProfile?._id,
      ...sellerSnapshot,
      createdBy: user._id,
      status: "draft",
      dueDate,
      companyName: company.name,
      contactName: company.contactName,
      contactEmail: company.contactEmail,
      billingEmail: company.contactEmail,
      lineItems,
      subtotal: grandTotal,
      monthlyTotal: grandTotal,
      yearlyTotal: roundMoney(grandTotal * 12),
      grandTotal,
      amountPaid: 0,
      balanceDue: grandTotal,
      notes: `Draft invoice from daily usage snapshots for ${args.month}. Review before issuing.`,
      createdAt: now,
      updatedAt: now,
    });

    for (const row of rows) {
      await ctx.db.patch(row._id, { invoiceId });
    }

    await ctx.db.insert("invoiceEvents", {
      invoiceId,
      type: "draft_created",
      actorId: user._id,
      message: `Draft invoice created from daily usage ${args.month}.`,
      createdAt: now,
    });

    return { invoiceId, companyName: company.name, grandTotal };
  },
});

export const review = query({
  args: {
    month: v.string(),
    companyId: v.optional(v.id("companies")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);

    const rows = args.companyId
      ? await ctx.db
          .query("dailyUsageSnapshots")
          .withIndex("by_company_month", (q) =>
            q.eq("companyId", args.companyId!).eq("month", args.month),
          )
          .collect()
      : await ctx.db
          .query("dailyUsageSnapshots")
          .withIndex("by_month", (q) => q.eq("month", args.month))
          .collect();

    const visibleRows = [];
    const companyNameById = new Map<Id<"companies">, string>();

    for (const row of rows) {
      const company = args.companyId
        ? await assertCanManageUsage(ctx, user, row.companyId)
        : await ctx.db.get(row.companyId);
      if (!company || !canViewCompany(user, company)) {
        continue;
      }
      visibleRows.push(row);
      companyNameById.set(row.companyId, company.name);
    }

    const serviceTypes = [...new Set(visibleRows.map((row) => row.serviceType))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const usageDates = [...new Set(visibleRows.map((row) => row.usageDate))]
      .filter(Boolean)
      .sort();
    const companies = [...companyNameById.entries()]
      .map(([companyId, companyName]) => ({ companyId, companyName }))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));

    const sortedRows = [...visibleRows].sort((a, b) => {
      const dateCompare = b.usageDate.localeCompare(a.usageDate);
      if (dateCompare !== 0) return dateCompare;
      const companyCompare = (
        companyNameById.get(a.companyId) ?? ""
      ).localeCompare(companyNameById.get(b.companyId) ?? "");
      if (companyCompare !== 0) return companyCompare;
      return a.serviceType.localeCompare(b.serviceType);
    });

    const catalogById = new Map(
      (await ctx.db.query("serviceCatalog").collect()).map((item) => [
        item._id,
        item,
      ]),
    );
    const monthDayCount = daysInMonth(args.month);
    const rollupRows = buildMonthlyRollupRows({
      rows: visibleRows,
      catalogById,
      companyNameById,
      month: args.month,
    });

    return {
      month: args.month,
      rows: sortedRows.map((row) => ({
        ...row,
        companyName: companyNameById.get(row.companyId) ?? "Unknown",
      })),
      rollup: {
        daysInMonth: monthDayCount,
        rows: rollupRows,
        totals: {
          estimatedAmount: rollupRows.reduce(
            (total, row) => total + (row.estimatedAmount ?? 0),
            0,
          ),
          unpricedCount: rollupRows.filter(
            (row) => row.estimatedAmount === undefined,
          ).length,
          attachedCount: visibleRows.filter(
            (row) => row.invoiceId || row.lockedAt,
          ).length,
        },
      },
      summary: {
        rowCount: visibleRows.length,
        companyCount: companies.length,
        serviceCount: serviceTypes.length,
        dayCount: usageDates.length,
        capturedCount: visibleRows.filter((row) => !row.lockedAt).length,
        lockedCount: visibleRows.filter((row) => row.lockedAt).length,
      },
      filters: {
        companies,
        serviceTypes,
        usageDates,
      },
    };
  },
});
