import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import { assertNotMonitoring, canViewCompany } from "./authorization";
import { roundMoney } from "./money";

type BillingActivityRow = {
  key: string;
  type: "invoice" | "payment";
  date: number;
  companyId: Doc<"companies">["_id"];
  companyName: string;
  countryId: Doc<"countries">["_id"];
  invoiceId: Doc<"invoices">["_id"];
  paymentId?: Doc<"invoicePayments">["_id"];
  reference: string;
  invoiceNumber?: string;
  model:
    | "payg"
    | "flexible_total_commitment"
    | "monthly_minimum"
    | "discounted_usage"
    | "historical";
  contractId?: Doc<"customerContracts">["_id"];
  periodStart?: string;
  periodEnd?: string;
  amount: number;
  appliedAmount: number;
  remainingAmount: number;
  currency: string;
  dueDate?: number;
  settledAt?: number;
  receivingAccountId?: Doc<"receivingAccounts">["_id"];
  receivingAccountName?: string;
  receivingAccountNumber?: string;
  receivingBankName?: string;
  status: string;
};

const modelValidator = v.optional(
  v.union(
    v.literal("payg"),
    v.literal("flexible_total_commitment"),
    v.literal("monthly_minimum"),
    v.literal("discounted_usage"),
    v.literal("historical"),
  ),
);

function modelFor(
  invoice: Doc<"invoices">,
  company: Doc<"companies">,
  contract?: Doc<"customerContracts">,
) {
  if (invoice.isHistorical && !contract) return "historical" as const;
  if (!contract || company.commercialModel === "payg") return "payg" as const;
  if (contract.pricingModel) return contract.pricingModel;
  if (contract.commitmentModel === "flexible_value") {
    return "flexible_total_commitment" as const;
  }
  return "discounted_usage" as const;
}

export const list = query({
  args: {
    companyId: v.optional(v.id("companies")),
    countryId: v.optional(v.id("countries")),
    currency: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.number(),
    activityType: v.optional(
      v.union(v.literal("invoice"), v.literal("payment")),
    ),
    model: modelValidator,
    status: v.optional(v.string()),
    sort: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, args) => {
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

    const [companies, invoices, payments, contracts] = await Promise.all([
      ctx.db.query("companies").collect(),
      ctx.db.query("invoices").collect(),
      ctx.db.query("invoicePayments").collect(),
      ctx.db.query("customerContracts").collect(),
    ]);
    const visibleCompanies = companies.filter(
      (company) =>
        canViewCompany(user, company) &&
        (!args.companyId || company._id === args.companyId) &&
        (!args.countryId || company.countryId === args.countryId),
    );
    const companyMap = new Map(visibleCompanies.map((row) => [row._id, row]));
    const contractMap = new Map(contracts.map((row) => [row._id, row]));
    const paymentMap = new Map<string, Doc<"invoicePayments">[]>();
    for (const payment of payments) {
      const rows = paymentMap.get(payment.invoiceId) ?? [];
      rows.push(payment);
      paymentMap.set(payment.invoiceId, rows);
    }

    const rows: BillingActivityRow[] = [];
    for (const invoice of invoices) {
      const company = companyMap.get(invoice.companyId);
      if (!company || invoice.isTest || invoice.hiddenAt) continue;
      const currency = invoice.sellerCurrency ?? "USD";
      if (args.currency && currency !== args.currency) continue;
      const contractId = invoice.contractId ?? invoice.sourceContractId;
      const contract = contractId ? contractMap.get(contractId) : undefined;
      const model = modelFor(invoice, company, contract);
      if (args.model && model !== args.model) continue;
      const invoiceDate = invoice.issueDate ?? invoice.createdAt;
      const invoicePayments = paymentMap.get(invoice._id) ?? [];
      const activePayments = invoicePayments.filter(
        (payment) => !payment.reversedByPaymentId && payment.amount > 0,
      );

      if (
        args.activityType !== "payment" &&
        invoiceDate >= args.startDate &&
        invoiceDate <= args.endDate &&
        (!args.status || invoice.status === args.status)
      ) {
        const lastPaymentAt = activePayments.reduce(
          (latest, payment) => Math.max(latest, payment.paidAt),
          0,
        );
        rows.push({
          key: `invoice:${invoice._id}`,
          type: "invoice",
          date: invoiceDate,
          companyId: company._id,
          companyName: company.name,
          countryId: company.countryId,
          invoiceId: invoice._id,
          reference: invoice.invoiceNumber ?? "Draft invoice",
          model,
          contractId,
          periodStart: invoice.cycleStartMonth ?? invoice.sourceMonth,
          periodEnd: invoice.cycleEndMonth,
          amount: invoice.grandTotal,
          appliedAmount: invoice.amountPaid,
          remainingAmount: invoice.balanceDue,
          currency,
          dueDate: invoice.dueDate,
          settledAt:
            invoice.status === "paid" ? lastPaymentAt || undefined : undefined,
          status: invoice.status,
        });
      }

      if (args.activityType === "invoice") continue;
      for (const payment of invoicePayments) {
        if (payment.paidAt < args.startDate || payment.paidAt > args.endDate)
          continue;
        const paymentStatus = payment.reversesPaymentId
          ? "reversal"
          : payment.reversedByPaymentId
            ? "reversed"
            : "applied";
        if (args.status && paymentStatus !== args.status) continue;
        rows.push({
          key: `payment:${payment._id}`,
          type: "payment",
          date: payment.paidAt,
          companyId: company._id,
          companyName: company.name,
          countryId: company.countryId,
          invoiceId: invoice._id,
          paymentId: payment._id,
          reference: payment.transactionId ?? payment.reference ?? "Payment",
          invoiceNumber: invoice.invoiceNumber,
          model,
          contractId,
          amount: payment.amount,
          appliedAmount:
            payment.appliedAmount ??
            Math.min(payment.amount, invoice.grandTotal),
          remainingAmount: roundMoney(payment.unappliedAmount ?? 0),
          currency,
          receivingAccountId: payment.receivingAccountId,
          receivingAccountName: payment.receivingAccountName,
          receivingAccountNumber: payment.receivingAccountNumber,
          receivingBankName: payment.receivingBankName,
          status: paymentStatus,
        });
      }
    }

    rows.sort((a, b) =>
      args.sort === "asc" ? a.date - b.date : b.date - a.date,
    );
    return { rows: rows.slice(0, 500), total: rows.length };
  },
});
