import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import schema from "./schema";
import { modules } from "./test.setup";

function asUser(t: ReturnType<typeof convexTest>, user: Doc<"users">) {
  return t.withIdentity({ tokenIdentifier: user.tokenIdentifier });
}

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
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
      role: "ceo",
      tokenIdentifier: "hr-ceo",
    });
    const amId = await ctx.db.insert("users", {
      name: "AM",
      role: "account_manager",
      tokenIdentifier: "hr-am",
      countryId: countryA,
    });
    return {
      countryA,
      countryB,
      ceo: (await ctx.db.get(ceoId))!,
      am: (await ctx.db.get(amId))!,
    };
  });
}

function employeeArgs(countryId: Id<"countries">, suffix: string) {
  return {
    firstName: `Person ${suffix}`,
    lastName: "Example",
    workEmail: `${suffix.toLowerCase()}@example.com`,
    countryId,
    jobTitle: "Cloud Engineer",
    employmentType: "permanent" as const,
    status: "active" as const,
    startDate: "2026-01-01",
    screeningStatus: "completed" as const,
    ndaAcknowledged: true,
    securityTrainingCompleted: true,
  };
}

describe("HR management", () => {
  it("creates automatic employee numbers and supports two reporting managers", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ceo = asUser(t, s.ceo);
    const managerA = await ceo.mutation(
      api.hr.createEmployee,
      employeeArgs(s.countryA, "A"),
    );
    const managerB = await ceo.mutation(
      api.hr.createEmployee,
      employeeArgs(s.countryB, "B"),
    );
    const employee = await ceo.mutation(
      api.hr.createEmployee,
      employeeArgs(s.countryA, "C"),
    );

    await ceo.mutation(api.hr.setReportingLines, {
      employeeId: employee,
      primaryManagerId: managerA,
      secondaryManagerId: managerB,
    });

    const rows = await ceo.query(api.hr.listEmployees, {});
    expect(rows.map((row) => row.employeeNumber)).toEqual([
      "EMP-00001",
      "EMP-00002",
      "EMP-00003",
    ]);
    expect(rows.find((row) => row._id === employee)?.managers).toEqual([
      { id: managerA, name: "Person A Example", type: "primary" },
      { id: managerB, name: "Person B Example", type: "secondary" },
    ]);
  });

  it("rejects duplicate managers, self-reporting, and reporting cycles", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ceo = asUser(t, s.ceo);
    const first = await ceo.mutation(
      api.hr.createEmployee,
      employeeArgs(s.countryA, "A"),
    );
    const second = await ceo.mutation(
      api.hr.createEmployee,
      employeeArgs(s.countryA, "B"),
    );

    await expect(
      ceo.mutation(api.hr.setReportingLines, {
        employeeId: first,
        primaryManagerId: second,
        secondaryManagerId: second,
      }),
    ).rejects.toThrow(/different/);
    await expect(
      ceo.mutation(api.hr.setReportingLines, {
        employeeId: first,
        primaryManagerId: first,
      }),
    ).rejects.toThrow(/themselves/);

    await ceo.mutation(api.hr.setReportingLines, {
      employeeId: second,
      primaryManagerId: first,
    });
    await expect(
      ceo.mutation(api.hr.setReportingLines, {
        employeeId: first,
        primaryManagerId: second,
      }),
    ).rejects.toThrow(/cycle/);
  });

  it("protects HR mutations and enforces unique work emails and login links", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ceo = asUser(t, s.ceo);
    await expect(
      asUser(t, s.am).mutation(
        api.hr.createEmployee,
        employeeArgs(s.countryA, "A"),
      ),
    ).rejects.toThrow(/HR administrators/);
    await ceo.mutation(api.hr.createEmployee, {
      ...employeeArgs(s.countryA, "A"),
      userId: s.am._id,
    });
    await expect(
      ceo.mutation(api.hr.createEmployee, employeeArgs(s.countryA, "A")),
    ).rejects.toThrow(/email is already/);
    await expect(
      ceo.mutation(api.hr.createEmployee, {
        ...employeeArgs(s.countryA, "B"),
        userId: s.am._id,
      }),
    ).rejects.toThrow(/already linked/);
  });

  it("limits ordinary employees to their own linked profile", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ceo = asUser(t, s.ceo);
    const mine = await ceo.mutation(api.hr.createEmployee, {
      ...employeeArgs(s.countryA, "A"),
      userId: s.am._id,
    });
    await ceo.mutation(api.hr.createEmployee, employeeArgs(s.countryB, "B"));

    const visible = await asUser(t, s.am).query(api.hr.listEmployees, {});
    expect(visible.map((row) => row._id)).toEqual([mine]);
  });

  it("requires an end date and disables linked access when offboarding", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ceo = asUser(t, s.ceo);
    const employeeId = await ceo.mutation(api.hr.createEmployee, {
      ...employeeArgs(s.countryA, "A"),
      userId: s.am._id,
    });

    await expect(
      ceo.mutation(api.hr.updateEmployee, {
        employeeId,
        ...employeeArgs(s.countryA, "A"),
        userId: s.am._id,
        status: "departed",
        departureType: "resignation",
        departureReason: "Relocation",
      }),
    ).rejects.toThrow(/End date/);

    await ceo.mutation(api.hr.updateEmployee, {
      employeeId,
      ...employeeArgs(s.countryA, "A"),
      userId: s.am._id,
      status: "departed",
      endDate: "2026-08-31",
      departureType: "resignation",
      departureReason: "Relocation",
    });
    expect(await t.run((ctx) => ctx.db.get(s.am._id))).toMatchObject({
      isDisabled: true,
    });
  });

  it("disables a newly linked login when offboarding in the same update", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ceo = asUser(t, s.ceo);
    const employeeId = await ceo.mutation(
      api.hr.createEmployee,
      employeeArgs(s.countryA, "LateLink"),
    );
    await ceo.mutation(api.hr.updateEmployee, {
      employeeId,
      ...employeeArgs(s.countryA, "LateLink"),
      userId: s.am._id,
      status: "departed",
      endDate: "2026-08-31",
      departureType: "termination",
      departureReason: "Employment ended",
    });
    expect(await t.run((ctx) => ctx.db.get(s.am._id))).toMatchObject({
      isDisabled: true,
    });
  });

  it("keeps business and regional HR roles independent and enforces region scope", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const gmId = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Country GM and Regional HR",
        role: "country_gm",
        tokenIdentifier: "hr-regional-gm",
        countryId: s.countryA,
      }),
    );
    await asUser(t, s.ceo).mutation(api.users.setHrAccess, {
      userId: gmId,
      assignment: "regional_administrator",
      region: "East Africa",
    });
    const regionalUser = (await t.run((ctx) => ctx.db.get(gmId)))!;
    expect(regionalUser).toMatchObject({
      role: "country_gm",
      hrAccessRole: "administrator",
      hrAccessScope: "region",
      hrRegion: "East Africa",
    });
    await expect(
      asUser(t, regionalUser).mutation(
        api.hr.createEmployee,
        employeeArgs(s.countryB, "Regional"),
      ),
    ).resolves.toBeDefined();

    const outsideCountry = await t.run((ctx) =>
      ctx.db.insert("countries", { name: "UAE", region: "Middle East" }),
    );
    await expect(
      asUser(t, regionalUser).mutation(
        api.hr.createEmployee,
        employeeArgs(outsideCountry, "Outside"),
      ),
    ).rejects.toThrow(/HR administrators/);
  });

  it("excludes departed employees from live directory and workforce totals", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ceo = asUser(t, s.ceo);
    await ceo.mutation(
      api.hr.createEmployee,
      employeeArgs(s.countryA, "Active"),
    );
    await ceo.mutation(api.hr.createEmployee, {
      ...employeeArgs(s.countryA, "Departed"),
      status: "departed",
      endDate: "2026-08-31",
      departureType: "contract_end",
      departureReason: "Contract completed",
    });
    expect(await ceo.query(api.hr.getOverview, {})).toMatchObject({ total: 1 });
    expect(await ceo.query(api.hr.listEmployees, {})).toHaveLength(1);
    expect(
      await ceo.query(api.hr.listEmployees, { includeDeparted: true }),
    ).toHaveLength(2);
  });

  it("rejects impossible employment dates", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expect(
      asUser(t, s.ceo).mutation(api.hr.createEmployee, {
        ...employeeArgs(s.countryA, "Invalid"),
        startDate: "2026-02-31",
      }),
    ).rejects.toThrow(/valid date/);
  });

  it("creates lifecycle controls and audits their completion", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ceo = asUser(t, s.ceo);
    const employeeId = await ceo.mutation(
      api.hr.createEmployee,
      employeeArgs(s.countryA, "Checklist"),
    );
    const detail = await ceo.query(api.hr.getEmployee, { employeeId });
    expect(
      detail.lifecycleTasks.filter((task) => task.phase === "onboarding"),
    ).toHaveLength(6);
    const pending = detail.lifecycleTasks.find(
      (task) => task.code === "employment_terms",
    )!;
    await ceo.mutation(api.hr.updateLifecycleTask, {
      taskId: pending._id,
      completed: true,
    });
    const updated = await ceo.query(api.hr.getEmployee, { employeeId });
    expect(
      updated.lifecycleTasks.find((task) => task._id === pending._id)?.status,
    ).toBe("completed");
    expect(
      updated.events.some((event) => event.type === "lifecycle_task_updated"),
    ).toBe(true);
  });

  it("preserves employee history by blocking deletion of linked login accounts", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ceo = asUser(t, s.ceo);
    await ceo.mutation(api.hr.createEmployee, {
      ...employeeArgs(s.countryA, "Protected"),
      userId: s.am._id,
    });
    await expect(
      ceo.mutation(api.auth.deleteTeamMember, { userId: s.am._id }),
    ).rejects.toThrow(/employee record/);
  });
});
