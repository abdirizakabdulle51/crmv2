import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  assertNotMonitoring,
  canViewCompany,
  isCeoOrHob,
} from "./authorization";
import { allocateMoney, sumMoney } from "./money";
import { financialMonthStart, financialYear, historicalDateDay } from "./financialDates";

type AchievementRow = {
  accountManagerId: Id<"users">;
  countryId?: Id<"countries">;
  sectorId: Id<"sectors">;
  amount: number;
};

function yearFromTimestamp(timestamp: number) {
  return financialYear(timestamp);
}

async function getCurrentUserOrThrow(ctx: QueryCtx): Promise<Doc<"users">> {
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

function isRevenueInvoice(invoice: Doc<"invoices">) {
  return (
    invoice.isTest !== true &&
    invoice.hiddenAt === undefined &&
    invoice.status !== "draft" &&
    invoice.status !== "void" &&
    invoice.status !== "cancelled"
  );
}

export async function buildCollectedRevenueAchievement(
  ctx: QueryCtx,
  year: number,
  visibleCompanies: Doc<"companies">[],
) {
  const companyById = new Map(
    visibleCompanies.map((company) => [company._id, company]),
  );
  const invoices = (await ctx.db.query("invoices").collect()).filter(
    (invoice) =>
      companyById.has(invoice.companyId) && isRevenueInvoice(invoice),
  );
  const invoiceById = new Map(
    invoices.map((invoice) => [invoice._id, invoice]),
  );
  const recordedByInvoiceId = new Map<Id<"invoices">, number>();
  const rows: AchievementRow[] = [];

  const addRow = (
    invoice: Doc<"invoices">,
    amount: number,
    collectedAt: number,
  ) => {
    const collectedYear = invoice.isHistorical
      ? Number(historicalDateDay(collectedAt).slice(0, 4))
      : yearFromTimestamp(collectedAt);
    if (collectedYear !== year || amount <= 0) {
      return;
    }
    const company = companyById.get(invoice.companyId);
    if (!company?.accountManagerId) {
      return;
    }
    rows.push({
      accountManagerId: company.accountManagerId,
      countryId: company.countryId,
      sectorId: company.sectorId,
      amount,
    });
  };
  const addCollection = (
    invoice: Doc<"invoices">,
    amount: number,
    collectedAt: number,
  ) => {
    if (
      invoice.billingTiming === "prepaid" &&
      invoice.revenueAllocations?.length
    ) {
      const allocations = allocateMoney(
        amount,
        invoice.revenueAllocations.map((allocation) => ({
          month: allocation.month,
          weight: allocation.amount,
        })),
      );
      for (const allocation of allocations) {
        const allocationStart = financialMonthStart(allocation.month);
        addRow(
          invoice,
          allocation.amount,
          collectedAt < allocationStart
            ? allocationStart
            : collectedAt,
        );
      }
      return;
    }
    addRow(invoice, amount, collectedAt);
  };

  for (const payment of await ctx.db.query("invoicePayments").collect()) {
    const invoice = invoiceById.get(payment.invoiceId);
    if (!invoice) {
      continue;
    }
    recordedByInvoiceId.set(
      invoice._id,
      sumMoney([recordedByInvoiceId.get(invoice._id) ?? 0, payment.amount]),
    );
    addCollection(invoice, payment.amount, payment.paidAt);
  }

  for (const invoice of invoices) {
    const recorded = recordedByInvoiceId.get(invoice._id) ?? 0;
    const unrecorded = sumMoney([invoice.amountPaid, -recorded]);
    addCollection(invoice, unrecorded, invoice.updatedAt);
  }

  const byAccountManager: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const bySector: Record<string, number> = {};

  for (const row of rows) {
    byAccountManager[row.accountManagerId] = sumMoney([
      byAccountManager[row.accountManagerId] ?? 0,
      row.amount,
    ]);
    if (row.countryId) {
      byCountry[row.countryId] = sumMoney([
        byCountry[row.countryId] ?? 0,
        row.amount,
      ]);
    }
    bySector[row.sectorId] = sumMoney([
      bySector[row.sectorId] ?? 0,
      row.amount,
    ]);
  }

  return {
    total: sumMoney(rows.map((row) => row.amount)),
    byAccountManager,
    byCountry,
    bySector,
  };
}

async function getVisibleCompanies(ctx: QueryCtx, user: Doc<"users">) {
  const companies = await ctx.db.query("companies").collect();
  if (isCeoOrHob(user)) {
    return companies;
  }
  return companies.filter((company) => canViewCompany(user, company));
}

export const byYear = query({
  args: { year: v.number() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const visibleCompanies = await getVisibleCompanies(ctx, user);
    return await buildCollectedRevenueAchievement(
      ctx,
      args.year,
      visibleCompanies,
    );
  },
});
