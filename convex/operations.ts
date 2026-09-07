import { ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { isCeoOrHob } from "./authorization";

export const healthOverview = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "User not logged in",
      });
    const actor = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!actor || !isCeoOrHob(actor))
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Data Health is restricted to global leadership",
      });

    const [
      companies,
      leads,
      quotes,
      contracts,
      invoices,
      payments,
      expenses,
      accountTransactions,
      accounts,
      consumption,
      tenants,
      profiles,
      runs,
    ] = await Promise.all([
      ctx.db.query("companies").collect(),
      ctx.db.query("leads").collect(),
      ctx.db.query("quotes").collect(),
      ctx.db.query("customerContracts").collect(),
      ctx.db.query("invoices").collect(),
      ctx.db.query("invoicePayments").collect(),
      ctx.db.query("expenseRequests").collect(),
      ctx.db.query("accountTransactions").collect(),
      ctx.db.query("receivingAccounts").collect(),
      ctx.db.query("consumption").collect(),
      ctx.db.query("manageOneTenants").collect(),
      ctx.db.query("invoiceProfiles").collect(),
      ctx.db
        .query("billingAutomationRuns")
        .withIndex("by_started_at")
        .order("desc")
        .take(20),
    ]);
    const companyMap = new Map(
      companies.map((company) => [company._id, company]),
    );
    const invoiceMap = new Map(
      invoices.map((invoice) => [invoice._id, invoice]),
    );
    const expenseMap = new Map(
      expenses.map((expense) => [expense._id, expense]),
    );
    const accountMap = new Map(
      accounts.map((account) => [account._id, account]),
    );
    const activeContracts = new Set(
      contracts
        .filter((contract) => contract.status === "active")
        .map((contract) => contract.companyId),
    );
    const invoicedCompanies = new Set(
      invoices.map((invoice) => invoice.companyId),
    );
    const usageCompanies = new Set(consumption.map((row) => row.companyId));
    tenants.forEach(
      (tenant) =>
        tenant.linkedCompanyId && usageCompanies.add(tenant.linkedCompanyId),
    );
    const profileCountries = new Set(
      profiles
        .filter((profile) => profile.isActive)
        .map((profile) => profile.countryId)
        .filter(Boolean),
    );
    const acceptedByLead = new Map<string, typeof quotes>();
    for (const quote of quotes.filter(
      (row) => row.status === "accepted" && row.leadId,
    )) {
      const rows = acceptedByLead.get(quote.leadId!) ?? [];
      rows.push(quote);
      acceptedByLead.set(quote.leadId!, rows);
    }

    const onboarding = leads
      .filter((lead) => lead.stage === "won")
      .map((lead) => {
        const company = lead.companyId
          ? companyMap.get(lead.companyId)
          : undefined;
        const acceptedQuotes = acceptedByLead.get(lead._id) ?? [];
        const winningQuote = [...acceptedQuotes].sort(
          (a, b) =>
            (b.acceptedAt ?? b._creationTime) -
            (a.acceptedAt ?? a._creationTime),
        )[0];
        const commercialModel =
          winningQuote?.commercialModel ?? company?.commercialModel;
        const checks = {
          companyLinked: !!company,
          quoteAccepted: !!winningQuote,
          commercialPathReady:
            commercialModel === "contracted"
              ? !!company && activeContracts.has(company._id)
              : commercialModel === "payg",
          billingProfileReady:
            !!company && profileCountries.has(company.countryId),
          usageConnected: !!company && usageCompanies.has(company._id),
          firstInvoiceCreated: !!company && invoicedCompanies.has(company._id),
        };
        return {
          leadId: lead._id,
          opportunityNumber: lead.opportunityNumber,
          title: lead.title,
          companyId: company?._id,
          companyName: company?.name,
          commercialModel,
          checks,
          complete: Object.values(checks).every(Boolean),
        };
      });

    const issues: Array<{
      severity: "high" | "medium";
      type: string;
      message: string;
      href?: string;
    }> = [];
    for (const item of onboarding) {
      if (!item.complete)
        issues.push({
          severity:
            !item.checks.companyLinked || !item.checks.quoteAccepted
              ? "high"
              : "medium",
          type: "onboarding",
          message: `${item.companyName ?? item.title} has incomplete won onboarding`,
          href: `/pipeline/${item.leadId}`,
        });
    }
    for (const quote of quotes.filter(
      (row) => row.status === "accepted" && row.leadId,
    )) {
      const lead = leads.find((row) => row._id === quote.leadId);
      if (lead && lead.stage !== "won")
        issues.push({
          severity: "high",
          type: "accepted_quote",
          message: `${quote.quoteNumber ?? "Accepted quote"} is accepted but its opportunity is ${lead.stage}`,
          href: `/pipeline/${lead._id}`,
        });
    }
    for (const company of companies) {
      if (
        company.lifecycleStatus === "lost" &&
        activeContracts.has(company._id)
      )
        issues.push({
          severity: "high",
          type: "lifecycle",
          message: `${company.name} is Lost but has an active contract`,
          href: `/companies/${company._id}`,
        });
    }
    const recordedByInvoice = new Map<string, number>();
    for (const payment of payments) {
      recordedByInvoice.set(
        payment.invoiceId,
        (recordedByInvoice.get(payment.invoiceId) ?? 0) + payment.amount,
      );
    }
    for (const invoice of invoices) {
      const missing =
        Math.round(
          (invoice.amountPaid - (recordedByInvoice.get(invoice._id) ?? 0)) *
            100,
        ) / 100;
      if (missing > 0) {
        issues.push({
          severity: "high",
          type: "unreconciled_collection",
          message: `${invoice.invoiceNumber ?? "Invoice"} has ${missing.toFixed(2)} paid without a payment transaction`,
          href: `/invoices/${invoice._id}`,
        });
      }
    }
    for (const expense of expenses) {
      if (expense.status === "paid" && !expense.paidAt) {
        issues.push({
          severity: "high",
          type: "unreconciled_expense",
          message: `${expense.title} is paid but has no payment date`,
          href: `/finance/expenses/${expense._id}`,
        });
      }
      if (
        expense.status === "paid" &&
        !expense.fundingAccountId &&
        !expense.onboardingCreditId
      ) {
        issues.push({
          severity: "high",
          type: "orphan_expense_payment",
          message: `${expense.title} is paid but has no funding account`,
          href: `/finance/expenses/${expense._id}`,
        });
      } else if (
        expense.fundingAccountId &&
        !accountMap.has(expense.fundingAccountId)
      ) {
        issues.push({
          severity: "high",
          type: "orphan_expense_payment",
          message: `${expense.title} references a missing funding account`,
          href: `/finance/expenses/${expense._id}`,
        });
      }
    }
    for (const payment of payments) {
      if (!invoiceMap.has(payment.invoiceId))
        issues.push({
          severity: "high",
          type: "orphan_invoice_payment",
          message: `Payment ${payment.transactionId ?? payment._id} references a missing invoice`,
          href: "/finance/account-transactions",
        });
      if (
        payment.receivingAccountId &&
        !accountMap.has(payment.receivingAccountId)
      )
        issues.push({
          severity: "high",
          type: "orphan_invoice_payment",
          message: `Payment ${payment.transactionId ?? payment._id} references a missing account`,
          href: "/finance/account-transactions",
        });
    }
    for (const entry of accountTransactions) {
      if (!accountMap.has(entry.accountId))
        issues.push({
          severity: "high",
          type: "orphan_account_transaction",
          message: `Transaction ${entry.transactionId} references a missing account`,
          href: "/finance/account-transactions",
        });
      if (
        entry.type === "expense_return" &&
        (!entry.expenseId || !expenseMap.has(entry.expenseId))
      )
        issues.push({
          severity: "high",
          type: "orphan_expense_return",
          message: `Expense return ${entry.transactionId} has no corresponding expense`,
          href: "/finance/account-transactions",
        });
      if (
        entry.type === "reversal" &&
        (!entry.relatedTransactionId ||
          !accountTransactions.some(
            (row) => row._id === entry.relatedTransactionId,
          ))
      )
        issues.push({
          severity: "high",
          type: "orphan_reversal",
          message: `Reversal ${entry.transactionId} has no original transaction`,
          href: "/finance/account-transactions",
        });
    }
    const transactionKeys = new Map<string, string[]>();
    const addTransactionKey = (
      accountId: string | undefined,
      transactionId: string | undefined,
      label: string,
    ) => {
      if (!accountId || !transactionId?.trim()) return;
      const key = `${accountId}:${transactionId.trim()}`;
      transactionKeys.set(key, [...(transactionKeys.get(key) ?? []), label]);
    };
    payments.forEach((row) =>
      addTransactionKey(
        row.receivingAccountId,
        row.transactionId,
        "invoice payment",
      ),
    );
    expenses.forEach((row) =>
      addTransactionKey(
        row.fundingAccountId,
        row.paymentTransactionId,
        "expense payment",
      ),
    );
    accountTransactions.forEach((row) =>
      addTransactionKey(row.accountId, row.transactionId, row.type),
    );
    for (const [key, sources] of transactionKeys) {
      if (sources.length > 1)
        issues.push({
          severity: "high",
          type: "duplicate_account_transaction",
          message: `Duplicate account transaction ID ${key.split(":")[key.split(":").length - 1]} (${sources.join(", ")})`,
          href: "/finance/account-transactions",
        });
    }
    const duplicateGroups = new Map<string, string[]>();
    for (const company of companies) {
      const key = `${company.countryId}:${company.name.trim().toLowerCase()}`;
      duplicateGroups.set(key, [
        ...(duplicateGroups.get(key) ?? []),
        company.name,
      ]);
    }
    for (const names of duplicateGroups.values())
      if (names.length > 1)
        issues.push({
          severity: "medium",
          type: "duplicate_company",
          message: `Possible duplicate companies: ${names.join(", ")}`,
          href: "/companies",
        });

    return {
      generatedAt: Date.now(),
      summary: {
        openIssues: issues.length,
        highIssues: issues.filter((issue) => issue.severity === "high").length,
        onboardingPending: onboarding.filter((item) => !item.complete).length,
        onboardingComplete: onboarding.filter((item) => item.complete).length,
        lastBillingRun: runs[0] ?? null,
      },
      issues,
      onboarding,
      billingRuns: runs,
    };
  },
});
