import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assertNotMonitoring, isCeoOrHob } from "./authorization";

type Ctx = QueryCtx | MutationCtx;

const APPLY_CONFIRMATION = "BACKFILL_INVOICE_SOURCES";

async function getCurrentAdminOrThrow(ctx: Ctx) {
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
  if (!isCeoOrHob(user)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Only CEO or Head of Business can backfill invoice sources",
    });
  }
  return user;
}

function monthInputValue(timestamp: number) {
  const date = new Date(timestamp);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function addMonths(month: string, count: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return monthInputValue(date.getTime());
}

function monthDiff(startMonth: string, endMonth: string) {
  const [startYear, startNumber] = startMonth.split("-").map(Number);
  const [endYear, endNumber] = endMonth.split("-").map(Number);
  return (endYear - startYear) * 12 + (endNumber - startNumber);
}

function frequencyMonths(
  frequency: Doc<"customerContracts">["billingFrequency"],
) {
  if (frequency === "quarterly" || frequency === "every_3_months") return 3;
  if (frequency === "yearly") return 12;
  return 1;
}

function contractPeriodForInvoice(
  contract: Doc<"customerContracts">,
  invoice: Doc<"invoices">,
) {
  const frequencyMonthCount = frequencyMonths(contract.billingFrequency);
  const contractStartMonth = monthInputValue(contract.startDate);
  const contractEndMonth = monthInputValue(contract.endDate);
  const sourceMonth = invoice.sourceMonth ?? contractStartMonth;
  const offset = Math.max(0, monthDiff(contractStartMonth, sourceMonth));
  const periodOffset =
    Math.floor(offset / frequencyMonthCount) * frequencyMonthCount;
  const periodStartMonth = addMonths(contractStartMonth, periodOffset);
  const periodEndMonth = addMonths(periodStartMonth, frequencyMonthCount - 1);

  return {
    startMonth: periodStartMonth,
    endMonth:
      monthDiff(periodEndMonth, contractEndMonth) > 0
        ? contractEndMonth
        : periodEndMonth,
  };
}

function dailyUsageMonth(sourceReference: string | undefined) {
  const match = sourceReference?.match(/^Daily usage (\d{4}-\d{2})$/);
  return match?.[1];
}

function sourcePatchForInvoice(
  invoice: Doc<"invoices">,
  contractByNumber: Map<string, Doc<"customerContracts">>,
) {
  if (invoice.sourceReference) {
    const contract = contractByNumber.get(invoice.sourceReference);
    if (contract) {
      const period = contractPeriodForInvoice(contract, invoice);
      return {
        kind: "contract" as const,
        contract,
        patch: {
          sourceType: "contract" as const,
          sourceContractId: contract._id,
          contractPeriodStartMonth: period.startMonth,
          contractPeriodEndMonth: period.endMonth,
        },
      };
    }
  }

  if (invoice.sourceQuoteId) {
    return {
      kind: "quote" as const,
      patch: { sourceType: "quote" as const },
    };
  }

  const sourceMonth = dailyUsageMonth(invoice.sourceReference);
  if (sourceMonth) {
    return {
      kind: "daily_usage" as const,
      patch: {
        sourceType: "daily_usage" as const,
        sourceMonth: invoice.sourceMonth ?? sourceMonth,
      },
    };
  }

  return null;
}

function patchDiff(
  invoice: Doc<"invoices">,
  patch: Partial<Doc<"invoices">>,
) {
  const diff: Partial<Doc<"invoices">> = {};
  for (const [key, value] of Object.entries(patch)) {
    const typedKey = key as keyof Doc<"invoices">;
    if (invoice[typedKey] !== value) {
      (diff as Record<string, unknown>)[key] = value;
    }
  }
  return diff;
}

async function buildPreview(ctx: Ctx) {
  const contracts = await ctx.db.query("customerContracts").collect();
  const contractByNumber = new Map(
    contracts.map((contract) => [contract.contractNumber, contract]),
  );
  const invoices = await ctx.db.query("invoices").collect();

  const rows = invoices
    .map((invoice) => {
      const source = sourcePatchForInvoice(invoice, contractByNumber);
      if (!source) {
        return {
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          companyName: invoice.companyName,
          status: invoice.status,
          sourceReference: invoice.sourceReference,
          sourceMonth: invoice.sourceMonth,
          currentSourceType: invoice.sourceType,
          action: "skip" as const,
          reason: "No contract, quote, or daily usage source detected",
          changes: {},
        };
      }

      const changes = patchDiff(invoice, source.patch);
      return {
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        companyName: invoice.companyName,
        status: invoice.status,
        sourceReference: invoice.sourceReference,
        sourceMonth: invoice.sourceMonth,
        currentSourceType: invoice.sourceType,
        action:
          Object.keys(changes).length > 0
            ? (`update_${source.kind}` as const)
            : (`already_${source.kind}` as const),
        contractNumber:
          source.kind === "contract" ? source.contract.contractNumber : undefined,
        changes,
      };
    })
    .sort((a, b) => {
      const left = a.invoiceNumber ?? a.invoiceId;
      const right = b.invoiceNumber ?? b.invoiceId;
      return left.localeCompare(right);
    });

  const summary = rows.reduce(
    (total, row) => {
      total.scanned += 1;
      if (row.action === "update_contract") total.wouldUpdateContract += 1;
      else if (row.action === "update_quote") total.wouldUpdateQuote += 1;
      else if (row.action === "update_daily_usage") {
        total.wouldUpdateDailyUsage += 1;
      } else if (row.action.startsWith("already_")) total.alreadyLinked += 1;
      else total.skipped += 1;
      return total;
    },
    {
      scanned: 0,
      wouldUpdateContract: 0,
      wouldUpdateQuote: 0,
      wouldUpdateDailyUsage: 0,
      alreadyLinked: 0,
      skipped: 0,
    },
  );

  return { summary, rows };
}

export const preview = query({
  args: {},
  handler: async (ctx) => {
    await getCurrentAdminOrThrow(ctx);
    return await buildPreview(ctx);
  },
});

export const apply = mutation({
  args: {
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    await getCurrentAdminOrThrow(ctx);
    if (args.confirm !== APPLY_CONFIRMATION) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Pass confirm: "${APPLY_CONFIRMATION}" to apply invoice source backfill`,
      });
    }

    const previewResult = await buildPreview(ctx);
    const updated = [];
    for (const row of previewResult.rows) {
      if (!row.action.startsWith("update_")) continue;
      if (Object.keys(row.changes).length === 0) continue;
      await ctx.db.patch(row.invoiceId, row.changes);
      updated.push({
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber,
        companyName: row.companyName,
        action: row.action,
        changes: row.changes,
      });
    }

    return {
      before: previewResult.summary,
      updatedCount: updated.length,
      updated,
    };
  },
});
