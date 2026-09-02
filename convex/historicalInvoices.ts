import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import {
  assertCanManageCompany,
  canViewCompany,
} from "./authorization";
import {
  allocateMoney,
  calculateInvoiceTotals,
  calculateLineItems,
  fromCents,
  toCents,
  withInvoiceMoneyCents,
  withLineMoneyCents,
} from "./money";
import { calculatePaymentApplication } from "./invoices";

const PAYMENT_METHOD_BANK_TRANSFER = "Bank Transfer";
const PAYMENT_METHOD_MOBILE_MONEY = "Mobile Money";
const SUPPORTED_PAYMENT_METHODS = new Set([
  PAYMENT_METHOD_BANK_TRANSFER,
  PAYMENT_METHOD_MOBILE_MONEY,
]);

async function getCurrentUserOrThrow(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "User not logged in" });
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) {
    throw new ConvexError({ code: "NOT_FOUND", message: "User profile not found" });
  }
  if (user.role === "monitoring") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Monitoring users cannot access Finance" });
  }
  return user;
}

function normalizeReference(reference: string) {
  const normalized = reference.trim().toUpperCase();
  if (!normalized) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Original reference is required" });
  }
  return normalized;
}

function dateOnlyTimestamp(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConvexError({ code: "BAD_REQUEST", message: `${label} must use YYYY-MM-DD` });
  }
  const timestamp = Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  );
  if (new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new ConvexError({ code: "BAD_REQUEST", message: `${label} is not a valid date` });
  }
  return timestamp;
}

function coverageMonths(startMonth: string, count: number) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Coverage start month must use YYYY-MM" });
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new ConvexError({ code: "BAD_REQUEST", message: "Months covered must be at least 1" });
  }
  const start = Number(startMonth.slice(0, 4)) * 12 + Number(startMonth.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, index) => {
    const absolute = start + index;
    const year = Math.floor(absolute / 12);
    const month = (absolute % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

function historicalInvoiceNumber(
  companyId: Doc<"companies">["_id"],
  normalizedReference: string,
) {
  return `HIST-ODOO-${companyId}-${encodeURIComponent(normalizedReference)}`;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const [invoices, companies] = await Promise.all([
      ctx.db.query("invoices").collect(),
      ctx.db.query("companies").collect(),
    ]);
    const companyMap = new Map(companies.map((company) => [company._id, company]));
    const historical = invoices
      .filter(
        (invoice) =>
          invoice.isHistorical &&
          Boolean(companyMap.get(invoice.companyId)) &&
          canViewCompany(user, companyMap.get(invoice.companyId)!),
      );
    return await Promise.all(
      historical
        .sort((a, b) => (b.issueDate ?? b.createdAt) - (a.issueDate ?? a.createdAt))
        .map(async (invoice) => ({
          ...invoice,
          paymentDate: (
            await ctx.db
              .query("invoicePayments")
              .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
              .first()
          )?.paidAt,
        })),
    );
  },
});

export const create = mutation({
  args: {
    companyId: v.id("companies"),
    originalReference: v.string(),
    invoiceDate: v.string(),
    coverageStartMonth: v.string(),
    monthsCovered: v.number(),
    monthlyAmount: v.number(),
    paymentDate: v.string(),
    paymentMethod: v.optional(v.string()),
    receivingAccountId: v.optional(v.id("receivingAccounts")),
    paymentReference: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const company = await ctx.db.get(args.companyId);
    if (!company) throw new ConvexError({ code: "NOT_FOUND", message: "Company not found" });
    assertCanManageCompany(user, company);

    const normalizedReference = normalizeReference(args.originalReference);
    const invoiceDate = dateOnlyTimestamp(args.invoiceDate, "Invoice date");
    const paymentDate = dateOnlyTimestamp(args.paymentDate, "Payment date");
    const months = coverageMonths(args.coverageStartMonth, args.monthsCovered);
    const monthlyCents = toCents(args.monthlyAmount, "Monthly amount");
    if (monthlyCents <= 0) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Monthly amount must be positive" });
    }
    const monthlyAmount = fromCents(monthlyCents);
    const lineItems = calculateLineItems([
      {
        itemName: `Historical Odoo coverage (${args.coverageStartMonth})`,
        serviceCategory: "Historical Invoice",
        billingUnit: "month",
        quantity: args.monthsCovered,
        monthlyUnitPrice: monthlyAmount,
      },
    ]);
    const totals = calculateInvoiceTotals(lineItems);
    const revenueAllocations = allocateMoney(
      totals.grandTotal,
      months.map((month) => ({ month, weight: 1 })),
    ).map(({ month, amount }) => ({ month, amount }));
    const receivableAllocations = allocateMoney(
      totals.grandTotal,
      months.map((month) => ({ month, weight: 1 })),
    ).map(({ month, amount }) => ({ month, amount }));
    const existing = await ctx.db
      .query("invoices")
      .withIndex("by_historical_identity", (q) =>
        q
          .eq("companyId", args.companyId)
          .eq("sourceSystem", "odoo")
          .eq("normalizedOriginalReference", normalizedReference),
      )
      .first();
    if (existing) {
      throw new ConvexError({ code: "CONFLICT", message: "This historical invoice reference already exists for the customer" });
    }

    const now = Date.now();
    const invoiceNumber = historicalInvoiceNumber(company._id, normalizedReference);
    const invoiceId = await ctx.db.insert("invoices", {
      companyId: company._id,
      sourceMonth: args.coverageStartMonth,
      sourceSystem: "odoo",
      isHistorical: true,
      originalReference: args.originalReference.trim(),
      normalizedOriginalReference: normalizedReference,
      historicalCoverageStartMonth: args.coverageStartMonth,
      historicalCoverageMonths: args.monthsCovered,
      historicalImportedAt: now,
      revenueAllocations,
      receivableAllocations,
      createdBy: user._id,
      invoiceNumber,
      status: "issued",
      issueDate: invoiceDate,
      dueDate: invoiceDate,
      lockedAt: now,
      companyName: company.name,
      contactName: company.contactName,
      contactEmail: company.contactEmail,
      billingEmail: company.contactEmail,
      sellerCurrency: "USD",
      lineItems: lineItems.map(withLineMoneyCents),
      ...withInvoiceMoneyCents(totals),
      notes: args.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("invoiceEvents", {
      invoiceId,
      type: "draft_created",
      actorId: user._id,
      message: `Historical Odoo invoice ${args.originalReference.trim()} recorded as a draft before issue.`,
      createdAt: now,
    });
    await ctx.db.insert("invoiceEvents", {
      invoiceId,
      type: "issued",
      actorId: user._id,
      message: `Historical Odoo invoice ${invoiceNumber} issued.`,
      createdAt: now,
    });

    const paymentAmount = totals.grandTotal;
    const payment = calculatePaymentApplication(
      { ...({ grandTotal: totals.grandTotal, balanceDue: totals.grandTotal, amountPaid: 0 } as Doc<"invoices">) },
      paymentAmount,
    );
    const method = (args.paymentMethod?.trim() || PAYMENT_METHOD_BANK_TRANSFER);
    if (!SUPPORTED_PAYMENT_METHODS.has(method)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Unsupported payment method" });
    }
    const reference = args.paymentReference?.trim() || undefined;
    const transactionId = args.transactionId?.trim() || undefined;
    if (transactionId && !args.receivingAccountId) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Select an active receiving account" });
    }
    const receivingAccount = args.receivingAccountId
      ? await ctx.db.get(args.receivingAccountId)
      : null;
    if (args.receivingAccountId && (!receivingAccount || !receivingAccount.isActive)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Select an active receiving account" });
    }
    if (receivingAccount?.usage === "outgoing") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Select an account enabled for customer collections" });
    }
    if (receivingAccount && (!receivingAccount.countryId || receivingAccount.countryId !== company.countryId)) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Receiving account must belong to the customer's country" });
    }
    const expectedType = method === PAYMENT_METHOD_BANK_TRANSFER ? "bank" : "mobile_money";
    if (receivingAccount && receivingAccount.type !== expectedType) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "The receiving account does not match the payment method" });
    }
    if (args.receivingAccountId && !transactionId) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Bank or provider transaction ID is required" });
    }
    if (receivingAccount && receivingAccount.currency !== "USD") {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Payment account currency must be USD" });
    }
    if (receivingAccount) {
      const duplicate = await ctx.db
        .query("invoicePayments")
        .withIndex("by_account_transaction", (q) =>
          q.eq("receivingAccountId", receivingAccount._id).eq("transactionId", transactionId),
        )
        .first();
      if (duplicate) throw new ConvexError({ code: "CONFLICT", message: "This transaction ID has already been recorded for the account" });
    }
    await ctx.db.insert("invoicePayments", {
      invoiceId,
      amount: payment.amount,
      amountCents: toCents(payment.amount),
      appliedAmount: payment.appliedAmount,
      paidAt: paymentDate,
      method,
      reference,
      ...(receivingAccount
        ? {
            receivingAccountId: receivingAccount._id,
            transactionId,
            receivingBankName: receivingAccount.providerName,
            receivingAccountNumber: receivingAccount.accountNumber,
            receivingAccountName: receivingAccount.accountHolderName,
            receivingBankLocation: receivingAccount.location,
            receivingCurrencyNote: receivingAccount.currency,
          }
        : {}),
      recordedBy: user._id,
      createdAt: now,
    });
    await ctx.db.patch(invoiceId, {
      amountPaid: payment.nextAmountPaid,
      balanceDue: payment.nextBalanceDue,
      amountPaidCents: toCents(payment.nextAmountPaid),
      balanceDueCents: toCents(payment.nextBalanceDue),
      status: payment.nextStatus,
      updatedAt: now,
    });
    await ctx.db.insert("invoiceEvents", {
      invoiceId,
      type: "payment_recorded",
      actorId: user._id,
      message: `Historical payment of ${payment.amount.toFixed(2)} recorded.`,
      createdAt: now,
    });
    return invoiceId;
  },
});
