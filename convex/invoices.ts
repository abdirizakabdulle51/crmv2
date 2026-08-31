import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { internal } from "./_generated/api";
import {
  assertCanManageCompany,
  assertNotMonitoring,
  canViewCompany,
  isCeoOrHob,
} from "./authorization";
import {
  assertSupportedCurrency,
  allocateMoney,
  calculateContractCharges,
  calculateInvoiceTotals,
  calculateLineItems,
  calculateMonthProration,
  calculateBalance,
  multiplySignedMoney,
  roundMoney,
  roundQuantity,
  sumMoney,
  toCents,
  withInvoiceMoneyCents,
  withLineMoneyCents,
} from "./money";
import {
  consumeInvoiceCredit,
  findApplicableCredit,
  releaseInvoiceCredit,
  reserveCredit,
  restoreInvoiceCredit,
} from "./customerCredits";
import {
  contractDiscount,
  contractOveragePrice,
  isDynamicPricingContract,
} from "./contractPricing";
import {
  priceFlexibleContractUsage,
  priceMonthlyContractUsage,
} from "./contractUsagePricing";

type Ctx = QueryCtx | MutationCtx;
type InvoiceStatus = Doc<"invoices">["status"];
type InvoiceLineItem = Doc<"invoices">["lineItems"][number];
type InternalReminderCandidate = {
  invoice: Doc<"invoices">;
  accountManager: Doc<"users">;
  recipient: string;
};
type InternalReminderCandidateResult = {
  reminders: InternalReminderCandidate[];
  skipped: number;
};
type InternalReminderRunResult = {
  sent: number;
  skipped: number;
  failed: number;
};
type CustomerReminderCandidate = {
  invoice: Doc<"invoices">;
  recipient: string;
};
type CustomerReminderCandidateResult = {
  reminders: CustomerReminderCandidate[];
  skipped: number;
};
type InvoiceReconciliationIssue = {
  field: string;
  expected: number | string;
  actual: number | string | undefined;
};
type CustomerReminderRunResult = {
  sent: number;
  skipped: number;
  failed: number;
};

async function invoiceLinesWithOnboardingCredit(
  ctx: MutationCtx,
  args: {
    companyId: Id<"companies">;
    isContract: boolean;
    lineItems: InvoiceLineItem[];
  },
) {
  const originalTotals = calculateInvoiceTotals(args.lineItems);
  const applicable = await findApplicableCredit(
    ctx,
    args.companyId,
    args.isContract,
    originalTotals.grandTotal,
  );
  if (!applicable) {
    return {
      lineItems: args.lineItems,
      totals: originalTotals,
      grossBeforeCredit: originalTotals.grandTotal,
    };
  }
  const creditLine: InvoiceLineItem = {
    itemName: "Onboarding credit",
    serviceCategory: "Credit",
    billingUnit: "one-time credit",
    quantity: 1,
    monthlyUnitPrice: -applicable.amount,
    monthlyTotal: -applicable.amount,
    yearlyTotal: -applicable.amount,
  };
  const lineItems = [...args.lineItems, creditLine];
  return {
    lineItems,
    totals: calculateInvoiceTotals(lineItems),
    grossBeforeCredit: originalTotals.grandTotal,
    credit: applicable,
  };
}

const DEFAULT_PAYMENT_TERM_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const MOGADISHU_UTC_OFFSET_HOURS = 3;
const BUSINESS_TIME_ZONE = "Africa/Mogadishu";
const INTERNAL_REMINDER_INTERVAL_MS = 7 * MS_PER_DAY;
const DEFAULT_INTERNAL_REMINDER_LIMIT = 50;
const CUSTOMER_REMINDER_INTERVAL_MS = 7 * MS_PER_DAY;
const DEFAULT_CUSTOMER_REMINDER_LIMIT = 50;
const PAYMENT_METHOD_BANK_TRANSFER = "Bank Transfer";
const PAYMENT_METHOD_MOBILE_MONEY = "Mobile Money";
const SUPPORTED_PAYMENT_METHODS = new Set([
  PAYMENT_METHOD_BANK_TRANSFER,
  PAYMENT_METHOD_MOBILE_MONEY,
]);

const PAYABLE_STATUSES = new Set<InvoiceStatus>([
  "issued",
  "sent",
  "overdue",
  "partially_paid",
]);
const OVERDUE_CANDIDATE_STATUSES = new Set<InvoiceStatus>([
  "issued",
  "sent",
  "partially_paid",
]);
const VOIDABLE_STATUSES = new Set<InvoiceStatus>([
  "issued",
  "sent",
  "partially_paid",
  "overdue",
]);

const invoiceStatusValidator = v.union(
  v.literal("draft"),
  v.literal("issued"),
  v.literal("sent"),
  v.literal("partially_paid"),
  v.literal("paid"),
  v.literal("overdue"),
  v.literal("void"),
  v.literal("cancelled"),
);

const invoiceLineItemValidator = v.object({
  catalogItemId: v.optional(v.id("serviceCatalog")),
  itemName: v.string(),
  serviceCategory: v.string(),
  billingUnit: v.string(),
  quantity: v.number(),
  monthlyUnitPrice: v.number(),
  regionId: v.optional(v.string()),
  regionName: v.optional(v.string()),
  dataCenterName: v.optional(v.string()),
});

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

async function getInvoiceOrThrow(ctx: Ctx, invoiceId: Id<"invoices">) {
  const invoice = await ctx.db.get(invoiceId);
  if (!invoice) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Invoice not found" });
  }
  return invoice;
}

async function getCompanyOrThrow(ctx: Ctx, companyId: Id<"companies">) {
  const company = await ctx.db.get(companyId);
  if (!company) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Company not found" });
  }
  return company;
}

async function resolveInvoiceProfileForCompany(
  ctx: Ctx,
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

async function resolveInvoiceProfileForIssue(
  ctx: Ctx,
  invoice: Doc<"invoices">,
  company: Doc<"companies">,
) {
  if (invoice.invoiceProfileId) {
    const selectedProfile = await ctx.db.get(invoice.invoiceProfileId);
    if (selectedProfile) return selectedProfile;
  }
  return await resolveInvoiceProfileForCompany(ctx, company);
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

async function assertCanAccessInvoice(
  ctx: Ctx,
  user: Doc<"users">,
  invoice: Doc<"invoices">,
) {
  const company = await getCompanyOrThrow(ctx, invoice.companyId);
  assertCanManageCompany(user, company);
}

function assertCanCleanupInvoices(user: Doc<"users">) {
  if (isCeoOrHob(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "Only CEO or Head of Business can clean up invoices",
  });
}

async function insertEvent(
  ctx: MutationCtx,
  args: {
    invoiceId: Id<"invoices">;
    type: Doc<"invoiceEvents">["type"];
    actorId?: Id<"users">;
    message?: string;
    now: number;
  },
) {
  await ctx.db.insert("invoiceEvents", {
    invoiceId: args.invoiceId,
    type: args.type,
    actorId: args.actorId,
    message: args.message,
    createdAt: args.now,
  });
}

function trimOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireCleanupReason(value: string | undefined) {
  const reason = trimOptional(value);
  if (!reason) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Cleanup reason is required",
    });
  }
  return reason;
}

function invoiceNumberForSequence(now: number, sequence: number) {
  const year = new Date(now).getUTCFullYear();
  return `INV-${year}-${String(sequence).padStart(5, "0")}`;
}

function defaultDueDateForIssue(
  issueDate: number,
  paymentTermDays = DEFAULT_PAYMENT_TERM_DAYS,
) {
  return issueDate + paymentTermDays * MS_PER_DAY;
}

function startOfBusinessDay(now: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
  }).formatToParts(new Date(now));
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  // Africa/Mogadishu is UTC+3 with no daylight-saving shift.
  return (
    Date.UTC(year, month - 1, day) - MOGADISHU_UTC_OFFSET_HOURS * MS_PER_HOUR
  );
}

async function nextInvoiceNumber(ctx: MutationCtx, now: number) {
  const invoices = await ctx.db.query("invoices").collect();
  const issuedCount = invoices.filter(
    (invoice) => invoice.invoiceNumber,
  ).length;
  return invoiceNumberForSequence(now, issuedCount + 1);
}

function assertDraft(invoice: Doc<"invoices">) {
  if (invoice.status !== "draft") {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Only draft invoices can be edited",
    });
  }
}

function assertTransitionFromDraft(invoice: Doc<"invoices">) {
  if (invoice.status !== "draft") {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Invoice must be draft",
    });
  }
}

function recipientForInvoice(invoice: Doc<"invoices">) {
  return (
    trimOptional(invoice.billingEmail) ?? trimOptional(invoice.contactEmail)
  );
}

function assertIssuedForSend(invoice: Doc<"invoices">) {
  if (invoice.status !== "issued") {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Only issued invoices can be sent",
    });
  }
}

function assertPayable(invoice: Doc<"invoices">) {
  if (!PAYABLE_STATUSES.has(invoice.status)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Payments can only be recorded for payable invoices",
    });
  }
}

function escapeHtml(value: string | number | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function reconciliationIssues(
  invoice: Doc<"invoices">,
  recordedPaymentTotal: number,
) {
  const issues: InvoiceReconciliationIssue[] = [];
  invoice.lineItems.forEach((line, index) => {
    const expectedMonthly = multiplySignedMoney(
      line.monthlyUnitPrice,
      line.quantity,
      `Invoice line ${index + 1}`,
    );
    if (toCents(expectedMonthly) !== toCents(line.monthlyTotal)) {
      issues.push({
        field: `lineItems[${index}].monthlyTotal`,
        expected: expectedMonthly,
        actual: line.monthlyTotal,
      });
    }
  });
  const totals = calculateInvoiceTotals(invoice.lineItems);
  for (const field of [
    "subtotal",
    "monthlyTotal",
    "yearlyTotal",
    "grandTotal",
  ] as const) {
    if (toCents(totals[field]) !== toCents(invoice[field])) {
      issues.push({ field, expected: totals[field], actual: invoice[field] });
    }
  }
  const expectedBalance = sumMoney([invoice.grandTotal, -invoice.amountPaid]);
  if (toCents(expectedBalance) !== toCents(invoice.balanceDue)) {
    issues.push({
      field: "balanceDue",
      expected: expectedBalance,
      actual: invoice.balanceDue,
    });
  }
  if (toCents(recordedPaymentTotal) !== toCents(invoice.amountPaid)) {
    issues.push({
      field: "amountPaid",
      expected: recordedPaymentTotal,
      actual: invoice.amountPaid,
    });
  }
  for (const [field, expected] of [
    ["subtotalCents", toCents(invoice.subtotal)],
    ["monthlyTotalCents", toCents(invoice.monthlyTotal)],
    ["yearlyTotalCents", toCents(invoice.yearlyTotal)],
    ["grandTotalCents", toCents(invoice.grandTotal)],
    ["amountPaidCents", toCents(invoice.amountPaid)],
    ["balanceDueCents", toCents(invoice.balanceDue)],
  ] as const) {
    if (invoice[field] !== expected) {
      issues.push({ field, expected, actual: invoice[field] });
    }
  }
  try {
    assertSupportedCurrency(invoice.sellerCurrency);
  } catch {
    issues.push({
      field: "sellerCurrency",
      expected: "USD",
      actual: invoice.sellerCurrency,
    });
  }
  return issues;
}

async function buildReconciliationReport(ctx: QueryCtx | MutationCtx) {
  const [invoices, payments] = await Promise.all([
    ctx.db.query("invoices").collect(),
    ctx.db.query("invoicePayments").collect(),
  ]);
  const paymentsByInvoice = new Map<Id<"invoices">, number>();
  for (const payment of payments) {
    paymentsByInvoice.set(
      payment.invoiceId,
      roundMoney(
        (paymentsByInvoice.get(payment.invoiceId) ?? 0) + payment.amount,
      ),
    );
  }
  const records = invoices
    .map((invoice) => ({
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      companyName: invoice.companyName,
      status: invoice.status,
      issues: reconciliationIssues(
        invoice,
        paymentsByInvoice.get(invoice._id) ?? 0,
      ),
    }))
    .filter((record) => record.issues.length > 0);
  return {
    checkedAt: Date.now(),
    invoiceCount: invoices.length,
    corruptedInvoiceCount: records.length,
    issueCount: records.reduce((sum, record) => sum + record.issues.length, 0),
    records,
  };
}

function formatInvoiceDate(value?: number) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function buildInvoiceEmail(invoice: Doc<"invoices">, recipient: string) {
  const invoiceNumber = invoice.invoiceNumber ?? "Invoice";
  const subject = `HTGClouds invoice ${invoiceNumber}`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5;">
      <h1 style="margin:0 0 12px;font-size:24px;">${escapeHtml(invoiceNumber)}</h1>
      <p>Dear ${escapeHtml(invoice.contactName ?? invoice.companyName)},</p>
      <p>Please find attached your HTGClouds invoice ${escapeHtml(invoiceNumber)}.</p>
      <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:720px;">
        <tbody>
          <tr><td style="padding:6px 18px 6px 0;color:#64748b;">Invoice amount</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(formatMoney(invoice.grandTotal))}</td></tr>
          <tr><td style="padding:6px 18px 6px 0;color:#64748b;">Balance due</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(formatMoney(invoice.balanceDue))}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Due date</td><td style="padding:6px 0;">${escapeHtml(formatInvoiceDate(invoice.dueDate))}</td></tr>
        </tbody>
      </table>
      <p>If you have any questions, please contact your HTGClouds account team.</p>
    </div>`;
  const textLines = [
    `${invoiceNumber}`,
    "",
    `Dear ${invoice.contactName ?? invoice.companyName},`,
    "",
    `Please find attached your HTGClouds invoice ${invoiceNumber}.`,
    "",
    `Invoice amount: ${formatMoney(invoice.grandTotal)}`,
    `Balance due: ${formatMoney(invoice.balanceDue)}`,
    `Due date: ${formatInvoiceDate(invoice.dueDate)}`,
    "",
    "If you have any questions, please contact your HTGClouds account team.",
  ];

  return { subject, html, text: textLines.join("\n") };
}

function buildInternalReminderEmail(args: {
  invoice: Doc<"invoices">;
  accountManager: Doc<"users">;
}) {
  const { invoice, accountManager } = args;
  const invoiceNumber = invoice.invoiceNumber ?? String(invoice._id);
  const invoicePath = `/invoices/${invoice._id}`;
  const subject = `Overdue invoice follow-up: ${invoiceNumber}`;
  const greeting = accountManager.name ? `Hi ${accountManager.name},` : "Hi,";
  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5;">
      <p>${escapeHtml(greeting)}</p>
      <p>Invoice ${escapeHtml(invoiceNumber)} for ${escapeHtml(invoice.companyName)} is overdue and needs follow-up.</p>
      <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:640px;">
        <tbody>
          <tr><td style="padding:6px 18px 6px 0;color:#64748b;">Customer</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(invoice.companyName)}</td></tr>
          <tr><td style="padding:6px 18px 6px 0;color:#64748b;">Invoice</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(invoiceNumber)}</td></tr>
          <tr><td style="padding:6px 18px 6px 0;color:#64748b;">Due date</td><td style="padding:6px 0;">${escapeHtml(formatInvoiceDate(invoice.dueDate))}</td></tr>
          <tr><td style="padding:6px 18px 6px 0;color:#64748b;">Balance due</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(formatMoney(invoice.balanceDue))}</td></tr>
        </tbody>
      </table>
      <p>Open the invoice in CRM: ${escapeHtml(invoicePath)}</p>
    </div>`;
  const text = [
    greeting,
    "",
    `Invoice ${invoiceNumber} for ${invoice.companyName} is overdue and needs follow-up.`,
    "",
    `Customer: ${invoice.companyName}`,
    `Invoice: ${invoiceNumber}`,
    `Due date: ${formatInvoiceDate(invoice.dueDate)}`,
    `Balance due: ${formatMoney(invoice.balanceDue)}`,
    `CRM invoice: ${invoicePath}`,
  ].join("\n");

  return { subject, html, text };
}

function buildCustomerReminderEmail(invoice: Doc<"invoices">) {
  const invoiceNumber = invoice.invoiceNumber ?? String(invoice._id);
  const greeting = invoice.contactName ?? invoice.companyName;
  const subject = `Overdue HTGClouds invoice ${invoiceNumber}`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5;">
      <p>Dear ${escapeHtml(greeting)},</p>
      <p>This is a friendly reminder that invoice ${escapeHtml(invoiceNumber)} is now overdue.</p>
      <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:640px;">
        <tbody>
          <tr><td style="padding:6px 18px 6px 0;color:#64748b;">Balance due</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(formatMoney(invoice.balanceDue))}</td></tr>
          <tr><td style="padding:6px 18px 6px 0;color:#64748b;">Due date</td><td style="padding:6px 0;">${escapeHtml(formatInvoiceDate(invoice.dueDate))}</td></tr>
        </tbody>
      </table>
      <p>Please find the invoice PDF attached for your reference.</p>
      <p>If payment has already been made, please disregard this reminder or contact your HTGClouds account team.</p>
      <p>Thank you,<br />HTGClouds</p>
    </div>`;
  const text = [
    `Dear ${greeting},`,
    "",
    `This is a friendly reminder that invoice ${invoiceNumber} is now overdue.`,
    "",
    `Balance due: ${formatMoney(invoice.balanceDue)}`,
    `Due date: ${formatInvoiceDate(invoice.dueDate)}`,
    "",
    "Please find the invoice PDF attached for your reference.",
    "",
    "If payment has already been made, please disregard this reminder or contact your HTGClouds account team.",
    "",
    "Thank you,",
    "HTGClouds",
  ].join("\n");

  return { subject, html, text };
}

function invoiceRelaySnapshot(invoice: Doc<"invoices">) {
  const { sourceQuoteId: _sourceQuoteId, ...snapshot } = invoice;
  const lineItems: InvoiceLineItem[] = [];
  for (const line of snapshot.lineItems) {
    if (line.monthlyTotal >= 0) {
      lineItems.push({ ...line });
      continue;
    }

    const base = lineItems[lineItems.length - 1];
    if (!base) {
      throw new ConvexError({
        code: "INVOICE_INTEGRITY_ERROR",
        message: "Invoice discount must follow its base charge",
      });
    }
    const netMonthlyTotal = roundMoney(base.monthlyTotal + line.monthlyTotal);
    const netYearlyTotal = roundMoney(base.yearlyTotal + line.yearlyTotal);
    if (netMonthlyTotal < 0 || netYearlyTotal < 0) {
      throw new ConvexError({
        code: "INVOICE_INTEGRITY_ERROR",
        message: "Invoice discount cannot exceed its base charge",
      });
    }
    const discount = formatMoney(Math.abs(line.monthlyTotal));
    Object.assign(base, {
      itemName: `${base.itemName} (after ${discount} discount)`,
      quantity: 1,
      monthlyUnitPrice: netMonthlyTotal,
      monthlyTotal: netMonthlyTotal,
      yearlyTotal: netYearlyTotal,
      monthlyUnitPriceCents: toCents(netMonthlyTotal),
      monthlyTotalCents: toCents(netMonthlyTotal),
      yearlyTotalCents: toCents(netYearlyTotal),
    });
    if (line.itemName === "Onboarding credit") {
      lineItems.push({
        ...line,
        itemName: `Onboarding credit (-${discount})`,
        quantity: 0,
        monthlyUnitPrice: 0,
        monthlyTotal: 0,
        yearlyTotal: 0,
        monthlyUnitPriceCents: 0,
        monthlyTotalCents: 0,
        yearlyTotalCents: 0,
      });
    }
  }
  return { ...snapshot, lineItems };
}

function usageMatchesContractLine(
  usage: Doc<"consumption">,
  line: Doc<"customerContractLineItems">,
) {
  return Boolean(
    line.catalogItemId && usage.catalogItemId === line.catalogItemId,
  );
}

function contractMonthFraction(
  contract: Doc<"customerContracts">,
  sourceMonth: string,
) {
  return calculateMonthProration({
    startDate: contract.startDate,
    endDate: contract.endDate,
    month: sourceMonth,
  }).fraction;
}

function contractInvoiceLines(
  line: Doc<"customerContractLineItems">,
  usageEntries: Doc<"consumption">[],
  monthFraction: number,
  options?: {
    monthLabel?: string;
    defaultDiscountType?: "percentage" | "amount";
    defaultDiscountValue?: number;
    overageUnitPrice?: number;
    activeStart?: number;
    activeEnd?: number;
  },
): InvoiceLineItem[] {
  const matchedUsage = usageEntries.filter((usage) => {
    if (!usageMatchesContractLine(usage, line)) return false;
    if (!usage.usageDate || options?.activeStart === undefined) return true;
    const timestamp = Date.parse(`${usage.usageDate}T00:00:00.000Z`);
    return (
      timestamp >= options.activeStart &&
      timestamp <= (options.activeEnd ?? Infinity)
    );
  });
  const actualQuantity = matchedUsage.reduce((total, usage) => {
    if (usage.quantity !== undefined) return total + usage.quantity;
    const price = line.catalogUnitPrice ?? line.contractUnitPrice;
    if (price > 0) return total + usage.amount / price;
    return total;
  }, 0);
  const charges = calculateContractCharges({
    includedQuantity: line.includedQuantity,
    contractUnitPrice: line.contractUnitPrice,
    discountType: line.discountType ?? options?.defaultDiscountType,
    discountValue: line.discountValue ?? options?.defaultDiscountValue,
    overageUnitPrice: options?.overageUnitPrice ?? line.overageUnitPrice,
    actualQuantity,
    monthFraction,
  });
  const {
    proratedIncludedQuantity,
    grossBaseAmount,
    discountAmount: proratedDiscountAmount,
    overageQuantity,
    overageUnitPrice,
    overageAmount,
  } = charges;

  const common = {
    catalogItemId: line.catalogItemId,
    serviceCategory: line.serviceCategory,
    billingUnit: line.billingUnit,
  };
  const periodSuffix = options?.monthLabel ? ` — ${options.monthLabel}` : "";

  const result: InvoiceLineItem[] = [
    {
      ...common,
      itemName:
        monthFraction < 1
          ? `${line.itemName} base${periodSuffix} (${Math.round(monthFraction * 10000) / 100}% month)`
          : `${line.itemName} base${periodSuffix}`,
      quantity: proratedIncludedQuantity,
      monthlyUnitPrice: line.contractUnitPrice,
      monthlyTotal: grossBaseAmount,
      yearlyTotal: roundMoney(grossBaseAmount * 12),
    },
  ];

  if (proratedDiscountAmount > 0) {
    result.push({
      ...common,
      itemName: `${line.itemName} contract discount${periodSuffix}`,
      quantity: 1,
      monthlyUnitPrice: -proratedDiscountAmount,
      monthlyTotal: -proratedDiscountAmount,
      yearlyTotal: -roundMoney(proratedDiscountAmount * 12),
    });
  }

  if (overageQuantity > 0) {
    result.push({
      ...common,
      itemName: `${line.itemName} overage${periodSuffix}`,
      quantity: roundQuantity(overageQuantity),
      monthlyUnitPrice: overageUnitPrice,
      monthlyTotal: overageAmount,
      yearlyTotal: roundMoney(overageAmount * 12),
    });
  }

  return result;
}

function monthStartTimestamp(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Source month must use YYYY-MM format",
    });
  }
  return Date.UTC(year, monthNumber - 1, 1);
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

function monthKeyFromTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(month: string, count: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return monthKeyFromTimestamp(date.getTime());
}

function monthsBetweenInclusive(startMonth: string, endMonth: string) {
  const months: string[] = [];
  for (let month = startMonth; month <= endMonth; month = addMonths(month, 1)) {
    months.push(month);
  }
  return months;
}

function contractFrequencyMonths(contract: Doc<"customerContracts">) {
  if (contract.billingFrequency === "yearly") return 12;
  if (contract.billingFrequency === "semiannual") return 6;
  if (
    contract.billingFrequency === "quarterly" ||
    contract.billingFrequency === "every_3_months"
  )
    return 3;
  return 1;
}

function contractCycleMonths(
  contract: Doc<"customerContracts">,
  sourceMonth: string,
) {
  const startMonth = monthKeyFromTimestamp(contract.startDate);
  const endMonth = monthKeyFromTimestamp(contract.endDate);
  const allMonths = monthsBetweenInclusive(startMonth, endMonth);
  const startIndex = allMonths.indexOf(sourceMonth);
  const frequency = contractFrequencyMonths(contract);
  if (startIndex < 0 || startIndex % frequency !== 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `Invoice month must be a ${contract.billingFrequency} cycle boundary beginning ${startMonth}`,
    });
  }
  return allMonths.slice(startIndex, startIndex + frequency);
}

function contractValueAllocations(contract: Doc<"customerContracts">) {
  if (contract.pricingBasis !== "total_contract" || !contract.contractValue)
    return null;
  const months = monthsBetweenInclusive(
    monthKeyFromTimestamp(contract.startDate),
    monthKeyFromTimestamp(contract.endDate),
  );
  return allocateMoney(
    contract.contractValue,
    months.map((month) => ({
      month,
      weight: calculateMonthProration({
        startDate: contract.startDate,
        endDate: contract.endDate,
        month,
      }).fraction,
    })),
  );
}

async function previouslyBilledFlexibleOverage(
  ctx: Ctx,
  contract: Doc<"customerContracts">,
) {
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
    .collect();
  return sumMoney(
    invoices
      .filter(
        (invoice) =>
          invoice.status !== "void" && invoice.status !== "cancelled",
      )
      .flatMap((invoice) => invoice.lineItems)
      .filter((line) => line.serviceCategory === "Contract Overage")
      .map((line) => line.monthlyTotal),
  );
}

function contractCoversMonth(
  contract: Doc<"customerContracts">,
  month: string,
) {
  const start = monthStartTimestamp(month);
  const end = monthEndTimestamp(month);
  return contract.startDate <= end && contract.endDate >= start;
}

async function findContractInvoiceForMonth(
  ctx: Ctx,
  contract: Doc<"customerContracts">,
  sourceMonth: string,
  kind: "cycle" | "overage_settlement" = "cycle",
) {
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_company", (q) => q.eq("companyId", contract.companyId))
    .collect();
  return (
    invoices.find(
      (invoice) =>
        invoice.sourceReference === contract.contractNumber &&
        invoice.sourceMonth === sourceMonth &&
        (invoice.contractInvoiceKind ?? "cycle") === kind &&
        invoice.status !== "cancelled" &&
        invoice.status !== "void",
    ) ?? null
  );
}

async function createContractDraftInvoice(
  ctx: MutationCtx,
  args: {
    user: Doc<"users">;
    contract: Doc<"customerContracts">;
    sourceMonth: string;
    notes?: string;
    kind?: "cycle" | "overage_settlement";
  },
) {
  const { user, contract, sourceMonth } = args;
  const kind = args.kind ?? "cycle";
  if (
    kind === "overage_settlement" &&
    (contract.pricingModel === "monthly_minimum" ||
      contract.pricingModel === "discounted_usage")
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Monthly usage contracts do not have overage settlements",
    });
  }
  if (kind === "overage_settlement" && contract.billingTiming !== "prepaid") {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "Overage settlement invoices are only used for prepaid contracts",
    });
  }
  if (contract.status !== "active") {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Only active contracts can create invoices",
    });
  }
  if (!contractCoversMonth(contract, sourceMonth)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Contract does not cover the selected invoice month",
    });
  }

  const duplicate = await findContractInvoiceForMonth(
    ctx,
    contract,
    sourceMonth,
    kind,
  );
  if (duplicate) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `An invoice already exists for contract ${contract.contractNumber} and month ${sourceMonth}`,
    });
  }

  const company = await getCompanyOrThrow(ctx, contract.companyId);
  assertCanManageCompany(user, company);

  const lines = await ctx.db
    .query("customerContractLineItems")
    .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
    .collect();
  const groupDiscounts = await ctx.db
    .query("customerContractGroupDiscounts")
    .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
    .collect();
  const groupDiscountByKey = new Map(
    groupDiscounts.map((rule) => [rule.productGroup, rule.discountPercent]),
  );
  const isFlexible =
    contract.commitmentModel === "flexible_value" ||
    contract.pricingModel === "flexible_total_commitment";
  const isMonthlyUsageModel =
    contract.pricingModel === "monthly_minimum" ||
    contract.pricingModel === "discounted_usage";
  if (!isFlexible && !isMonthlyUsageModel && lines.length === 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Add at least one contract service before creating an invoice",
    });
  }

  const cycleMonths = contractCycleMonths(contract, sourceMonth);
  const cycleEndMonth = cycleMonths[cycleMonths.length - 1];
  if (
    ((contract.billingTiming ?? "postpaid") === "postpaid" ||
      kind === "overage_settlement") &&
    Date.now() < monthEndTimestamp(cycleEndMonth)
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "Postpaid and overage settlement invoices can only be created after the billing cycle ends",
    });
  }
  const catalogById = new Map<Id<"serviceCatalog">, Doc<"serviceCatalog">>();
  for (const line of lines) {
    if (!line.catalogItemId || catalogById.has(line.catalogItemId)) continue;
    const catalogItem = await ctx.db.get(line.catalogItemId);
    if (catalogItem) catalogById.set(line.catalogItemId, catalogItem);
  }
  let monthlyLineGroups: Array<{
    month: string;
    lineItems: InvoiceLineItem[];
  }> = [];
  let monthlyUsageSummary:
    | {
        catalogueUsage: number;
        discountedUsage: number;
        minimum: number;
        shortfall: number;
        payable: number;
        entries: number;
      }
    | undefined;
  let monthlyUsageBreakdown: string | undefined;
  if (isMonthlyUsageModel) {
    if (kind !== "cycle") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Monthly usage contracts do not have overage settlements",
      });
    }
    const usage = await priceMonthlyContractUsage(ctx, contract, sourceMonth);
    if (contract.pricingModel === "discounted_usage" && usage.entries === 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "No billable usage is available for this month",
      });
    }
    const minimum = usage.minimum;
    const payable = usage.payable;
    const minimumApplies = minimum > usage.discountedUsage;
    monthlyUsageSummary = {
      catalogueUsage: usage.catalogueUsage,
      discountedUsage: usage.discountedUsage,
      minimum,
      shortfall: usage.shortfall,
      payable,
      entries: usage.entries,
    };
    monthlyUsageBreakdown = usage.lines.length
      ? `Usage detail: ${usage.lines
          .map(
            (line) =>
              `${line.itemName}: ${line.catalogueUsage.toFixed(2)} less ${line.discountPercent}% = ${line.discountedUsage.toFixed(2)} ${contract.currency}`,
          )
          .join("; ")}.`
      : "Usage detail: no usage recorded for this billing period.";
    const usageLines: InvoiceLineItem[] = usage.lines.flatMap((line) => {
      const discountAmount = sumMoney([
        line.catalogueUsage,
        -line.discountedUsage,
      ]);
      const common = {
        catalogItemId: line.catalogItemId,
        serviceCategory: line.serviceCategory,
        billingUnit: line.billingUnit,
      };
      return [
        {
          ...common,
          itemName: `${line.itemName} catalogue usage`,
          quantity: 1,
          monthlyUnitPrice: line.catalogueUsage,
          monthlyTotal: line.catalogueUsage,
          yearlyTotal: roundMoney(line.catalogueUsage * 12),
        },
        ...(discountAmount > 0
          ? [
              {
                ...common,
                itemName: `${line.itemName} contract discount (${line.discountPercent}%)`,
                quantity: 1,
                monthlyUnitPrice: -discountAmount,
                monthlyTotal: -discountAmount,
                yearlyTotal: -roundMoney(discountAmount * 12),
              },
            ]
          : []),
      ];
    });
    monthlyLineGroups = [
      {
        month: sourceMonth,
        lineItems: minimumApplies
          ? [
              {
                itemName: `Contracted monthly minimum — includes discounted usage ${usage.discountedUsage.toFixed(2)}`,
                serviceCategory: "Contract Usage",
                billingUnit: "month",
                quantity: 1,
                monthlyUnitPrice: payable,
                monthlyTotal: payable,
                yearlyTotal: roundMoney(payable * 12),
              },
            ]
          : usageLines,
      },
    ];
  } else if (isFlexible) {
    const valueAllocations = contractValueAllocations(contract) ?? [];
    monthlyLineGroups = cycleMonths.map((month) => {
      const amount =
        valueAllocations.find((allocation) => allocation.month === month)
          ?.amount ?? 0;
      return {
        month,
        lineItems:
          kind === "cycle"
            ? [
                {
                  itemName: `Contract commitment — ${month}`,
                  serviceCategory: "Contract",
                  billingUnit: "month",
                  quantity: 1,
                  monthlyUnitPrice: amount,
                  monthlyTotal: amount,
                  yearlyTotal: amount,
                },
              ]
            : [],
      };
    });
    if (
      kind === "overage_settlement" ||
      (contract.billingTiming ?? "postpaid") === "postpaid"
    ) {
      const allocations = await priceFlexibleContractUsage(
        ctx,
        contract,
        monthEndTimestamp(cycleEndMonth),
      );
      const expectedOverage = sumMoney(
        allocations.map((allocation) => allocation.overageAmount),
      );
      const alreadyBilled = await previouslyBilledFlexibleOverage(
        ctx,
        contract,
      );
      const overageDue = Math.max(
        0,
        sumMoney([expectedOverage, -alreadyBilled]),
      );
      if (overageDue > 0) {
        monthlyLineGroups[monthlyLineGroups.length - 1]!.lineItems.push({
          itemName: `Flexible contract overage through ${cycleEndMonth}`,
          serviceCategory: "Contract Overage",
          billingUnit: "usage",
          quantity: 1,
          monthlyUnitPrice: overageDue,
          monthlyTotal: overageDue,
          yearlyTotal: overageDue,
        });
      }
    }
  } else
    for (const month of cycleMonths) {
      const recordedUsageEntries = await ctx.db
        .query("consumption")
        .withIndex("by_company_month", (q) =>
          q.eq("companyId", contract.companyId).eq("month", month),
        )
        .collect();
      const usageEntries =
        (contract.billingTiming ?? "postpaid") === "prepaid" && kind === "cycle"
          ? []
          : recordedUsageEntries;
      const monthFraction = contractMonthFraction(contract, month);
      if (
        monthFraction < 1 &&
        usageEntries.some((entry) =>
          lines.some(
            (line) => usageMatchesContractLine(entry, line) && !entry.usageDate,
          ),
        )
      ) {
        throw new ConvexError({
          code: "USAGE_PERIOD_REQUIRED",
          message:
            "Mid-month contract conversion requires dated usage entries so pre-contract and contract usage can be separated",
        });
      }
      monthlyLineGroups.push({
        month,
        lineItems: lines
          .sort((a, b) => a.createdAt - b.createdAt)
          .flatMap((line, lineIndex) => {
            const catalogPrice = line.catalogItemId
              ? catalogById.get(line.catalogItemId)?.monthlyPrice
              : undefined;
            const discount = contractDiscount(
              contract,
              line,
              lineIndex,
              lines,
              line.productGroup
                ? groupDiscountByKey.get(line.productGroup)
                : undefined,
            );
            return contractInvoiceLines(line, usageEntries, monthFraction, {
              monthLabel: cycleMonths.length > 1 ? month : undefined,
              defaultDiscountType: discount.type,
              defaultDiscountValue: discount.value,
              overageUnitPrice: contractOveragePrice(
                contract,
                line,
                catalogPrice,
              ),
              activeStart: contract.startDate,
              activeEnd: contract.endDate,
            });
          }),
      });
    }
  let lineItems = monthlyLineGroups.flatMap((group) => group.lineItems);
  if ((contract.billingTiming ?? "postpaid") === "prepaid") {
    lineItems = lineItems.filter((line) =>
      kind === "overage_settlement"
        ? line.itemName.includes(" overage")
        : !line.itemName.includes(" overage"),
    );
  }
  if (kind === "overage_settlement" && lineItems.length === 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "No overage is available for this prepaid billing cycle",
    });
  }
  const valueAllocations = contractValueAllocations(contract);
  if (
    !isFlexible &&
    !isMonthlyUsageModel &&
    valueAllocations &&
    kind === "cycle"
  ) {
    const desiredBase = sumMoney(
      valueAllocations
        .filter((allocation) => cycleMonths.includes(allocation.month))
        .map((allocation) => allocation.amount),
    );
    const calculatedBase = sumMoney(
      lineItems
        .filter((line) => !line.itemName.includes(" overage"))
        .map((line) => line.monthlyTotal),
    );
    const adjustment = sumMoney([desiredBase, -calculatedBase]);
    if (adjustment !== 0) {
      lineItems = [
        ...lineItems,
        {
          itemName: "Contract value reconciliation",
          serviceCategory: "Contract",
          billingUnit: "billing cycle",
          quantity: 1,
          monthlyUnitPrice: adjustment,
          monthlyTotal: adjustment,
          yearlyTotal: adjustment,
        },
      ];
    }
  }
  const pricedInvoice = await invoiceLinesWithOnboardingCredit(ctx, {
    companyId: contract.companyId,
    isContract: true,
    lineItems,
  });
  const grandTotal = pricedInvoice.totals.grandTotal;
  const invoiceProfile = await resolveInvoiceProfileForCompany(ctx, company);
  const sellerSnapshot = invoiceProfile
    ? sellerSnapshotFromProfile(invoiceProfile)
    : {};
  const now = Date.now();
  const billingPoint =
    (contract.billingTiming ?? "postpaid") === "prepaid"
      ? monthStartTimestamp(sourceMonth)
      : monthEndTimestamp(cycleEndMonth);
  const dueDate =
    (contract.billingTiming ?? "postpaid") === "prepaid"
      ? billingPoint
      : contract.paymentTermDays === undefined
        ? undefined
        : billingPoint + contract.paymentTermDays * MS_PER_DAY;

  const monthlyWeights = monthlyLineGroups.map((group) => {
    const committedAmount = valueAllocations?.find(
      (allocation) => allocation.month === group.month,
    )?.amount;
    if (kind === "cycle" && committedAmount !== undefined) {
      return { month: group.month, weight: committedAmount };
    }
    const allocationLines =
      (contract.billingTiming ?? "postpaid") === "prepaid"
        ? group.lineItems.filter((line) =>
            kind === "overage_settlement"
              ? line.itemName.includes(" overage")
              : !line.itemName.includes(" overage"),
          )
        : group.lineItems;
    return {
      month: group.month,
      weight: Math.max(
        0,
        allocationLines.length
          ? calculateInvoiceTotals(allocationLines).grandTotal
          : 0,
      ),
    };
  });
  const allocationRecipients = monthlyWeights.some((row) => row.weight > 0)
    ? monthlyWeights
    : cycleMonths.map((month) => ({ month, weight: 1 }));
  const revenueAllocations = allocateMoney(
    pricedInvoice.grossBeforeCredit,
    allocationRecipients,
  ).map(({ month, amount }) => ({ month, amount }));
  const receivableAllocations = allocateMoney(
    pricedInvoice.totals.grandTotal,
    allocationRecipients,
  ).map(({ month, amount }) => ({ month, amount }));

  const invoiceId = await ctx.db.insert("invoices", {
    companyId: contract.companyId,
    contractId: contract._id,
    sourceMonth,
    sourceReference: contract.contractNumber,
    cycleStartMonth: sourceMonth,
    cycleEndMonth,
    billingTiming: contract.billingTiming ?? "postpaid",
    contractInvoiceKind: kind,
    contractUsageSummary: monthlyUsageSummary
      ? {
          catalogueUsage: monthlyUsageSummary.catalogueUsage,
          discountedUsage: monthlyUsageSummary.discountedUsage,
          monthlyMinimum: monthlyUsageSummary.minimum,
          minimumShortfall: monthlyUsageSummary.shortfall,
          payable: monthlyUsageSummary.payable,
          usageEntries: monthlyUsageSummary.entries,
        }
      : undefined,
    revenueAllocations,
    receivableAllocations,
    invoiceProfileId: invoiceProfile?._id,
    ...sellerSnapshot,
    createdBy: user._id,
    status: "draft",
    dueDate,
    companyName: company.name,
    contactName: company.contactName,
    contactEmail: company.contactEmail,
    billingEmail: company.contactEmail,
    lineItems: pricedInvoice.lineItems.map(withLineMoneyCents),
    ...withInvoiceMoneyCents(pricedInvoice.totals),
    grossBeforeCredit: pricedInvoice.grossBeforeCredit,
    onboardingCreditId: pricedInvoice.credit?.credit._id,
    onboardingCreditApplied: pricedInvoice.credit?.amount,
    notes: [
      monthlyUsageSummary &&
      monthlyUsageSummary.minimum > monthlyUsageSummary.discountedUsage
        ? `Contract ${contract.contractNumber} includes a monthly minimum of ${monthlyUsageSummary.minimum.toFixed(2)} ${contract.currency}. Discounted usage for this billing period was ${monthlyUsageSummary.discountedUsage.toFixed(2)} ${contract.currency}; therefore, the contracted minimum applies.`
        : `Draft invoice from customer contract ${contract.contractNumber}. Review before issuing.`,
      monthlyUsageBreakdown,
      trimOptional(args.notes),
    ]
      .filter(Boolean)
      .join("\n\n"),
    createdAt: now,
    updatedAt: now,
  });

  if (pricedInvoice.credit) {
    await reserveCredit(
      ctx,
      pricedInvoice.credit.credit,
      invoiceId,
      pricedInvoice.credit.amount,
      user._id,
    );
  }

  await insertEvent(ctx, {
    invoiceId,
    type: "draft_created",
    actorId: user._id,
    message: `Draft invoice created from contract ${contract.contractNumber}.`,
    now,
  });
  await ctx.db.insert("customerContractEvents", {
    contractId: contract._id,
    actorId: user._id,
    type: "updated",
    message: `Draft invoice created for ${sourceMonth}.`,
    createdAt: now,
  });

  return { invoiceId, companyName: company.name, grandTotal };
}

function relayUrl() {
  const value =
    process.env.HTGWEB_MAIL_RELAY_URL?.trim() ??
    process.env.MAIL_RELAY_URL?.trim();
  if (!value) {
    throw new ConvexError({
      code: "CONFIGURATION_ERROR",
      message: "HTGweb mail relay URL is not configured",
    });
  }
  return value;
}

function invoiceRelayUrl() {
  const value = relayUrl();
  if (value.endsWith("/internal/send-invoice-email")) {
    return value;
  }
  if (value.endsWith("/internal/send-email")) {
    return value.replace(
      /\/internal\/send-email$/,
      "/internal/send-invoice-email",
    );
  }
  return `${value.replace(/\/$/, "")}/internal/send-invoice-email`;
}

function genericMailRelayUrl() {
  const value = relayUrl();
  if (value.endsWith("/internal/send-email")) {
    return value;
  }
  if (value.endsWith("/internal/send-invoice-email")) {
    return value.replace(
      /\/internal\/send-invoice-email$/,
      "/internal/send-email",
    );
  }
  return `${value.replace(/\/$/, "")}/internal/send-email`;
}

function relaySecret() {
  const value = process.env.MAIL_RELAY_SECRET?.trim();
  if (!value) {
    throw new ConvexError({
      code: "CONFIGURATION_ERROR",
      message: "Mail relay secret is not configured",
    });
  }
  return value;
}

function crmEmailEnabled() {
  const value = process.env.CRM_EMAIL_ENABLED?.trim().toLowerCase();
  return !value || !["0", "false", "no", "off"].includes(value);
}

function assertCrmEmailEnabled() {
  if (!crmEmailEnabled()) {
    throw new ConvexError({
      code: "EMAIL_DISABLED",
      message: "CRM email sending is disabled",
    });
  }
}

async function relayErrorMessage(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === "string" && body.error.trim()
      ? body.error.trim()
      : "Invoice email delivery failed";
  } catch {
    return text.trim() || "Invoice email delivery failed";
  }
}

export const list = query({
  args: {
    status: v.optional(invoiceStatusValidator),
    companyId: v.optional(v.id("companies")),
    includeTestHidden: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (args.includeTestHidden && !isCeoOrHob(user)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can include test invoices",
      });
    }
    const includeTestHidden = args.includeTestHidden === true;
    const invoices = await ctx.db.query("invoices").collect();
    const companies = await ctx.db.query("companies").collect();
    const companyMap = new Map(
      companies.map((company) => [company._id, company]),
    );

    return invoices.filter((invoice) => {
      if (!includeTestHidden && (invoice.isTest || invoice.hiddenAt)) {
        return false;
      }
      if (args.status && invoice.status !== args.status) {
        return false;
      }
      if (args.companyId && invoice.companyId !== args.companyId) {
        return false;
      }
      const company = companyMap.get(invoice.companyId);
      return company ? canViewCompany(user, company) : false;
    });
  },
});

export const reconciliationReport = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (!isCeoOrHob(user)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can reconcile invoices",
      });
    }
    return await buildReconciliationReport(ctx);
  },
});

export const reconcileInvoices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const report = await buildReconciliationReport(ctx);
    if (report.corruptedInvoiceCount > 0) {
      console.warn(
        `[INVOICE RECONCILIATION] ${report.corruptedInvoiceCount}/${report.invoiceCount} invoices have ${report.issueCount} integrity issues.`,
      );
    }
    return report;
  },
});

export const backfillContractAllocations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const invoices = await ctx.db.query("invoices").collect();
    let updated = 0;
    for (const invoice of invoices) {
      if (!invoice.contractId || invoice.revenueAllocations?.length) continue;
      const contract = await ctx.db.get(invoice.contractId);
      if (!contract || !invoice.sourceMonth) continue;
      let months: string[];
      try {
        months = contractCycleMonths(contract, invoice.sourceMonth);
      } catch {
        continue;
      }
      const recipients = months.map((month) => ({
        month,
        weight: calculateMonthProration({
          startDate: contract.startDate,
          endDate: contract.endDate,
          month,
        }).fraction,
      }));
      const gross =
        invoice.grossBeforeCredit ??
        sumMoney([invoice.grandTotal, invoice.onboardingCreditApplied ?? 0]);
      await ctx.db.patch(invoice._id, {
        revenueAllocations: allocateMoney(gross, recipients).map(
          ({ month, amount }) => ({ month, amount }),
        ),
        receivableAllocations: allocateMoney(
          invoice.grandTotal,
          recipients,
        ).map(({ month, amount }) => ({ month, amount })),
        updatedAt: Date.now(),
      });
      updated += 1;
    }
    return { updated };
  },
});

export const getById = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    await assertCanAccessInvoice(ctx, user, invoice);
    return invoice;
  },
});

export const getSendInvoiceContext = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    await assertCanAccessInvoice(ctx, user, invoice);
    assertIssuedForSend(invoice);
    const recipient = recipientForInvoice(invoice);
    if (!recipient) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Invoice has no billing or contact email",
      });
    }
    return { invoice, recipient, userId: user._id };
  },
});

export const createDraftFromQuote = mutation({
  args: {
    quoteId: v.id("quotes"),
    dueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const quote = await ctx.db.get(args.quoteId);
    if (!quote) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Quote not found" });
    }
    if (quote.status !== "accepted") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Only accepted quotes can be invoiced",
      });
    }

    const company = await getCompanyOrThrow(ctx, quote.companyId);
    assertCanManageCompany(user, company);
    const invoiceProfile = await resolveInvoiceProfileForCompany(ctx, company);
    const sellerSnapshot = invoiceProfile
      ? sellerSnapshotFromProfile(invoiceProfile)
      : {};

    const now = Date.now();
    const lineItems = calculateLineItems(
      quote.lineItems.map((lineItem) => ({ ...lineItem })),
    ).map((lineItem, index) => ({
      ...lineItem,
      yearlyTotal: roundMoney(quote.lineItems[index].yearlyTotal),
    }));
    const pricedInvoice = await invoiceLinesWithOnboardingCredit(ctx, {
      companyId: quote.companyId,
      isContract: false,
      lineItems,
    });
    assertSupportedCurrency(invoiceProfile?.currency);
    const invoiceId = await ctx.db.insert("invoices", {
      companyId: quote.companyId,
      sourceQuoteId: quote._id,
      sourceMonth: quote.sourceMonth,
      sourceReference: quote.quoteNumber,
      invoiceProfileId: invoiceProfile?._id,
      ...sellerSnapshot,
      createdBy: user._id,
      status: "draft",
      dueDate: args.dueDate,
      companyName: company.name,
      contactName: company.contactName,
      contactEmail: company.contactEmail,
      billingEmail: company.contactEmail,
      lineItems: pricedInvoice.lineItems.map(withLineMoneyCents),
      ...withInvoiceMoneyCents(pricedInvoice.totals),
      grossBeforeCredit: pricedInvoice.grossBeforeCredit,
      onboardingCreditId: pricedInvoice.credit?.credit._id,
      onboardingCreditApplied: pricedInvoice.credit?.amount,
      notes: trimOptional(args.notes ?? quote.notes),
      createdAt: now,
      updatedAt: now,
    });

    if (pricedInvoice.credit) {
      await reserveCredit(
        ctx,
        pricedInvoice.credit.credit,
        invoiceId,
        pricedInvoice.credit.amount,
        user._id,
      );
    }

    await insertEvent(ctx, {
      invoiceId,
      type: "draft_created",
      actorId: user._id,
      message: `Draft invoice created from quote ${quote.quoteNumber ?? "accepted quote"}.`,
      now,
    });

    return invoiceId;
  },
});

export const createDraftFromContract = mutation({
  args: {
    contractId: v.id("customerContracts"),
    sourceMonth: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Customer contract not found",
      });
    }

    const result = await createContractDraftInvoice(ctx, {
      user,
      contract,
      sourceMonth: args.sourceMonth,
      notes: args.notes,
    });

    return result.invoiceId;
  },
});

export const createOverageDraftFromContract = mutation({
  args: {
    contractId: v.id("customerContracts"),
    cycleStartMonth: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const contract = await ctx.db.get(args.contractId);
    if (!contract) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Customer contract not found",
      });
    }
    const result = await createContractDraftInvoice(ctx, {
      user,
      contract,
      sourceMonth: args.cycleStartMonth,
      notes: args.notes,
      kind: "overage_settlement",
    });
    return result.invoiceId;
  },
});

export const previewContractInvoiceBatch = query({
  args: { sourceMonth: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    monthStartTimestamp(args.sourceMonth);
    const contracts = await ctx.db.query("customerContracts").collect();
    const rows = await Promise.all(
      contracts.map(async (contract) => {
        const company = await ctx.db.get(contract.companyId);
        if (!company || !canViewCompany(user, company)) return null;
        const lineItems = await ctx.db
          .query("customerContractLineItems")
          .withIndex("by_contract", (q) => q.eq("contractId", contract._id))
          .collect();
        const existingInvoice = await findContractInvoiceForMonth(
          ctx,
          contract,
          args.sourceMonth,
        );
        let status:
          | "ready"
          | "already_invoiced"
          | "no_services"
          | "not_in_period"
          | "not_due"
          | "inactive" = "ready";
        let reason = "Ready to create draft";

        if (contract.status !== "active") {
          status = "inactive";
          reason = "Contract must be active before billing";
        } else if (!contractCoversMonth(contract, args.sourceMonth)) {
          status = "not_in_period";
          reason = "Contract does not cover this month";
        } else if (
      !isDynamicPricingContract(contract) &&
          lineItems.length === 0
        ) {
          status = "no_services";
          reason = "No contract services";
        } else {
          try {
            const cycleMonths = contractCycleMonths(contract, args.sourceMonth);
            if (
              (contract.billingTiming ?? "postpaid") === "postpaid" &&
              Date.now() <
                monthEndTimestamp(cycleMonths[cycleMonths.length - 1])
            ) {
              status = "not_due";
              reason = "Postpaid billing cycle has not ended";
            }
          } catch {
            status = "not_due";
            reason = "Not a billing-cycle boundary";
          }
        }
        if (status === "ready" && existingInvoice) {
          status = "already_invoiced";
          reason = existingInvoice.invoiceNumber
            ? `Already has ${existingInvoice.invoiceNumber}`
            : "Already has a draft invoice";
        }

        return {
          contractId: contract._id,
          contractNumber: contract.contractNumber,
          title: contract.title,
          companyName: company.name,
          contractStatus: contract.status,
          startDate: contract.startDate,
          endDate: contract.endDate,
          lineItemCount: lineItems.length,
          existingInvoiceId: existingInvoice?._id,
          existingInvoiceNumber: existingInvoice?.invoiceNumber,
          status,
          reason,
        };
      }),
    );
    return rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  },
});

export const createDraftsFromContracts = mutation({
  args: { sourceMonth: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    if (!isCeoOrHob(user)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message:
          "Only CEO or Head of Business can run batch contract invoicing",
      });
    }
    monthStartTimestamp(args.sourceMonth);

    const contracts = await ctx.db.query("customerContracts").collect();
    const created: Array<{
      contractId: Id<"customerContracts">;
      contractNumber: string;
      companyName: string;
      invoiceId: Id<"invoices">;
      grandTotal: number;
    }> = [];
    const skipped: Array<{
      contractId: Id<"customerContracts">;
      contractNumber: string;
      reason: string;
    }> = [];

    for (const contract of contracts) {
      try {
        const result = await createContractDraftInvoice(ctx, {
          user,
          contract,
          sourceMonth: args.sourceMonth,
        });
        created.push({
          contractId: contract._id,
          contractNumber: contract.contractNumber,
          companyName: result.companyName,
          invoiceId: result.invoiceId,
          grandTotal: result.grandTotal,
        });
      } catch (error) {
        skipped.push({
          contractId: contract._id,
          contractNumber: contract.contractNumber,
          reason:
            error instanceof ConvexError
              ? String(error.data?.message ?? error.message)
              : error instanceof Error
                ? error.message
                : "Could not create draft invoice",
        });
      }
    }

    return { created, skipped };
  },
});

export const createDueContractDrafts = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const users = await ctx.db.query("users").collect();
    const actor = users.find((user) => isCeoOrHob(user));
    if (!actor) return { created: 0, skipped: 0, reason: "No CEO or HOB user" };
    const contracts = (
      await ctx.db.query("customerContracts").collect()
    ).filter((contract) => contract.status === "active");
    let created = 0;
    let skipped = 0;
    for (const contract of contracts) {
      const startMonth = monthKeyFromTimestamp(contract.startDate);
      const endMonth = monthKeyFromTimestamp(contract.endDate);
      const frequency = contractFrequencyMonths(contract);
      for (
        let sourceMonth = startMonth;
        sourceMonth <= endMonth;
        sourceMonth = addMonths(sourceMonth, frequency)
      ) {
        const cycleMonths = contractCycleMonths(contract, sourceMonth);
        const cycleEnd = monthEndTimestamp(cycleMonths[cycleMonths.length - 1]!);
        const due =
          (contract.billingTiming ?? "postpaid") === "prepaid"
            ? monthStartTimestamp(sourceMonth) <= now
            : cycleEnd <= now;
        if (!due) continue;
        try {
          await createContractDraftInvoice(ctx, {
            user: actor,
            contract,
            sourceMonth,
          });
          created += 1;
        } catch {
          skipped += 1;
        }
        if (
          (contract.billingTiming ?? "postpaid") === "prepaid" &&
          cycleEnd <= now
        ) {
          try {
            await createContractDraftInvoice(ctx, {
              user: actor,
              contract,
              sourceMonth,
              kind: "overage_settlement",
            });
            created += 1;
          } catch {
            skipped += 1;
          }
        }
      }
    }
    return { created, skipped };
  },
});

export const updateDraft = mutation({
  args: {
    invoiceId: v.id("invoices"),
    dueDate: v.optional(v.number()),
    companyName: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    billingEmail: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    taxId: v.optional(v.string()),
    lineItems: v.optional(v.array(invoiceLineItemValidator)),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    await assertCanAccessInvoice(ctx, user, invoice);
    assertDraft(invoice);

    const now = Date.now();
    const patch: Partial<Doc<"invoices">> = {
      updatedAt: now,
    };

    if (args.dueDate !== undefined) patch.dueDate = args.dueDate;
    if (args.companyName !== undefined) {
      const companyName = args.companyName.trim();
      if (!companyName) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Company name is required",
        });
      }
      patch.companyName = companyName;
    }
    if (args.contactName !== undefined) {
      patch.contactName = trimOptional(args.contactName);
    }
    if (args.contactEmail !== undefined) {
      patch.contactEmail = trimOptional(args.contactEmail);
    }
    if (args.billingEmail !== undefined) {
      patch.billingEmail = trimOptional(args.billingEmail);
    }
    if (args.billingAddress !== undefined) {
      patch.billingAddress = trimOptional(args.billingAddress);
    }
    if (args.taxId !== undefined) {
      patch.taxId = trimOptional(args.taxId);
    }
    if (args.lineItems !== undefined) {
      if (invoice.onboardingCreditApplied) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message:
            "Cancel and recreate a credited draft to change its line items so the onboarding credit can be recalculated safely",
        });
      }
      const lineItems = calculateLineItems(args.lineItems);
      const totals = calculateInvoiceTotals(lineItems);
      patch.lineItems = lineItems.map(withLineMoneyCents);
      Object.assign(patch, withInvoiceMoneyCents(totals, invoice.amountPaid));
    }
    if (args.notes !== undefined) {
      patch.notes = trimOptional(args.notes);
    }

    await ctx.db.patch(args.invoiceId, patch);
    await insertEvent(ctx, {
      invoiceId: args.invoiceId,
      type: "draft_updated",
      actorId: user._id,
      message: "Draft invoice updated.",
      now,
    });
  },
});

export const issueInvoice = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    await assertCanAccessInvoice(ctx, user, invoice);
    assertTransitionFromDraft(invoice);
    const company = await getCompanyOrThrow(ctx, invoice.companyId);

    const now = Date.now();
    const invoiceNumber =
      invoice.invoiceNumber ?? (await nextInvoiceNumber(ctx, now));
    const invoiceProfile = await resolveInvoiceProfileForIssue(
      ctx,
      invoice,
      company,
    );
    assertSupportedCurrency(invoiceProfile?.currency ?? invoice.sellerCurrency);
    const profilePatch = invoiceProfile
      ? {
          invoiceProfileId: invoice.invoiceProfileId ?? invoiceProfile._id,
          ...sellerSnapshotFromProfile(invoiceProfile),
        }
      : {};
    const invariantIssues = reconciliationIssues(
      invoice,
      invoice.amountPaid,
    ).filter((issue) => !issue.field.endsWith("Cents"));
    if (invariantIssues.length > 0) {
      throw new ConvexError({
        code: "INVOICE_INTEGRITY_ERROR",
        message: `Invoice has ${invariantIssues.length} calculation issue(s); reconcile the draft before issuing`,
        issues: invariantIssues,
      });
    }
    const canonicalTotals = calculateInvoiceTotals(invoice.lineItems);
    await ctx.db.patch(args.invoiceId, {
      status: "issued",
      invoiceNumber,
      ...profilePatch,
      lineItems: invoice.lineItems.map(withLineMoneyCents),
      ...withInvoiceMoneyCents(canonicalTotals, invoice.amountPaid),
      issueDate: now,
      dueDate:
        invoice.dueDate ?? defaultDueDateForIssue(now, company.paymentTermDays),
      lockedAt: now,
      updatedAt: now,
    });
    await consumeInvoiceCredit(ctx, invoice, user._id);
    await insertEvent(ctx, {
      invoiceId: args.invoiceId,
      type: "issued",
      actorId: user._id,
      message: `Invoice ${invoiceNumber} issued and locked.`,
      now,
    });
    const dailyUsageRows = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
      .collect();
    for (const row of dailyUsageRows) {
      await ctx.db.patch(row._id, { lockedAt: now });
    }
  },
});

export const markInvoiceSent = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    sentTo: v.string(),
    sentBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    assertIssuedForSend(invoice);

    const now = Date.now();
    await ctx.db.patch(args.invoiceId, {
      status: "sent" satisfies InvoiceStatus,
      sentAt: now,
      sentTo: args.sentTo,
      sentBy: args.sentBy,
      updatedAt: now,
    });
    await insertEvent(ctx, {
      invoiceId: args.invoiceId,
      type: "sent",
      actorId: args.sentBy,
      message: `Invoice ${invoice.invoiceNumber ?? args.invoiceId} sent to ${args.sentTo}.`,
      now,
    });
  },
});

export const markOverdueInvoices = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const overdueBefore = startOfBusinessDay(now);
    const invoices = await ctx.db.query("invoices").collect();
    let updated = 0;

    for (const invoice of invoices) {
      if (
        !OVERDUE_CANDIDATE_STATUSES.has(invoice.status) ||
        invoice.dueDate === undefined ||
        invoice.dueDate >= overdueBefore ||
        invoice.balanceDue <= 0
      ) {
        continue;
      }

      await ctx.db.patch(invoice._id, {
        status: "overdue",
        updatedAt: now,
      });
      await insertEvent(ctx, {
        invoiceId: invoice._id,
        type: "overdue",
        message: `Invoice marked overdue. Balance due: ${formatMoney(invoice.balanceDue)}.`,
        now,
      });
      updated += 1;
    }

    return { updated };
  },
});

export const listInternalReminderCandidates = internalQuery({
  args: {
    now: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<InternalReminderCandidateResult> => {
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_status", (q) => q.eq("status", "overdue"))
      .collect();
    const reminders: InternalReminderCandidate[] = [];
    let skipped = 0;

    for (const invoice of invoices) {
      if (invoice.balanceDue <= 0) {
        skipped += 1;
        continue;
      }
      if (
        invoice.lastInternalReminderAt !== undefined &&
        args.now - invoice.lastInternalReminderAt <
          INTERNAL_REMINDER_INTERVAL_MS
      ) {
        skipped += 1;
        continue;
      }

      const company = await ctx.db.get(invoice.companyId);
      if (!company?.accountManagerId) {
        skipped += 1;
        continue;
      }

      const accountManager = await ctx.db.get(company.accountManagerId);
      const recipient = trimOptional(accountManager?.email);
      if (!accountManager || !recipient) {
        skipped += 1;
        continue;
      }

      reminders.push({ invoice, accountManager, recipient });
      if (reminders.length >= args.limit) {
        break;
      }
    }

    return { reminders, skipped };
  },
});

export const markInternalReminderSent = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    sentTo: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    if (
      invoice.status !== "overdue" ||
      invoice.balanceDue <= 0 ||
      (invoice.lastInternalReminderAt !== undefined &&
        args.now - invoice.lastInternalReminderAt <
          INTERNAL_REMINDER_INTERVAL_MS)
    ) {
      return false;
    }

    const count = (invoice.internalReminderCount ?? 0) + 1;
    await ctx.db.patch(args.invoiceId, {
      lastInternalReminderAt: args.now,
      internalReminderCount: count,
      updatedAt: args.now,
    });
    await insertEvent(ctx, {
      invoiceId: args.invoiceId,
      type: "internal_reminder_sent",
      message: `Internal overdue reminder sent to ${args.sentTo}. Balance due: ${formatMoney(invoice.balanceDue)}.`,
      now: args.now,
    });
    return true;
  },
});

export const sendInternalOverdueReminders = internalAction({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<InternalReminderRunResult> => {
    const now = args.now ?? Date.now();
    const limit = Math.min(
      Math.max(args.limit ?? DEFAULT_INTERNAL_REMINDER_LIMIT, 1),
      100,
    );
    const { reminders, skipped: initialSkipped } = (await ctx.runQuery(
      internal.invoices.listInternalReminderCandidates,
      { now, limit },
    )) as InternalReminderCandidateResult;
    let sent = 0;
    let skipped = initialSkipped;
    let failed = 0;

    if (!crmEmailEnabled()) {
      return { sent, skipped: skipped + reminders.length, failed };
    }

    for (const reminder of reminders) {
      const email = buildInternalReminderEmail(reminder);
      try {
        const response = await fetch(genericMailRelayUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Mail-Relay-Secret": relaySecret(),
          },
          body: JSON.stringify({
            to: reminder.recipient,
            subject: email.subject,
            html: email.html,
            text: email.text,
          }),
        });

        if (!response.ok) {
          throw new Error(await relayErrorMessage(response));
        }

        const body = (await response.json().catch(() => ({
          success: true,
        }))) as { success?: unknown; error?: unknown };
        if (body.success === false) {
          throw new Error(
            typeof body.error === "string" && body.error.trim()
              ? body.error.trim()
              : "Internal reminder delivery failed",
          );
        }

        const recorded = await ctx.runMutation(
          internal.invoices.markInternalReminderSent,
          {
            invoiceId: reminder.invoice._id,
            sentTo: reminder.recipient,
            now,
          },
        );
        if (recorded) {
          sent += 1;
        } else {
          skipped += 1;
        }
      } catch {
        failed += 1;
      }
    }

    return { sent, skipped, failed };
  },
});

export const listCustomerReminderCandidates = internalQuery({
  args: {
    now: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args): Promise<CustomerReminderCandidateResult> => {
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_status", (q) => q.eq("status", "overdue"))
      .collect();
    const reminders: CustomerReminderCandidate[] = [];
    let skipped = 0;

    for (const invoice of invoices) {
      if (invoice.balanceDue <= 0) {
        skipped += 1;
        continue;
      }
      if (
        invoice.lastCustomerReminderAt !== undefined &&
        args.now - invoice.lastCustomerReminderAt <
          CUSTOMER_REMINDER_INTERVAL_MS
      ) {
        skipped += 1;
        continue;
      }

      const recipient = recipientForInvoice(invoice);
      if (!recipient) {
        skipped += 1;
        continue;
      }

      reminders.push({ invoice, recipient });
      if (reminders.length >= args.limit) {
        break;
      }
    }

    return { reminders, skipped };
  },
});

export const markCustomerReminderSent = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    sentTo: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    if (
      invoice.status !== "overdue" ||
      invoice.balanceDue <= 0 ||
      (invoice.lastCustomerReminderAt !== undefined &&
        args.now - invoice.lastCustomerReminderAt <
          CUSTOMER_REMINDER_INTERVAL_MS)
    ) {
      return false;
    }

    const count = (invoice.customerReminderCount ?? 0) + 1;
    await ctx.db.patch(args.invoiceId, {
      lastCustomerReminderAt: args.now,
      customerReminderCount: count,
      updatedAt: args.now,
    });
    await insertEvent(ctx, {
      invoiceId: args.invoiceId,
      type: "customer_reminder_sent",
      message: `Customer overdue reminder sent to ${args.sentTo}. Balance due: ${formatMoney(invoice.balanceDue)}.`,
      now: args.now,
    });
    return true;
  },
});

export const sendCustomerOverdueReminders = internalAction({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CustomerReminderRunResult> => {
    const now = args.now ?? Date.now();
    const limit = Math.min(
      Math.max(args.limit ?? DEFAULT_CUSTOMER_REMINDER_LIMIT, 1),
      100,
    );
    const { reminders, skipped: initialSkipped } = (await ctx.runQuery(
      internal.invoices.listCustomerReminderCandidates,
      { now, limit },
    )) as CustomerReminderCandidateResult;
    let sent = 0;
    let skipped = initialSkipped;
    let failed = 0;

    if (!crmEmailEnabled()) {
      return { sent, skipped: skipped + reminders.length, failed };
    }

    for (const reminder of reminders) {
      const email = buildCustomerReminderEmail(reminder.invoice);
      try {
        const response = await fetch(invoiceRelayUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Mail-Relay-Secret": relaySecret(),
          },
          body: JSON.stringify({
            to: reminder.recipient,
            subject: email.subject,
            html: email.html,
            text: email.text,
            invoice: invoiceRelaySnapshot(reminder.invoice),
          }),
        });

        if (!response.ok) {
          throw new Error(await relayErrorMessage(response));
        }

        const body = (await response.json().catch(() => ({
          success: true,
        }))) as { success?: unknown; error?: unknown };
        if (body.success === false) {
          throw new Error(
            typeof body.error === "string" && body.error.trim()
              ? body.error.trim()
              : "Customer reminder delivery failed",
          );
        }

        const recorded = await ctx.runMutation(
          internal.invoices.markCustomerReminderSent,
          {
            invoiceId: reminder.invoice._id,
            sentTo: reminder.recipient,
            now,
          },
        );
        if (recorded) {
          sent += 1;
        } else {
          skipped += 1;
        }
      } catch {
        failed += 1;
      }
    }

    return { sent, skipped, failed };
  },
});

export const sendInvoiceEmail = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const { invoice, recipient, userId } = await ctx.runQuery(
      internal.invoices.getSendInvoiceContext,
      { invoiceId: args.invoiceId },
    );
    assertCrmEmailEnabled();
    const email = buildInvoiceEmail(invoice, recipient);
    const response = await fetch(invoiceRelayUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mail-Relay-Secret": relaySecret(),
      },
      body: JSON.stringify({
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
        invoice: invoiceRelaySnapshot(invoice),
      }),
    });

    if (!response.ok) {
      throw new ConvexError({
        code: "EMAIL_DELIVERY_FAILED",
        message: await relayErrorMessage(response),
      });
    }

    const body = (await response.json().catch(() => ({ success: true }))) as {
      success?: unknown;
      error?: unknown;
    };
    if (body.success === false) {
      throw new ConvexError({
        code: "EMAIL_DELIVERY_FAILED",
        message:
          typeof body.error === "string" && body.error.trim()
            ? body.error.trim()
            : "Invoice email delivery failed",
      });
    }

    await ctx.runMutation(internal.invoices.markInvoiceSent, {
      invoiceId: args.invoiceId,
      sentTo: recipient,
      sentBy: userId,
    });
  },
});

export const voidInvoice = mutation({
  args: {
    invoiceId: v.id("invoices"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    assertCanCleanupInvoices(user);
    await assertCanAccessInvoice(ctx, user, invoice);
    const reason = requireCleanupReason(args.reason);
    if (!VOIDABLE_STATUSES.has(invoice.status)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Only issued, sent, partially paid, or overdue invoices can be voided",
      });
    }

    const now = Date.now();
    await ctx.db.patch(args.invoiceId, {
      status: "void" satisfies InvoiceStatus,
      updatedAt: now,
    });
    await restoreInvoiceCredit(ctx, invoice, user._id);
    await insertEvent(ctx, {
      invoiceId: args.invoiceId,
      type: "voided",
      actorId: user._id,
      message: `Invoice voided. Reason: ${reason}`,
      now,
    });
  },
});

export const cancelDraftInvoice = mutation({
  args: {
    invoiceId: v.id("invoices"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    assertCanCleanupInvoices(user);
    await assertCanAccessInvoice(ctx, user, invoice);
    const reason = requireCleanupReason(args.reason);
    if (invoice.status !== "draft") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Only draft invoices can be cancelled",
      });
    }

    const now = Date.now();
    await ctx.db.patch(args.invoiceId, {
      status: "cancelled" satisfies InvoiceStatus,
      updatedAt: now,
    });
    await releaseInvoiceCredit(ctx, invoice, user._id);
    await insertEvent(ctx, {
      invoiceId: args.invoiceId,
      type: "cancelled",
      actorId: user._id,
      message: `Draft invoice cancelled. Reason: ${reason}`,
      now,
    });
    const dailyUsageRows = await ctx.db
      .query("dailyUsageSnapshots")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
      .collect();
    for (const row of dailyUsageRows) {
      await ctx.db.patch(row._id, {
        invoiceId: undefined,
        lockedAt: undefined,
      });
    }
  },
});

export const setInvoiceTestMode = mutation({
  args: {
    invoiceId: v.id("invoices"),
    isTest: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    assertCanCleanupInvoices(user);
    await assertCanAccessInvoice(ctx, user, invoice);
    const reason = requireCleanupReason(args.reason);
    if ((invoice.isTest ?? false) === args.isTest) {
      return;
    }

    const now = Date.now();
    if (args.isTest) {
      await ctx.db.patch(args.invoiceId, {
        isTest: true,
        hiddenAt: now,
        hiddenBy: user._id,
        updatedAt: now,
      });
      await insertEvent(ctx, {
        invoiceId: args.invoiceId,
        type: "marked_test",
        actorId: user._id,
        message: `Invoice marked as test/hidden. Reason: ${reason}`,
        now,
      });
      return;
    }

    await ctx.db.patch(args.invoiceId, {
      isTest: false,
      hiddenAt: undefined,
      hiddenBy: undefined,
      updatedAt: now,
    });
    await insertEvent(ctx, {
      invoiceId: args.invoiceId,
      type: "unmarked_test",
      actorId: user._id,
      message: `Invoice unmarked as test/hidden. Reason: ${reason}`,
      now,
    });
  },
});

export const listPayments = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    await assertCanAccessInvoice(ctx, user, invoice);

    const payments = await ctx.db
      .query("invoicePayments")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
      .collect();
    return payments.sort((a, b) => b.paidAt - a.paidAt);
  },
});

export const recordPayment = mutation({
  args: {
    invoiceId: v.id("invoices"),
    amount: v.number(),
    paidAt: v.optional(v.number()),
    method: v.optional(v.string()),
    reference: v.optional(v.string()),
    receivingAccountId: v.optional(v.id("receivingAccounts")),
    transactionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    await assertCanAccessInvoice(ctx, user, invoice);
    assertPayable(invoice);

    const amount = roundMoney(args.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Payment amount must be positive",
      });
    }
    if (amount > roundMoney(invoice.balanceDue)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Payment cannot exceed the balance due",
      });
    }

    const now = Date.now();
    const paidAt = args.paidAt ?? now;
    const nextAmountPaid = sumMoney([invoice.amountPaid, amount]);
    const nextBalanceDue = calculateBalance(invoice.grandTotal, nextAmountPaid);
    const nextStatus: InvoiceStatus =
      nextBalanceDue === 0 ? "paid" : "partially_paid";
    const method = trimOptional(args.method) ?? PAYMENT_METHOD_BANK_TRANSFER;
    if (!SUPPORTED_PAYMENT_METHODS.has(method)) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Unsupported payment method",
      });
    }
    const reference = trimOptional(args.reference);
    const transactionId = trimOptional(args.transactionId);
    const receivingAccount = args.receivingAccountId
      ? await ctx.db.get(args.receivingAccountId)
      : null;
    if (!receivingAccount || !receivingAccount.isActive) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select an active receiving account",
      });
    }
    if (receivingAccount.usage === "outgoing") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select an account enabled for customer collections",
      });
    }
    const paymentCompany = await ctx.db.get(invoice.companyId);
    if (
      !paymentCompany ||
      !receivingAccount.countryId ||
      receivingAccount.countryId !== paymentCompany.countryId
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Receiving account must belong to the customer's country",
      });
    }
    const expectedType =
      method === PAYMENT_METHOD_BANK_TRANSFER ? "bank" : "mobile_money";
    if (receivingAccount.type !== expectedType) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "The receiving account does not match the payment method",
      });
    }
    if (!transactionId) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Bank or provider transaction ID is required",
      });
    }
    const invoiceCurrency = invoice.sellerCurrency ?? "USD";
    if (receivingAccount.currency !== invoiceCurrency) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Payment account currency must be ${invoiceCurrency}`,
      });
    }
    const duplicate = await ctx.db
      .query("invoicePayments")
      .withIndex("by_account_transaction", (q) =>
        q
          .eq("receivingAccountId", receivingAccount._id)
          .eq("transactionId", transactionId),
      )
      .first();
    if (duplicate) {
      throw new ConvexError({
        code: "CONFLICT",
        message:
          "This transaction ID has already been recorded for the account",
      });
    }

    await ctx.db.insert("invoicePayments", {
      invoiceId: args.invoiceId,
      receivingAccountId: receivingAccount._id,
      amount,
      amountCents: toCents(amount),
      paidAt,
      method,
      reference,
      transactionId,
      receivingBankName: receivingAccount.providerName,
      receivingAccountNumber: receivingAccount.accountNumber,
      receivingAccountName: receivingAccount.accountHolderName,
      receivingBankLocation: receivingAccount.location,
      receivingCurrencyNote: receivingAccount.currency,
      recordedBy: user._id,
      createdAt: now,
    });

    await ctx.db.patch(args.invoiceId, {
      amountPaid: nextAmountPaid,
      balanceDue: nextBalanceDue,
      amountPaidCents: toCents(nextAmountPaid),
      balanceDueCents: toCents(nextBalanceDue),
      status: nextStatus,
      updatedAt: now,
    });

    const details = [
      `Payment of ${formatMoney(amount)} recorded.`,
      method ? `Method: ${method}.` : undefined,
      `Account: ${receivingAccount.name}.`,
      `Transaction ID: ${transactionId}.`,
      reference ? `Note: ${reference}.` : undefined,
      `Balance due: ${formatMoney(nextBalanceDue)}.`,
    ]
      .filter(Boolean)
      .join(" ");

    await insertEvent(ctx, {
      invoiceId: args.invoiceId,
      type: "payment_recorded",
      actorId: user._id,
      message: details,
      now,
    });
  },
});

export const listEvents = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    await assertCanAccessInvoice(ctx, user, invoice);

    const events = await ctx.db
      .query("invoiceEvents")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
      .collect();
    const actorIds = Array.from(
      new Set(events.map((event) => event.actorId).filter(Boolean)),
    ) as Id<"users">[];
    const actors = await Promise.all(
      actorIds.map(async (actorId) => await ctx.db.get(actorId)),
    );
    const actorMap = new Map(
      actors
        .filter((actor): actor is Doc<"users"> => actor !== null)
        .map((actor) => [actor._id, actor]),
    );

    return events
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((event) => {
        const actor = event.actorId ? actorMap.get(event.actorId) : undefined;
        return {
          ...event,
          actorEmail: actor?.email,
          actorName: actor?.name,
        };
      });
  },
});
