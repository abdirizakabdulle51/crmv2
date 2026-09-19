import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import {
  allocateMoney,
  calculateMonthProration,
  fromCents,
  roundMoney,
  sumMoney,
  toCents,
} from "./money";
import { financialMonth, historicalDateMonth } from "./financialDates";
import { assertNotMonitoring, isCeoOrHob } from "./authorization";
import { contractMonths, contractValueAllocations } from "./contractSchedule";

type Ctx = QueryCtx | MutationCtx;

async function currentUser(ctx: Ctx) {
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

function assertMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Month must use YYYY-MM format",
    });
  }
}

function percent(actual: number, target: number) {
  return target > 0 ? Math.round((actual / target) * 1000) / 10 : 0;
}

function activeInvoice(invoice: Doc<"invoices">) {
  return (
    invoice.isTest !== true &&
    invoice.hiddenAt === undefined &&
    invoice.status !== "draft" &&
    invoice.status !== "void" &&
    invoice.status !== "cancelled"
  );
}

function invoiceMonth(invoice: Doc<"invoices">, timestamp?: number) {
  if (invoice.sourceMonth) return invoice.sourceMonth;
  if (invoice.cycleStartMonth) return invoice.cycleStartMonth;
  const date = timestamp ?? invoice.issueDate ?? invoice.createdAt;
  return invoice.isHistorical
    ? historicalDateMonth(date)
    : financialMonth(date);
}

function invoiceAmountForMonth(invoice: Doc<"invoices">, month: string) {
  const allocations =
    invoice.receivableAllocations ?? invoice.revenueAllocations;
  if (allocations?.length) {
    return sumMoney(
      allocations.filter((row) => row.month === month).map((row) => row.amount),
    );
  }
  return invoiceMonth(invoice) === month ? invoice.grandTotal : 0;
}

function invoiceOutstandingForMonth(invoice: Doc<"invoices">, month: string) {
  const allocations =
    invoice.receivableAllocations ?? invoice.revenueAllocations;
  if (allocations?.length) {
    return sumMoney(
      allocateMoney(
        invoice.balanceDue,
        allocations.map((row) => ({ month: row.month, weight: row.amount })),
      )
        .filter((row) => row.month === month)
        .map((row) => row.amount),
    );
  }
  return invoiceMonth(invoice) === month ? invoice.balanceDue : 0;
}

function attributedAmount(
  invoice: Doc<"invoices">,
  amount: number,
  eventAt: number,
  month: string,
) {
  const allocations =
    invoice.revenueAllocations ?? invoice.receivableAllocations;
  if (invoice.billingTiming === "prepaid" && allocations?.length) {
    const eventMonth = invoice.isHistorical
      ? historicalDateMonth(eventAt)
      : financialMonth(eventAt);
    return sumMoney(
      allocateMoney(
        amount,
        allocations.map((row) => ({ month: row.month, weight: row.amount })),
      )
        .filter(
          (row) => (eventMonth > row.month ? eventMonth : row.month) === month,
        )
        .map((row) => row.amount),
    );
  }
  const eventMonth = invoice.isHistorical
    ? historicalDateMonth(eventAt)
    : financialMonth(eventAt);
  return eventMonth === month ? amount : 0;
}

function paymentAppliedAmount(payment: Doc<"invoicePayments">) {
  return (
    payment.appliedAmount ??
    sumMoney([
      payment.amount,
      -(payment.unappliedAmount ?? payment.extraServiceRevenueAmount ?? 0),
    ])
  );
}

function fixedContractExpectation(
  contract: Doc<"customerContracts">,
  month: string,
) {
  const months = contractMonths(contract);
  if (!months.includes(month)) return 0;
  if (contract.pricingModel === "monthly_minimum")
    return roundMoney(
      (contract.monthlyMinimum ?? 0) *
        calculateMonthProration({
          startDate: contract.startDate,
          endDate: contract.endDate,
          month,
        }).fraction,
    );
  if (
    contract.pricingModel !== "flexible_total_commitment" ||
    !contract.contractValue
  )
    return 0;
  return (
    contractValueAllocations(contract)?.find((row) => row.month === month)
      ?.amount ?? 0
  );
}

async function targetForCountry(
  ctx: Ctx,
  countryId: Id<"countries">,
  month: string,
) {
  return (
    await ctx.db
      .query("monthlyPerformanceTargets")
      .withIndex("by_country_month", (q) =>
        q.eq("countryId", countryId).eq("month", month),
      )
      .collect()
  ).find((target) => target.teamMemberId === undefined);
}

export const upsertCountryTarget = mutation({
  args: {
    countryId: v.id("countries"),
    month: v.string(),
    currency: v.string(),
    billingTarget: v.number(),
    collectionTarget: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await currentUser(ctx);
    if (!isCeoOrHob(actor)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only CEO or Head of Business can set country targets",
      });
    }
    assertMonth(args.month);
    if (!(await ctx.db.get(args.countryId))) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Country not found",
      });
    }
    const currency = args.currency.trim().toUpperCase();
    if (
      !/^[A-Z]{3}$/.test(currency) ||
      args.billingTarget < 0 ||
      args.collectionTarget < 0
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Enter non-negative targets and a valid currency",
      });
    }
    const existing = await targetForCountry(ctx, args.countryId, args.month);
    const now = Date.now();
    const values = {
      currency,
      billingTargetCents: toCents(args.billingTarget),
      collectionTargetCents: toCents(args.collectionTarget),
      updatedBy: actor._id,
      updatedAt: now,
    };
    if (existing) {
      const team = (
        await ctx.db
          .query("monthlyPerformanceTargets")
          .withIndex("by_country_month", (q) =>
            q.eq("countryId", args.countryId).eq("month", args.month),
          )
          .collect()
      ).filter((row) => row.teamMemberId !== undefined);
      if (
        team.reduce((sum, row) => sum + row.billingTargetCents, 0) >
          values.billingTargetCents ||
        team.reduce((sum, row) => sum + row.collectionTargetCents, 0) >
          values.collectionTargetCents
      ) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message:
            "Country targets cannot be lower than targets already allocated to the team",
        });
      }
      if (
        existing.currency !== currency &&
        team.some(
          (row) =>
            row.billingTargetCents !== 0 || row.collectionTargetCents !== 0,
        )
      ) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message:
            "Clear the allocated team targets before changing the country target currency",
        });
      }
      await ctx.db.patch(existing._id, values);
      await ctx.db.insert("monthlyPerformanceTargetEvents", {
        targetId: existing._id,
        changedBy: actor._id,
        previousBillingTargetCents: existing.billingTargetCents,
        previousCollectionTargetCents: existing.collectionTargetCents,
        billingTargetCents: values.billingTargetCents,
        collectionTargetCents: values.collectionTargetCents,
        currency,
        changedAt: now,
      });
      return existing._id;
    }
    const targetId = await ctx.db.insert("monthlyPerformanceTargets", {
      countryId: args.countryId,
      month: args.month,
      ...values,
      createdBy: actor._id,
      createdAt: now,
    });
    await ctx.db.insert("monthlyPerformanceTargetEvents", {
      targetId,
      changedBy: actor._id,
      billingTargetCents: values.billingTargetCents,
      collectionTargetCents: values.collectionTargetCents,
      currency,
      changedAt: now,
    });
    return targetId;
  },
});

export const upsertTeamTarget = mutation({
  args: {
    teamMemberId: v.id("users"),
    month: v.string(),
    billingTarget: v.number(),
    collectionTarget: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await currentUser(ctx);
    assertMonth(args.month);
    if (actor.role !== "country_gm" || !actor.countryId) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only a Country GM can allocate targets to their team",
      });
    }
    const member = await ctx.db.get(args.teamMemberId);
    if (
      member?.role !== "account_manager" ||
      member.countryId !== actor.countryId ||
      (member.isDisabled &&
        (args.billingTarget !== 0 || args.collectionTarget !== 0))
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message:
          "Select an Account Manager in your country; inactive members can only be cleared to zero",
      });
    }
    if (args.billingTarget < 0 || args.collectionTarget < 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Targets cannot be negative",
      });
    }
    const countryTarget = await targetForCountry(
      ctx,
      actor.countryId,
      args.month,
    );
    if (!countryTarget) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Leadership must set the country target before team allocation",
      });
    }
    const rows = await ctx.db
      .query("monthlyPerformanceTargets")
      .withIndex("by_country_month", (q) =>
        q.eq("countryId", actor.countryId!).eq("month", args.month),
      )
      .collect();
    const existing = rows.find((row) => row.teamMemberId === member._id);
    const billingTargetCents = toCents(args.billingTarget);
    const collectionTargetCents = toCents(args.collectionTarget);
    const otherRows = rows.filter(
      (row) => row.teamMemberId && row._id !== existing?._id,
    );
    if (
      otherRows.reduce(
        (sum, row) => sum + row.billingTargetCents,
        Number(billingTargetCents),
      ) > countryTarget.billingTargetCents ||
      otherRows.reduce(
        (sum, row) => sum + row.collectionTargetCents,
        Number(collectionTargetCents),
      ) > countryTarget.collectionTargetCents
    ) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Team allocation cannot exceed the country target",
      });
    }
    const now = Date.now();
    const values = {
      countryId: actor.countryId,
      teamMemberId: member._id,
      month: args.month,
      currency: countryTarget.currency,
      billingTargetCents,
      collectionTargetCents,
      updatedBy: actor._id,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, values);
      await ctx.db.insert("monthlyPerformanceTargetEvents", {
        targetId: existing._id,
        changedBy: actor._id,
        previousBillingTargetCents: existing.billingTargetCents,
        previousCollectionTargetCents: existing.collectionTargetCents,
        billingTargetCents,
        collectionTargetCents,
        currency: countryTarget.currency,
        changedAt: now,
      });
      return existing._id;
    }
    const targetId = await ctx.db.insert("monthlyPerformanceTargets", {
      ...values,
      createdBy: actor._id,
      createdAt: now,
    });
    await ctx.db.insert("monthlyPerformanceTargetEvents", {
      targetId,
      changedBy: actor._id,
      billingTargetCents,
      collectionTargetCents,
      currency: countryTarget.currency,
      changedAt: now,
    });
    return targetId;
  },
});

export const dashboard = query({
  args: {
    month: v.string(),
    countryId: v.optional(v.id("countries")),
    teamMemberId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    assertMonth(args.month);
    const actor = await currentUser(ctx);
    const countries = await ctx.db.query("countries").collect();
    let countryId = args.countryId;
    let teamMemberId = args.teamMemberId;
    if (actor.role === "country_gm" || actor.role === "account_manager")
      countryId = actor.countryId;
    if (actor.role === "account_manager") teamMemberId = actor._id;
    if (!countryId) {
      return { needsCountry: true as const, countries, role: actor.role };
    }
    const country = await ctx.db.get(countryId);
    if (!country)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Country not found",
      });
    if (!isCeoOrHob(actor) && actor.countryId !== countryId) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You cannot view another country's targets",
      });
    }
    const users = await ctx.db
      .query("users")
      .withIndex("by_country", (q) => q.eq("countryId", countryId!))
      .collect();
    const team = users.filter((user) => user.role === "account_manager");
    if (teamMemberId && !team.some((member) => member._id === teamMemberId)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Team member is outside this country",
      });
    }
    const companies = (
      await ctx.db
        .query("companies")
        .withIndex("by_country", (q) => q.eq("countryId", countryId!))
        .collect()
    ).filter(
      (company) => !teamMemberId || company.accountManagerId === teamMemberId,
    );
    const [invoiceGroups, contractGroups, targets] = await Promise.all([
      Promise.all(
        companies.map((company) =>
          ctx.db
            .query("invoices")
            .withIndex("by_company", (q) => q.eq("companyId", company._id))
            .collect(),
        ),
      ),
      Promise.all(
        companies.map((company) =>
          ctx.db
            .query("customerContracts")
            .withIndex("by_company", (q) => q.eq("companyId", company._id))
            .collect(),
        ),
      ),
      ctx.db
        .query("monthlyPerformanceTargets")
        .withIndex("by_country_month", (q) =>
          q.eq("countryId", countryId!).eq("month", args.month),
        )
        .collect(),
    ]);
    const invoices = invoiceGroups.flat();
    const contracts = contractGroups.flat();
    const [paymentGroups, applicationGroups] = await Promise.all([
      Promise.all(
        invoices.map((invoice) =>
          ctx.db
            .query("invoicePayments")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
            .collect(),
        ),
      ),
      Promise.all(
        invoices.map((invoice) =>
          ctx.db
            .query("customerAdvanceApplications")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
            .collect(),
        ),
      ),
    ]);
    const payments = paymentGroups.flat();
    const applications = applicationGroups.flat();
    const invoiceById = new Map(
      invoices.map((invoice) => [invoice._id, invoice]),
    );
    const countryTarget = targets.find(
      (target) => target.teamMemberId === undefined,
    );
    const selectedTarget = teamMemberId
      ? targets.find((target) => target.teamMemberId === teamMemberId)
      : countryTarget;
    const currency =
      selectedTarget?.currency ?? countryTarget?.currency ?? "USD";
    const eligibleInvoices = invoices.filter(
      (invoice) =>
        activeInvoice(invoice) &&
        (invoice.sellerCurrency ?? "USD") === currency,
    );
    const currencyMismatchInvoices = invoices.filter(
      (invoice) =>
        activeInvoice(invoice) &&
        (invoice.sellerCurrency ?? "USD") !== currency &&
        invoiceAmountForMonth(invoice, args.month) !== 0,
    );
    const currencyMismatchCollections = payments.filter((payment) => {
      if (payment.reversesPaymentId || payment.reversedByPaymentId)
        return false;
      const invoice = invoiceById.get(payment.invoiceId);
      return Boolean(
        invoice &&
        activeInvoice(invoice) &&
        (invoice.sellerCurrency ?? "USD") !== currency &&
        attributedAmount(
          invoice,
          paymentAppliedAmount(payment),
          payment.paidAt,
          args.month,
        ) !== 0,
      );
    }).length;
    const billingByCompany = new Map<string, number>();
    for (const invoice of eligibleInvoices) {
      const amount = invoiceAmountForMonth(invoice, args.month);
      if (amount > 0)
        billingByCompany.set(
          invoice.companyId,
          sumMoney([billingByCompany.get(invoice.companyId) ?? 0, amount]),
        );
    }
    const collectionByCompany = new Map<string, number>();
    const recordedAppliedByInvoice = new Map<string, number>();
    for (const payment of payments) {
      if (payment.reversesPaymentId || payment.reversedByPaymentId) continue;
      const invoice = invoiceById.get(payment.invoiceId);
      if (
        !invoice ||
        !activeInvoice(invoice) ||
        (invoice.sellerCurrency ?? "USD") !== currency
      )
        continue;
      recordedAppliedByInvoice.set(
        invoice._id,
        sumMoney([
          recordedAppliedByInvoice.get(invoice._id) ?? 0,
          paymentAppliedAmount(payment),
        ]),
      );
      const amount = attributedAmount(
        invoice,
        paymentAppliedAmount(payment),
        payment.paidAt,
        args.month,
      );
      if (amount > 0)
        collectionByCompany.set(
          invoice.companyId,
          sumMoney([collectionByCompany.get(invoice.companyId) ?? 0, amount]),
        );
    }
    for (const application of applications) {
      if (application.reversedAt) continue;
      const invoice = invoiceById.get(application.invoiceId);
      if (
        !invoice ||
        !activeInvoice(invoice) ||
        (invoice.sellerCurrency ?? "USD") !== currency
      )
        continue;
      recordedAppliedByInvoice.set(
        invoice._id,
        sumMoney([
          recordedAppliedByInvoice.get(invoice._id) ?? 0,
          fromCents(application.amountCents),
        ]),
      );
      const amount = attributedAmount(
        invoice,
        fromCents(application.amountCents),
        application.appliedAt,
        args.month,
      );
      if (amount > 0)
        collectionByCompany.set(
          invoice.companyId,
          sumMoney([collectionByCompany.get(invoice.companyId) ?? 0, amount]),
        );
    }
    const previousInvoiceAmounts = new Map<string, Map<string, number>>();
    for (const invoice of eligibleInvoices) {
      const rows = previousInvoiceAmounts.get(invoice.companyId) ?? new Map();
      const allocations =
        invoice.receivableAllocations ?? invoice.revenueAllocations;
      const monthlyAmounts = allocations?.length
        ? allocations.map((row) => ({ month: row.month, amount: row.amount }))
        : [{ month: invoiceMonth(invoice), amount: invoice.grandTotal }];
      for (const row of monthlyAmounts) {
        if (row.month >= args.month) continue;
        rows.set(row.month, sumMoney([rows.get(row.month) ?? 0, row.amount]));
      }
      previousInvoiceAmounts.set(invoice.companyId, rows);
    }
    const now = Date.now();
    const unreconciledCollectionAmount = sumMoney(
      eligibleInvoices
        .filter((invoice) => invoiceAmountForMonth(invoice, args.month) !== 0)
        .map((invoice) =>
          Math.max(
            0,
            sumMoney([
              invoice.amountPaid,
              -(recordedAppliedByInvoice.get(invoice._id) ?? 0),
            ]),
          ),
        ),
    );
    const customerRows = companies
      .map((company) => {
        const companyInvoices = eligibleInvoices.filter(
          (invoice) => invoice.companyId === company._id,
        );
        const monthInvoices = companyInvoices.filter(
          (invoice) => invoiceAmountForMonth(invoice, args.month) > 0,
        );
        const overdue = companyInvoices.filter(
          (invoice) =>
            (invoice.dueDate ?? Infinity) < now && invoice.balanceDue > 0,
        );
        const atRisk = overdue.length >= 3;
        const invoiced = billingByCompany.get(company._id) ?? 0;
        const collected = collectionByCompany.get(company._id) ?? 0;
        const outstanding = sumMoney(
          monthInvoices.map((invoice) =>
            invoiceOutstandingForMonth(invoice, args.month),
          ),
        );
        const drafts = invoices.filter(
          (invoice) =>
            invoice.companyId === company._id && invoice.status === "draft",
        );
        let expectedBill = sumMoney(
          drafts.map((invoice) => invoiceAmountForMonth(invoice, args.month)),
        );
        let forecastBasis = expectedBill > 0 ? "draft_invoice" : "none";
        if (invoiced === 0 && expectedBill === 0) {
          const contract = contracts.find(
            (row) => row.companyId === company._id && row.status === "active",
          );
          expectedBill = contract
            ? fixedContractExpectation(contract, args.month)
            : 0;
          if (expectedBill > 0) forecastBasis = "contract";
          if (expectedBill === 0) {
            const history = [
              ...(previousInvoiceAmounts.get(company._id)?.entries() ?? []),
            ]
              .sort(([a], [b]) => b.localeCompare(a))
              .slice(0, 3)
              .map(([, amount]) => amount);
            expectedBill = history.length
              ? sumMoney(history) / history.length
              : 0;
            if (expectedBill > 0) forecastBasis = "usage_history";
          }
        }
        const expectedCollection = atRisk
          ? 0
          : Math.max(0, sumMoney([outstanding, expectedBill]));
        return {
          companyId: company._id,
          companyName: company.name,
          accountManagerId: company.accountManagerId,
          accountManagerName:
            users.find((user) => user._id === company.accountManagerId)?.name ??
            "Unassigned",
          invoiced,
          collected,
          outstanding,
          expectedBill,
          forecastBasis,
          expectedCollection,
          overdueInvoices: overdue.length,
          oldestDueDate: overdue.reduce<number | undefined>(
            (oldest, invoice) =>
              !oldest || (invoice.dueDate ?? now) < oldest
                ? invoice.dueDate
                : oldest,
            undefined,
          ),
          overdueInvoiceIds: overdue.map((invoice) => invoice._id),
          status: atRisk
            ? ("at_risk" as const)
            : collected >= invoiced && invoiced > 0
              ? ("collected" as const)
              : expectedBill > 0 && invoiced === 0
                ? ("not_invoiced" as const)
                : ("expected" as const),
          invoiceIds: monthInvoices.map((invoice) => invoice._id),
        };
      })
      .sort((a, b) => {
        const priority = {
          at_risk: 0,
          not_invoiced: 1,
          expected: 2,
          collected: 3,
        };
        return (
          priority[a.status] - priority[b.status] ||
          b.expectedCollection - a.expectedCollection ||
          b.outstanding - a.outstanding
        );
      });
    const billingActual = sumMoney(customerRows.map((row) => row.invoiced));
    const collectionActual = sumMoney(customerRows.map((row) => row.collected));
    const expectedBills = sumMoney(customerRows.map((row) => row.expectedBill));
    const expectedCollection = sumMoney(
      customerRows.map((row) => row.expectedCollection),
    );
    const atRiskAmount = sumMoney(
      customerRows
        .filter((row) => row.status === "at_risk")
        .map((row) => sumMoney([row.outstanding, row.expectedBill])),
    );
    const billingTarget = fromCents(selectedTarget?.billingTargetCents ?? 0);
    const collectionTarget = fromCents(
      selectedTarget?.collectionTargetCents ?? 0,
    );
    return {
      needsCountry: false as const,
      role: actor.role,
      country: { id: country._id, name: country.name },
      countries,
      team: team.map((member) => ({
        id: member._id,
        name: member.name ?? member.email ?? "Unnamed team member",
        isDisabled: member.isDisabled === true,
      })),
      selectedTeamMemberId: teamMemberId,
      currency,
      target: selectedTarget ? { billingTarget, collectionTarget } : null,
      countryTarget: countryTarget
        ? {
            billingTarget: fromCents(countryTarget.billingTargetCents),
            collectionTarget: fromCents(countryTarget.collectionTargetCents),
          }
        : null,
      teamTargets: targets
        .filter((target) => target.teamMemberId)
        .map((target) => ({
          teamMemberId: target.teamMemberId!,
          billingTarget: fromCents(target.billingTargetCents),
          collectionTarget: fromCents(target.collectionTargetCents),
        })),
      summary: {
        billingActual,
        billingAchievement: percent(billingActual, billingTarget),
        billingGap: Math.max(0, sumMoney([billingTarget, -billingActual])),
        expectedBills,
        billingForecastAchievement: percent(
          sumMoney([billingActual, expectedBills]),
          billingTarget,
        ),
        collectionActual,
        collectionAchievement: percent(collectionActual, collectionTarget),
        collectionGap: Math.max(
          0,
          sumMoney([collectionTarget, -collectionActual]),
        ),
        expectedCollection,
        collectionForecastAchievement: percent(
          sumMoney([collectionActual, expectedCollection]),
          collectionTarget,
        ),
        atRiskAmount,
      },
      dataQuality: {
        currencyMismatchRecords:
          currencyMismatchInvoices.length + currencyMismatchCollections,
        unreconciledCollectionAmount,
      },
      customers: customerRows,
    };
  },
});
