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
    };
    const acceptedQuoteA = await ctx.db.insert("quotes", {
      companyId: companyA,
      createdBy: amAId,
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

async function createDraftForA(t: ReturnType<typeof convexTest>, s: Seed) {
  return await asUser(t, s.amA).mutation(api.invoices.createDraftFromQuote, {
    quoteId: s.acceptedQuoteA,
    dueDate: 1786400000000,
    notes: "Invoice notes",
  });
}

describe("invoices", () => {
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
    expect(invoice.lockedAt).toEqual(expect.any(Number));

    const events = await asUser(t, s.amA).query(api.invoices.listEvents, {
      invoiceId,
    });
    expect(events.map((event) => event.type)).toEqual([
      "draft_created",
      "issued",
    ]);
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

  it("voids an invoice and records the reason as an event", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const invoiceId = await createDraftForA(t, s);
    await asUser(t, s.amA).mutation(api.invoices.issueInvoice, { invoiceId });

    await asUser(t, s.amA).mutation(api.invoices.voidInvoice, {
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
      message: "Customer requested correction",
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
});
