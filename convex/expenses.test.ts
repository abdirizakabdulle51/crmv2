import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

type Seed = {
  countryA: Id<"countries">;
  countryB: Id<"countries">;
  sector: Id<"sectors">;
  category: Id<"expenseCategories">;
  inactiveCategory: Id<"expenseCategories">;
  ceo: Doc<"users">;
  hob: Doc<"users">;
  gmA: Doc<"users">;
  gmB: Doc<"users">;
  amA: Doc<"users">;
  amB: Doc<"users">;
  companyA: Id<"companies">;
  companyB: Id<"companies">;
};

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function storeTestFile(
  t: ReturnType<typeof convexTest>,
  body = "receipt",
  type = "application/pdf",
) {
  return await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob([body], { type }));
  });
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Seed> {
  return await t.run(async (ctx) => {
    const countryA = await ctx.db.insert("countries", {
      name: "Somalia",
      region: "East Africa",
    });
    const countryB = await ctx.db.insert("countries", {
      name: "Kenya",
      region: "East Africa",
    });
    const sector = await ctx.db.insert("sectors", { name: "Banking" });
    const ceoId = await ctx.db.insert("users", {
      name: "CEO",
      tokenIdentifier: "ceo-token",
      role: "ceo",
    });
    const hobId = await ctx.db.insert("users", {
      name: "HOB",
      tokenIdentifier: "hob-token",
      role: "head_of_business",
    });
    const gmAId = await ctx.db.insert("users", {
      name: "GM A",
      tokenIdentifier: "gm-a-token",
      role: "country_gm",
      countryId: countryA,
    });
    const gmBId = await ctx.db.insert("users", {
      name: "GM B",
      tokenIdentifier: "gm-b-token",
      role: "country_gm",
      countryId: countryB,
    });
    const amAId = await ctx.db.insert("users", {
      name: "AM A",
      tokenIdentifier: "am-a-token",
      role: "account_manager",
      countryId: countryA,
    });
    const amBId = await ctx.db.insert("users", {
      name: "AM B",
      tokenIdentifier: "am-b-token",
      role: "account_manager",
      countryId: countryB,
    });
    const companyA = await ctx.db.insert("companies", {
      name: "Company A",
      sectorId: sector,
      countryId: countryA,
      accountManagerId: amAId,
      contractStatus: "active",
    });
    const companyB = await ctx.db.insert("companies", {
      name: "Company B",
      sectorId: sector,
      countryId: countryB,
      accountManagerId: amBId,
      contractStatus: "active",
    });
    const category = await ctx.db.insert("expenseCategories", {
      name: "Travel",
      isActive: true,
      createdBy: ceoId,
      createdAt: 1,
      updatedAt: 1,
    });
    const inactiveCategory = await ctx.db.insert("expenseCategories", {
      name: "Old Category",
      isActive: false,
      createdBy: ceoId,
      createdAt: 1,
      updatedAt: 1,
    });

    return {
      countryA,
      countryB,
      sector,
      category,
      inactiveCategory,
      ceo: (await ctx.db.get(ceoId))!,
      hob: (await ctx.db.get(hobId))!,
      gmA: (await ctx.db.get(gmAId))!,
      gmB: (await ctx.db.get(gmBId))!,
      amA: (await ctx.db.get(amAId))!,
      amB: (await ctx.db.get(amBId))!,
      companyA,
      companyB,
    };
  });
}

async function createDraftExpense(
  t: ReturnType<typeof convexTest>,
  s: Seed,
  user: Doc<"users"> = s.amA,
  overrides: Partial<{
    title: string;
    categoryId: Id<"expenseCategories">;
    amount: number;
    currency: string;
    expenseDate: number;
    companyId: Id<"companies">;
    countryId: Id<"countries">;
  }> = {},
) {
  const defaultCompanyId = user._id === s.amB._id ? s.companyB : s.companyA;
  return await asUser(t, user).mutation(api.expenses.createExpenseRequest, {
    title: overrides.title ?? "Customer visit taxi",
    categoryId: overrides.categoryId ?? s.category,
    amount: overrides.amount ?? 25,
    currency: overrides.currency,
    expenseDate: overrides.expenseDate ?? Date.UTC(2026, 7, 5),
    companyId: overrides.companyId ?? defaultCompanyId,
    countryId: overrides.countryId,
  });
}

async function createSubmittedExpense(
  t: ReturnType<typeof convexTest>,
  s: Seed,
  user: Doc<"users"> = s.amA,
) {
  const expenseId = await createDraftExpense(t, s, user);
  await asUser(t, user).mutation(api.expenses.submitExpenseRequest, {
    expenseId,
  });
  return expenseId;
}

async function createReceiptRequiredCategory(
  t: ReturnType<typeof convexTest>,
  s: Seed,
) {
  return await asUser(t, s.ceo).mutation(api.expenses.createExpenseCategory, {
    name: "Receipt Required",
    code: "RECEIPT_REQUIRED",
    requiresReceipt: true,
  });
}

async function uploadReceipt(
  t: ReturnType<typeof convexTest>,
  s: Seed,
  expenseId: Id<"expenseRequests">,
  user: Doc<"users"> = s.amA,
) {
  return await asUser(t, user).mutation(api.expenses.saveReceiptMetadata, {
    expenseId,
    storageId: await storeTestFile(t),
    fileName: "receipt.pdf",
    mimeType: "application/pdf",
    size: 1024,
  });
}

describe("expenses", () => {
  it("allows an Account Manager to create and submit own expense", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const expenseId = await createDraftExpense(t, s);
    await asUser(t, s.amA).mutation(api.expenses.submitExpenseRequest, {
      expenseId,
    });

    const expense = await asUser(t, s.amA).query(
      api.expenses.getExpenseRequest,
      { expenseId },
    );
    expect(expense).toMatchObject({
      title: "Customer visit taxi",
      amount: 25,
      currency: "USD",
      requestedBy: s.amA._id,
      status: "submitted",
      companyId: s.companyA,
      countryId: s.countryA,
    });
  });

  it("blocks Account Managers from approving, rejecting, or marking expenses paid", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseId = await createSubmittedExpense(t, s);

    await expect(
      asUser(t, s.amA).mutation(api.expenses.approveExpenseRequest, {
        expenseId,
      }),
    ).rejects.toThrow();
    await expect(
      asUser(t, s.amA).mutation(api.expenses.rejectExpenseRequest, {
        expenseId,
        reason: "No receipt",
      }),
    ).rejects.toThrow();
    await expect(
      asUser(t, s.amA).mutation(api.expenses.markExpensePaid, {
        expenseId,
      }),
    ).rejects.toThrow();
  });

  it("hides other users' expenses from Account Managers", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await createDraftExpense(t, s, s.amA);
    await createDraftExpense(t, s, s.amB, {
      companyId: s.companyB,
      countryId: s.countryB,
    });

    const visible = await asUser(t, s.amA).query(
      api.expenses.listExpenseRequests,
      {},
    );
    expect(visible).toHaveLength(1);
    expect(visible[0].requestedBy).toBe(s.amA._id);
  });

  it("allows Country GM to approve and reject country expenses only", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const countryDraft = await createDraftExpense(t, s);
    const countryExpense = await createSubmittedExpense(t, s);
    const otherCountryExpense = await createSubmittedExpense(t, s, s.amB);

    await asUser(t, s.gmA).mutation(api.expenses.approveExpenseRequest, {
      expenseId: countryExpense,
      note: "Within policy",
    });

    await expect(
      asUser(t, s.gmA).mutation(api.expenses.rejectExpenseRequest, {
        expenseId: otherCountryExpense,
        reason: "Wrong country",
      }),
    ).rejects.toThrow();

    const visible = await asUser(t, s.gmA).query(
      api.expenses.listExpenseRequests,
      {},
    );
    expect(visible.map((expense) => expense._id)).toContain(countryExpense);
    expect(visible.map((expense) => expense._id)).not.toContain(countryDraft);
    expect(visible.map((expense) => expense._id)).not.toContain(
      otherCountryExpense,
    );
  });

  it("allows HOB and CEO to view, approve, reject, and mark paid across countries", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseA = await createSubmittedExpense(t, s);
    const expenseB = await createSubmittedExpense(t, s, s.amB);

    await asUser(t, s.hob).mutation(api.expenses.approveExpenseRequest, {
      expenseId: expenseA,
    });
    await asUser(t, s.ceo).mutation(api.expenses.rejectExpenseRequest, {
      expenseId: expenseB,
      reason: "Duplicate",
    });
    await asUser(t, s.ceo).mutation(api.expenses.markExpensePaid, {
      expenseId: expenseA,
      paymentMethod: "Bank Transfer",
      paymentReference: "PAY-1",
    });

    const visible = await asUser(t, s.ceo).query(
      api.expenses.listExpenseRequests,
      {},
    );
    expect(visible).toHaveLength(2);
    const paidExpense = await t.run(async (ctx) => await ctx.db.get(expenseA));
    expect(paidExpense).toMatchObject({
      status: "paid",
      paidBy: s.ceo._id,
      paymentMethod: "Bank Transfer",
      paymentReference: "PAY-1",
    });
  });

  it("rejects invalid workflow transitions", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const draft = await createDraftExpense(t, s);

    await expect(
      asUser(t, s.ceo).mutation(api.expenses.approveExpenseRequest, {
        expenseId: draft,
      }),
    ).rejects.toThrow();

    await asUser(t, s.amA).mutation(api.expenses.submitExpenseRequest, {
      expenseId: draft,
    });
    await asUser(t, s.ceo).mutation(api.expenses.approveExpenseRequest, {
      expenseId: draft,
    });
    await expect(
      asUser(t, s.amA).mutation(api.expenses.submitExpenseRequest, {
        expenseId: draft,
      }),
    ).rejects.toThrow();
    await expect(
      asUser(t, s.ceo).mutation(api.expenses.rejectExpenseRequest, {
        expenseId: draft,
        reason: "Too late",
      }),
    ).rejects.toThrow();
  });

  it("rejects inactive categories for new expense requests", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      createDraftExpense(t, s, s.amA, { categoryId: s.inactiveCategory }),
    ).rejects.toThrow();
  });

  it("creates an event for every state transition", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseId = await createDraftExpense(t, s);

    await asUser(t, s.amA).mutation(api.expenses.updateDraftExpenseRequest, {
      expenseId,
      title: "Updated taxi",
      categoryId: s.category,
      amount: 30,
      expenseDate: Date.UTC(2026, 7, 6),
      companyId: s.companyA,
    });
    await asUser(t, s.amA).mutation(api.expenses.submitExpenseRequest, {
      expenseId,
    });
    await asUser(t, s.ceo).mutation(api.expenses.approveExpenseRequest, {
      expenseId,
    });
    await asUser(t, s.ceo).mutation(api.expenses.markExpensePaid, {
      expenseId,
    });

    const events = await asUser(t, s.ceo).query(
      api.expenses.listExpenseEvents,
      { expenseId },
    );
    expect(events.map((event) => event.type)).toEqual([
      "created",
      "updated",
      "submitted",
      "approved",
      "marked_paid",
    ]);
  });

  it("blocks submitting receipt-required expenses until a receipt is uploaded", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const requiredCategory = await createReceiptRequiredCategory(t, s);
    const expenseId = await createDraftExpense(t, s, s.amA, {
      categoryId: requiredCategory,
    });

    await expect(
      asUser(t, s.amA).mutation(api.expenses.submitExpenseRequest, {
        expenseId,
      }),
    ).rejects.toThrow(
      "A receipt is required before this expense can be submitted.",
    );

    await uploadReceipt(t, s, expenseId);
    await asUser(t, s.amA).mutation(api.expenses.submitExpenseRequest, {
      expenseId,
    });

    const expense = await asUser(t, s.amA).query(
      api.expenses.getExpenseRequest,
      { expenseId },
    );
    expect(expense.status).toBe("submitted");
  });

  it("blocks approving receipt-required expenses until a receipt is uploaded", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const requiredCategory = await createReceiptRequiredCategory(t, s);
    const expenseId = await createDraftExpense(t, s, s.amA, {
      categoryId: requiredCategory,
    });
    await uploadReceipt(t, s, expenseId);
    await asUser(t, s.amA).mutation(api.expenses.submitExpenseRequest, {
      expenseId,
    });
    const receipts = await asUser(t, s.amA).query(api.expenses.listReceipts, {
      expenseId,
    });
    await asUser(t, s.amA).mutation(api.expenses.archiveReceipt, {
      receiptId: receipts[0]._id,
    });

    await expect(
      asUser(t, s.ceo).mutation(api.expenses.approveExpenseRequest, {
        expenseId,
      }),
    ).rejects.toThrow(
      "A receipt is required before this expense can be approved.",
    );

    await uploadReceipt(t, s, expenseId);
    await asUser(t, s.ceo).mutation(api.expenses.approveExpenseRequest, {
      expenseId,
    });

    const expense = await asUser(t, s.ceo).query(
      api.expenses.getExpenseRequest,
      { expenseId },
    );
    expect(expense.status).toBe("approved");
  });

  it("keeps non-receipt-required categories unchanged", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseId = await createSubmittedExpense(t, s);

    await asUser(t, s.ceo).mutation(api.expenses.approveExpenseRequest, {
      expenseId,
    });

    const expense = await asUser(t, s.ceo).query(
      api.expenses.getExpenseRequest,
      { expenseId },
    );
    expect(expense.status).toBe("approved");
  });

  it("enforces category create and update permissions", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      asUser(t, s.amA).mutation(api.expenses.createExpenseCategory, {
        name: "Fuel",
      }),
    ).rejects.toThrow();

    const categoryId = await asUser(t, s.ceo).mutation(
      api.expenses.createExpenseCategory,
      {
        name: "Fuel",
        code: "FUEL",
        requiresReceipt: true,
      },
    );
    await asUser(t, s.hob).mutation(api.expenses.updateExpenseCategory, {
      categoryId,
      name: "Fuel and Transport",
      code: "FUEL",
      isActive: false,
      requiresReceipt: true,
    });

    const categories = await asUser(t, s.ceo).query(
      api.expenses.listExpenseCategories,
      { includeInactive: true },
    );
    expect(categories.find((category) => category._id === categoryId)).toMatchObject({
      name: "Fuel and Transport",
      isActive: false,
    });
  });

  it("seeds missing default expense categories without duplicating existing categories", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const firstRun = await asUser(t, s.ceo).mutation(
      api.expenses.seedDefaultExpenseCategories,
      {},
    );
    const secondRun = await asUser(t, s.ceo).mutation(
      api.expenses.seedDefaultExpenseCategories,
      {},
    );
    const categories = await asUser(t, s.ceo).query(
      api.expenses.listExpenseCategories,
      { includeInactive: true },
    );

    expect(firstRun.created).toBe(12);
    expect(secondRun.created).toBe(0);
    expect(categories.filter((category) => category.name === "Travel"))
      .toHaveLength(1);
    expect(categories.find((category) => category.name === "Travel"))
      .toMatchObject({
        isActive: true,
      });
    expect(
      categories.find(
        (category) => category.name === "Internet / Connectivity",
      ),
    ).toMatchObject({
      code: "INTERNET_CONNECTIVITY",
      isActive: true,
    });
    expect(
      categories.find((category) => category.name === "Data Center / Colocation"),
    ).toMatchObject({
      code: "DATA_CENTER_COLOCATION",
      isActive: true,
    });
  });

  it("allows HOB to seed default expense categories and rejects Account Managers", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      asUser(t, s.amA).mutation(api.expenses.seedDefaultExpenseCategories, {}),
    ).rejects.toThrow();

    const result = await asUser(t, s.hob).mutation(
      api.expenses.seedDefaultExpenseCategories,
      {},
    );

    expect(result.created).toBe(12);
  });

  it("filters expense lists while preserving RBAC", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseA = await createSubmittedExpense(t, s);
    await createSubmittedExpense(t, s, s.amB);

    const countryA = await asUser(t, s.ceo).query(
      api.expenses.listExpenseRequests,
      { countryId: s.countryA },
    );
    expect(countryA.map((expense) => expense._id)).toEqual([expenseA]);

    const submittedForAmA = await asUser(t, s.gmA).query(
      api.expenses.listExpenseRequests,
      {
        status: "submitted",
        requestedBy: s.amA._id,
      },
    );
    expect(submittedForAmA).toHaveLength(1);
    expect(submittedForAmA[0]._id).toBe(expenseA);
  });

  it("requires auth before generating receipt upload URLs", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.expenses.generateReceiptUploadUrl, {}),
    ).rejects.toThrow();
  });

  it("saves receipts for visible expenses and records an upload event", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseId = await createDraftExpense(t, s);
    const storageId = await storeTestFile(t);

    const receiptId = await asUser(t, s.amA).mutation(
      api.expenses.saveReceiptMetadata,
      {
        expenseId,
        storageId,
        fileName: "receipt.pdf",
        mimeType: "application/pdf",
        size: 1024,
      },
    );

    const receipt = await t.run(async (ctx) => await ctx.db.get(receiptId));
    expect(receipt).toMatchObject({
      expenseId,
      storageId,
      fileName: "receipt.pdf",
      mimeType: "application/pdf",
      size: 1024,
      uploadedBy: s.amA._id,
      uploadedAt: expect.any(Number),
    });
    const events = await asUser(t, s.amA).query(api.expenses.listExpenseEvents, {
      expenseId,
    });
    expect(events.map((event) => event.type)).toContain("receipt_uploaded");
  });

  it("rejects receipts for hidden expenses and invalid files", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseId = await createDraftExpense(t, s);
    const storageId = await storeTestFile(t);

    await expect(
      asUser(t, s.amB).mutation(api.expenses.saveReceiptMetadata, {
        expenseId,
        storageId,
        fileName: "receipt.pdf",
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toThrow();
    await expect(
      asUser(t, s.amA).mutation(api.expenses.saveReceiptMetadata, {
        expenseId,
        storageId,
        fileName: "script.html",
        mimeType: "text/html",
        size: 1024,
      }),
    ).rejects.toThrow();
    await expect(
      asUser(t, s.amA).mutation(api.expenses.saveReceiptMetadata, {
        expenseId,
        storageId,
        fileName: "large.pdf",
        mimeType: "application/pdf",
        size: 10 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow();
  });

  it("lists and downloads only non-archived receipts for visible expenses", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseId = await createDraftExpense(t, s);
    const firstStorageId = await storeTestFile(t, "first");
    const secondStorageId = await storeTestFile(t, "second");

    await asUser(t, s.amA).mutation(api.expenses.saveReceiptMetadata, {
      expenseId,
      storageId: firstStorageId,
      fileName: "first.pdf",
      mimeType: "application/pdf",
      size: 100,
    });
    const archivedReceiptId = await asUser(t, s.amA).mutation(
      api.expenses.saveReceiptMetadata,
      {
        expenseId,
        storageId: secondStorageId,
        fileName: "second.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );
    await asUser(t, s.amA).mutation(api.expenses.archiveReceipt, {
      receiptId: archivedReceiptId,
    });

    const receipts = await asUser(t, s.amA).query(api.expenses.listReceipts, {
      expenseId,
    });
    expect(receipts.map((receipt) => receipt.fileName)).toEqual(["first.pdf"]);

    const url = await asUser(t, s.amA).query(
      api.expenses.getReceiptDownloadUrl,
      { receiptId: receipts[0]._id },
    );
    expect(url).toContain("/api/storage/");
    await expect(
      asUser(t, s.amB).query(api.expenses.getReceiptDownloadUrl, {
        receiptId: receipts[0]._id,
      }),
    ).rejects.toThrow();
  });

  it("archives receipts for uploaders HOB and CEO but not unrelated Account Managers", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const expenseId = await createDraftExpense(t, s);

    const uploaderReceiptId = await asUser(t, s.amA).mutation(
      api.expenses.saveReceiptMetadata,
      {
        expenseId,
        storageId: await storeTestFile(t, "uploader"),
        fileName: "uploader.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );
    const hobReceiptId = await asUser(t, s.amA).mutation(
      api.expenses.saveReceiptMetadata,
      {
        expenseId,
        storageId: await storeTestFile(t, "hob"),
        fileName: "hob.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );
    const ceoReceiptId = await asUser(t, s.amA).mutation(
      api.expenses.saveReceiptMetadata,
      {
        expenseId,
        storageId: await storeTestFile(t, "ceo"),
        fileName: "ceo.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );
    const otherReceiptId = await asUser(t, s.amA).mutation(
      api.expenses.saveReceiptMetadata,
      {
        expenseId,
        storageId: await storeTestFile(t, "other"),
        fileName: "other.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );

    await asUser(t, s.amA).mutation(api.expenses.archiveReceipt, {
      receiptId: uploaderReceiptId,
    });
    await asUser(t, s.hob).mutation(api.expenses.archiveReceipt, {
      receiptId: hobReceiptId,
    });
    await asUser(t, s.ceo).mutation(api.expenses.archiveReceipt, {
      receiptId: ceoReceiptId,
    });
    await expect(
      asUser(t, s.amB).mutation(api.expenses.archiveReceipt, {
        receiptId: otherReceiptId,
      }),
    ).rejects.toThrow();

    const archived = await t.run(async (ctx) => ({
      uploader: await ctx.db.get(uploaderReceiptId),
      hob: await ctx.db.get(hobReceiptId),
      ceo: await ctx.db.get(ceoReceiptId),
      other: await ctx.db.get(otherReceiptId),
    }));
    expect(archived.uploader?.archivedBy).toBe(s.amA._id);
    expect(archived.hob?.archivedBy).toBe(s.hob._id);
    expect(archived.ceo?.archivedBy).toBe(s.ceo._id);
    expect(archived.other?.archivedAt).toBeUndefined();

    const events = await asUser(t, s.ceo).query(api.expenses.listExpenseEvents, {
      expenseId,
    });
    expect(events.filter((event) => event.type === "receipt_removed"))
      .toHaveLength(3);
  });
});
