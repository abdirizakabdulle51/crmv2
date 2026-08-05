import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

type Seed = {
  countryA: Id<"countries">;
  countryB: Id<"countries">;
  sector: Id<"sectors">;
  catalogItemId: Id<"serviceCatalog">;
  ceo: Doc<"users">;
  hob: Doc<"users">;
  gmA: Doc<"users">;
  gmB: Doc<"users">;
  amA: Doc<"users">;
  amB: Doc<"users">;
  companyA: Id<"companies">;
  companyB: Id<"companies">;
  acceptedQuoteA: Id<"quotes">;
  acceptedQuoteB: Id<"quotes">;
  draftQuoteA: Id<"quotes">;
  sentQuoteA: Id<"quotes">;
};

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
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
      email: "am-a@example.com",
      tokenIdentifier: "am-a-token",
      role: "account_manager",
      countryId: countryA,
    });
    const amBId = await ctx.db.insert("users", {
      name: "AM B",
      email: "am-b@example.com",
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
      contactName: "A Contact",
      contactEmail: "billing-a@example.com",
    });
    const companyB = await ctx.db.insert("companies", {
      name: "Company B",
      sectorId: sector,
      countryId: countryB,
      accountManagerId: amBId,
      contractStatus: "active",
      contactName: "B Contact",
      contactEmail: "billing-b@example.com",
    });
    const catalogItemId = await ctx.db.insert("serviceCatalog", {
      serviceCategory: "ECS",
      itemName: "ECS Small",
      billingUnit: "per instance",
      monthlyPrice: 10,
      yearlyPrice: 100,
    });
    const lineItem = {
      catalogItemId,
      itemName: "ECS Small",
      serviceCategory: "ECS",
      billingUnit: "per instance",
      quantity: 2,
      monthlyUnitPrice: 10,
      monthlyTotal: 20,
      yearlyTotal: 200,
      regionId: "hoa-mog-2",
      regionName: "Hoa-Mogadishu-2",
      dataCenterName: "Mogadishu DC 2",
    };
    const acceptedQuoteA = await ctx.db.insert("quotes", {
      companyId: companyA,
      createdBy: amAId,
      quoteNumber: "Q-2026-00001",
      date: "2026-08-01",
      status: "accepted",
      lineItems: [lineItem],
      monthlyGrandTotal: 20,
      yearlyGrandTotal: 200,
      notes: "Accepted quote notes",
      sourceMonth: "2026-07",
    });
    const acceptedQuoteB = await ctx.db.insert("quotes", {
      companyId: companyB,
      createdBy: amBId,
      quoteNumber: "Q-2026-00002",
      date: "2026-08-01",
      status: "accepted",
      lineItems: [lineItem],
      monthlyGrandTotal: 20,
      yearlyGrandTotal: 200,
    });
    const draftQuoteA = await ctx.db.insert("quotes", {
      companyId: companyA,
      createdBy: amAId,
      date: "2026-08-02",
      status: "draft",
      lineItems: [lineItem],
      monthlyGrandTotal: 20,
      yearlyGrandTotal: 200,
    });
    const sentQuoteA = await ctx.db.insert("quotes", {
      companyId: companyA,
      createdBy: amAId,
      date: "2026-08-03",
      status: "sent",
      lineItems: [lineItem],
      monthlyGrandTotal: 20,
      yearlyGrandTotal: 200,
    });

    return {
      countryA,
      countryB,
      sector,
      catalogItemId,
      ceo: (await ctx.db.get(ceoId))!,
      hob: (await ctx.db.get(hobId))!,
      gmA: (await ctx.db.get(gmAId))!,
      gmB: (await ctx.db.get(gmBId))!,
      amA: (await ctx.db.get(amAId))!,
      amB: (await ctx.db.get(amBId))!,
      companyA,
      companyB,
      acceptedQuoteA,
      acceptedQuoteB,
      draftQuoteA,
      sentQuoteA,
    };
  });
}

async function createDraftForA(
  t: ReturnType<typeof convexTest>,
  s: Seed,
  options: { omitDueDate?: boolean; dueDate?: number } = {},
) {
  const args: {
    quoteId: Id<"quotes">;
    dueDate?: number;
    notes: string;
  } = {
    quoteId: s.acceptedQuoteA,
    notes: "Invoice notes",
  };
  if (!options.omitDueDate) {
    args.dueDate = options.dueDate ?? 1786400000000;
  }
  return await asUser(t, s.amA).mutation(
    api.invoices.createDraftFromQuote,
    args,
  );
}

async function issueDraftForA(t: ReturnType<typeof convexTest>, s: Seed) {
  const invoiceId = await createDraftForA(t, s);
  await asUser(t, s.amA).mutation(api.invoices.issueInvoice, { invoiceId });
  return invoiceId;
}

async function issueInvoiceWithStatus(
  t: ReturnType<typeof convexTest>,
  s: Seed,
  status: Doc<"invoices">["status"],
  overrides: Partial<Doc<"invoices">> = {},
) {
  const invoiceId = await issueDraftForA(t, s);
  await t.run(async (ctx) => {
    await ctx.db.patch(invoiceId, {
      status,
      dueDate: Date.UTC(2026, 7, 8, 12),
      amountPaid: 0,
      balanceDue: 20,
      ...overrides,
    });
  });
  return invoiceId;
}

function invoiceProfileInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Somalia Invoice Profile",
    isDefault: false,
    isActive: true,
    legalName: "HTG CLOUDS LIMITED",
    slogan: "Built for us, Ready for the World.",
    addressLines: [
      "Airport road, Next to Ali Jimale Masque",
      "Wadajir District",
      "Mogadishu, Somalia",
    ],
    phone: "+252 61 5558484",
    email: "finance@htgclouds.com",
    website: "https://htgclouds.com/",
    taxId: "TIN-123",
    bankName: "Salaam Somali Bank",
    bankAccountNumber: "33111777",
    bankAccountName: "HTG CLOUDS LIMITED",
    bankLocation: "MOGADISHU - SOMALIA",
    currency: "USD",
    currencyNote: "All fees are listed in USD",
    paymentInstructions:
      "PLEASE PAY BILLS ON DUE DATE BY DEPOSITING IT TO OUR SALAAM SOMALI BANK ACCOUNT.",
    footerText: "Thank you for your business.",
    ...overrides,
  };
}

function mockRelaySuccess() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function configureRelayEnv() {
  vi.stubEnv(
    "HTGWEB_MAIL_RELAY_URL",
    "https://htgweb.example/internal/send-email",
  );
  vi.stubEnv("MAIL_RELAY_SECRET", "relay-secret");
}

describe("invoices", () => {
  beforeEach(() => {
    configureRelayEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("creates companies with Net 7, Net 15, and Net 30 payment terms", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    for (const paymentTermDays of [7, 15, 30] as const) {
      const companyId = await asUser(t, s.ceo).mutation(api.companies.create, {
        name: `Terms ${paymentTermDays}`,
        sectorId: s.sector,
        countryId: s.countryA,
        accountManagerId: s.amA._id,
        contractStatus: "active",
        paymentTermDays,
      });
      const company = await asUser(t, s.ceo).query(api.companies.getById, {
        id: companyId,
      });
      expect(company.paymentTermDays).toBe(paymentTermDays);
    }
  });

  it("updates company payment terms and rejects invalid values", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await asUser(t, s.ceo).mutation(api.companies.update, {
      id: s.companyA,
      name: "Company A",
      sectorId: s.sector,
      countryId: s.countryA,
      accountManagerId: s.amA._id,
      contractStatus: "active",
      paymentTermDays: 30,
    });
    const company = await asUser(t, s.ceo).query(api.companies.getById, {
      id: s.companyA,
    });
    expect(company.paymentTermDays).toBe(30);

    await expect(
      asUser(t, s.ceo).mutation(api.companies.update, {
        id: s.companyA,
        name: "Company A",
        sectorId: s.sector,
        countryId: s.countryA,
        accountManagerId: s.amA._id,
        contractStatus: "active",
        paymentTermDays: 45 as 7,
      }),
    ).rejects.toThrow();
  });

  it("scopes invoice visibility by AM, Country GM, HOB, and CEO company access", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const invoiceA = await asUser(t, s.amA).mutation(
      api.invoices.createDraftFromQuote,
      { quoteId: s.acceptedQuoteA },
    );
    const invoiceB = await asUser(t, s.amB).mutation(
      api.invoices.createDraftFromQuote,
      { quoteId: s.acceptedQuoteB },
    );

    await expect(
      asUser(t, s.amA).query(api.invoices.getById, { invoiceId: invoiceB }),
    ).rejects.toThrow();

    expect(
      (await asUser(t, s.amA).query(api.invoices.list, {})).map(
        (invoice) => invoice._id,
      ),
    ).toEqual([invoiceA]);
    expect(
      (await asUser(t, s.gmA).query(api.invoices.list, {})).map(
        (invoice) => invoice._id,
      ),
    ).toEqual([invoiceA]);
    expect(
      (await asUser(t, s.hob).query(api.invoices.list, {})).map(
        (invoice) => invoice._id,
      ),
    ).toEqual(expect.arrayContaining([invoiceA, invoiceB]));
    expect(
      (await asUser(t, s.ceo).query(api.invoices.list, {})).map(
        (invoice) => invoice._id,
      ),
    ).toEqual(expect.arrayContaining([invoiceA, invoiceB]));
  });

  it("hides test or hidden invoices by default and lets admins include them", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceA = await createDraftForA(t, s);
    const invoiceB = await asUser(t, s.amB).mutation(
      api.invoices.createDraftFromQuote,
      { quoteId: s.acceptedQuoteB },
    );

    await asUser(t, s.ceo).mutation(api.invoices.setInvoiceTestMode, {
      invoiceId: invoiceB,
      isTest: true,
      reason: "Seeded test invoice",
    });

    expect(
      (await asUser(t, s.ceo).query(api.invoices.list, {})).map(
        (invoice) => invoice._id,
      ),
    ).toEqual([invoiceA]);
    expect(
      (
        await asUser(t, s.ceo).query(api.invoices.list, {
          includeTestHidden: true,
        })
      ).map((invoice) => invoice._id),
    ).toEqual(expect.arrayContaining([invoiceA, invoiceB]));
    await expect(
      asUser(t, s.amA).query(api.invoices.list, {
        includeTestHidden: true,
      }),
    ).rejects.toThrow("Only CEO or Head of Business can include test invoices");
  });

  it("creates a draft invoice only from accepted quotes", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      asUser(t, s.amA).mutation(api.invoices.createDraftFromQuote, {
        quoteId: s.draftQuoteA,
      }),
    ).rejects.toThrow("Only accepted quotes can be invoiced");
    await expect(
      asUser(t, s.amA).mutation(api.invoices.createDraftFromQuote, {
        quoteId: s.sentQuoteA,
      }),
    ).rejects.toThrow("Only accepted quotes can be invoiced");

    const invoiceId = await createDraftForA(t, s);
    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });

    expect(invoice).toMatchObject({
      companyId: s.companyA,
      sourceQuoteId: s.acceptedQuoteA,
      sourceMonth: "2026-07",
      sourceReference: "Q-2026-00001",
      status: "draft",
      companyName: "Company A",
      contactName: "A Contact",
      contactEmail: "billing-a@example.com",
      billingEmail: "billing-a@example.com",
      subtotal: 20,
      monthlyTotal: 20,
      yearlyTotal: 200,
      grandTotal: 20,
      amountPaid: 0,
      balanceDue: 20,
      notes: "Invoice notes",
    });
    expect(invoice.lineItems).toEqual([
      expect.objectContaining({
        itemName: "ECS Small",
        quantity: 2,
        monthlyTotal: 20,
        regionId: "hoa-mog-2",
        regionName: "Hoa-Mogadishu-2",
        dataCenterName: "Mogadishu DC 2",
      }),
    ]);
  });

  it("creates an event when a draft invoice is created", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);

    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      invoiceId,
      type: "draft_created",
      actorId: s.amA._id,
    });
  });

  it("stores the matching invoice profile on draft invoices", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const profileId = await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      invoiceProfileInput({ countryId: s.countryA }),
    );

    const invoiceId = await createDraftForA(t, s);
    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });

    expect(invoice.invoiceProfileId).toBe(profileId);
  });

  it("stores the default invoice profile on drafts when no country match exists", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const profileId = await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      invoiceProfileInput({ isDefault: true }),
    );

    const invoiceId = await createDraftForA(t, s);
    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });

    expect(invoice.invoiceProfileId).toBe(profileId);
  });

  it("creates draft invoices when no invoice profile exists", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const invoiceId = await createDraftForA(t, s);
    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });

    expect(invoice.invoiceProfileId).toBeUndefined();
    expect(invoice.status).toBe("draft");
  });

  it("updates draft invoices and records an update event", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);

    await asUser(t, s.amA).mutation(api.invoices.updateDraft, {
      invoiceId,
      companyName: "Company A Billing",
      contactEmail: "finance@example.com",
      billingAddress: "Mogadishu HQ",
      taxId: "TIN-123",
      grandTotal: 30,
      notes: "Updated draft",
    });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice).toMatchObject({
      companyName: "Company A Billing",
      contactEmail: "finance@example.com",
      billingAddress: "Mogadishu HQ",
      taxId: "TIN-123",
      grandTotal: 30,
      balanceDue: 30,
      notes: "Updated draft",
    });

    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events.map((event) => event.type)).toEqual([
      "draft_created",
      "draft_updated",
    ]);
  });

  it("issues and locks a draft invoice with an invoice number and event", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);

    await asUser(t, s.amA).mutation(api.invoices.issueInvoice, { invoiceId });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.status).toBe("issued");
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-00001$/);
    expect(invoice.issueDate).toEqual(expect.any(Number));
    expect(invoice.dueDate).toBe(1786400000000);
    expect(invoice.lockedAt).toEqual(expect.any(Number));

    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events.map((event) => event.type)).toEqual([
      "draft_created",
      "issued",
    ]);
  });

  it("snapshots seller fields when issuing with the selected invoice profile", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const profileId = await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      invoiceProfileInput({ countryId: s.countryA }),
    );
    const invoiceId = await createDraftForA(t, s);

    await asUser(t, s.amA).mutation(api.invoices.issueInvoice, { invoiceId });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice).toMatchObject({
      invoiceProfileId: profileId,
      sellerLegalName: "HTG CLOUDS LIMITED",
      sellerAddressLines: [
        "Airport road, Next to Ali Jimale Masque",
        "Wadajir District",
        "Mogadishu, Somalia",
      ],
      sellerPhone: "+252 61 5558484",
      sellerEmail: "finance@htgclouds.com",
      sellerWebsite: "https://htgclouds.com/",
      sellerSlogan: "Built for us, Ready for the World.",
      sellerTaxId: "TIN-123",
      sellerBankName: "Salaam Somali Bank",
      sellerBankAccountNumber: "33111777",
      sellerBankAccountName: "HTG CLOUDS LIMITED",
      sellerBankLocation: "MOGADISHU - SOMALIA",
      sellerCurrency: "USD",
      sellerCurrencyNote: "All fees are listed in USD",
      sellerPaymentInstructions:
        "PLEASE PAY BILLS ON DUE DATE BY DEPOSITING IT TO OUR SALAAM SOMALI BANK ACCOUNT.",
      sellerFooterText: "Thank you for your business.",
    });
  });

  it("resolves and snapshots an invoice profile at issue time when a draft has no profile", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);
    const profileId = await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      invoiceProfileInput({
        countryId: s.countryA,
        legalName: "HTG SOMALIA LIMITED",
      }),
    );

    await asUser(t, s.amA).mutation(api.invoices.issueInvoice, { invoiceId });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.invoiceProfileId).toBe(profileId);
    expect(invoice.sellerLegalName).toBe("HTG SOMALIA LIMITED");
  });

  it("does not change issued invoice seller snapshot when the profile changes later", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const profileId = await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      invoiceProfileInput({ countryId: s.countryA }),
    );
    const invoiceId = await createDraftForA(t, s);
    await asUser(t, s.amA).mutation(api.invoices.issueInvoice, { invoiceId });

    await asUser(t, s.ceo).mutation(api.invoiceProfiles.updateInvoiceProfile, {
      profileId,
      ...invoiceProfileInput({
        countryId: s.countryA,
        legalName: "CHANGED LEGAL NAME",
      }),
    });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.sellerLegalName).toBe("HTG CLOUDS LIMITED");
  });

  it("sets a default Net 7 due date when issuing an invoice without a due date", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s, { omitDueDate: true });

    await asUser(t, s.amA).mutation(api.invoices.issueInvoice, { invoiceId });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.issueDate).toEqual(expect.any(Number));
    expect(invoice.dueDate).toBe(invoice.issueDate! + 7 * 24 * 60 * 60 * 1000);
  });

  it("uses company payment terms when issuing an invoice without a due date", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await asUser(t, s.ceo).mutation(api.companies.update, {
      id: s.companyA,
      name: "Company A",
      sectorId: s.sector,
      countryId: s.countryA,
      accountManagerId: s.amA._id,
      contractStatus: "active",
      paymentTermDays: 15,
    });
    const invoiceId = await createDraftForA(t, s, { omitDueDate: true });

    await asUser(t, s.amA).mutation(api.invoices.issueInvoice, { invoiceId });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.issueDate).toEqual(expect.any(Number));
    expect(invoice.dueDate).toBe(invoice.issueDate! + 15 * 24 * 60 * 60 * 1000);
  });

  it.each(["issued", "sent", "partially_paid"] as const)(
    "marks %s invoices overdue when due date has passed",
    async (status) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const invoiceId = await issueInvoiceWithStatus(t, s, status, {
        amountPaid: status === "partially_paid" ? 5 : 0,
        balanceDue: status === "partially_paid" ? 15 : 20,
      });

      const result = await t.mutation(internal.invoices.markOverdueInvoices, {
        now: Date.UTC(2026, 7, 10, 12),
      });

      expect(result).toEqual({ updated: 1 });
      const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
        invoiceId,
      });
      expect(invoice.status).toBe("overdue");
      const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
        invoiceId,
      });
      const expectedBalance = status === "partially_paid" ? "$15.00" : "$20.00";
      expect(events[events.length - 1]).toMatchObject({
        type: "overdue",
        message: `Invoice marked overdue. Balance due: ${expectedBalance}.`,
      });
    },
  );

  it.each(["draft", "paid", "void", "cancelled"] as const)(
    "does not mark %s invoices overdue",
    async (status) => {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const invoiceId = await issueInvoiceWithStatus(t, s, status, {
        amountPaid: status === "paid" ? 20 : 0,
        balanceDue: status === "paid" ? 0 : 20,
      });

      const result = await t.mutation(internal.invoices.markOverdueInvoices, {
        now: Date.UTC(2026, 7, 10, 12),
      });

      expect(result).toEqual({ updated: 0 });
      const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
        invoiceId,
      });
      expect(invoice.status).toBe(status);
    },
  );

  it("ignores invoices with no balance due or due dates within the current business day", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const paidBalanceInvoiceId = await issueInvoiceWithStatus(t, s, "sent", {
      amountPaid: 20,
      balanceDue: 0,
    });
    const dueTodayInvoiceId = await issueInvoiceWithStatus(t, s, "sent", {
      dueDate: Date.UTC(2026, 7, 10, 8),
    });
    const futureInvoiceId = await issueInvoiceWithStatus(t, s, "sent", {
      dueDate: Date.UTC(2026, 7, 11, 8),
    });

    const result = await t.mutation(internal.invoices.markOverdueInvoices, {
      now: Date.UTC(2026, 7, 10, 12),
    });

    expect(result).toEqual({ updated: 0 });
    for (const invoiceId of [
      paidBalanceInvoiceId,
      dueTodayInvoiceId,
      futureInvoiceId,
    ]) {
      const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
        invoiceId,
      });
      expect(invoice.status).toBe("sent");
    }
  });

  it("does not duplicate overdue events on repeated runs", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueInvoiceWithStatus(t, s, "issued");

    const first = await t.mutation(internal.invoices.markOverdueInvoices, {
      now: Date.UTC(2026, 7, 10, 12),
    });
    const second = await t.mutation(internal.invoices.markOverdueInvoices, {
      now: Date.UTC(2026, 7, 10, 13),
    });

    expect(first).toEqual({ updated: 1 });
    expect(second).toEqual({ updated: 0 });
    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events.filter((event) => event.type === "overdue")).toHaveLength(1);
  });

  it("sends internal reminder for an overdue invoice with balance", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueInvoiceWithStatus(t, s, "overdue");
    const fetchMock = mockRelaySuccess();

    const result = await t.action(
      internal.invoices.sendInternalOverdueReminders,
      { now: Date.UTC(2026, 7, 20, 6), limit: 10 },
    );

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://htgweb.example/internal/send-email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Mail-Relay-Secret": "relay-secret",
        }),
      }),
    );
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      to: string;
      subject: string;
      html: string;
      text: string;
      invoice?: unknown;
    };
    expect(payload.to).toBe("am-a@example.com");
    expect(payload.subject).toMatch(/^Overdue invoice follow-up: INV-/);
    expect(payload.html).toContain("Company A");
    expect(payload.html).toContain("Balance due");
    expect(payload.html).toContain(`/invoices/${invoiceId}`);
    expect(payload.text).toContain("Customer: Company A");
    expect(payload.text).toContain("Balance due: $20.00");
    expect(payload.text).toContain(`/invoices/${invoiceId}`);
    expect(payload.invoice).toBeUndefined();

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.lastInternalReminderAt).toBe(Date.UTC(2026, 7, 20, 6));
    expect(invoice.internalReminderCount).toBe(1);
    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events[events.length - 1]).toMatchObject({
      type: "internal_reminder_sent",
      message: expect.stringContaining("am-a@example.com"),
    });
  });

  it.each([
    "draft",
    "issued",
    "sent",
    "partially_paid",
    "paid",
    "void",
    "cancelled",
  ] as const)("skips %s invoices for internal reminders", async (status) => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await issueInvoiceWithStatus(t, s, status, {
      amountPaid: status === "paid" ? 20 : 0,
      balanceDue: status === "paid" ? 0 : 20,
    });
    const fetchMock = mockRelaySuccess();

    const result = await t.action(
      internal.invoices.sendInternalOverdueReminders,
      { now: Date.UTC(2026, 7, 20, 6), limit: 10 },
    );

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips zero-balance overdue invoices and missing account manager emails", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await issueInvoiceWithStatus(t, s, "overdue", {
      amountPaid: 20,
      balanceDue: 0,
    });
    await issueInvoiceWithStatus(t, s, "overdue");
    await t.run(async (ctx) => {
      await ctx.db.patch(s.amA._id, { email: undefined });
    });
    const fetchMock = mockRelaySuccess();

    const result = await t.action(
      internal.invoices.sendInternalOverdueReminders,
      { now: Date.UTC(2026, 7, 20, 6), limit: 10 },
    );

    expect(result).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not resend internal reminders within seven days", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const now = Date.UTC(2026, 7, 20, 6);
    const invoiceId = await issueInvoiceWithStatus(t, s, "overdue", {
      lastInternalReminderAt: now - 6 * 24 * 60 * 60 * 1000,
      internalReminderCount: 1,
    });
    const fetchMock = mockRelaySuccess();

    const result = await t.action(
      internal.invoices.sendInternalOverdueReminders,
      { now, limit: 10 },
    );

    expect(result).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.internalReminderCount).toBe(1);
  });

  it("sends internal reminders again after seven days", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const now = Date.UTC(2026, 7, 20, 6);
    const invoiceId = await issueInvoiceWithStatus(t, s, "overdue", {
      lastInternalReminderAt: now - 8 * 24 * 60 * 60 * 1000,
      internalReminderCount: 1,
    });
    mockRelaySuccess();

    const result = await t.action(
      internal.invoices.sendInternalOverdueReminders,
      { now, limit: 10 },
    );

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.lastInternalReminderAt).toBe(now);
    expect(invoice.internalReminderCount).toBe(2);
  });

  it("does not update reminder fields when internal reminder relay fails", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueInvoiceWithStatus(t, s, "overdue");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "SMTP down" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await t.action(
      internal.invoices.sendInternalOverdueReminders,
      { now: Date.UTC(2026, 7, 20, 6), limit: 10 },
    );

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 1 });
    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.lastInternalReminderAt).toBeUndefined();
    expect(invoice.internalReminderCount).toBeUndefined();
    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(
      events.some((event) => event.type === "internal_reminder_sent"),
    ).toBe(false);
  });

  it("sends customer reminder for an overdue invoice with balance", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueInvoiceWithStatus(t, s, "overdue");
    const fetchMock = mockRelaySuccess();

    const result = await t.action(
      internal.invoices.sendCustomerOverdueReminders,
      { now: Date.UTC(2026, 7, 20, 6), limit: 10 },
    );

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://htgweb.example/internal/send-invoice-email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Mail-Relay-Secret": "relay-secret",
        }),
      }),
    );
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      to: string;
      subject: string;
      html: string;
      text: string;
      invoice: Doc<"invoices">;
    };
    expect(payload.to).toBe("billing-a@example.com");
    expect(payload.subject).toMatch(/^Overdue HTGClouds invoice INV-/);
    expect(payload.html).toContain("friendly reminder");
    expect(payload.html).toContain("Please find the invoice PDF attached");
    expect(payload.text).toContain("Balance due: $20.00");
    expect(payload.text).toContain("Please find the invoice PDF attached");
    expect(payload.invoice).toMatchObject({
      _id: invoiceId,
      status: "overdue",
      companyName: "Company A",
      sourceReference: "Q-2026-00001",
      contactEmail: "billing-a@example.com",
      billingEmail: "billing-a@example.com",
      balanceDue: 20,
    });
    expect("sourceQuoteId" in payload.invoice).toBe(false);

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.lastCustomerReminderAt).toBe(Date.UTC(2026, 7, 20, 6));
    expect(invoice.customerReminderCount).toBe(1);
    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events[events.length - 1]).toMatchObject({
      type: "customer_reminder_sent",
      message: expect.stringContaining("billing-a@example.com"),
    });
  });

  it("prefers billingEmail over contactEmail for customer reminders", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueInvoiceWithStatus(t, s, "overdue", {
      billingEmail: "accounts-payable@example.com",
      contactEmail: "contact@example.com",
    });
    const fetchMock = mockRelaySuccess();

    await t.action(internal.invoices.sendCustomerOverdueReminders, {
      now: Date.UTC(2026, 7, 20, 6),
      limit: 10,
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      to: string;
      invoice: Doc<"invoices">;
    };
    expect(payload.to).toBe("accounts-payable@example.com");
    expect(payload.invoice._id).toBe(invoiceId);
    expect("sourceQuoteId" in payload.invoice).toBe(false);
  });

  it.each([
    "draft",
    "issued",
    "sent",
    "partially_paid",
    "paid",
    "void",
    "cancelled",
  ] as const)("skips %s invoices for customer reminders", async (status) => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await issueInvoiceWithStatus(t, s, status, {
      amountPaid: status === "paid" ? 20 : 0,
      balanceDue: status === "paid" ? 0 : 20,
    });
    const fetchMock = mockRelaySuccess();

    const result = await t.action(
      internal.invoices.sendCustomerOverdueReminders,
      { now: Date.UTC(2026, 7, 20, 6), limit: 10 },
    );

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips customer reminders with no email or no balance due", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await issueInvoiceWithStatus(t, s, "overdue", {
      billingEmail: undefined,
      contactEmail: undefined,
    });
    await issueInvoiceWithStatus(t, s, "overdue", {
      amountPaid: 20,
      balanceDue: 0,
    });
    const fetchMock = mockRelaySuccess();

    const result = await t.action(
      internal.invoices.sendCustomerOverdueReminders,
      { now: Date.UTC(2026, 7, 20, 6), limit: 10 },
    );

    expect(result).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not resend customer reminders within seven days", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const now = Date.UTC(2026, 7, 20, 6);
    const invoiceId = await issueInvoiceWithStatus(t, s, "overdue", {
      lastCustomerReminderAt: now - 6 * 24 * 60 * 60 * 1000,
      customerReminderCount: 1,
    });
    const fetchMock = mockRelaySuccess();

    const result = await t.action(
      internal.invoices.sendCustomerOverdueReminders,
      { now, limit: 10 },
    );

    expect(result).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.customerReminderCount).toBe(1);
  });

  it("sends customer reminders again after seven days", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const now = Date.UTC(2026, 7, 20, 6);
    const invoiceId = await issueInvoiceWithStatus(t, s, "overdue", {
      lastCustomerReminderAt: now - 8 * 24 * 60 * 60 * 1000,
      customerReminderCount: 1,
    });
    mockRelaySuccess();

    const result = await t.action(
      internal.invoices.sendCustomerOverdueReminders,
      { now, limit: 10 },
    );

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.lastCustomerReminderAt).toBe(now);
    expect(invoice.customerReminderCount).toBe(2);
  });

  it("does not update customer reminder fields when relay fails", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueInvoiceWithStatus(t, s, "overdue");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "SMTP down" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const result = await t.action(
      internal.invoices.sendCustomerOverdueReminders,
      { now: Date.UTC(2026, 7, 20, 6), limit: 10 },
    );

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 1 });
    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.lastCustomerReminderAt).toBeUndefined();
    expect(invoice.customerReminderCount).toBeUndefined();
    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(
      events.some((event) => event.type === "customer_reminder_sent"),
    ).toBe(false);
  });

  it("rejects editing an issued invoice", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);
    await asUser(t, s.amA).mutation(api.invoices.issueInvoice, { invoiceId });

    await expect(
      asUser(t, s.amA).mutation(api.invoices.updateDraft, {
        invoiceId,
        companyName: "Changed after issue",
        grandTotal: 1,
      }),
    ).rejects.toThrow("Only draft invoices can be edited");
  });

  it("only CEO or HOB can cancel draft invoices with an audited reason", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);

    await expect(
      asUser(t, s.amA).mutation(api.invoices.cancelDraftInvoice, {
        invoiceId,
        reason: "Test cleanup",
      }),
    ).rejects.toThrow("Only CEO or Head of Business can clean up invoices");
    await expect(
      asUser(t, s.gmA).mutation(api.invoices.cancelDraftInvoice, {
        invoiceId,
        reason: "Test cleanup",
      }),
    ).rejects.toThrow("Only CEO or Head of Business can clean up invoices");
    await expect(
      asUser(t, s.ceo).mutation(api.invoices.cancelDraftInvoice, {
        invoiceId,
        reason: " ",
      }),
    ).rejects.toThrow("Cleanup reason is required");

    await asUser(t, s.hob).mutation(api.invoices.cancelDraftInvoice, {
      invoiceId,
      reason: "Duplicate test invoice",
    });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.status).toBe("cancelled");

    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events[events.length - 1]).toMatchObject({
      type: "cancelled",
      actorId: s.hob._id,
      message: "Draft invoice cancelled. Reason: Duplicate test invoice",
    });
  });

  it("rejects cancelling non-draft invoices", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);

    await expect(
      asUser(t, s.ceo).mutation(api.invoices.cancelDraftInvoice, {
        invoiceId,
        reason: "Wrong customer",
      }),
    ).rejects.toThrow("Only draft invoices can be cancelled");
  });

  it("only CEO or HOB can void eligible invoices with an audited reason", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);

    await expect(
      asUser(t, s.amA).mutation(api.invoices.voidInvoice, {
        invoiceId,
        reason: "Customer requested correction",
      }),
    ).rejects.toThrow("Only CEO or Head of Business can clean up invoices");
    await expect(
      asUser(t, s.gmA).mutation(api.invoices.voidInvoice, {
        invoiceId,
        reason: "Customer requested correction",
      }),
    ).rejects.toThrow("Only CEO or Head of Business can clean up invoices");
    await expect(
      asUser(t, s.ceo).mutation(api.invoices.voidInvoice, {
        invoiceId,
        reason: "",
      }),
    ).rejects.toThrow("Cleanup reason is required");

    await asUser(t, s.ceo).mutation(api.invoices.voidInvoice, {
      invoiceId,
      reason: "Customer requested correction",
    });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.status).toBe("void");

    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events[events.length - 1]).toMatchObject({
      type: "voided",
      actorId: s.ceo._id,
      message: "Invoice voided. Reason: Customer requested correction",
    });
  });

  it("allows voiding sent, partially paid, and overdue invoices but rejects other statuses", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    for (const status of ["sent", "partially_paid", "overdue"] as const) {
      const invoiceId = await issueInvoiceWithStatus(t, s, status);
      await asUser(t, s.hob).mutation(api.invoices.voidInvoice, {
        invoiceId,
        reason: `Void ${status}`,
      });
      const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
        invoiceId,
      });
      expect(invoice.status).toBe("void");
    }

    for (const status of ["draft", "paid", "cancelled", "void"] as const) {
      const invoiceId =
        status === "draft"
          ? await createDraftForA(t, s)
          : await issueInvoiceWithStatus(t, s, status);
      await expect(
        asUser(t, s.ceo).mutation(api.invoices.voidInvoice, {
          invoiceId,
          reason: `Cannot void ${status}`,
        }),
      ).rejects.toThrow(
        "Only issued, sent, partially paid, or overdue invoices can be voided",
      );
    }
  });

  it("marks and unmarks invoices as test or hidden with admin-only audit events", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);

    await expect(
      asUser(t, s.amA).mutation(api.invoices.setInvoiceTestMode, {
        invoiceId,
        isTest: true,
        reason: "Test data",
      }),
    ).rejects.toThrow("Only CEO or Head of Business can clean up invoices");
    await expect(
      asUser(t, s.gmA).mutation(api.invoices.setInvoiceTestMode, {
        invoiceId,
        isTest: true,
        reason: "Test data",
      }),
    ).rejects.toThrow("Only CEO or Head of Business can clean up invoices");
    await expect(
      asUser(t, s.ceo).mutation(api.invoices.setInvoiceTestMode, {
        invoiceId,
        isTest: true,
        reason: " ",
      }),
    ).rejects.toThrow("Cleanup reason is required");

    await asUser(t, s.ceo).mutation(api.invoices.setInvoiceTestMode, {
      invoiceId,
      isTest: true,
      reason: "Training invoice",
    });
    let invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.isTest).toBe(true);
    expect(invoice.hiddenBy).toBe(s.ceo._id);
    expect(invoice.hiddenAt).toBeGreaterThan(0);

    await asUser(t, s.hob).mutation(api.invoices.setInvoiceTestMode, {
      invoiceId,
      isTest: false,
      reason: "Real invoice after review",
    });
    invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.isTest).toBe(false);
    expect(invoice.hiddenBy).toBeUndefined();
    expect(invoice.hiddenAt).toBeUndefined();

    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["marked_test", "unmarked_test"]),
    );
    expect(events[events.length - 2]).toMatchObject({
      type: "marked_test",
      actorId: s.ceo._id,
      message: "Invoice marked as test/hidden. Reason: Training invoice",
    });
    expect(events[events.length - 1]).toMatchObject({
      type: "unmarked_test",
      actorId: s.hob._id,
      message: "Invoice unmarked as test/hidden. Reason: Real invoice after review",
    });
  });

  it("protects invoice events with invoice RBAC", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);

    await expect(
      asUser(t, s.amB).query(api.invoices.listEvents, { invoiceId }),
    ).rejects.toThrow();
  });

  it("keeps issued invoice snapshots independent from later quote and company changes", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);
    await asUser(t, s.amA).mutation(api.invoices.issueInvoice, { invoiceId });

    await t.run(async (ctx) => {
      await ctx.db.patch(s.companyA, {
        name: "Renamed Company",
        contactEmail: "new@example.com",
      });
      await ctx.db.patch(s.acceptedQuoteA, {
        monthlyGrandTotal: 999,
        lineItems: [
          {
            catalogItemId: s.catalogItemId,
            itemName: "Changed Item",
            serviceCategory: "ECS",
            billingUnit: "per instance",
            quantity: 99,
            monthlyUnitPrice: 10,
            monthlyTotal: 990,
            yearlyTotal: 9900,
          },
        ],
      });
    });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.companyName).toBe("Company A");
    expect(invoice.contactEmail).toBe("billing-a@example.com");
    expect(invoice.grandTotal).toBe(20);
    expect(invoice.lineItems[0].itemName).toBe("ECS Small");
  });

  it("rejects sending a draft invoice", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);
    const fetchMock = mockRelaySuccess();

    await expect(
      asUser(t, s.amA).action(api.invoices.sendInvoiceEmail, { invoiceId }),
    ).rejects.toThrow("Only issued invoices can be sent");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an issued invoice through the relay", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      invoiceProfileInput({ countryId: s.countryA }),
    );
    const invoiceId = await issueDraftForA(t, s);
    const fetchMock = mockRelaySuccess();

    await asUser(t, s.amA).action(api.invoices.sendInvoiceEmail, {
      invoiceId,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://htgweb.example/internal/send-invoice-email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Mail-Relay-Secret": "relay-secret",
        }),
      }),
    );
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      to: string;
      subject: string;
      html: string;
      text: string;
      invoice: Doc<"invoices">;
    };
    expect(payload.to).toBe("billing-a@example.com");
    expect(payload.subject).toMatch(/^HTGClouds invoice INV-/);
    expect(payload.html).toContain(
      "Please find attached your HTGClouds invoice",
    );
    expect(payload.html).toContain("Invoice amount");
    expect(payload.html).toContain("Balance due");
    expect(payload.html).not.toContain(
      "Please find your HTGClouds invoice summary below",
    );
    expect(payload.html).not.toContain("ECS Small");
    expect(payload.text).toContain("Balance due: $20.00");
    expect(payload.text).toContain(
      "Please find attached your HTGClouds invoice",
    );
    expect(payload.text).not.toContain("Line items:");
    expect(payload.text).not.toContain("ECS Small");
    expect(payload.invoice).toMatchObject({
      _id: invoiceId,
      status: "issued",
      companyName: "Company A",
      sourceReference: "Q-2026-00001",
      contactEmail: "billing-a@example.com",
      billingEmail: "billing-a@example.com",
      grandTotal: 20,
      balanceDue: 20,
      sellerLegalName: "HTG CLOUDS LIMITED",
      sellerBankAccountNumber: "33111777",
      sellerPaymentInstructions:
        "PLEASE PAY BILLS ON DUE DATE BY DEPOSITING IT TO OUR SALAAM SOMALI BANK ACCOUNT.",
    });
    expect(payload.invoice.lineItems[0]).toMatchObject({
      itemName: "ECS Small",
      quantity: 2,
      monthlyTotal: 20,
    });
    expect("sourceQuoteId" in payload.invoice).toBe(false);
  });

  it("prefers billingEmail over contactEmail when sending", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);
    await t.run(async (ctx) => {
      await ctx.db.patch(invoiceId, {
        billingEmail: "accounts-payable@example.com",
        contactEmail: "contact@example.com",
      });
    });
    const fetchMock = mockRelaySuccess();

    await asUser(t, s.amA).action(api.invoices.sendInvoiceEmail, {
      invoiceId,
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      to: string;
    };
    expect(payload.to).toBe("accounts-payable@example.com");
  });

  it("rejects sending when no recipient email exists", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);
    await t.run(async (ctx) => {
      await ctx.db.patch(invoiceId, {
        billingEmail: undefined,
        contactEmail: undefined,
      });
    });
    const fetchMock = mockRelaySuccess();

    await expect(
      asUser(t, s.amA).action(api.invoices.sendInvoiceEmail, { invoiceId }),
    ).rejects.toThrow("Invoice has no billing or contact email");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not mark an invoice sent when the relay fails", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "SMTP down" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(
      asUser(t, s.amA).action(api.invoices.sendInvoiceEmail, { invoiceId }),
    ).rejects.toThrow("SMTP down");

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice.status).toBe("issued");
    expect(invoice.sentAt).toBeUndefined();
    expect(invoice.sentTo).toBeUndefined();
    expect(invoice.sentBy).toBeUndefined();
  });

  it("records sent status, audit fields, and a sent event on relay success", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);
    mockRelaySuccess();

    await asUser(t, s.amA).action(api.invoices.sendInvoiceEmail, {
      invoiceId,
    });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice).toMatchObject({
      status: "sent",
      sentTo: "billing-a@example.com",
      sentBy: s.amA._id,
    });
    expect(invoice.sentAt).toEqual(expect.any(Number));

    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events[events.length - 1]).toMatchObject({
      type: "sent",
      actorId: s.amA._id,
      message: expect.stringContaining("billing-a@example.com"),
    });
  });

  it("blocks out-of-scope users from sending invoices", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);
    const fetchMock = mockRelaySuccess();

    await expect(
      asUser(t, s.amB).action(api.invoices.sendInvoiceEmail, { invoiceId }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects payments on draft, paid, void, and cancelled invoices", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const draftInvoiceId = await createDraftForA(t, s);

    await expect(
      asUser(t, s.amA).mutation(api.invoices.recordPayment, {
        invoiceId: draftInvoiceId,
        amount: 5,
      }),
    ).rejects.toThrow("Payments can only be recorded for payable invoices");

    const issuedInvoiceId = await issueDraftForA(t, s);
    await t.run(async (ctx) => {
      await ctx.db.patch(issuedInvoiceId, {
        status: "paid",
        amountPaid: 20,
        balanceDue: 0,
      });
    });
    await expect(
      asUser(t, s.amA).mutation(api.invoices.recordPayment, {
        invoiceId: issuedInvoiceId,
        amount: 5,
      }),
    ).rejects.toThrow("Payments can only be recorded for payable invoices");

    await t.run(async (ctx) => {
      await ctx.db.patch(issuedInvoiceId, {
        status: "void",
        amountPaid: 0,
        balanceDue: 20,
      });
    });
    await expect(
      asUser(t, s.amA).mutation(api.invoices.recordPayment, {
        invoiceId: issuedInvoiceId,
        amount: 5,
      }),
    ).rejects.toThrow("Payments can only be recorded for payable invoices");

    await t.run(async (ctx) => {
      await ctx.db.patch(issuedInvoiceId, {
        status: "cancelled",
      });
    });
    await expect(
      asUser(t, s.amA).mutation(api.invoices.recordPayment, {
        invoiceId: issuedInvoiceId,
        amount: 5,
      }),
    ).rejects.toThrow("Payments can only be recorded for payable invoices");
  });

  it("rejects zero, negative, and over-balance payments", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);

    await expect(
      asUser(t, s.amA).mutation(api.invoices.recordPayment, {
        invoiceId,
        amount: 0,
      }),
    ).rejects.toThrow("Payment amount must be positive");
    await expect(
      asUser(t, s.amA).mutation(api.invoices.recordPayment, {
        invoiceId,
        amount: -1,
      }),
    ).rejects.toThrow("Payment amount must be positive");
    await expect(
      asUser(t, s.amA).mutation(api.invoices.recordPayment, {
        invoiceId,
        amount: 25,
      }),
    ).rejects.toThrow("Payment cannot exceed the balance due");
  });

  it("records partial payments and creates payment and event records", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);
    const paidAt = Date.UTC(2026, 7, 4, 12, 0);

    await asUser(t, s.amA).mutation(api.invoices.recordPayment, {
      invoiceId,
      amount: 7.5,
      paidAt,
      method: "Bank Transfer",
      reference: "SSB-1001",
    });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice).toMatchObject({
      status: "partially_paid",
      amountPaid: 7.5,
      balanceDue: 12.5,
    });

    const payments = await asUser(t, s.amA).query(api.invoices.listPayments, {
      invoiceId,
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      invoiceId,
      amount: 7.5,
      paidAt,
      method: "Bank Transfer",
      reference: "SSB-1001",
      receivingBankName: "Salaam Somali Bank",
      receivingAccountNumber: "33111777",
      receivingAccountName: "HTG CLOUDS LIMITED",
      receivingBankLocation: "MOGADISHU - SOMALIA",
      receivingCurrencyNote: "All fees are listed in USD",
      recordedBy: s.amA._id,
    });

    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events[events.length - 1]).toMatchObject({
      type: "payment_recorded",
      actorId: s.amA._id,
      message: expect.stringContaining("Payment of $7.50 recorded."),
    });
    expect(events[events.length - 1].message).toContain(
      "Method: Bank Transfer.",
    );
    expect(events[events.length - 1].message).toContain(
      "Reference: SSB-1001.",
    );
    expect(events[events.length - 1].message).toContain(
      "Balance due: $12.50.",
    );
  });

  it("records mobile money payments without receiving bank details", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);

    await asUser(t, s.amA).mutation(api.invoices.recordPayment, {
      invoiceId,
      amount: 5,
      method: "Mobile Money",
      reference: "ZAAD-1001",
    });

    const payments = await asUser(t, s.amA).query(api.invoices.listPayments, {
      invoiceId,
    });
    expect(payments[0]).toMatchObject({
      method: "Mobile Money",
      reference: "ZAAD-1001",
    });
    expect(payments[0].receivingBankName).toBeUndefined();
    expect(payments[0].receivingAccountNumber).toBeUndefined();
    expect(payments[0].receivingAccountName).toBeUndefined();
    expect(payments[0].receivingBankLocation).toBeUndefined();
    expect(payments[0].receivingCurrencyNote).toBeUndefined();
  });

  it("rejects unsupported new payment methods", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);

    await expect(
      asUser(t, s.amA).mutation(api.invoices.recordPayment, {
        invoiceId,
        amount: 5,
        method: "Cash",
      }),
    ).rejects.toThrow("Unsupported payment method");
  });

  it("records full payments and marks invoices paid", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);

    await asUser(t, s.amA).mutation(api.invoices.recordPayment, {
      invoiceId,
      amount: 20,
      method: "Mobile Money",
    });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice).toMatchObject({
      status: "paid",
      amountPaid: 20,
      balanceDue: 0,
    });
  });

  it("allows payments for sent, overdue, and partially paid invoices", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    for (const status of ["sent", "overdue", "partially_paid"] as const) {
      const invoiceId = await issueDraftForA(t, s);
      await t.run(async (ctx) => {
        await ctx.db.patch(invoiceId, {
          status,
          amountPaid: status === "partially_paid" ? 5 : 0,
          balanceDue: status === "partially_paid" ? 15 : 20,
        });
      });

      await asUser(t, s.amA).mutation(api.invoices.recordPayment, {
        invoiceId,
        amount: 5,
      });

      const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
        invoiceId,
      });
      expect(invoice.status).toBe("partially_paid");
    }
  });

  it("records full payment after overdue and marks invoice paid", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueInvoiceWithStatus(t, s, "overdue");

    await asUser(t, s.amA).mutation(api.invoices.recordPayment, {
      invoiceId,
      amount: 20,
    });

    const invoice = await asUser(t, s.amA).query(api.invoices.getById, {
      invoiceId,
    });
    expect(invoice).toMatchObject({
      status: "paid",
      amountPaid: 20,
      balanceDue: 0,
    });
  });

  it("protects payment recording and payment history with invoice RBAC", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await issueDraftForA(t, s);

    await expect(
      asUser(t, s.amB).mutation(api.invoices.recordPayment, {
        invoiceId,
        amount: 5,
      }),
    ).rejects.toThrow();
    await expect(
      asUser(t, s.amB).query(api.invoices.listPayments, { invoiceId }),
    ).rejects.toThrow();
  });
});
