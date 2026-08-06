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
      inserted: 12,
      byGroup: {
        "Team Guide": 3,
        "Technical Reference": 9,
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
    expect(hobSections).toHaveLength(12);
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

  it("syncs missing page documentation without overwriting existing live content", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    await t.mutation(internal.documentation.seedInitialDocs, {});
    await t.mutation(internal.documentation.replaceNavigationSection, {});

    await asUser(t, users.hob).mutation(api.documentation.upsert, {
      slug: "page-quotes",
      title: "Quotes",
      group: "Team Guide",
      content: "Live production quote guide",
      order: 9,
      visibility: "public",
    });
    await t.run(async (ctx) => {
      const invoices = await ctx.db
        .query("documentationSections")
        .withIndex("by_slug", (q) => q.eq("slug", "page-invoices"))
        .unique();
      if (invoices) {
        await ctx.db.delete(invoices._id);
      }
      const cloudAdvisor = await ctx.db
        .query("documentationSections")
        .withIndex("by_slug", (q) => q.eq("slug", "page-ai-recs"))
        .unique();
      if (cloudAdvisor) {
        await ctx.db.patch(cloudAdvisor._id, { order: 10 });
      }
    });

    await expect(
      asUser(t, users.am).mutation(api.documentation.syncPageDocumentationSections, {}),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "FORBIDDEN" }),
    });

    const result = await asUser(t, users.ceo).mutation(
      api.documentation.syncPageDocumentationSections,
      {},
    );
    expect(result.inserted).toEqual(["page-invoices"]);
    expect(result.updated).toContain("page-ai-recs");

    const quotes = await asUser(t, users.ceo).query(
      api.documentation.getBySlug,
      { slug: "page-quotes" },
    );
    expect(quotes.content).toBe("Live production quote guide");

    const invoices = await asUser(t, users.ceo).query(
      api.documentation.getBySlug,
      { slug: "page-invoices" },
    );
    expect(invoices.title).toBe("Invoices");
    expect(invoices.order).toBe(10);
    expect(invoices.content).toContain("Invoice System Overview");

    const cloudAdvisor = await asUser(t, users.ceo).query(
      api.documentation.getBySlug,
      { slug: "page-ai-recs" },
    );
    expect(cloudAdvisor.order).toBe(12);
  });

  it("syncs only the invoices documentation body from the seed", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    await t.mutation(internal.documentation.seedInitialDocs, {});
    await t.mutation(internal.documentation.replaceNavigationSection, {});

    await asUser(t, users.hob).mutation(api.documentation.upsert, {
      slug: "page-invoices",
      title: "Old Invoice Title",
      group: "Team Guide",
      content: "Old live invoice guide",
      order: 99,
      visibility: "public",
    });
    await asUser(t, users.hob).mutation(api.documentation.upsert, {
      slug: "page-quotes",
      title: "Quotes",
      group: "Team Guide",
      content: "Live production quote guide",
      order: 9,
      visibility: "public",
    });

    await expect(
      asUser(t, users.am).mutation(
        api.documentation.syncInvoicesDocumentationFromSeed,
        {},
      ),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "FORBIDDEN" }),
    });

    const result = await asUser(t, users.ceo).mutation(
      api.documentation.syncInvoicesDocumentationFromSeed,
      {},
    );
    expect(result).toEqual({
      inserted: false,
      slug: "page-invoices",
      updated: ["title", "order", "content"],
    });

    const invoices = await asUser(t, users.ceo).query(
      api.documentation.getBySlug,
      { slug: "page-invoices" },
    );
    expect(invoices.title).toBe("Invoices");
    expect(invoices.order).toBe(10);
    expect(invoices.content).toContain("Admin Invoice Cleanup Tutorial");

    const quotes = await asUser(t, users.ceo).query(
      api.documentation.getBySlug,
      { slug: "page-quotes" },
    );
    expect(quotes.content).toBe("Live production quote guide");
  });

  it("syncs only the finance documentation body from the seed", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    await t.mutation(internal.documentation.seedInitialDocs, {});
    await t.mutation(internal.documentation.replaceNavigationSection, {});

    await asUser(t, users.hob).mutation(api.documentation.upsert, {
      slug: "page-finance",
      title: "Old Finance Title",
      group: "Team Guide",
      content: "Old live finance guide",
      order: 99,
      visibility: "public",
    });
    await asUser(t, users.hob).mutation(api.documentation.upsert, {
      slug: "page-invoices",
      title: "Invoices",
      group: "Team Guide",
      content: "Live production invoice guide",
      order: 10,
      visibility: "public",
    });

    await expect(
      asUser(t, users.am).mutation(
        api.documentation.syncFinanceDocumentationFromSeed,
        {},
      ),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "FORBIDDEN" }),
    });

    const result = await asUser(t, users.ceo).mutation(
      api.documentation.syncFinanceDocumentationFromSeed,
      {},
    );
    expect(result).toEqual({
      inserted: false,
      slug: "page-finance",
      updated: ["title", "order", "content"],
    });

    const finance = await asUser(t, users.ceo).query(
      api.documentation.getBySlug,
      { slug: "page-finance" },
    );
    expect(finance.title).toBe("Finance");
    expect(finance.order).toBe(11);
    expect(finance.content).toContain("Finance Overview");
    expect(finance.content).toContain("CSV Exports");

    const invoices = await asUser(t, users.ceo).query(
      api.documentation.getBySlug,
      { slug: "page-invoices" },
    );
    expect(invoices.content).toBe("Live production invoice guide");
  });

  it("replaces the navigation section with idempotent per-page guides", async () => {
    const t = convexTest(schema, modules);
    const users = await seedUsers(t);
    await t.mutation(internal.documentation.seedInitialDocs, {});

    const firstRun = await t.mutation(
      internal.documentation.replaceNavigationSection,
      {},
    );
    expect(firstRun.removed).toBe(true);
    expect(firstRun.inserted).toEqual([
      "page-dashboard",
      "page-companies",
      "page-pipeline",
      "page-targets",
      "page-pace",
      "page-usage",
      "page-at-risk",
      "page-quotes",
      "page-invoices",
      "page-finance",
      "page-ai-recs",
      "page-coach",
      "page-activities",
      "page-manageone",
      "page-cloud-health",
      "page-tasks",
      "page-team",
      "page-settings",
    ]);

    const amSections = await asUser(t, users.am).query(
      api.documentation.list,
      {},
    );
    expect(amSections.map((section) => section.slug).slice(0, 20)).toEqual([
      "roles-and-access",
      ...firstRun.inserted,
      "common-workflows",
    ]);
    expect(
      amSections.some((section) => section.slug === "navigating-the-crm"),
    ).toBe(false);

    const commonWorkflows = amSections.find(
      (section) => section.slug === "common-workflows",
    );
    expect(commonWorkflows?.order).toBe(20);

    const dashboard = await asUser(t, users.am).query(
      api.documentation.getBySlug,
      { slug: "page-dashboard" },
    );
    expect(dashboard.group).toBe("Team Guide");
    expect(dashboard.visibility).toBe("public");
    expect(dashboard.content).toContain("The Dashboard is your personal");

    const tasks = await asUser(t, users.am).query(api.documentation.getBySlug, {
      slug: "page-tasks",
    });
    expect(tasks.group).toBe("Team Guide");
    expect(tasks.visibility).toBe("public");
    expect(tasks.order).toBe(17);
    expect(tasks.content).toContain("Tasks helps the team");

    const finance = await asUser(t, users.am).query(
      api.documentation.getBySlug,
      { slug: "page-finance" },
    );
    expect(finance.group).toBe("Team Guide");
    expect(finance.visibility).toBe("public");
    expect(finance.content).toContain("Finance is where the CRM handles");
    expect(finance.content).toContain("Income by Region / Data Center");
    expect(finance.content).toContain("Export Region Income CSV");
    expect(finance.content).toContain("Unassigned means the invoice is old");

    const invoices = await asUser(t, users.am).query(
      api.documentation.getBySlug,
      { slug: "page-invoices" },
    );
    expect(invoices.content).toContain("Invoice Profiles live under Finance");
    expect(invoices.content).toContain("Company country profile");
    expect(invoices.content).toContain("Resource region and data center split");
    expect(invoices.content).toContain("Hoa-Mogadishu-2");

    const secondRun = await t.mutation(
      internal.documentation.replaceNavigationSection,
      {},
    );
    expect(secondRun).toEqual({ removed: false, inserted: [] });
  });
});
