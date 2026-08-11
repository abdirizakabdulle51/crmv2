import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";

type Ctx = QueryCtx | MutationCtx;

export function isCeoOrHob(user: Doc<"users">) {
  return user.role === "ceo" || user.role === "head_of_business";
}

export function isMonitoring(user: Doc<"users">) {
  return user.role === "monitoring";
}

export function assertNotMonitoring(user: Doc<"users">) {
  if (!isMonitoring(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "Monitoring users can only access Cloud Health and Documentation",
  });
}

export function canViewCloudHealth(user: Doc<"users">) {
  return (
    isCeoOrHob(user) ||
    user.role === "country_gm" ||
    user.role === "monitoring"
  );
}

export function canManageCloudHealthTargets(user: Doc<"users">) {
  return isCeoOrHob(user);
}

export function canViewCompany(user: Doc<"users">, company: Doc<"companies">) {
  if (isCeoOrHob(user)) {
    return true;
  }
  if (user.role === "country_gm") {
    return !!user.countryId && company.countryId === user.countryId;
  }
  return (
    user.role === "account_manager" && company.accountManagerId === user._id
  );
}

export function assertCanManageCompany(
  user: Doc<"users">,
  company: Doc<"companies">,
) {
  if (canViewCompany(user, company)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to modify this company",
  });
}

export async function assertCanManageLead(
  ctx: Ctx,
  user: Doc<"users">,
  lead: Doc<"leads">,
) {
  if (isCeoOrHob(user)) {
    return;
  }
  if (user.role === "account_manager" && lead.accountManagerId === user._id) {
    return;
  }
  if (user.role === "country_gm" && user.countryId) {
    const company = await ctx.db.get(lead.companyId);
    if (company?.countryId === user.countryId) {
      return;
    }
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to modify this lead",
  });
}

export async function assertCanManageUsage(
  ctx: Ctx,
  user: Doc<"users">,
  companyId: Id<"companies">,
) {
  const company = await ctx.db.get(companyId);
  if (!company) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Company not found" });
  }
  if (canViewCompany(user, company)) {
    return company;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to manage usage for this company",
  });
}

export async function assertCanManageTarget(
  ctx: Ctx,
  user: Doc<"users">,
  accountManagerId: Id<"users"> | undefined,
) {
  if (isCeoOrHob(user)) {
    return;
  }
  if (!accountManagerId) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "You do not have permission to manage this target",
    });
  }
  if (user.role === "country_gm" && user.countryId) {
    const targetUser = await ctx.db.get(accountManagerId);
    if (
      targetUser?.role === "account_manager" &&
      targetUser.countryId === user.countryId
    ) {
      return;
    }
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to manage this target",
  });
}

export function canManageUser(
  actor: Doc<"users">,
  target: Doc<"users">,
  action: "view" | "manage",
) {
  if (isCeoOrHob(actor)) {
    return true;
  }
  if (actor.role !== "country_gm" || !actor.countryId) {
    return action === "view" && actor._id === target._id;
  }
  if (action === "view" && actor._id === target._id) {
    return true;
  }
  return (
    target.role === "account_manager" && target.countryId === actor.countryId
  );
}

export function assertCanManageUser(actor: Doc<"users">, target: Doc<"users">) {
  if (canManageUser(actor, target, "manage")) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to manage this user",
  });
}

export async function assertAccountManagerIsInActorScope(
  ctx: Ctx,
  actor: Doc<"users">,
  accountManagerId: Id<"users">,
  countryId?: Id<"countries">,
) {
  if (actor.role === "account_manager") {
    if (accountManagerId === actor._id) {
      return;
    }
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Account Managers can only assign records to themselves",
    });
  }
  if (isCeoOrHob(actor)) {
    return;
  }
  if (actor.role === "country_gm" && actor.countryId) {
    const accountManager = await ctx.db.get(accountManagerId);
    if (
      accountManager?.role === "account_manager" &&
      accountManager.countryId === actor.countryId &&
      (!countryId || countryId === actor.countryId)
    ) {
      return;
    }
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "You do not have permission to assign this account manager",
  });
}
