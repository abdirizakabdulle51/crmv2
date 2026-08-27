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
  return await t.run(async (ctx) => {
    const month = new Date().toISOString().slice(0, 7);
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
    const gmId = await ctx.db.insert("users", {
      name: "Somalia GM",
      tokenIdentifier: "gm-token",
      role: "country_gm",
      countryId: countryA,
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
      name: "AICC",
      sectorId: sector,
      countryId: countryA,
      accountManagerId: amAId,
      contractStatus: "active",
    });
    const companyB = await ctx.db.insert("companies", {
      name: "Safari",
      sectorId: sector,
      countryId: countryB,
      accountManagerId: amBId,
      contractStatus: "pending",
    });
    const backupCatalogId = await ctx.db.insert("serviceCatalog", {
      serviceCategory: "CSBS",
      itemName: "Cloud Backup",
      billingUnit: "GB/month",
      monthlyPrice: 0.02,
    });
    await ctx.db.insert("serviceCatalog", {
      serviceCategory: "OBS",
      itemName: "Object Storage",
      billingUnit: "GB/month",
      monthlyPrice: 0.01,
    });

    await ctx.db.insert("leads", {
      title: "AICC Expansion",
      companyId: companyA,
      accountManagerId: amAId,
      stage: "proposal",
      potentialValue: 5000,
      expectedCloseDate: "2026-08-01",
    });
    await ctx.db.insert("leads", {
      title: "AICC Won Deal",
      companyId: companyA,
      accountManagerId: amAId,
      stage: "won",
      potentialValue: 7000,
      expectedCloseDate: "2026-07-01",
    });
    await ctx.db.insert("leads", {
      title: "Safari Expansion",
      companyId: companyB,
      accountManagerId: amBId,
      stage: "qualified",
      potentialValue: 9000,
      expectedCloseDate: "2026-08-01",
    });
    await ctx.db.insert("leads", {
      title: "Safari Won Deal",
      companyId: companyB,
      accountManagerId: amBId,
      stage: "won",
      potentialValue: 11000,
      expectedCloseDate: "2026-07-01",
    });

    await ctx.db.insert("salesTargets", {
      accountManagerId: amAId,
      year: 2026,
      quarter: 1,
      target: 10000,
    });
    await ctx.db.insert("salesTargets", {
      accountManagerId: amBId,
      year: 2026,
      quarter: 1,
      target: 20000,
    });

    await ctx.db.insert("consumption", {
      companyId: companyA,
      month: "2026-05",
      serviceType: "EVS",
      amount: 300,
      quantity: 1000,
    });
    await ctx.db.insert("consumption", {
      companyId: companyA,
      month: "2026-06",
      serviceType: "EVS",
      amount: 200,
      quantity: 1000,
    });
    await ctx.db.insert("consumption", {
      companyId: companyA,
      month,
      serviceType: "ECS",
      amount: 70,
      quantity: 2,
    });
    await ctx.db.insert("consumption", {
      companyId: companyA,
      month,
      serviceType: "EVS",
      amount: 30,
      quantity: 1000,
    });
    await ctx.db.insert("consumption", {
      companyId: companyB,
      month,
      serviceType: "ECS",
      amount: 400,
      quantity: 4,
    });

    await ctx.db.insert("quotes", {
      companyId: companyA,
      createdBy: amAId,
      date: "2026-07-20",
      status: "draft",
      lineItems: [
        {
          catalogItemId: backupCatalogId,
          itemName: "Cloud Backup",
          serviceCategory: "CSBS",
          billingUnit: "GB/month",
          quantity: 1000,
          monthlyUnitPrice: 0.02,
          monthlyTotal: 20,
          yearlyTotal: 240,
        },
      ],
      monthlyGrandTotal: 20,
      yearlyGrandTotal: 240,
    });
    await ctx.db.insert("quotes", {
      companyId: companyB,
      createdBy: amBId,
      date: "2026-07-20",
      status: "accepted",
      lineItems: [
        {
          catalogItemId: backupCatalogId,
          itemName: "Cloud Backup",
          serviceCategory: "CSBS",
          billingUnit: "GB/month",
          quantity: 1000,
          monthlyUnitPrice: 0.02,
          monthlyTotal: 20,
          yearlyTotal: 240,
        },
      ],
      monthlyGrandTotal: 20,
      yearlyGrandTotal: 240,
    });

    await ctx.db.insert("cloudCapacityRegions", {
      regionId: "som-1",
      regionName: "Somalia Region",
      cpuUsed: 40,
      cpuTotal: 100,
      memoryUsedGb: 75,
      memoryTotalGb: 100,
      storageUsedGb: 95,
      storageTotalGb: 100,
      lastSyncedAt: Date.now(),
    });
    const pingTargetA = await ctx.db.insert("pingTargets", {
      name: "ISP A",
      ip: "203.0.113.1",
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("pingTargets", {
      name: "ISP B",
      ip: "203.0.113.2",
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("pingResults", {
      targetId: pingTargetA,
      success: false,
      error: "timeout",
      checkedAt: Date.now(),
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = today.getTime() + 24 * 60 * 60 * 1000;
    const yesterday = today.getTime() - 24 * 60 * 60 * 1000;
    await ctx.db.insert("tasks", {
      title: "CEO dashboard task",
      status: "todo",
      priority: "medium",
      createdBy: ceoId,
      assigneeId: ceoId,
      dueDate: tomorrow,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("tasks", {
      title: "AM due task",
      status: "todo",
      priority: "medium",
      createdBy: amAId,
      assigneeId: amAId,
      dueDate: tomorrow,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("tasks", {
      title: "AM overdue task",
      status: "todo",
      priority: "high",
      createdBy: amAId,
      assigneeId: amAId,
      dueDate: yesterday,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("tasks", {
      title: "AM blocked task",
      status: "blocked",
      priority: "urgent",
      createdBy: amAId,
      assigneeId: amAId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("tasks", {
      title: "Done task excluded",
      status: "done",
      priority: "medium",
      createdBy: amAId,
      assigneeId: amAId,
      dueDate: yesterday,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    await ctx.db.insert("tasks", {
      title: "Canceled task excluded",
      status: "canceled",
      priority: "medium",
      createdBy: amAId,
      assigneeId: amAId,
      dueDate: tomorrow,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("tasks", {
      title: "Archived task excluded",
      status: "todo",
      priority: "medium",
      createdBy: amAId,
      assigneeId: amAId,
      dueDate: tomorrow,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      archivedAt: Date.now(),
    });
    await ctx.db.insert("tasks", {
      title: "Out of scope task",
      status: "todo",
      priority: "medium",
      createdBy: amBId,
      assigneeId: amBId,
      dueDate: tomorrow,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      ceo: (await ctx.db.get(ceoId))!,
      gm: (await ctx.db.get(gmId))!,
      amA: (await ctx.db.get(amAId))!,
    };
  });
}

describe("dashboard.summary", () => {
  it("combines top-level metrics for all data visible to a CEO", async () => {
    const t = convexTest(schema, modules);
    const users = await seed(t);

    const summary = await asUser(t, users.ceo).query(api.dashboard.summary, {
      year: 2026,
    });

    expect(summary.companies).toEqual({ total: 2, activeContracts: 1 });
    expect(summary.leads).toMatchObject({
      active: 2,
      won: 2,
      wonValue: 18000,
    });
    expect(summary.targets).toMatchObject({
      target: 30000,
      achieved: 0,
      achievementPercent: 0,
    });
    expect(summary.pipeline.stageCounts).toMatchObject({
      proposal: 1,
      qualified: 1,
      won: 2,
    });
    expect(summary.pipeline.value).toBe(14000);
    expect(summary.usage.total).toBe(500);
    expect(summary.quotes).toMatchObject({
      total: 2,
      draft: 1,
      accepted: 1,
      monthlyValue: 40,
      acceptedMonthlyValue: 20,
    });
    expect(summary.aiRecommendations.openOpportunityCount).toBeGreaterThan(0);
    expect(summary.aiRecommendations.estimatedMonthlyValue).toBeGreaterThan(0);
    expect(summary.atRisk.count).toBe(1);
    expect(summary.tasks).toEqual({
      myOpen: 1,
      overdue: 0,
      dueThisWeek: 1,
      blocked: 0,
    });
    expect(summary.cloudHealth).toMatchObject({
      regions: 1,
      criticalRegions: 1,
      activePingTargets: 2,
      upPingTargets: 1,
      downPingTargets: 1,
    });
  });

  it("scopes the summary to a Country GM country and keeps Cloud Health visible", async () => {
    const t = convexTest(schema, modules);
    const users = await seed(t);

    const summary = await asUser(t, users.gm).query(api.dashboard.summary, {
      year: 2026,
    });

    expect(summary.companies.total).toBe(1);
    expect(summary.leads).toMatchObject({
      active: 1,
      won: 1,
      wonValue: 7000,
    });
    expect(summary.targets).toMatchObject({
      target: 10000,
      achieved: 0,
      achievementPercent: 0,
    });
    expect(summary.pipeline.value).toBe(5000);
    expect(summary.usage.total).toBe(100);
    expect(summary.quotes.total).toBe(1);
    expect(summary.tasks).toEqual({
      myOpen: 0,
      overdue: 0,
      dueThisWeek: 0,
      blocked: 0,
    });
    expect(summary.cloudHealth?.regions).toBe(1);
  });

  it("scopes the summary to an Account Manager and hides Cloud Health", async () => {
    const t = convexTest(schema, modules);
    const users = await seed(t);

    const summary = await asUser(t, users.amA).query(api.dashboard.summary, {
      year: 2026,
    });

    expect(summary.companies.total).toBe(1);
    expect(summary.leads).toMatchObject({
      active: 1,
      won: 1,
      wonValue: 7000,
    });
    expect(summary.targets).toMatchObject({
      target: 10000,
      achieved: 0,
      achievementPercent: 0,
    });
    expect(summary.pipeline.value).toBe(5000);
    expect(summary.usage.total).toBe(100);
    expect(summary.quotes.total).toBe(1);
    expect(summary.tasks).toEqual({
      myOpen: 3,
      overdue: 1,
      dueThisWeek: 1,
      blocked: 1,
    });
    expect(summary.cloudHealth).toBeNull();
  });
});
