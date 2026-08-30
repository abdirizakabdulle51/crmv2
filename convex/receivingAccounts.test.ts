import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const countryA = await ctx.db.insert("countries", {
      name: "Somalia",
      region: "East Africa",
    });
    const countryB = await ctx.db.insert("countries", {
      name: "Kenya",
      region: "East Africa",
    });
    const ceoId = await ctx.db.insert("users", {
      name: "CEO",
      tokenIdentifier: "ceo-accounts",
      role: "ceo",
    });
    const gmAId = await ctx.db.insert("users", {
      name: "GM A",
      tokenIdentifier: "gm-a-accounts",
      role: "country_gm",
      countryId: countryA,
    });
    const gmBId = await ctx.db.insert("users", {
      name: "GM B",
      tokenIdentifier: "gm-b-accounts",
      role: "country_gm",
      countryId: countryB,
    });
    return {
      countryA,
      countryB,
      ceo: (await ctx.db.get(ceoId))!,
      gmA: (await ctx.db.get(gmAId))!,
      gmB: (await ctx.db.get(gmBId))!,
    };
  });
}

describe("finance accounts", () => {
  it("requires country ownership and scopes account visibility by country", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const accountId = await asUser(t, s.ceo).mutation(
      api.receivingAccounts.create,
      {
        countryId: s.countryA,
        name: "Somalia Bank USD",
        providerName: "Somalia Bank",
        accountNumber: "SO-100",
        accountHolderName: "HTG CLOUDS LIMITED",
        type: "bank",
        usage: "both",
        currency: "USD",
      },
    );
    expect(
      (await asUser(t, s.gmA).query(api.receivingAccounts.list, {})).map(
        (row) => row._id,
      ),
    ).toContain(accountId);
    expect(
      await asUser(t, s.gmB).query(api.receivingAccounts.list, {}),
    ).toHaveLength(0);
  });

  it("allows controlled descriptive edits while preserving account identity", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const accountId = await asUser(t, s.ceo).mutation(
      api.receivingAccounts.create,
      {
        countryId: s.countryA,
        name: "Original",
        providerName: "Somalia Bank",
        accountNumber: "SO-200",
        accountHolderName: "HTG",
        type: "bank",
        usage: "incoming",
        currency: "USD",
      },
    );
    await asUser(t, s.ceo).mutation(api.receivingAccounts.update, {
      accountId,
      countryId: s.countryA,
      name: "Operations USD",
      accountHolderName: "HTG CLOUDS LIMITED",
      usage: "both",
    });
    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account).toMatchObject({
      name: "Operations USD",
      providerName: "Somalia Bank",
      accountNumber: "SO-200",
      usage: "both",
    });
  });
});
