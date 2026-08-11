import type { UserRole } from "@/lib/crm-context.tsx";

export function isAdminRole(role: UserRole | undefined) {
  return role === "ceo" || role === "head_of_business";
}

export function canViewCloudHealth(role: UserRole | undefined) {
  return (
    role === "ceo" ||
    role === "head_of_business" ||
    role === "country_gm" ||
    role === "monitoring"
  );
}

export function canManageCloudHealthTargets(role: UserRole | undefined) {
  return isAdminRole(role);
}

export function isMonitoringRole(role: UserRole | undefined) {
  return role === "monitoring";
}

export function isMonitoringAllowedPath(pathname: string) {
  return (
    pathname === "/cloud-health" ||
    pathname.startsWith("/cloud-health/") ||
    pathname === "/documentation" ||
    pathname.startsWith("/documentation/")
  );
}
