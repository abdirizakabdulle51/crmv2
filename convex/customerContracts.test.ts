import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

const TOTAL = 2237.48;
const CONFIRMATION = "DELETE_INCORRECT_CONTRACT";

type Fixture = {
  userId: Id<"users">;
  companyId: Id<"companies">;
  otherCompanyId: Id<"companies">;
  contractId: Id<"customerContracts">;
  invoiceIds: Id<"invoices">[];
  unrelatedInvoiceId: Id<"invoices">;
  billingRunId: Id<"billingAutomationRuns">;
};

type CleanupArgs = {
  contractId: Id<"customerContracts">;
  expectedContractNumber: string;
  expectedCompanyId: Id<"companies">;
  expectedContractStatus: "draft" | "active" | "expired" | "terminated" | "renewed";
  expectedContractTitle: string;
  expectedContractValue: number;
  invoiceIds: Id<"invoices">[];
  expectedInvoiceTotal: number;
  dryRun: boolean;
  confirm?: string;
};

function cleanupArgs(fixture: Fixture, overrides: Partial<CleanupArgs> = {}): CleanupArgs {
  return {
    contractId: fixture.contractId,
    expectedContractNumber: "CTR-2026-00005",
    expectedCompanyId: fixture.companyId,
    expectedContractStatus: "active",
    expectedContractTitle: "Compute, Network and Storage Services",
    expectedContractValue: 13424.85,
    invoiceIds: fixture.invoiceIds,
    expectedInvoiceTotal: TOTAL,
    dryRun: true,
    ...overrides,
  };
}

async function seedFixture(
  t: ReturnType<typeof convexTest>,
  fillerCount = 50,
): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.UTC(2026, 8, 10);
    const countryId = await ctx.db.insert("countries", {
      name: "Somalia",
      region: "East Africa",
    });
    const sectorId = await ctx.db.insert("sectors", { name: "Technology" });
    const userId = await ctx.db.insert("users", {
      name: "CEO",
      tokenIdentifier: "cleanup-test-ceo",
      role: "ceo",
    });
    const companyId = await ctx.db.insert("companies", {
      name: "Safari-CH",
      sectorId,
      countryId,
      contractStatus: "active",
    });
    const otherCompanyId = await ctx.db.insert("companies", {
      name: "NationalCivilServiceCommission",
      sectorId,
      countryId,
      contractStatus: "active",
    });
    const contractId = await ctx.db.insert("customerContracts", {
      companyId,
      contractNumber: "CTR-2026-00005",
      title: "Compute, Network and Storage Services",
      status: "active",
      startDate: Date.UTC(2026, 0, 1),
      endDate: Date.UTC(2026, 11, 31),
      currency: "USD",
      billingFrequency: "monthly",
      contractValue: 13424.85,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    const invoiceIds: Id<"invoices">[] = [];
    for (const [index, sourceMonth] of ["2026-07", "2026-08", "2026-09"].entries()) {
      const invoiceId = await ctx.db.insert("invoices", {
        companyId,
        contractId,
        sourceReference: "CTR-2026-00005",
        sourceMonth,
        invoiceNumber: `INV-2026-000${40 + index}`,
        createdBy: userId,
        status: index === 0 ? "overdue" : "draft",
        companyName: "Safari-CH",
        lineItems: [],
        subtotal: TOTAL,
        monthlyTotal: TOTAL,
        yearlyTotal: TOTAL,
        grandTotal: TOTAL,
        amountPaid: 0,
        balanceDue: TOTAL,
        createdAt: now,
        updatedAt: now,
      });
      invoiceIds.push(invoiceId);
      const eventCount = index === 0 ? 3 : 1;
      for (let eventIndex = 0; eventIndex < eventCount; eventIndex += 1) {
        await ctx.db.insert("invoiceEvents", {
          invoiceId,
          type: eventIndex === 0 ? "draft_created" : "overdue",
          actorId: userId,
          message: "cleanup test event",
          createdAt: now + eventIndex,
        });
      }
    }
    for (let index = 0; index < fillerCount; index += 1) {
      await ctx.db.insert("invoices", {
        companyId: otherCompanyId,
        invoiceNumber: `LEGACY-${index}`,
        createdBy: userId,
        status: "draft",
        companyName: "NationalCivilServiceCommission",
        lineItems: [],
        subtotal: 1,
        monthlyTotal: 1,
        yearlyTotal: 1,
        grandTotal: 1,
        amountPaid: 0,
        balanceDue: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    const unrelatedInvoiceId = await ctx.db.insert("invoices", {
      companyId: otherCompanyId,
      invoiceNumber: "INV-2026-00040",
      createdBy: userId,
      status: "issued",
      companyName: "NationalCivilServiceCommission",
      lineItems: [],
      subtotal: TOTAL,
      monthlyTotal: TOTAL,
      yearlyTotal: TOTAL,
      grandTotal: TOTAL,
      amountPaid: 0,
      balanceDue: TOTAL,
      createdAt: now,
      updatedAt: now,
    });
    for (let index = 0; index < 6; index += 1) {
      await ctx.db.insert("customerContractEvents", {
        contractId,
        actorId: userId,
        type: index === 0 ? "created" : "updated",
        message: "cleanup test contract event",
        createdAt: now + index,
      });
    }
    const billingRunId = await ctx.db.insert("billingAutomationRuns", {
      startedAt: now,
      completedAt: now + 1,
      status: "completed",
      trigger: "manual",
      actorId: userId,
      contractsScanned: 1,
      created: 0,
      skipped: 1,
      issues: [
        {
          contractId,
          contractNumber: "CTR-2026-00005",
          sourceMonth: "2026-09",
          reason: "cleanup test issue",
        },
      ],
    });
    return {
      userId,
      companyId,
      otherCompanyId,
      contractId,
      invoiceIds,
      unrelatedInvoiceId,
      billingRunId,
    };
  });
}

describe("customer contract maintenance cleanup", () => {
  it("dry-runs and then deletes only the exact contract graph", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t);
    const dryRun = await t.mutation(
      internal.customerContracts.permanentlyDeleteIncorrectContract,
      cleanupArgs(fixture),
    );

    expect(dryRun).toMatchObject({
      dependencyCounts: {
        invoices: 3,
        invoiceEvents: 5,
        invoicePayments: 0,
        usageSnapshots: 0,
        creditLedger: 0,
        contractEvents: 6,
        amendments: 0,
        contractLineItems: 0,
        groupDiscounts: 0,
      },
      billingAutomationRunsPreserved: true,
      invoiceNumberAllocatorSafe: true,
    });
    expect(
      await t.run(async (ctx) => ({
        contract: await ctx.db.get(fixture.contractId),
        invoices: await Promise.all(
          fixture.invoiceIds.map((invoiceId) => ctx.db.get(invoiceId)),
        ),
      })),
    ).toMatchObject({ contract: { _id: fixture.contractId } });

    await expect(
      t.mutation(
        internal.customerContracts.permanentlyDeleteIncorrectContract,
        cleanupArgs(fixture, { dryRun: false }),
      ),
    ).rejects.toThrow("Exact confirmation required");

    await t.mutation(
      internal.customerContracts.permanentlyDeleteIncorrectContract,
      cleanupArgs(fixture, { dryRun: false, confirm: CONFIRMATION }),
    );

    const remaining = await t.run(async (ctx) => ({
      contract: await ctx.db.get(fixture.contractId),
      targetInvoices: await Promise.all(
        fixture.invoiceIds.map((invoiceId) => ctx.db.get(invoiceId)),
      ),
      unrelatedInvoice: await ctx.db.get(fixture.unrelatedInvoiceId),
      billingRun: await ctx.db.get(fixture.billingRunId),
      invoiceEvents: await ctx.db.query("invoiceEvents").collect(),
      contractEvents: await ctx.db.query("customerContractEvents").collect(),
      allInvoices: await ctx.db.query("invoices").collect(),
    }));
    expect(remaining.contract).toBeNull();
    expect(remaining.targetInvoices).toEqual([null, null, null]);
    expect(remaining.unrelatedInvoice?.invoiceNumber).toBe("INV-2026-00040");
    expect(remaining.billingRun?.issues).toHaveLength(1);
    expect(remaining.billingRun?.issues[0]?.contractId).toBe(fixture.contractId);
    expect(remaining.invoiceEvents).toHaveLength(0);
    expect(remaining.contractEvents).toHaveLength(0);
    expect(remaining.allInvoices).toHaveLength(51);
  });

  it("requires every linked invoice and rejects wrong exact relationships", async () => {
    const missingInvoiceTest = convexTest(schema, modules);
    const missingFixture = await seedFixture(missingInvoiceTest);
    await expect(
      missingInvoiceTest.mutation(
        internal.customerContracts.permanentlyDeleteIncorrectContract,
        cleanupArgs(missingFixture, {
          invoiceIds: missingFixture.invoiceIds.slice(0, 2),
        }),
      ),
    ).rejects.toThrow("all contract invoices must be supplied");

    const wrongCompanyTest = convexTest(schema, modules);
    const wrongCompanyFixture = await seedFixture(wrongCompanyTest);
    await wrongCompanyTest.run((ctx) =>
      ctx.db.patch(wrongCompanyFixture.invoiceIds[0], {
        companyId: wrongCompanyFixture.otherCompanyId,
      }),
    );
    await expect(
      wrongCompanyTest.mutation(
        internal.customerContracts.permanentlyDeleteIncorrectContract,
        cleanupArgs(wrongCompanyFixture),
      ),
    ).rejects.toThrow();

    const wrongRelationshipTest = convexTest(schema, modules);
    const wrongRelationshipFixture = await seedFixture(wrongRelationshipTest);
    const otherContractId = await wrongRelationshipTest.run(async (ctx) =>
      ctx.db.insert("customerContracts", {
        companyId: wrongRelationshipFixture.otherCompanyId,
        contractNumber: "CTR-2026-OTHER",
        title: "Other contract",
        status: "active",
        startDate: Date.UTC(2026, 0, 1),
        endDate: Date.UTC(2026, 11, 31),
        currency: "USD",
        billingFrequency: "monthly",
        contractValue: 1,
        createdBy: wrongRelationshipFixture.userId,
        createdAt: Date.UTC(2026, 8, 10),
        updatedAt: Date.UTC(2026, 8, 10),
      }),
    );
    await wrongRelationshipTest.run((ctx) =>
      ctx.db.patch(wrongRelationshipFixture.invoiceIds[0], {
        contractId: otherContractId,
      }),
    );
    await expect(
      wrongRelationshipTest.mutation(
        internal.customerContracts.permanentlyDeleteIncorrectContract,
        cleanupArgs(wrongRelationshipFixture),
      ),
    ).rejects.toThrow("invoice relationship validation failed");

    const wrongNumberTest = convexTest(schema, modules);
    const wrongNumberFixture = await seedFixture(wrongNumberTest);
    await wrongNumberTest.run((ctx) =>
      ctx.db.patch(wrongNumberFixture.contractId, {
        contractNumber: "CTR-2026-OTHER",
      }),
    );
    await expect(
      wrongNumberTest.mutation(
        internal.customerContracts.permanentlyDeleteIncorrectContract,
        cleanupArgs(wrongNumberFixture),
      ),
    ).rejects.toThrow("exact contract validation failed");
  });

  it.each([
    "invoicePayments",
    "dailyUsageSnapshots",
    "customerCreditLedger",
    "customerContractAmendments",
    "customerContractLineItems",
    "customerContractGroupDiscounts",
  ] as const)("fails closed when %s are linked", async (dependency) => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t);
    await t.run(async (ctx) => {
      const now = Date.UTC(2026, 8, 10);
      if (dependency === "invoicePayments") {
        await ctx.db.insert("invoicePayments", {
          invoiceId: fixture.invoiceIds[0],
          amount: 1,
          paidAt: now,
          recordedBy: fixture.userId,
          createdAt: now,
        });
      } else if (dependency === "dailyUsageSnapshots") {
        const tenantId = await ctx.db.insert("manageOneTenants", {
          vdcId: "cleanup-vdc",
          name: "Cleanup tenant",
          lastSyncedAt: now,
        });
        await ctx.db.insert("dailyUsageSnapshots", {
          companyId: fixture.companyId,
          tenantId,
          tenantName: "Cleanup tenant",
          tenantVdcId: "cleanup-vdc",
          usageDate: "2026-09-01",
          month: "2026-09",
          serviceType: "compute",
          itemName: "Compute",
          serviceCategory: "Compute",
          quantity: 1,
          unit: "unit",
          source: "manageone",
          sourceKey: "cleanup-source",
          capturedAt: now,
          invoiceId: fixture.invoiceIds[0],
        });
      } else if (dependency === "customerCreditLedger") {
        const creditId = await ctx.db.insert("customerCredits", {
          companyId: fixture.companyId,
          originalAmount: 1,
          remainingAmount: 1,
          reservedAmount: 0,
          currency: "USD",
          policy: "first_invoice_only",
          appliesTo: "contract",
          status: "available",
          createdBy: fixture.userId,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("customerCreditLedger", {
          creditId,
          companyId: fixture.companyId,
          invoiceId: fixture.invoiceIds[0],
          type: "consumed",
          amount: 1,
          balanceAfter: 0,
          actorId: fixture.userId,
          createdAt: now,
        });
      } else if (dependency === "customerContractAmendments") {
        await ctx.db.insert("customerContractAmendments", {
          contractId: fixture.contractId,
          amendmentNumber: "AMD-1",
          type: "correction",
          effectiveDate: now,
          summary: "cleanup test amendment",
          status: "draft",
          createdBy: fixture.userId,
          createdAt: now,
          updatedAt: now,
        });
      } else if (dependency === "customerContractLineItems") {
        await ctx.db.insert("customerContractLineItems", {
          contractId: fixture.contractId,
          itemName: "Compute",
          serviceCategory: "Compute",
          includedQuantity: 1,
          unit: "unit",
          contractUnitPrice: 1,
          billingUnit: "unit",
          createdBy: fixture.userId,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("customerContractGroupDiscounts", {
          contractId: fixture.contractId,
          productGroup: "compute",
          discountPercent: 1,
          createdBy: fixture.userId,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    await expect(
      t.mutation(
        internal.customerContracts.permanentlyDeleteIncorrectContract,
        cleanupArgs(fixture),
      ),
    ).rejects.toThrow("linked records found");
    expect(
      await t.run((ctx) => ctx.db.get(fixture.contractId)),
    ).not.toBeNull();
  });

  it("keeps the Safari cleanup safe after the count-based collision is corrected", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFixture(t, 45);
    await t.run(async (ctx) => {
      const invoice = await ctx.db.get(fixture.unrelatedInvoiceId);
      if (!invoice) throw new Error("fixture invoice missing");
      await ctx.db.patch(invoice._id, { invoiceNumber: "INV-2026-00049" });
    });
    const dryRun = await t.mutation(
      internal.customerContracts.permanentlyDeleteIncorrectContract,
      cleanupArgs(fixture),
    );
    expect(dryRun).toMatchObject({
      invoiceNumberAllocatorSafe: true,
    });
    expect(
      await t.run((ctx) => ctx.db.get(fixture.contractId)),
    ).not.toBeNull();
  });
});
