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
  ceo: Doc<"users">;
  hob: Doc<"users">;
  gmA: Doc<"users">;
  gmB: Doc<"users">;
  amA: Doc<"users">;
  amB: Doc<"users">;
  companyA: Id<"companies">;
  companyB: Id<"companies">;
  leadA: Id<"leads">;
  quoteA: Id<"quotes">;
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
    });
    const companyB = await ctx.db.insert("companies", {
      name: "Company B",
      sectorId: sector,
      countryId: countryB,
      accountManagerId: amBId,
      contractStatus: "active",
    });
    const leadA = await ctx.db.insert("leads", {
      title: "Lead A",
      companyId: companyA,
      accountManagerId: amAId,
      stage: "new_lead",
      potentialValue: 100,
      expectedCloseDate: "2026-08-15",
    });
    const catalogItemId = await ctx.db.insert("serviceCatalog", {
      serviceCategory: "ECS",
      itemName: "ECS Small",
      billingUnit: "per instance",
      monthlyPrice: 10,
    });
    const quoteA = await ctx.db.insert("quotes", {
      companyId: companyA,
      createdBy: amAId,
      date: "2026-08-01",
      status: "draft",
      lineItems: [
        {
          catalogItemId,
          itemName: "ECS Small",
          serviceCategory: "ECS",
          billingUnit: "per instance",
          quantity: 1,
          monthlyUnitPrice: 10,
          monthlyTotal: 10,
          yearlyTotal: 120,
        },
      ],
      monthlyGrandTotal: 10,
      yearlyGrandTotal: 120,
    });

    return {
      countryA,
      countryB,
      sector,
      ceo: (await ctx.db.get(ceoId))!,
      hob: (await ctx.db.get(hobId))!,
      gmA: (await ctx.db.get(gmAId))!,
      gmB: (await ctx.db.get(gmBId))!,
      amA: (await ctx.db.get(amAId))!,
      amB: (await ctx.db.get(amBId))!,
      companyA,
      companyB,
      leadA,
      quoteA,
    };
  });
}

describe("tasks", () => {
  it("allows an Account Manager to create a task assigned to self", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Follow up on quote",
      assigneeId: s.amA._id,
      companyId: s.companyA,
    });
    const task = await t.run(async (ctx) => await ctx.db.get(taskId));

    expect(task).toMatchObject({
      title: "Follow up on quote",
      status: "todo",
      priority: "medium",
      createdBy: s.amA._id,
      assigneeId: s.amA._id,
      companyId: s.companyA,
    });
  });

  it("blocks Account Managers from assigning tasks to another user", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      asUser(t, s.amA).mutation(api.tasks.create, {
        title: "Assign outside self",
        assigneeId: s.amB._id,
      }),
    ).rejects.toThrow(/assign|FORBIDDEN/i);
  });

  it("allows Country GMs to assign in-country users and blocks outside-country assignment", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await asUser(t, s.gmA).mutation(api.tasks.create, {
      title: "In country follow-up",
      assigneeId: s.amA._id,
    });

    await expect(
      asUser(t, s.gmA).mutation(api.tasks.create, {
        title: "Outside country follow-up",
        assigneeId: s.amB._id,
      }),
    ).rejects.toThrow(/assign|FORBIDDEN/i);
  });

  it("allows CEO and Head of Business to assign broadly", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await asUser(t, s.ceo).mutation(api.tasks.create, {
      title: "CEO assigned task",
      assigneeId: s.amB._id,
    });
    await asUser(t, s.hob).mutation(api.tasks.create, {
      title: "HOB assigned task",
      assigneeId: s.gmB._id,
    });

    const tasks = await asUser(t, s.ceo).query(api.tasks.list, {});
    expect(tasks.map((task) => task.title)).toEqual(
      expect.arrayContaining(["CEO assigned task", "HOB assigned task"]),
    );
  });

  it("scopes Account Manager task visibility to assigned, created, and own-company tasks", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("tasks", {
        title: "Assigned to AM A",
        status: "todo",
        priority: "medium",
        createdBy: s.amB._id,
        assigneeId: s.amA._id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("tasks", {
        title: "Created by AM A",
        status: "todo",
        priority: "medium",
        createdBy: s.amA._id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("tasks", {
        title: "Linked to AM A company",
        status: "todo",
        priority: "medium",
        createdBy: s.amB._id,
        companyId: s.companyA,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("tasks", {
        title: "Outside AM A scope",
        status: "todo",
        priority: "medium",
        createdBy: s.amB._id,
        companyId: s.companyB,
        createdAt: now,
        updatedAt: now,
      });
    });

    const tasks = await asUser(t, s.amA).query(api.tasks.list, {});
    const titles = tasks.map((task) => task.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Assigned to AM A",
        "Created by AM A",
        "Linked to AM A company",
      ]),
    );
    expect(titles).not.toContain("Outside AM A scope");
  });

  it("sets and clears completedAt when task status changes", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Complete task",
      assigneeId: s.amA._id,
    });

    await asUser(t, s.amA).mutation(api.tasks.updateStatus, {
      taskId,
      status: "done",
    });
    let task = await t.run(async (ctx) => await ctx.db.get(taskId));
    expect(task?.status).toBe("done");
    expect(task?.completedAt).toEqual(expect.any(Number));

    await asUser(t, s.amA).mutation(api.tasks.updateStatus, {
      taskId,
      status: "in_progress",
    });
    task = await t.run(async (ctx) => await ctx.db.get(taskId));
    expect(task?.status).toBe("in_progress");
    expect(task?.completedAt).toBeUndefined();
  });

  it("archives tasks and hides them from list by default", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Archive task",
      assigneeId: s.amA._id,
    });

    await asUser(t, s.amA).mutation(api.tasks.archive, { taskId });

    const visibleTasks = await asUser(t, s.amA).query(api.tasks.list, {});
    expect(visibleTasks.map((task) => task._id)).not.toContain(taskId);

    const withArchived = await asUser(t, s.amA).query(api.tasks.list, {
      includeArchived: true,
    });
    expect(withArchived.map((task) => task._id)).toContain(taskId);
  });

  it("requires company access before linking a task to a company", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      asUser(t, s.amA).mutation(api.tasks.create, {
        title: "Out of scope company task",
        companyId: s.companyB,
      }),
    ).rejects.toThrow(/company|permission|FORBIDDEN/i);

    await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "In scope company task",
      companyId: s.companyA,
      leadId: s.leadA,
      quoteId: s.quoteA,
    });
  });
});
