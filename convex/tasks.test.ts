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

async function storeTestFile(
  t: ReturnType<typeof convexTest>,
  body = "test file",
  type = "application/pdf",
) {
  return await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob([body], { type }));
  });
}

async function listNotificationsFor(
  t: ReturnType<typeof convexTest>,
  recipient: Doc<"users">,
) {
  return await asUser(t, recipient).query(api.notifications.listMine, {
    limit: 50,
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
      reportToId: s.amA._id,
      companyId: s.companyA,
    });
  });

  it("creates tasks with explicit valid Report To users", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Report to GM",
      assigneeId: s.amA._id,
      reportToId: s.gmA._id,
    });

    const task = await t.run(async (ctx) => await ctx.db.get(taskId));
    expect(task?.reportToId).toBe(s.gmA._id);
  });

  it("allows Account Managers to report to self their GM HOB and CEO", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    for (const reportTo of [s.amA, s.gmA, s.hob, s.ceo]) {
      await asUser(t, s.amA).mutation(api.tasks.create, {
        title: `Report to ${reportTo.name}`,
        assigneeId: s.amA._id,
        reportToId: reportTo._id,
      });
    }
  });

  it("blocks Account Managers from reporting to unrelated users", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      asUser(t, s.amA).mutation(api.tasks.create, {
        title: "Report outside scope",
        assigneeId: s.amA._id,
        reportToId: s.amB._id,
      }),
    ).rejects.toThrow(/report|FORBIDDEN/i);
    await expect(
      asUser(t, s.amA).mutation(api.tasks.create, {
        title: "Report to other GM",
        assigneeId: s.amA._id,
        reportToId: s.gmB._id,
      }),
    ).rejects.toThrow(/report|FORBIDDEN/i);
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

  it("allows Country GMs to report to in-country users HOB and CEO but not unrelated users", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    for (const reportTo of [s.gmA, s.amA, s.hob, s.ceo]) {
      await asUser(t, s.gmA).mutation(api.tasks.create, {
        title: `GM reports to ${reportTo.name}`,
        assigneeId: s.amA._id,
        reportToId: reportTo._id,
      });
    }

    await expect(
      asUser(t, s.gmA).mutation(api.tasks.create, {
        title: "GM reports outside country",
        assigneeId: s.amA._id,
        reportToId: s.amB._id,
      }),
    ).rejects.toThrow(/report|FORBIDDEN/i);
    await expect(
      asUser(t, s.gmA).mutation(api.tasks.create, {
        title: "GM reports to other GM",
        assigneeId: s.amA._id,
        reportToId: s.gmB._id,
      }),
    ).rejects.toThrow(/report|FORBIDDEN/i);
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

  it("creates task notifications for assignee and Report To while excluding the actor", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await asUser(t, s.ceo).mutation(api.tasks.create, {
      title: "Notify task recipients",
      assigneeId: s.amA._id,
      reportToId: s.amB._id,
    });

    const assigneeNotifications = await listNotificationsFor(t, s.amA);
    const reportToNotifications = await listNotificationsFor(t, s.amB);
    const actorNotifications = await listNotificationsFor(t, s.ceo);
    expect(assigneeNotifications).toMatchObject([
      {
        type: "task_assigned",
        title: "Task assigned to you",
        body: "Notify task recipients",
      },
    ]);
    expect(reportToNotifications).toMatchObject([
      {
        type: "task_report_to",
        title: "You were set as Report To",
        body: "Notify task recipients",
      },
    ]);
    expect(actorNotifications).toEqual([]);
  });

  it("dedupes task creation notifications when assignee and Report To are the same user", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await asUser(t, s.ceo).mutation(api.tasks.create, {
      title: "Single recipient task",
      assigneeId: s.amA._id,
      reportToId: s.amA._id,
    });

    const notifications = await listNotificationsFor(t, s.amA);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "task_assigned",
      title: "Task assigned to you",
    });
  });

  it("does not notify the task creator about their own assignment or report-to", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await asUser(t, s.ceo).mutation(api.tasks.create, {
      title: "Self-owned task",
      assigneeId: s.ceo._id,
      reportToId: s.ceo._id,
    });

    expect(await listNotificationsFor(t, s.ceo)).toEqual([]);
  });

  it("notifies new assignee and Report To users when task assignment fields change", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert("tasks", {
        title: "Reassigned task",
        status: "todo",
        priority: "medium",
        createdBy: s.ceo._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await asUser(t, s.ceo).mutation(api.tasks.update, {
      taskId,
      assigneeId: s.amA._id,
      reportToId: s.amB._id,
    });

    expect(await listNotificationsFor(t, s.amA)).toMatchObject([
      {
        type: "task_assigned",
        title: "Task assigned to you",
        body: "Reassigned task",
      },
    ]);
    expect(await listNotificationsFor(t, s.amB)).toMatchObject([
      {
        type: "task_report_to",
        title: "You were set as Report To",
        body: "Reassigned task",
      },
    ]);
  });

  it("notifies the assignee when task status changes and excludes the actor", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert("tasks", {
        title: "Status task",
        status: "todo",
        priority: "medium",
        createdBy: s.ceo._id,
        assigneeId: s.amA._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await asUser(t, s.ceo).mutation(api.tasks.updateStatus, {
      taskId,
      status: "blocked",
    });

    expect(await listNotificationsFor(t, s.amA)).toMatchObject([
      {
        type: "task_status_changed",
        title: "Task status changed",
        body: "Status task: To Do -> Blocked",
      },
    ]);
    expect(await listNotificationsFor(t, s.ceo)).toEqual([]);
  });

  it("notifies task assignee and Report To when a comment is created with dedupe and actor exclusion", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert("tasks", {
        title: "Commented task",
        status: "todo",
        priority: "medium",
        createdBy: s.ceo._id,
        assigneeId: s.amA._id,
        reportToId: s.amB._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await asUser(t, s.ceo).mutation(api.tasks.createComment, {
      taskId,
      body: "Please review.",
    });

    expect(await listNotificationsFor(t, s.amA)).toMatchObject([
      {
        type: "task_commented",
        title: "New comment on task",
        body: "Commented task",
      },
    ]);
    expect(await listNotificationsFor(t, s.amB)).toMatchObject([
      {
        type: "task_commented",
        title: "New comment on task",
        body: "Commented task",
      },
    ]);
    expect(await listNotificationsFor(t, s.ceo)).toEqual([]);
  });

  it("dedupes comment notifications when assignee and Report To are the same user", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert("tasks", {
        title: "Deduped comment task",
        status: "todo",
        priority: "medium",
        createdBy: s.ceo._id,
        assigneeId: s.amA._id,
        reportToId: s.amA._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await asUser(t, s.ceo).mutation(api.tasks.createComment, {
      taskId,
      body: "One notification only.",
    });

    expect(await listNotificationsFor(t, s.amA)).toHaveLength(1);
  });

  it("allows CEO and Head of Business to report to anyone", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await asUser(t, s.ceo).mutation(api.tasks.create, {
      title: "CEO reports to AM B",
      reportToId: s.amB._id,
    });
    await asUser(t, s.hob).mutation(api.tasks.create, {
      title: "HOB reports to GM B",
      reportToId: s.gmB._id,
    });
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
        title: "Reported to AM A",
        status: "todo",
        priority: "medium",
        createdBy: s.amB._id,
        reportToId: s.amA._id,
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
        "Reported to AM A",
      ]),
    );
    expect(titles).not.toContain("Outside AM A scope");
  });

  it("returns non-archived comment and attachment counts for visible tasks only", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const [visibleStorageId, archivedStorageId, hiddenStorageId] =
      await Promise.all([
        storeTestFile(t, "visible"),
        storeTestFile(t, "archived"),
        storeTestFile(t, "hidden"),
      ]);

    const { visibleTaskId, hiddenTaskId } = await t.run(async (ctx) => {
      const now = Date.now();
      const visibleTaskId = await ctx.db.insert("tasks", {
        title: "Visible counted task",
        status: "todo",
        priority: "medium",
        createdBy: s.amB._id,
        companyId: s.companyA,
        createdAt: now,
        updatedAt: now,
      });
      const hiddenTaskId = await ctx.db.insert("tasks", {
        title: "Hidden counted task",
        status: "todo",
        priority: "medium",
        createdBy: s.amB._id,
        companyId: s.companyB,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert("taskComments", {
        taskId: visibleTaskId,
        body: "Visible comment",
        createdBy: s.amA._id,
        createdAt: now,
      });
      await ctx.db.insert("taskComments", {
        taskId: visibleTaskId,
        body: "Archived comment",
        createdBy: s.amA._id,
        createdAt: now,
        archivedAt: now + 1,
      });
      await ctx.db.insert("taskComments", {
        taskId: hiddenTaskId,
        body: "Hidden comment",
        createdBy: s.amB._id,
        createdAt: now,
      });
      await ctx.db.insert("taskAttachments", {
        taskId: visibleTaskId,
        storageId: visibleStorageId,
        fileName: "visible.pdf",
        mimeType: "application/pdf",
        size: 100,
        uploadedBy: s.amA._id,
        uploadedAt: now,
      });
      await ctx.db.insert("taskAttachments", {
        taskId: visibleTaskId,
        storageId: archivedStorageId,
        fileName: "archived.pdf",
        mimeType: "application/pdf",
        size: 100,
        uploadedBy: s.amA._id,
        uploadedAt: now,
        archivedAt: now + 1,
      });
      await ctx.db.insert("taskAttachments", {
        taskId: hiddenTaskId,
        storageId: hiddenStorageId,
        fileName: "hidden.pdf",
        mimeType: "application/pdf",
        size: 100,
        uploadedBy: s.amB._id,
        uploadedAt: now,
      });

      return { visibleTaskId, hiddenTaskId };
    });

    const tasks = await asUser(t, s.amA).query(api.tasks.list, {});
    const visibleTask = tasks.find((task) => task._id === visibleTaskId);

    expect(visibleTask).toMatchObject({
      commentCount: 1,
      attachmentCount: 1,
    });
    expect(tasks.map((task) => task._id)).not.toContain(hiddenTaskId);
  });

  it("gets a visible task by id", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Readable task",
      assigneeId: s.amA._id,
      companyId: s.companyA,
    });

    const task = await asUser(t, s.amA).query(api.tasks.get, { taskId });

    expect(task).toMatchObject({
      _id: taskId,
      title: "Readable task",
      assigneeId: s.amA._id,
    });
  });

  it("blocks get for out-of-scope tasks", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const hiddenTaskId = await asUser(t, s.amB).mutation(api.tasks.create, {
      title: "Hidden task",
      assigneeId: s.amB._id,
      companyId: s.companyB,
    });

    await expect(
      asUser(t, s.amA).query(api.tasks.get, { taskId: hiddenTaskId }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("validates Report To changes on update", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Update report target",
      assigneeId: s.amA._id,
    });

    await asUser(t, s.amA).mutation(api.tasks.update, {
      taskId,
      reportToId: s.gmA._id,
    });
    let task = await t.run(async (ctx) => await ctx.db.get(taskId));
    expect(task?.reportToId).toBe(s.gmA._id);

    await expect(
      asUser(t, s.amA).mutation(api.tasks.update, {
        taskId,
        reportToId: s.amB._id,
      }),
    ).rejects.toThrow(/report|FORBIDDEN/i);

    task = await t.run(async (ctx) => await ctx.db.get(taskId));
    expect(task?.reportToId).toBe(s.gmA._id);
  });

  it("lists Report To candidates by role scope", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const amCandidates = await asUser(t, s.amA).query(
      api.tasks.listReportToCandidates,
      {},
    );
    expect(amCandidates.map((user) => user._id)).toEqual(
      expect.arrayContaining([s.amA._id, s.gmA._id, s.hob._id, s.ceo._id]),
    );
    expect(amCandidates.map((user) => user._id)).not.toEqual(
      expect.arrayContaining([s.amB._id, s.gmB._id]),
    );

    const gmCandidates = await asUser(t, s.gmA).query(
      api.tasks.listReportToCandidates,
      {},
    );
    expect(gmCandidates.map((user) => user._id)).toEqual(
      expect.arrayContaining([s.gmA._id, s.amA._id, s.hob._id, s.ceo._id]),
    );
    expect(gmCandidates.map((user) => user._id)).not.toEqual(
      expect.arrayContaining([s.amB._id, s.gmB._id]),
    );

    const hobCandidates = await asUser(t, s.hob).query(
      api.tasks.listReportToCandidates,
      {},
    );
    expect(hobCandidates.map((user) => user._id)).toEqual(
      expect.arrayContaining([
        s.ceo._id,
        s.hob._id,
        s.gmA._id,
        s.gmB._id,
        s.amA._id,
        s.amB._id,
      ]),
    );
  });

  it("lists comments for visible tasks and blocks hidden task comments", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const { visibleTaskId, hiddenTaskId } = await t.run(async (ctx) => {
      const now = Date.now();
      const visibleTaskId = await ctx.db.insert("tasks", {
        title: "Visible task",
        status: "todo",
        priority: "medium",
        createdBy: s.amA._id,
        assigneeId: s.amA._id,
        reportToId: s.amA._id,
        createdAt: now,
        updatedAt: now,
      });
      const hiddenTaskId = await ctx.db.insert("tasks", {
        title: "Hidden task",
        status: "todo",
        priority: "medium",
        createdBy: s.amB._id,
        assigneeId: s.amB._id,
        reportToId: s.amB._id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("taskComments", {
        taskId: visibleTaskId,
        body: "Second comment",
        createdBy: s.amA._id,
        createdAt: now + 2,
      });
      await ctx.db.insert("taskComments", {
        taskId: visibleTaskId,
        body: "First comment",
        createdBy: s.amA._id,
        createdAt: now + 1,
      });
      await ctx.db.insert("taskComments", {
        taskId: visibleTaskId,
        body: "Archived comment",
        createdBy: s.amA._id,
        createdAt: now,
        archivedAt: now + 3,
      });
      return { visibleTaskId, hiddenTaskId };
    });

    const comments = await asUser(t, s.amA).query(api.tasks.listComments, {
      taskId: visibleTaskId,
    });
    expect(comments.map((comment) => comment.body)).toEqual([
      "First comment",
      "Second comment",
    ]);

    await expect(
      asUser(t, s.amA).query(api.tasks.listComments, {
        taskId: hiddenTaskId,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("creates comments only on visible tasks and rejects empty or too-long bodies", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Commentable task",
      assigneeId: s.amA._id,
    });

    const commentId = await asUser(t, s.amA).mutation(
      api.tasks.createComment,
      {
        taskId,
        body: "  Initial progress update.  ",
      },
    );
    const comment = await t.run(async (ctx) => await ctx.db.get(commentId));
    expect(comment).toMatchObject({
      taskId,
      body: "Initial progress update.",
      createdBy: s.amA._id,
    });

    await expect(
      asUser(t, s.amA).mutation(api.tasks.createComment, {
        taskId,
        body: "   ",
      }),
    ).rejects.toThrow(/required|BAD_REQUEST/i);

    await expect(
      asUser(t, s.amA).mutation(api.tasks.createComment, {
        taskId,
        body: "x".repeat(2001),
      }),
    ).rejects.toThrow(/2000|BAD_REQUEST/i);

    await expect(
      asUser(t, s.amB).mutation(api.tasks.createComment, {
        taskId,
        body: "I should not see this task.",
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("lets comment creators edit and archive their own comments", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Own comment task",
      assigneeId: s.amA._id,
    });
    const commentId = await asUser(t, s.amA).mutation(
      api.tasks.createComment,
      {
        taskId,
        body: "Initial update",
      },
    );

    await asUser(t, s.amA).mutation(api.tasks.updateComment, {
      commentId,
      body: "  Edited update  ",
    });
    let comment = await t.run(async (ctx) => await ctx.db.get(commentId));
    expect(comment).toMatchObject({
      body: "Edited update",
      updatedAt: expect.any(Number),
    });

    await asUser(t, s.amA).mutation(api.tasks.archiveComment, { commentId });
    comment = await t.run(async (ctx) => await ctx.db.get(commentId));
    expect(comment?.archivedAt).toEqual(expect.any(Number));
    const comments = await asUser(t, s.amA).query(api.tasks.listComments, {
      taskId,
    });
    expect(comments).toHaveLength(0);
  });

  it("blocks other Account Managers from editing or archiving someone else's visible comment", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const { commentId } = await t.run(async (ctx) => {
      const now = Date.now();
      const taskId = await ctx.db.insert("tasks", {
        title: "Reported task",
        status: "todo",
        priority: "medium",
        createdBy: s.amA._id,
        reportToId: s.amB._id,
        createdAt: now,
        updatedAt: now,
      });
      const commentId = await ctx.db.insert("taskComments", {
        taskId,
        body: "Creator-owned comment",
        createdBy: s.amA._id,
        createdAt: now,
      });
      return { taskId, commentId };
    });

    await expect(
      asUser(t, s.amB).mutation(api.tasks.updateComment, {
        commentId,
        body: "Edited by someone else",
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
    await expect(
      asUser(t, s.amB).mutation(api.tasks.archiveComment, { commentId }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("allows HOB and CEO to edit and archive comments", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const { ceoCommentId, hobCommentId } = await t.run(async (ctx) => {
      const now = Date.now();
      const taskId = await ctx.db.insert("tasks", {
        title: "Moderated task",
        status: "todo",
        priority: "medium",
        createdBy: s.amA._id,
        reportToId: s.amA._id,
        createdAt: now,
        updatedAt: now,
      });
      const ceoCommentId = await ctx.db.insert("taskComments", {
        taskId,
        body: "Needs CEO moderation",
        createdBy: s.amA._id,
        createdAt: now,
      });
      const hobCommentId = await ctx.db.insert("taskComments", {
        taskId,
        body: "Needs HOB moderation",
        createdBy: s.amA._id,
        createdAt: now + 1,
      });
      return { ceoCommentId, hobCommentId };
    });

    await asUser(t, s.ceo).mutation(api.tasks.updateComment, {
      commentId: ceoCommentId,
      body: "CEO edited",
    });
    await asUser(t, s.hob).mutation(api.tasks.archiveComment, {
      commentId: hobCommentId,
    });

    const comments = await t.run(async (ctx) => {
      return {
        ceo: await ctx.db.get(ceoCommentId),
        hob: await ctx.db.get(hobCommentId),
      };
    });
    expect(comments.ceo?.body).toBe("CEO edited");
    expect(comments.hob?.archivedAt).toEqual(expect.any(Number));
  });

  it("requires auth before generating attachment upload URLs", async () => {
    const t = convexTest(schema, modules);
    await seed(t);

    await expect(
      t.mutation(api.tasks.generateAttachmentUploadUrl, {}),
    ).rejects.toThrow(/logged in|UNAUTHENTICATED/i);
  });

  it("saves attachment metadata for visible tasks", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Attachment task",
      assigneeId: s.amA._id,
    });
    const storageId = await storeTestFile(t);

    const attachmentId = await asUser(t, s.amA).mutation(
      api.tasks.saveAttachmentMetadata,
      {
        taskId,
        storageId,
        fileName: "  invoice.pdf  ",
        mimeType: "application/pdf",
        size: 1024,
      },
    );

    const attachment = await t.run(
      async (ctx) => await ctx.db.get(attachmentId),
    );
    expect(attachment).toMatchObject({
      taskId,
      storageId,
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
      size: 1024,
      uploadedBy: s.amA._id,
      uploadedAt: expect.any(Number),
    });
  });

  it("rejects attachment metadata for hidden tasks", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amB).mutation(api.tasks.create, {
      title: "Hidden attachment task",
      assigneeId: s.amB._id,
      companyId: s.companyB,
    });
    const storageId = await storeTestFile(t);

    await expect(
      asUser(t, s.amA).mutation(api.tasks.saveAttachmentMetadata, {
        taskId,
        storageId,
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
        size: 1024,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("rejects disallowed attachment MIME types and oversized files", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Attachment validation task",
      assigneeId: s.amA._id,
    });
    const storageId = await storeTestFile(t);

    await expect(
      asUser(t, s.amA).mutation(api.tasks.saveAttachmentMetadata, {
        taskId,
        storageId,
        fileName: "danger.svg",
        mimeType: "image/svg+xml",
        size: 1024,
      }),
    ).rejects.toThrow(/file type|BAD_REQUEST/i);

    await expect(
      asUser(t, s.amA).mutation(api.tasks.saveAttachmentMetadata, {
        taskId,
        storageId,
        fileName: "large.pdf",
        mimeType: "application/pdf",
        size: 10 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow(/10 MB|BAD_REQUEST/i);
  });

  it("lists only non-archived attachments for visible tasks", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "List attachments task",
      assigneeId: s.amA._id,
    });
    const [firstStorageId, secondStorageId, archivedStorageId] =
      await Promise.all([
        storeTestFile(t, "first"),
        storeTestFile(t, "second"),
        storeTestFile(t, "archived"),
      ]);

    await asUser(t, s.amA).mutation(api.tasks.saveAttachmentMetadata, {
      taskId,
      storageId: firstStorageId,
      fileName: "first.pdf",
      mimeType: "application/pdf",
      size: 100,
    });
    await asUser(t, s.amA).mutation(api.tasks.saveAttachmentMetadata, {
      taskId,
      storageId: archivedStorageId,
      fileName: "archived.pdf",
      mimeType: "application/pdf",
      size: 100,
    });
    const secondAttachmentId = await asUser(t, s.amA).mutation(
      api.tasks.saveAttachmentMetadata,
      {
        taskId,
        storageId: secondStorageId,
        fileName: "second.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );
    await asUser(t, s.amA).mutation(api.tasks.archiveAttachment, {
      attachmentId: secondAttachmentId,
    });

    const attachments = await asUser(t, s.amA).query(
      api.tasks.listAttachments,
      { taskId },
    );
    expect(attachments.map((attachment) => attachment.fileName)).toEqual([
      "first.pdf",
      "archived.pdf",
    ]);

    await expect(
      asUser(t, s.amB).query(api.tasks.listAttachments, { taskId }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("requires task access before returning attachment download URLs", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await asUser(t, s.amA).mutation(api.tasks.create, {
      title: "Download attachment task",
      assigneeId: s.amA._id,
    });
    const storageId = await storeTestFile(t);
    const attachmentId = await asUser(t, s.amA).mutation(
      api.tasks.saveAttachmentMetadata,
      {
        taskId,
        storageId,
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );

    const url = await asUser(t, s.amA).query(
      api.tasks.getAttachmentDownloadUrl,
      { attachmentId },
    );
    expect(url).toContain("/api/storage/");

    await expect(
      asUser(t, s.amB).query(api.tasks.getAttachmentDownloadUrl, {
        attachmentId,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);
  });

  it("archives attachments for uploaders HOB and CEO but not unrelated Account Managers", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const taskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("tasks", {
        title: "Archive attachments task",
        status: "todo",
        priority: "medium",
        createdBy: s.amA._id,
        reportToId: s.amB._id,
        createdAt: now,
        updatedAt: now,
      });
    });
    const [uploaderStorageId, hobStorageId, ceoStorageId, otherStorageId] =
      await Promise.all([
        storeTestFile(t, "uploader"),
        storeTestFile(t, "hob"),
        storeTestFile(t, "ceo"),
        storeTestFile(t, "other"),
      ]);

    const uploaderAttachmentId = await asUser(t, s.amA).mutation(
      api.tasks.saveAttachmentMetadata,
      {
        taskId,
        storageId: uploaderStorageId,
        fileName: "uploader.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );
    const hobAttachmentId = await asUser(t, s.amA).mutation(
      api.tasks.saveAttachmentMetadata,
      {
        taskId,
        storageId: hobStorageId,
        fileName: "hob.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );
    const ceoAttachmentId = await asUser(t, s.amA).mutation(
      api.tasks.saveAttachmentMetadata,
      {
        taskId,
        storageId: ceoStorageId,
        fileName: "ceo.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );
    const otherAttachmentId = await asUser(t, s.amA).mutation(
      api.tasks.saveAttachmentMetadata,
      {
        taskId,
        storageId: otherStorageId,
        fileName: "other.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );

    await asUser(t, s.amA).mutation(api.tasks.archiveAttachment, {
      attachmentId: uploaderAttachmentId,
    });
    await asUser(t, s.hob).mutation(api.tasks.archiveAttachment, {
      attachmentId: hobAttachmentId,
    });
    await asUser(t, s.ceo).mutation(api.tasks.archiveAttachment, {
      attachmentId: ceoAttachmentId,
    });
    await expect(
      asUser(t, s.amB).mutation(api.tasks.archiveAttachment, {
        attachmentId: otherAttachmentId,
      }),
    ).rejects.toThrow(/permission|FORBIDDEN/i);

    const archived = await t.run(async (ctx) => ({
      uploader: await ctx.db.get(uploaderAttachmentId),
      hob: await ctx.db.get(hobAttachmentId),
      ceo: await ctx.db.get(ceoAttachmentId),
      other: await ctx.db.get(otherAttachmentId),
    }));
    expect(archived.uploader?.archivedBy).toBe(s.amA._id);
    expect(archived.hob?.archivedBy).toBe(s.hob._id);
    expect(archived.ceo?.archivedBy).toBe(s.ceo._id);
    expect(archived.other?.archivedAt).toBeUndefined();
  });

  it("requires comment attachments to target a live comment on the same task", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const { taskId, otherTaskId, commentId, otherCommentId, archivedCommentId } =
      await t.run(async (ctx) => {
        const now = Date.now();
        const taskId = await ctx.db.insert("tasks", {
          title: "Comment attachment task",
          status: "todo",
          priority: "medium",
          createdBy: s.amA._id,
          assigneeId: s.amA._id,
          createdAt: now,
          updatedAt: now,
        });
        const otherTaskId = await ctx.db.insert("tasks", {
          title: "Other task",
          status: "todo",
          priority: "medium",
          createdBy: s.amA._id,
          assigneeId: s.amA._id,
          createdAt: now,
          updatedAt: now,
        });
        const commentId = await ctx.db.insert("taskComments", {
          taskId,
          body: "Live comment",
          createdBy: s.amA._id,
          createdAt: now,
        });
        const otherCommentId = await ctx.db.insert("taskComments", {
          taskId: otherTaskId,
          body: "Wrong task comment",
          createdBy: s.amA._id,
          createdAt: now,
        });
        const archivedCommentId = await ctx.db.insert("taskComments", {
          taskId,
          body: "Archived comment",
          createdBy: s.amA._id,
          createdAt: now,
          archivedAt: now + 1,
        });
        return {
          taskId,
          otherTaskId,
          commentId,
          otherCommentId,
          archivedCommentId,
        };
      });
    const [validStorageId, wrongStorageId, archivedStorageId] =
      await Promise.all([
        storeTestFile(t, "valid"),
        storeTestFile(t, "wrong"),
        storeTestFile(t, "archived"),
      ]);

    const attachmentId = await asUser(t, s.amA).mutation(
      api.tasks.saveAttachmentMetadata,
      {
        taskId,
        commentId,
        storageId: validStorageId,
        fileName: "comment.pdf",
        mimeType: "application/pdf",
        size: 100,
      },
    );
    const commentAttachments = await asUser(t, s.amA).query(
      api.tasks.listAttachments,
      { taskId, commentId },
    );
    expect(commentAttachments.map((attachment) => attachment._id)).toEqual([
      attachmentId,
    ]);

    await expect(
      asUser(t, s.amA).mutation(api.tasks.saveAttachmentMetadata, {
        taskId,
        commentId: otherCommentId,
        storageId: wrongStorageId,
        fileName: "wrong.pdf",
        mimeType: "application/pdf",
        size: 100,
      }),
    ).rejects.toThrow(/same task|BAD_REQUEST/i);

    await expect(
      asUser(t, s.amA).mutation(api.tasks.saveAttachmentMetadata, {
        taskId,
        commentId: archivedCommentId,
        storageId: archivedStorageId,
        fileName: "archived.pdf",
        mimeType: "application/pdf",
        size: 100,
      }),
    ).rejects.toThrow(/archived comment|BAD_REQUEST/i);

    await expect(
      asUser(t, s.amA).query(api.tasks.listAttachments, {
        taskId: otherTaskId,
        commentId,
      }),
    ).rejects.toThrow(/same task|BAD_REQUEST/i);
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
