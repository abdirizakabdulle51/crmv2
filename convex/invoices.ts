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
import { buildContractUsageBilling } from "./contractBilling";

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
type CustomerReminderRunResult = {
  sent: number;
  skipped: number;
  failed: number;
};

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
const BANK_TRANSFER_RECEIVING_DETAILS = {
  receivingBankName: "Salaam Somali Bank",
  receivingAccountNumber: "33111777",
  receivingAccountName: "HTG CLOUDS LIMITED",
  receivingBankLocation: "MOGADISHU - SOMALIA",
  receivingCurrencyNote: "All fees are listed in USD",
};

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
  monthlyTotal: v.number(),
  yearlyTotal: v.number(),
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

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
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
  return snapshot;
}

function discountAmount(line: Doc<"customerContractLineItems">, gross: number) {
  if (!line.discountType || line.discountValue === undefined) return 0;
  if (line.discountType === "percentage") {
    return Math.min(gross, gross * (line.discountValue / 100));
  }
  return Math.min(gross, line.discountValue);
}

function contractLineBaseAmount(line: Doc<"customerContractLineItems">) {
  const gross = line.includedQuantity * line.contractUnitPrice;
  return Math.max(0, roundMoney(gross - discountAmount(line, gross)));
}

function usageMatchesContractLine(
  usage: Doc<"consumption">,
  line: Doc<"customerContractLineItems">,
) {
  if (line.catalogItemId && usage.catalogItemId === line.catalogItemId) {
    return true;
  }

  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const usageKey = normalize(usage.serviceType);
  const itemKey = normalize(line.itemName);
  const categoryKey = normalize(line.serviceCategory);
  return (
    usageKey === itemKey ||
    usageKey.includes(itemKey) ||
    itemKey.includes(usageKey) ||
    (categoryKey.length > 0 && usageKey.includes(categoryKey))
  );
}

function contractInvoiceLine(
  line: Doc<"customerContractLineItems">,
  usageEntries: Doc<"consumption">[],
): InvoiceLineItem {
  const matchedUsage = usageEntries.filter((usage) =>
    usageMatchesContractLine(usage, line),
  );
  const actualQuantity = matchedUsage.reduce((total, usage) => {
    if (usage.quantity !== undefined) return total + usage.quantity;
    const price = line.catalogUnitPrice ?? line.contractUnitPrice;
    if (price > 0) return total + usage.amount / price;
    return total;
  }, 0);
  const overageQuantity = Math.max(0, actualQuantity - line.includedQuantity);
  const baseAmount = contractLineBaseAmount(line);
  const overageAmount = roundMoney(
    overageQuantity * (line.overageUnitPrice ?? line.contractUnitPrice),
  );
  const monthlyTotal = roundMoney(baseAmount + overageAmount);

  return {
    catalogItemId: line.catalogItemId,
    itemName:
      overageQuantity > 0
        ? `${line.itemName} (${roundMoney(overageQuantity)} overage)`
        : line.itemName,
    serviceCategory: line.serviceCategory,
    billingUnit: line.billingUnit,
    quantity:
      overageQuantity > 0
        ? roundMoney(line.includedQuantity + overageQuantity)
        : line.includedQuantity,
    monthlyUnitPrice: line.contractUnitPrice,
    monthlyTotal,
    yearlyTotal: roundMoney(monthlyTotal * 12),
  };
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
) {
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_company", (q) => q.eq("companyId", contract.companyId))
    .collect();
  return (
    invoices.find(
      (invoice) =>
        (invoice.sourceContractId === contract._id ||
          invoice.sourceReference === contract.contractNumber) &&
        invoice.sourceMonth === sourceMonth &&
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
  },
) {
  const { user, contract, sourceMonth } = args;
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
  );
  if (duplicate) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `An invoice already exists for contract ${contract.contractNumber} and month ${sourceMonth}`,
    });
  }

  const company = await getCompanyOrThrow(ctx, contract.companyId);
  assertCanManageCompany(user, company);

  const billing = await buildContractUsageBilling(ctx, {
    contract,
    sourceMonth,
  });
  if (billing.lines.length === 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Add at least one contract service before creating an invoice",
    });
  }
  if (billing.dailyRowCount === 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "No daily usage snapshots found for this contract billing period",
    });
  }
  if (billing.unpricedCount > 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "All daily usage rows must have contract or catalog pricing before creating a contract invoice",
    });
  }

  const grandTotal = roundMoney(billing.overageAmount);
  if (grandTotal <= 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `No billable contract overage for ${contract.contractNumber} in ${sourceMonth}`,
    });
  }
  const lineItems: InvoiceLineItem[] = [
    {
      itemName: `Contract usage overage - ${contract.contractNumber}`,
      serviceCategory: "Contract Overage",
      billingUnit: "billing period",
      quantity: 1,
      monthlyUnitPrice: grandTotal,
      monthlyTotal: grandTotal,
      yearlyTotal: roundMoney(grandTotal * 12),
    },
  ];
  const invoiceProfile = await resolveInvoiceProfileForCompany(ctx, company);
  const sellerSnapshot = invoiceProfile
    ? sellerSnapshotFromProfile(invoiceProfile)
    : {};
  const now = Date.now();
  const dueDate =
    contract.paymentTermDays === undefined
      ? undefined
      : monthEndTimestamp(sourceMonth) + contract.paymentTermDays * MS_PER_DAY;

  const invoiceId = await ctx.db.insert("invoices", {
    companyId: contract.companyId,
    sourceType: "contract",
    sourceContractId: contract._id,
    sourceMonth,
    sourceReference: contract.contractNumber,
    contractPeriodStartMonth: billing.periodStartMonth,
    contractPeriodEndMonth: billing.periodEndMonth,
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
    notes:
      trimOptional(args.notes) ??
      `Draft invoice from customer contract ${contract.contractNumber}. Usage valued from daily snapshots for ${billing.periodStartMonth} through ${billing.effectiveEndMonth}; contract credit ${billing.contractPeriodAmount}, usage ${billing.usageToDate}. Review before issuing.`,
    createdAt: now,
    updatedAt: now,
  });

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
    if ((quote.discountPercent ?? 0) > 0) {
      if (quote.discountApprovalStatus === "pending") {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message:
            "Discount approval is still pending. It must be approved before this quote can be invoiced.",
        });
      }
      if (quote.discountApprovalStatus === "rejected") {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message:
            "Discount approval was rejected. Change or remove the discount before creating an invoice.",
        });
      }
    }

    const company = await getCompanyOrThrow(ctx, quote.companyId);
    assertCanManageCompany(user, company);
    if (quote.sourceMonth) {
      const coveringContract = (
        await ctx.db
          .query("customerContracts")
          .withIndex("by_company", (q) => q.eq("companyId", quote.companyId))
          .collect()
      ).find(
        (contract) =>
          contract.status === "active" &&
          contractCoversMonth(contract, quote.sourceMonth!),
      );
      if (coveringContract) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: `Quote ${quote.quoteNumber ?? quote._id} is for ${quote.sourceMonth}, which is covered by active contract ${coveringContract.contractNumber}. Use contract billing so the contract credit is applied.`,
        });
      }
    }
    const invoiceProfile = await resolveInvoiceProfileForCompany(ctx, company);
    const sellerSnapshot = invoiceProfile
      ? sellerSnapshotFromProfile(invoiceProfile)
      : {};

    const now = Date.now();
    const grandTotal = quote.monthlyGrandTotal;
    const invoiceLineItems: InvoiceLineItem[] = quote.lineItems.map(
      (lineItem) => ({ ...lineItem }),
    );
    if ((quote.discountPercent ?? 0) > 0) {
      invoiceLineItems.push({
        itemName: `Quote discount (${quote.discountPercent}%)`,
        serviceCategory: "Discount",
        billingUnit: "quote discount",
        quantity: 1,
        monthlyUnitPrice: -(quote.monthlyDiscountTotal ?? 0),
        monthlyTotal: -(quote.monthlyDiscountTotal ?? 0),
        yearlyTotal: -(quote.yearlyDiscountTotal ?? 0),
      });
    }
    const invoiceId = await ctx.db.insert("invoices", {
      companyId: quote.companyId,
      sourceQuoteId: quote._id,
      sourceType: "quote",
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
      lineItems: invoiceLineItems,
      subtotal: quote.monthlySubtotal ?? quote.monthlyGrandTotal,
      monthlyTotal: quote.monthlyGrandTotal,
      yearlyTotal: quote.yearlyGrandTotal,
      grandTotal,
      amountPaid: 0,
      balanceDue: grandTotal,
      notes: trimOptional(args.notes ?? quote.notes),
      createdAt: now,
      updatedAt: now,
    });

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

export const previewContractInvoiceBatch = query({
  args: { sourceMonth: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    monthStartTimestamp(args.sourceMonth);
    const contracts = await ctx.db.query("customerContracts").collect();
    const rows = await Promise.all(
      contracts.map(async (contract) => {
        if (contract.status === "terminated") return null;
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
          | "inactive" = "ready";
        let reason = "Ready to create draft";

        if (contract.status !== "active") {
          status = "inactive";
          reason = "Contract must be active before billing";
        } else if (!contractCoversMonth(contract, args.sourceMonth)) {
          status = "not_in_period";
          reason = "Contract does not cover this month";
        } else if (lineItems.length === 0) {
          status = "no_services";
          reason = "No contract services";
        } else if (existingInvoice) {
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
      if (contract.status === "terminated") continue;
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
    subtotal: v.optional(v.number()),
    monthlyTotal: v.optional(v.number()),
    yearlyTotal: v.optional(v.number()),
    grandTotal: v.optional(v.number()),
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
      patch.lineItems = args.lineItems;
    }
    if (args.subtotal !== undefined) patch.subtotal = args.subtotal;
    if (args.monthlyTotal !== undefined) patch.monthlyTotal = args.monthlyTotal;
    if (args.yearlyTotal !== undefined) patch.yearlyTotal = args.yearlyTotal;
    if (args.grandTotal !== undefined) {
      patch.grandTotal = args.grandTotal;
      patch.balanceDue = args.grandTotal - invoice.amountPaid;
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
    const profilePatch = invoiceProfile
      ? {
          invoiceProfileId: invoice.invoiceProfileId ?? invoiceProfile._id,
          ...sellerSnapshotFromProfile(invoiceProfile),
        }
      : {};
    await ctx.db.patch(args.invoiceId, {
      status: "issued",
      invoiceNumber,
      ...profilePatch,
      issueDate: now,
      dueDate:
        invoice.dueDate ?? defaultDueDateForIssue(now, company.paymentTermDays),
      lockedAt: now,
      updatedAt: now,
    });
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
    const now = Date.now();
    const paidAt = args.paidAt ?? now;
    const currentBalanceDue = roundMoney(invoice.balanceDue);
    const appliedAmount = roundMoney(Math.min(amount, currentBalanceDue));
    const extraServiceRevenueAmount = roundMoney(amount - appliedAmount);
    const nextAmountPaid = roundMoney(invoice.amountPaid + appliedAmount);
    const nextBalanceDue = roundMoney(currentBalanceDue - appliedAmount);
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
    const receivingDetails =
      method === PAYMENT_METHOD_BANK_TRANSFER
        ? BANK_TRANSFER_RECEIVING_DETAILS
        : {};

    await ctx.db.insert("invoicePayments", {
      invoiceId: args.invoiceId,
      amount,
      appliedAmount,
      extraServiceRevenueAmount:
        extraServiceRevenueAmount > 0 ? extraServiceRevenueAmount : undefined,
      paidAt,
      method,
      reference,
      ...receivingDetails,
      recordedBy: user._id,
      createdAt: now,
    });

    await ctx.db.patch(args.invoiceId, {
      amountPaid: nextAmountPaid,
      balanceDue: nextBalanceDue,
      status: nextStatus,
      updatedAt: now,
    });

    const details = [
      `Payment of ${formatMoney(amount)} recorded.`,
      extraServiceRevenueAmount > 0
        ? `Applied to invoice: ${formatMoney(appliedAmount)}. Extra Service Revenue: ${formatMoney(extraServiceRevenueAmount)}.`
        : undefined,
      method ? `Method: ${method}.` : undefined,
      reference ? `Reference: ${reference}.` : undefined,
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
