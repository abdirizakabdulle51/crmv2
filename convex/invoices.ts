import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { internal } from "./_generated/api";
import { assertCanManageCompany, canViewCompany } from "./authorization";

type Ctx = QueryCtx | MutationCtx;
type InvoiceStatus = Doc<"invoices">["status"];
type InvoiceLineItem = Doc<"invoices">["lineItems"][number];

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
  catalogItemId: v.id("serviceCatalog"),
  itemName: v.string(),
  serviceCategory: v.string(),
  billingUnit: v.string(),
  quantity: v.number(),
  monthlyUnitPrice: v.number(),
  monthlyTotal: v.number(),
  yearlyTotal: v.number(),
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

async function assertCanAccessInvoice(
  ctx: Ctx,
  user: Doc<"users">,
  invoice: Doc<"invoices">,
) {
  const company = await getCompanyOrThrow(ctx, invoice.companyId);
  assertCanManageCompany(user, company);
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

function invoiceNumberForSequence(now: number, sequence: number) {
  const year = new Date(now).getUTCFullYear();
  return `INV-${year}-${String(sequence).padStart(5, "0")}`;
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

function lineItemRows(lineItems: InvoiceLineItem[]) {
  return lineItems
    .map(
      (item) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.itemName)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.serviceCategory)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(item.quantity)}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(formatMoney(item.monthlyUnitPrice))}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escapeHtml(formatMoney(item.monthlyTotal))}</td>
        </tr>`,
    )
    .join("");
}

function buildInvoiceEmail(invoice: Doc<"invoices">, recipient: string) {
  const invoiceNumber = invoice.invoiceNumber ?? "Invoice";
  const subject = `HTGClouds invoice ${invoiceNumber}`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5;">
      <h1 style="margin:0 0 12px;font-size:24px;">${escapeHtml(invoiceNumber)}</h1>
      <p>Dear ${escapeHtml(invoice.contactName ?? invoice.companyName)},</p>
      <p>Please find your HTGClouds invoice summary below.</p>
      <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:720px;">
        <tbody>
          <tr><td style="padding:6px 0;color:#64748b;">Customer</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(invoice.companyName)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Invoice number</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(invoiceNumber)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Issue date</td><td style="padding:6px 0;">${escapeHtml(formatInvoiceDate(invoice.issueDate))}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Due date</td><td style="padding:6px 0;">${escapeHtml(formatInvoiceDate(invoice.dueDate))}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Recipient</td><td style="padding:6px 0;">${escapeHtml(recipient)}</td></tr>
        </tbody>
      </table>
      <table style="border-collapse:collapse;width:100%;max-width:720px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px;text-align:left;border-bottom:1px solid #cbd5e1;">Item</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid #cbd5e1;">Category</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid #cbd5e1;">Qty</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid #cbd5e1;">Unit</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid #cbd5e1;">Total</th>
          </tr>
        </thead>
        <tbody>${lineItemRows(invoice.lineItems)}</tbody>
      </table>
      <p style="margin-top:18px;font-size:18px;"><strong>Balance due: ${escapeHtml(formatMoney(invoice.balanceDue))}</strong></p>
      <p>If you have any questions, please contact your HTGClouds account team.</p>
    </div>`;
  const textLines = [
    `${invoiceNumber}`,
    `Customer: ${invoice.companyName}`,
    `Issue date: ${formatInvoiceDate(invoice.issueDate)}`,
    `Due date: ${formatInvoiceDate(invoice.dueDate)}`,
    "",
    "Line items:",
    ...invoice.lineItems.map(
      (item) =>
        `- ${item.itemName} (${item.serviceCategory}) x ${item.quantity}: ${formatMoney(item.monthlyTotal)}`,
    ),
    "",
    `Balance due: ${formatMoney(invoice.balanceDue)}`,
    "",
    "If you have any questions, please contact your HTGClouds account team.",
  ];

  return { subject, html, text: textLines.join("\n") };
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
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoices = await ctx.db.query("invoices").collect();
    const companies = await ctx.db.query("companies").collect();
    const companyMap = new Map(
      companies.map((company) => [company._id, company]),
    );

    return invoices.filter((invoice) => {
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

    const company = await getCompanyOrThrow(ctx, quote.companyId);
    assertCanManageCompany(user, company);

    const now = Date.now();
    const grandTotal = quote.monthlyGrandTotal;
    const invoiceId = await ctx.db.insert("invoices", {
      companyId: quote.companyId,
      sourceQuoteId: quote._id,
      sourceMonth: quote.sourceMonth,
      createdBy: user._id,
      status: "draft",
      dueDate: args.dueDate,
      companyName: company.name,
      contactName: company.contactName,
      contactEmail: company.contactEmail,
      billingEmail: company.contactEmail,
      lineItems: quote.lineItems.map((lineItem) => ({ ...lineItem })),
      subtotal: quote.monthlyGrandTotal,
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
      message: `Draft invoice created from quote ${quote._id}.`,
      now,
    });

    return invoiceId;
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

    const now = Date.now();
    const invoiceNumber =
      invoice.invoiceNumber ?? (await nextInvoiceNumber(ctx, now));
    await ctx.db.patch(args.invoiceId, {
      status: "issued",
      invoiceNumber,
      issueDate: now,
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

export const sendInvoiceEmail = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const { invoice, recipient, userId } = await ctx.runQuery(
      internal.invoices.getSendInvoiceContext,
      { invoiceId: args.invoiceId },
    );
    const email = buildInvoiceEmail(invoice, recipient);
    const response = await fetch(relayUrl(), {
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
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const invoice = await getInvoiceOrThrow(ctx, args.invoiceId);
    await assertCanAccessInvoice(ctx, user, invoice);
    if (invoice.status === "void") {
      return;
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
      message: trimOptional(args.reason) ?? "Invoice voided.",
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
    return events.sort((a, b) => a.createdAt - b.createdAt);
  },
});
