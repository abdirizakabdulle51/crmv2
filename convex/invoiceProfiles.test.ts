import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

type Seed = {
  countryA: Id<"countries">;
  countryB: Id<"countries">;
  companyA: Id<"companies">;
  companyB: Id<"companies">;
  ceo: Doc<"users">;
  hob: Doc<"users">;
  am: Doc<"users">;
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
    const amId = await ctx.db.insert("users", {
      name: "AM",
      tokenIdentifier: "am-token",
      role: "account_manager",
      countryId: countryA,
    });
    const companyA = await ctx.db.insert("companies", {
      name: "Company A",
      sectorId: sector,
      countryId: countryA,
      accountManagerId: amId,
      contractStatus: "active",
    });
    const companyB = await ctx.db.insert("companies", {
      name: "Company B",
      sectorId: sector,
      countryId: countryB,
      accountManagerId: amId,
      contractStatus: "active",
    });

    return {
      countryA,
      countryB,
      companyA,
      companyB,
      ceo: (await ctx.db.get(ceoId))!,
      hob: (await ctx.db.get(hobId))!,
      am: (await ctx.db.get(amId))!,
    };
  });
}

function profileInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Somalia Invoice Profile",
    isDefault: false,
    isActive: true,
    legalName: "HTG CLOUDS LIMITED",
    logoPath: "/Logo.svg",
    slogan: "Built for us, Ready for the World.",
    addressLines: [
      "Airport road, Next to Ali Jimale Masque",
      "Wadajir District",
      "Mogadishu, Somalia",
    ],
    phone: "+252 61 5558484",
    email: "Mohamed.hussein@htgclouds.com",
    website: "https://htgclouds.com/",
    bankName: "Salaam Somali Bank",
    bankAccountNumber: "33111777",
    bankAccountName: "HTG CLOUDS LIMITED",
    bankLocation: "MOGADISHU - SOMALIA",
    currency: "USD",
    currencyNote: "All fees are listed in USD",
    paymentInstructions:
      "PLEASE PAY BILLS ON DUE DATE BY DEPOSITING IT TO OUR SALAAM SOMALI BANK ACCOUNT.",
    ...overrides,
  };
}

describe("invoice profiles", () => {
  it("allows CEO and HOB to create and update invoice profiles", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const profileId = await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({ countryId: s.countryA }),
    );
    await asUser(t, s.hob).mutation(api.invoiceProfiles.updateInvoiceProfile, {
      profileId,
      ...profileInput({
        countryId: s.countryA,
        name: "Updated Somalia Profile",
        currency: undefined,
      }),
    });

    const profiles = await asUser(t, s.ceo).query(
      api.invoiceProfiles.listInvoiceProfiles,
      { includeInactive: true },
    );
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      name: "Updated Somalia Profile",
      currency: "USD",
      countryId: s.countryA,
    });
  });

  it("rejects Account Manager create and update attempts", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const profileId = await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({ countryId: s.countryA }),
    );

    await expect(
      asUser(t, s.am).mutation(
        api.invoiceProfiles.createInvoiceProfile,
        profileInput(),
      ),
    ).rejects.toThrow("Only CEO or Head of Business can manage invoice profiles");
    await expect(
      asUser(t, s.am).mutation(api.invoiceProfiles.updateInvoiceProfile, {
        profileId,
        ...profileInput(),
      }),
    ).rejects.toThrow("Only CEO or Head of Business can manage invoice profiles");
  });

  it("lists active profiles by default and inactive profiles when requested", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({ name: "Active" }),
    );
    await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({ name: "Inactive", isActive: false }),
    );

    const activeOnly = await asUser(t, s.am).query(
      api.invoiceProfiles.listInvoiceProfiles,
      {},
    );
    const allProfiles = await asUser(t, s.am).query(
      api.invoiceProfiles.listInvoiceProfiles,
      { includeInactive: true },
    );

    expect(activeOnly.map((profile) => profile.name)).toEqual(["Active"]);
    expect(allProfiles.map((profile) => profile.name).sort()).toEqual([
      "Active",
      "Inactive",
    ]);
  });

  it("matches active profiles by company country before default profile", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({ name: "Default", isDefault: true }),
    );
    await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({ name: "Somalia", countryId: s.countryA }),
    );

    const resolved = await asUser(t, s.am).query(
      api.invoiceProfiles.resolveInvoiceProfileForCompany,
      { companyId: s.companyA },
    );

    expect(resolved?.name).toBe("Somalia");
  });

  it("falls back to the active default profile and ignores inactive profiles", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({
        name: "Inactive Kenya",
        countryId: s.countryB,
        isActive: false,
      }),
    );
    await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({ name: "Default", isDefault: true }),
    );

    const resolved = await asUser(t, s.ceo).query(
      api.invoiceProfiles.resolveInvoiceProfileForCompany,
      { companyId: s.companyB },
    );

    expect(resolved?.name).toBe("Default");
  });

  it("keeps only one active default invoice profile", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const first = await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({ name: "First Default", isDefault: true }),
    );
    const second = await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({ name: "Second Default", isDefault: true }),
    );

    const profiles = await asUser(t, s.ceo).query(
      api.invoiceProfiles.listInvoiceProfiles,
      { includeInactive: true },
    );
    const firstProfile = profiles.find((profile) => profile._id === first);
    const secondProfile = profiles.find((profile) => profile._id === second);
    const defaultProfile = await asUser(t, s.ceo).query(
      api.invoiceProfiles.getDefaultInvoiceProfile,
      {},
    );

    expect(firstProfile?.isDefault).toBe(false);
    expect(secondProfile?.isDefault).toBe(true);
    expect(defaultProfile?._id).toBe(second);
  });

  it("returns null when no active matching or default profile exists", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await asUser(t, s.ceo).mutation(
      api.invoiceProfiles.createInvoiceProfile,
      profileInput({ isDefault: true, isActive: false }),
    );

    const resolved = await asUser(t, s.am).query(
      api.invoiceProfiles.resolveInvoiceProfileForCompany,
      { companyId: s.companyA },
    );

    expect(resolved).toBeNull();
  });

  it("rejects invalid invoice profile input", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      asUser(t, s.ceo).mutation(
        api.invoiceProfiles.createInvoiceProfile,
        profileInput({ name: "   " }),
      ),
    ).rejects.toThrow("Profile name is required");
    await expect(
      asUser(t, s.ceo).mutation(
        api.invoiceProfiles.createInvoiceProfile,
        profileInput({ addressLines: [" ", ""] }),
      ),
    ).rejects.toThrow("At least one invoice profile address line is required");
    await expect(
      asUser(t, s.ceo).mutation(
        api.invoiceProfiles.createInvoiceProfile,
        profileInput({ bankAccountNumber: "" }),
      ),
    ).rejects.toThrow("Bank account number is required");
  });
});
