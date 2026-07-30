import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function seedUsers(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
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
    });

    return {
      ceo: (await ctx.db.get(ceoId))!,
      hob: (await ctx.db.get(hobId))!,
      am: (await ctx.db.get(amId))!,
    };
  });
}

describe("documentation", () => {
  it("seeds initial sections idempotently and filters restricted docs by role", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);

    const firstSeed = await t.mutation(
      internal.documentation.seedInitialDocs,
      {},
    );
    expect(firstSeed).toEqual({
      inserted: 11,
      byGroup: {
        "Team Guide": 3,
        "Technical Reference": 8,
      },
    });

    const secondSeed = await t.mutation(
      internal.documentation.seedInitialDocs,
      {},
    );
    expect(secondSeed).toEqual({ inserted: 0, byGroup: {} });

    const amSections = await asUser(t, users.am).query(
      api.documentation.list,
      {},
    );
    expect(amSections).toHaveLength(3);
    expect(amSections.every((section) => section.group === "Team Guide")).toBe(
      true,
    );
    expect(amSections.every((section) => section.visibility === "public")).toBe(
      true,
    );

    const hobSections = await asUser(t, users.hob).query(
      api.documentation.list,
      {},
    );
    expect(hobSections).toHaveLength(11);
    expect(
      hobSections.some(
        (section) =>
          section.group === "Technical Reference" &&
          section.visibility === "restricted",
      ),
    ).toBe(true);

    await expect(
      asUser(t, users.am).query(api.documentation.getBySlug, {
        slug: "deployment-ops",
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "FORBIDDEN" }),
    });

    const restrictedSection = await asUser(t, users.ceo).query(
      api.documentation.getBySlug,
      { slug: "deployment-ops" },
    );
    expect(restrictedSection.visibility).toBe("restricted");
    expect(restrictedSection.group).toBe("Technical Reference");
  });

  it("allows CEO/HOB edits and denies Account Manager edits", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    await t.mutation(internal.documentation.seedInitialDocs, {});

    await expect(
      asUser(t, users.am).mutation(api.documentation.upsert, {
        slug: "am-edit",
        title: "AM Edit",
        group: "Team Guide",
        content: "Should not save",
        order: 99,
        visibility: "public",
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "FORBIDDEN" }),
    });

    await asUser(t, users.hob).mutation(api.documentation.upsert, {
      slug: "release-notes",
      title: "Release Notes",
      group: "Technical Reference",
      content: "## Current Release\n\nInternal update notes.",
      order: 12,
      visibility: "restricted",
    });

    const saved = await asUser(t, users.ceo).query(
      api.documentation.getBySlug,
      { slug: "release-notes" },
    );
    expect(saved.title).toBe("Release Notes");
    expect(saved.updatedByName).toBe("HOB");

    await expect(
      asUser(t, users.am).mutation(api.documentation.remove, {
        slug: "release-notes",
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "FORBIDDEN" }),
    });
  });
});
