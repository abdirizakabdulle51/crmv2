import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { assertNotMonitoring, isCeoOrHob } from "./authorization";

const employmentType = v.union(
  v.literal("permanent"),
  v.literal("temporary"),
  v.literal("contractor"),
  v.literal("intern"),
);
const employeeStatus = v.union(
  v.literal("preboarding"),
  v.literal("active"),
  v.literal("on_leave"),
  v.literal("suspended"),
  v.literal("departed"),
);
const screeningStatus = v.union(
  v.literal("not_required"),
  v.literal("pending"),
  v.literal("completed"),
);
const profileFields = {
  userId: v.optional(v.id("users")),
  firstName: v.string(),
  lastName: v.string(),
  workEmail: v.string(),
  phone: v.optional(v.string()),
  countryId: v.id("countries"),
  departmentId: v.optional(v.id("hrDepartments")),
  jobTitle: v.string(),
  workLocation: v.optional(v.string()),
  employmentType,
  status: employeeStatus,
  startDate: v.string(),
  endDate: v.optional(v.string()),
  probationEndDate: v.optional(v.string()),
  departureType: v.optional(
    v.union(
      v.literal("resignation"),
      v.literal("termination"),
      v.literal("contract_end"),
      v.literal("retirement"),
      v.literal("other"),
    ),
  ),
  departureReason: v.optional(v.string()),
  screeningStatus,
  ndaAcknowledged: v.boolean(),
  securityTrainingCompleted: v.boolean(),
  changeReason: v.optional(v.string()),
};
type Ctx = QueryCtx | MutationCtx;
type ProfileInput = {
  userId?: Id<"users">;
  firstName: string;
  lastName: string;
  workEmail: string;
  phone?: string;
  countryId: Id<"countries">;
  departmentId?: Id<"hrDepartments">;
  jobTitle: string;
  workLocation?: string;
  employmentType: "permanent" | "temporary" | "contractor" | "intern";
  status: "preboarding" | "active" | "on_leave" | "suspended" | "departed";
  startDate: string;
  endDate?: string;
  probationEndDate?: string;
  departureType?:
    | "resignation"
    | "termination"
    | "contract_end"
    | "retirement"
    | "other";
  departureReason?: string;
  screeningStatus: "not_required" | "pending" | "completed";
  ndaAcknowledged: boolean;
  securityTrainingCompleted: boolean;
  changeReason?: string;
};

async function currentUser(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Sign in required",
    });
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "User profile not found",
    });
  }
  assertNotMonitoring(user);
  return user;
}

function isHrAdministrator(user: Doc<"users">) {
  return isCeoOrHob(user) || user.hrAccessRole === "administrator";
}

function hasHrReadAccess(user: Doc<"users">) {
  return isHrAdministrator(user) || user.hrAccessRole === "auditor";
}

function countryInHrScope(
  user: Doc<"users">,
  countryId: Id<"countries">,
  countries: Doc<"countries">[],
) {
  if (isCeoOrHob(user)) return true;
  if (!hasHrReadAccess(user)) return false;
  if (user.hrAccessScope === "global") return true;
  if (user.hrAccessScope === "country") return user.hrCountryId === countryId;
  const country = countries.find((row) => row._id === countryId);
  return (
    user.hrAccessScope === "region" &&
    Boolean(user.hrRegion) &&
    country?.region === user.hrRegion
  );
}

function canViewEmployee(
  user: Doc<"users">,
  employee: Doc<"employeeProfiles">,
  countries: Doc<"countries">[],
) {
  return (
    employee.userId === user._id ||
    countryInHrScope(user, employee.countryId, countries)
  );
}

function canManageCountry(
  user: Doc<"users">,
  countryId: Id<"countries">,
  countries: Doc<"countries">[],
) {
  return (
    isHrAdministrator(user) && countryInHrScope(user, countryId, countries)
  );
}

function requireText(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label} is required`,
    });
  }
  return cleaned;
}

function requireIsoDate(value: string, label: string) {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label} must be a valid date`,
    });
  }
  return value;
}

async function validateReferences(
  ctx: Ctx,
  args: {
    userId?: Id<"users">;
    countryId: Id<"countries">;
    departmentId?: Id<"hrDepartments">;
  },
  existingId?: Id<"employeeProfiles">,
) {
  if (!(await ctx.db.get(args.countryId))) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Country not found",
    });
  }
  if (args.departmentId) {
    const department = await ctx.db.get(args.departmentId);
    if (!department?.isActive) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select an active department",
      });
    }
    if (department.countryId && department.countryId !== args.countryId) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Department must belong to the employee country",
      });
    }
  }
  if (args.userId) {
    if (!(await ctx.db.get(args.userId))) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Linked user not found",
      });
    }
    const linked = await ctx.db
      .query("employeeProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (linked && linked._id !== existingId) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "This login is already linked to an employee",
      });
    }
  }
}

function cleanProfile(args: ProfileInput) {
  const firstName = requireText(args.firstName, "First name");
  const lastName = requireText(args.lastName, "Last name");
  const jobTitle = requireText(args.jobTitle, "Job title");
  const workEmail = requireText(args.workEmail, "Work email").toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(workEmail)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Enter a valid work email",
    });
  }
  const startDate = requireIsoDate(args.startDate, "Start date");
  const endDate = args.endDate
    ? requireIsoDate(args.endDate, "End date")
    : undefined;
  const probationEndDate = args.probationEndDate
    ? requireIsoDate(args.probationEndDate, "Probation end date")
    : undefined;
  if (endDate && endDate < startDate) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "End date cannot precede start date",
    });
  }
  if (probationEndDate && probationEndDate < startDate) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Probation end date cannot precede start date",
    });
  }
  if (args.status === "departed" && !endDate) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "End date is required for a departed employee",
    });
  }
  const departureReason = args.departureReason?.trim() || undefined;
  if (args.status === "departed" && (!args.departureType || !departureReason)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Departure type and reason are required for offboarding",
    });
  }
  return {
    firstName,
    lastName,
    jobTitle,
    workEmail,
    phone: args.phone?.trim() || undefined,
    workLocation: args.workLocation?.trim() || undefined,
    startDate,
    endDate,
    probationEndDate,
    departureType: args.status === "departed" ? args.departureType : undefined,
    departureReason: args.status === "departed" ? departureReason : undefined,
  };
}

async function disableLinkedAccess(
  ctx: MutationCtx,
  actor: Doc<"users">,
  userIds: Array<Id<"users"> | undefined>,
) {
  for (const userId of new Set(userIds.filter(Boolean) as Id<"users">[])) {
    const user = await ctx.db.get(userId);
    if (!user || user.isDisabled === true) continue;
    if (
      (user.role === "ceo" || user.role === "head_of_business") &&
      !isCeoOrHob(actor)
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message:
          "CEO or Head of Business approval is required to offboard an executive account",
      });
    }
    if (user.role === "ceo") {
      const activeCeos = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "ceo"))
        .collect();
      if (activeCeos.filter((row) => row.isDisabled !== true).length <= 1) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Assign another active CEO before offboarding this employee",
        });
      }
    }
    await ctx.db.patch(userId, { isDisabled: true });
  }
}

function changedFields(
  current: Doc<"employeeProfiles">,
  next: Record<string, unknown>,
) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, to] of Object.entries(next)) {
    const from = current[field as keyof typeof current];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[field] = { from, to };
    }
  }
  return changes;
}

const lifecycleTemplates = {
  onboarding: [
    ["screening", "Screening completed"],
    ["employment_terms", "Employment terms accepted"],
    ["nda", "NDA and security policies acknowledged"],
    ["security_training", "Security awareness training completed"],
    ["equipment_issued", "Company equipment assigned"],
    ["access_provisioned", "Required system access approved"],
  ],
  offboarding: [
    ["access_revoked", "System and physical access removed"],
    ["assets_returned", "Company assets returned"],
    ["handover_completed", "Responsibilities and records handed over"],
    ["confidentiality_confirmed", "Continuing confidentiality confirmed"],
    ["final_clearance", "HR final clearance completed"],
  ],
} as const;

async function ensureLifecycleTasks(
  ctx: MutationCtx,
  employeeId: Id<"employeeProfiles">,
  phase: keyof typeof lifecycleTemplates,
  completedCodes: string[] = [],
) {
  const existing = await ctx.db
    .query("employeeLifecycleTasks")
    .withIndex("by_employee_phase", (q) =>
      q.eq("employeeId", employeeId).eq("phase", phase),
    )
    .collect();
  const existingCodes = new Set(existing.map((task) => task.code));
  const now = Date.now();
  for (const [code, title] of lifecycleTemplates[phase]) {
    if (existingCodes.has(code)) continue;
    const completed = completedCodes.includes(code);
    await ctx.db.insert("employeeLifecycleTasks", {
      employeeId,
      phase,
      code,
      title,
      status: completed ? "completed" : "pending",
      completedAt: completed ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function syncLifecycleTask(
  ctx: MutationCtx,
  employeeId: Id<"employeeProfiles">,
  actorId: Id<"users">,
  code: string,
  completed: boolean,
) {
  const tasks = await ctx.db
    .query("employeeLifecycleTasks")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();
  const task = tasks.find((row) => row.code === code);
  if (!task || (task.status === "completed") === completed) return;
  const now = Date.now();
  await ctx.db.patch(task._id, {
    status: completed ? "completed" : "pending",
    completedBy: completed ? actorId : undefined,
    completedAt: completed ? now : undefined,
    updatedAt: now,
  });
}

async function uniqueEmail(
  ctx: Ctx,
  email: string,
  existingId?: Id<"employeeProfiles">,
) {
  const match = await ctx.db
    .query("employeeProfiles")
    .withIndex("by_work_email", (q) => q.eq("workEmail", email))
    .unique();
  if (match && match._id !== existingId) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "Work email is already registered",
    });
  }
}

async function nextEmployeeNumber(ctx: MutationCtx) {
  const rows = await ctx.db.query("employeeProfiles").collect();
  const next =
    rows.reduce((max, row) => {
      const match = /^EMP-(\d+)$/.exec(row.employeeNumber);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  return `EMP-${String(next).padStart(5, "0")}`;
}

async function applyReportingLines(
  ctx: MutationCtx,
  actor: Doc<"users">,
  employeeId: Id<"employeeProfiles">,
  primaryManagerId?: Id<"employeeProfiles">,
  secondaryManagerId?: Id<"employeeProfiles">,
) {
  const employee = await ctx.db.get(employeeId);
  if (!employee)
    throw new ConvexError({ code: "NOT_FOUND", message: "Employee not found" });
  const countries = await ctx.db.query("countries").collect();
  if (!canManageCountry(actor, employee.countryId, countries)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "You do not have HR administration access for this employee",
    });
  }
  const managerIds = [primaryManagerId, secondaryManagerId].filter(
    Boolean,
  ) as Id<"employeeProfiles">[];
  if (new Set(managerIds).size !== managerIds.length) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Primary and secondary manager must be different",
    });
  }
  if (managerIds.includes(employee._id)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "An employee cannot report to themselves",
    });
  }
  for (const id of managerIds) {
    const manager = await ctx.db.get(id);
    if (!manager)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Manager not found",
      });
    if (manager.status === "departed" || manager.status === "suspended") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "A departed or suspended employee cannot be assigned as manager",
      });
    }
  }
  const allLines = await ctx.db.query("employeeReportingLines").collect();
  const existing = allLines.filter(
    (line) => line.employeeId === employee._id && !line.endedAt,
  );
  const desired = [
    primaryManagerId ? { managerId: primaryManagerId, type: "primary" } : null,
    secondaryManagerId
      ? { managerId: secondaryManagerId, type: "secondary" }
      : null,
  ].filter(Boolean) as Array<{
    managerId: Id<"employeeProfiles">;
    type: "primary" | "secondary";
  }>;
  if (
    existing.length === desired.length &&
    desired.every((item) =>
      existing.some(
        (line) => line.managerId === item.managerId && line.type === item.type,
      ),
    )
  ) {
    return;
  }
  const parents = new Map<Id<"employeeProfiles">, Id<"employeeProfiles">[]>();
  for (const line of allLines.filter(
    (line) => !line.endedAt && line.employeeId !== employee._id,
  )) {
    parents.set(line.employeeId, [
      ...(parents.get(line.employeeId) ?? []),
      line.managerId,
    ]);
  }
  parents.set(employee._id, managerIds);
  const reachesEmployee = (
    id: Id<"employeeProfiles">,
    seen = new Set<Id<"employeeProfiles">>(),
  ): boolean => {
    if (id === employee._id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (parents.get(id) ?? []).some((parent) =>
      reachesEmployee(parent, new Set(seen)),
    );
  };
  if (managerIds.some((id) => reachesEmployee(id))) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Reporting lines cannot create a management cycle",
    });
  }
  const now = Date.now();
  for (const line of existing) {
    await ctx.db.patch(line._id, { endedBy: actor._id, endedAt: now });
  }
  if (primaryManagerId)
    await ctx.db.insert("employeeReportingLines", {
      employeeId: employee._id,
      managerId: primaryManagerId,
      type: "primary",
      createdBy: actor._id,
      createdAt: now,
    });
  if (secondaryManagerId)
    await ctx.db.insert("employeeReportingLines", {
      employeeId: employee._id,
      managerId: secondaryManagerId,
      type: "secondary",
      createdBy: actor._id,
      createdAt: now,
    });
  await ctx.db.insert("hrEvents", {
    employeeId: employee._id,
    actorId: actor._id,
    type: "reporting_lines_updated",
    message: "Updated primary and secondary reporting lines",
    changes: JSON.stringify({ managerIds }),
    createdAt: now,
  });
}

export const listDepartments = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await currentUser(ctx);
    const [rows, countries] = await Promise.all([
      ctx.db.query("hrDepartments").collect(),
      ctx.db.query("countries").collect(),
    ]);
    return rows
      .filter(
        (row) =>
          (args.includeInactive && isHrAdministrator(actor)) || row.isActive,
      )
      .filter(
        (row) =>
          !row.countryId ||
          isCeoOrHob(actor) ||
          (row.countryId && countryInHrScope(actor, row.countryId, countries)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const listAccessibleCountries = query({
  args: {},
  handler: async (ctx) => {
    const actor = await currentUser(ctx);
    const countries = await ctx.db.query("countries").collect();
    return countries
      .filter((country) => countryInHrScope(actor, country._id, countries))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const listLinkableUsers = query({
  args: {},
  handler: async (ctx) => {
    const actor = await currentUser(ctx);
    if (!isHrAdministrator(actor)) return [];
    const [users, countries, profiles] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("countries").collect(),
      ctx.db.query("employeeProfiles").collect(),
    ]);
    const linkedIds = new Set(
      profiles.flatMap((profile) => (profile.userId ? [profile.userId] : [])),
    );
    return users
      .filter((user) => !user.isDisabled)
      .filter((user) =>
        user.countryId
          ? countryInHrScope(actor, user.countryId, countries)
          : isCeoOrHob(actor) || actor.hrAccessScope === "global",
      )
      .map((user) => ({
        id: user._id,
        name: user.name,
        email: user.email,
        linked: linkedIds.has(user._id),
      }))
      .sort((a, b) =>
        (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""),
      );
  },
});

export const createDepartment = mutation({
  args: {
    name: v.string(),
    code: v.string(),
    countryId: v.optional(v.id("countries")),
  },
  handler: async (ctx, args) => {
    const actor = await currentUser(ctx);
    if (!isHrAdministrator(actor)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only HR administrators can create departments",
      });
    }
    const name = requireText(args.name, "Department name");
    const code = requireText(args.code, "Department code").toUpperCase();
    if (
      await ctx.db
        .query("hrDepartments")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique()
    ) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Department code already exists",
      });
    }
    if (args.countryId && !(await ctx.db.get(args.countryId))) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Country not found",
      });
    }
    const countries = await ctx.db.query("countries").collect();
    if (
      (!args.countryId &&
        !isCeoOrHob(actor) &&
        actor.hrAccessScope !== "global") ||
      (args.countryId && !canManageCountry(actor, args.countryId, countries))
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You cannot create a department outside your HR scope",
      });
    }
    const now = Date.now();
    const id = await ctx.db.insert("hrDepartments", {
      name,
      code,
      countryId: args.countryId,
      isActive: true,
      createdBy: actor._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("hrEvents", {
      actorId: actor._id,
      type: "department_created",
      message: `Created department ${name}`,
      createdAt: now,
    });
    return id;
  },
});

export const listEmployees = query({
  args: { includeDeparted: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await currentUser(ctx);
    const [employees, departments, countries, lines] = await Promise.all([
      ctx.db.query("employeeProfiles").collect(),
      ctx.db.query("hrDepartments").collect(),
      ctx.db.query("countries").collect(),
      ctx.db.query("employeeReportingLines").collect(),
    ]);
    const currentLines = lines.filter((line) => !line.endedAt);
    const directReportIds = new Set(
      currentLines
        .filter(
          (line) =>
            employees.find((item) => item._id === line.managerId)?.userId ===
            actor._id,
        )
        .map((line) => line.employeeId),
    );
    const visible = employees.filter(
      (employee) =>
        (args.includeDeparted || employee.status !== "departed") &&
        (canViewEmployee(actor, employee, countries) ||
          directReportIds.has(employee._id)),
    );
    return visible
      .map((employee) => ({
        ...employee,
        fullName: `${employee.firstName} ${employee.lastName}`,
        countryName:
          countries.find((row) => row._id === employee.countryId)?.name ??
          "Unknown",
        departmentName: departments.find(
          (row) => row._id === employee.departmentId,
        )?.name,
        complianceReady:
          employee.screeningStatus !== "pending" &&
          Boolean(employee.ndaAcknowledgedAt) &&
          Boolean(employee.securityTrainingCompletedAt),
        managers: currentLines
          .filter((line) => line.employeeId === employee._id)
          .map((line) => {
            const manager = employees.find((row) => row._id === line.managerId);
            return manager
              ? {
                  id: manager._id,
                  name: `${manager.firstName} ${manager.lastName}`,
                  type: line.type,
                }
              : null;
          })
          .filter(Boolean),
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  },
});

export const getEmployee = query({
  args: { employeeId: v.id("employeeProfiles") },
  handler: async (ctx, args) => {
    const actor = await currentUser(ctx);
    const employee = await ctx.db.get(args.employeeId);
    const countries = await ctx.db.query("countries").collect();
    const actorEmployee = await ctx.db
      .query("employeeProfiles")
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
      .unique();
    const directLine = actorEmployee
      ? await ctx.db
          .query("employeeReportingLines")
          .withIndex("by_employee", (q) => q.eq("employeeId", args.employeeId))
          .collect()
      : [];
    const isDirectReport = directLine.some(
      (line) => !line.endedAt && line.managerId === actorEmployee?._id,
    );
    if (
      !employee ||
      (!canViewEmployee(actor, employee, countries) && !isDirectReport)
    ) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Employee not found",
      });
    }
    const [lines, events, lifecycleTasks] = await Promise.all([
      ctx.db
        .query("employeeReportingLines")
        .withIndex("by_employee", (q) => q.eq("employeeId", employee._id))
        .collect(),
      ctx.db
        .query("hrEvents")
        .withIndex("by_employee", (q) => q.eq("employeeId", employee._id))
        .collect(),
      ctx.db
        .query("employeeLifecycleTasks")
        .withIndex("by_employee", (q) => q.eq("employeeId", employee._id))
        .collect(),
    ]);
    return {
      employee,
      lines: lines.filter((line) => !line.endedAt),
      events:
        hasHrReadAccess(actor) || employee.userId === actor._id
          ? events.sort((a, b) => b.createdAt - a.createdAt)
          : [],
      lifecycleTasks: lifecycleTasks.sort(
        (a, b) => a.phase.localeCompare(b.phase) || a.createdAt - b.createdAt,
      ),
      canManage: canManageCountry(actor, employee.countryId, countries),
    };
  },
});

export const createEmployee = mutation({
  args: {
    ...profileFields,
    primaryManagerId: v.optional(v.id("employeeProfiles")),
    secondaryManagerId: v.optional(v.id("employeeProfiles")),
  },
  handler: async (ctx, args) => {
    const actor = await currentUser(ctx);
    const countries = await ctx.db.query("countries").collect();
    if (!canManageCountry(actor, args.countryId, countries)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only HR administrators can create employees",
      });
    }
    const clean = cleanProfile(args);
    await validateReferences(ctx, args);
    await uniqueEmail(ctx, clean.workEmail);
    const now = Date.now();
    if (args.status === "departed") {
      await disableLinkedAccess(ctx, actor, [args.userId]);
    }
    const id = await ctx.db.insert("employeeProfiles", {
      ...clean,
      userId: args.userId,
      countryId: args.countryId,
      departmentId: args.departmentId,
      employmentType: args.employmentType,
      status: args.status,
      departureType: clean.departureType,
      departureReason: clean.departureReason,
      offboardedAt: args.status === "departed" ? now : undefined,
      screeningStatus: args.screeningStatus,
      ndaAcknowledgedAt: args.ndaAcknowledged ? now : undefined,
      securityTrainingCompletedAt: args.securityTrainingCompleted
        ? now
        : undefined,
      employeeNumber: await nextEmployeeNumber(ctx),
      createdBy: actor._id,
      updatedBy: actor._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("hrEvents", {
      employeeId: id,
      actorId: actor._id,
      type: "employee_created",
      message: `Created employee profile for ${clean.firstName} ${clean.lastName}`,
      createdAt: now,
    });
    await ensureLifecycleTasks(ctx, id, "onboarding", [
      ...(args.screeningStatus !== "pending" ? ["screening"] : []),
      ...(args.ndaAcknowledged ? ["nda"] : []),
      ...(args.securityTrainingCompleted ? ["security_training"] : []),
    ]);
    if (args.status === "departed") {
      await ensureLifecycleTasks(ctx, id, "offboarding", [
        ...(args.userId ? ["access_revoked"] : []),
      ]);
    }
    await applyReportingLines(
      ctx,
      actor,
      id,
      args.primaryManagerId,
      args.secondaryManagerId,
    );
    return id;
  },
});

export const updateEmployee = mutation({
  args: {
    employeeId: v.id("employeeProfiles"),
    ...profileFields,
    primaryManagerId: v.optional(v.id("employeeProfiles")),
    secondaryManagerId: v.optional(v.id("employeeProfiles")),
  },
  handler: async (ctx, args) => {
    const actor = await currentUser(ctx);
    const countries = await ctx.db.query("countries").collect();
    const existingForScope = await ctx.db.get(args.employeeId);
    if (
      !existingForScope ||
      !canManageCountry(actor, existingForScope.countryId, countries) ||
      !canManageCountry(actor, args.countryId, countries)
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only HR administrators can update employees",
      });
    }
    const current = existingForScope;
    if (!current)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Employee not found",
      });
    const clean = cleanProfile(args);
    await validateReferences(ctx, args, current._id);
    await uniqueEmail(ctx, clean.workEmail, current._id);
    const now = Date.now();
    const complianceReversed =
      (Boolean(current.ndaAcknowledgedAt) && !args.ndaAcknowledged) ||
      (Boolean(current.securityTrainingCompletedAt) &&
        !args.securityTrainingCompleted) ||
      (current.screeningStatus === "completed" &&
        args.screeningStatus !== "completed");
    const sensitiveChange =
      current.status !== args.status ||
      current.userId !== args.userId ||
      complianceReversed;
    const reason =
      args.changeReason?.trim() ||
      (args.status === "departed" ? clean.departureReason : undefined);
    if (sensitiveChange && !reason) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "A change reason is required for status, login, or compliance corrections",
      });
    }
    if (args.status === "departed") {
      await disableLinkedAccess(ctx, actor, [current.userId, args.userId]);
    }
    const next = {
      ...clean,
      userId: args.userId,
      countryId: args.countryId,
      departmentId: args.departmentId,
      employmentType: args.employmentType,
      status: args.status,
      screeningStatus: args.screeningStatus,
      ndaAcknowledgedAt: args.ndaAcknowledged
        ? (current.ndaAcknowledgedAt ?? now)
        : undefined,
      securityTrainingCompletedAt: args.securityTrainingCompleted
        ? (current.securityTrainingCompletedAt ?? now)
        : undefined,
      offboardedAt:
        args.status === "departed" ? (current.offboardedAt ?? now) : undefined,
      updatedBy: actor._id,
      updatedAt: now,
    };
    const changes = changedFields(current, next);
    await ctx.db.patch(current._id, next);
    await ctx.db.insert("hrEvents", {
      employeeId: current._id,
      actorId: actor._id,
      type:
        current.status === args.status ? "employee_updated" : "status_changed",
      message:
        current.status === args.status
          ? "Updated employee profile"
          : `Changed status from ${current.status} to ${args.status}`,
      changes: JSON.stringify({
        reason,
        fields: changes,
      }),
      createdAt: now,
    });
    if (complianceReversed) {
      await ctx.db.insert("hrEvents", {
        employeeId: current._id,
        actorId: actor._id,
        type: "compliance_corrected",
        message: "Corrected employee compliance evidence",
        changes: JSON.stringify({ reason, fields: changes }),
        createdAt: now,
      });
    }
    await syncLifecycleTask(
      ctx,
      current._id,
      actor._id,
      "screening",
      args.screeningStatus !== "pending",
    );
    await syncLifecycleTask(
      ctx,
      current._id,
      actor._id,
      "nda",
      args.ndaAcknowledged,
    );
    await syncLifecycleTask(
      ctx,
      current._id,
      actor._id,
      "security_training",
      args.securityTrainingCompleted,
    );
    if (args.status === "departed") {
      await ensureLifecycleTasks(ctx, current._id, "offboarding");
      await syncLifecycleTask(
        ctx,
        current._id,
        actor._id,
        "access_revoked",
        Boolean(args.userId),
      );
      const reports = await ctx.db
        .query("employeeReportingLines")
        .withIndex("by_manager", (q) => q.eq("managerId", current._id))
        .collect();
      for (const line of reports.filter((row) => !row.endedAt)) {
        await ctx.db.patch(line._id, { endedBy: actor._id, endedAt: now });
        await ctx.db.insert("hrEvents", {
          employeeId: line.employeeId,
          actorId: actor._id,
          type: "reporting_lines_updated",
          message: "Removed departed manager from reporting line",
          changes: JSON.stringify({ managerId: current._id }),
          createdAt: now,
        });
      }
      if (args.userId) {
        await ctx.db.insert("hrEvents", {
          employeeId: current._id,
          actorId: actor._id,
          type: "access_disabled",
          message: "Disabled linked CRM access during offboarding",
          changes: JSON.stringify({ userId: args.userId, reason }),
          createdAt: now,
        });
      }
    }
    await applyReportingLines(
      ctx,
      actor,
      current._id,
      args.primaryManagerId,
      args.secondaryManagerId,
    );
  },
});

export const setReportingLines = mutation({
  args: {
    employeeId: v.id("employeeProfiles"),
    primaryManagerId: v.optional(v.id("employeeProfiles")),
    secondaryManagerId: v.optional(v.id("employeeProfiles")),
  },
  handler: async (ctx, args) => {
    const actor = await currentUser(ctx);
    if (!isHrAdministrator(actor)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only HR administrators can update reporting lines",
      });
    }
    await applyReportingLines(
      ctx,
      actor,
      args.employeeId,
      args.primaryManagerId,
      args.secondaryManagerId,
    );
  },
});

export const updateLifecycleTask = mutation({
  args: {
    taskId: v.id("employeeLifecycleTasks"),
    completed: v.boolean(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await currentUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Lifecycle task not found",
      });
    }
    const employee = await ctx.db.get(task.employeeId);
    const countries = await ctx.db.query("countries").collect();
    if (!employee || !canManageCountry(actor, employee.countryId, countries)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You cannot update this employee lifecycle task",
      });
    }
    const notes = args.notes?.trim() || undefined;
    if (!args.completed && task.status === "completed" && !notes) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "A reason is required to reopen completed evidence",
      });
    }
    const now = Date.now();
    await ctx.db.patch(task._id, {
      status: args.completed ? "completed" : "pending",
      completedBy: args.completed ? actor._id : undefined,
      completedAt: args.completed ? now : undefined,
      notes,
      updatedAt: now,
    });
    await ctx.db.insert("hrEvents", {
      employeeId: employee._id,
      actorId: actor._id,
      type: "lifecycle_task_updated",
      message: `${args.completed ? "Completed" : "Reopened"} ${task.title}`,
      changes: JSON.stringify({
        taskId: task._id,
        from: task.status,
        to: args.completed ? "completed" : "pending",
        notes,
      }),
      createdAt: now,
    });
  },
});

export const getOverview = query({
  args: {},
  handler: async (ctx) => {
    const actor = await currentUser(ctx);
    const [allEmployees, countries, lifecycleTasks] = await Promise.all([
      ctx.db.query("employeeProfiles").collect(),
      ctx.db.query("countries").collect(),
      ctx.db.query("employeeLifecycleTasks").collect(),
    ]);
    const employees = allEmployees.filter(
      (row) =>
        row.status !== "departed" && canViewEmployee(actor, row, countries),
    );
    const today = new Date().toISOString().slice(0, 10);
    const inThirtyDays = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      total: employees.length,
      active: employees.filter((row) => row.status === "active").length,
      preboarding: employees.filter((row) => row.status === "preboarding")
        .length,
      onLeave: employees.filter((row) => row.status === "on_leave").length,
      lifecycleDue: lifecycleTasks.filter(
        (task) =>
          task.status === "pending" &&
          employees.some((employee) => employee._id === task.employeeId),
      ).length,
      complianceDue: employees.filter(
        (row) =>
          row.screeningStatus === "pending" ||
          !row.ndaAcknowledgedAt ||
          !row.securityTrainingCompletedAt,
      ).length,
      probationDue: employees.filter(
        (row) =>
          (row.status === "active" || row.status === "preboarding") &&
          row.probationEndDate &&
          row.probationEndDate >= today &&
          row.probationEndDate <= inThirtyDays,
      ).length,
    };
  },
});
