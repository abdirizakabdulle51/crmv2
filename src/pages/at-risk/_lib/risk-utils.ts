import type { Doc } from "@/convex/_generated/dataModel.d.ts";

export type UsageTrend = "growing" | "flat" | "declining";

export type TenantRiskData = {
  company: Doc<"companies">;
  trend: UsageTrend;
  isAtRisk: boolean;
  latestMonth: string;
  latestTotal: number;
  previousTotal: number;
  monthBeforePrevious: number;
  changePercent: number;
};

/**
 * Calculate monthly totals for a company from consumption entries.
 * Returns an array sorted by month ascending: [{ month, total }]
 */
export function getMonthlyTotals(
  entries: Doc<"consumption">[],
  companyId: string,
): { month: string; total: number }[] {
  const byMonth = new Map<string, number>();
  for (const entry of entries) {
    if (entry.companyId !== companyId) continue;
    const current = byMonth.get(entry.month) || 0;
    byMonth.set(entry.month, current + entry.amount);
  }
  return [...byMonth.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Determine usage trend based on the last few months of data.
 * - "declining" if latest < previous
 * - "growing" if latest > previous (with 5% tolerance for "flat")
 * - "flat" otherwise
 */
export function determineTrend(monthlyTotals: { month: string; total: number }[]): UsageTrend {
  if (monthlyTotals.length < 2) return "flat";

  const latest = monthlyTotals[monthlyTotals.length - 1].total;
  const previous = monthlyTotals[monthlyTotals.length - 2].total;

  if (previous === 0) {
    return latest > 0 ? "growing" : "flat";
  }

  const changePercent = ((latest - previous) / previous) * 100;

  if (changePercent < -5) return "declining";
  if (changePercent > 5) return "growing";
  return "flat";
}

/**
 * Determine if tenant is "at risk" — declining for 2 consecutive months.
 * Requires 3 data points minimum (months N-2, N-1, N):
 *   - Month N < Month N-1 (recent decline)
 *   - Month N-1 < Month N-2 (prior decline)
 * Both must be strict decreases. Tenants with fewer than 3 months of data
 * are NEVER flagged at risk.
 *
 * Examples:
 *   $1,000 → $800 → $600 → At Risk (800 < 1000 AND 600 < 800)
 *   $1,000 → $800 → $1,200 → NOT At Risk (1200 > 800, recent period is growth)
 */
export function isConsecutiveDecline(monthlyTotals: { month: string; total: number }[]): boolean {
  if (monthlyTotals.length < 3) return false;

  const len = monthlyTotals.length;
  const monthN = monthlyTotals[len - 1].total;   // latest
  const monthN1 = monthlyTotals[len - 2].total;  // previous
  const monthN2 = monthlyTotals[len - 3].total;  // month before previous

  const recentDecline = monthN < monthN1;   // N < N-1
  const priorDecline = monthN1 < monthN2;   // N-1 < N-2

  return recentDecline && priorDecline;
}

/** Build risk data for all visible companies */
export function buildTenantRiskData(
  companies: Doc<"companies">[],
  consumption: Doc<"consumption">[],
): TenantRiskData[] {
  return companies.map((company) => {
    const monthlyTotals = getMonthlyTotals(consumption, company._id);
    const trend = determineTrend(monthlyTotals);
    const atRisk = isConsecutiveDecline(monthlyTotals);

    const len = monthlyTotals.length;
    const latestTotal = len >= 1 ? monthlyTotals[len - 1].total : 0;
    const previousTotal = len >= 2 ? monthlyTotals[len - 2].total : 0;
    const monthBeforePrevious = len >= 3 ? monthlyTotals[len - 3].total : 0;
    const latestMonth = len >= 1 ? monthlyTotals[len - 1].month : "";

    const changePercent = previousTotal > 0
      ? Math.round(((latestTotal - previousTotal) / previousTotal) * 100)
      : 0;

    return {
      company,
      trend,
      isAtRisk: atRisk,
      latestMonth,
      latestTotal,
      previousTotal,
      monthBeforePrevious,
      changePercent,
    };
  }).filter((d) => d.latestMonth !== ""); // Only include companies with data
}

export function getTrendLabel(trend: UsageTrend): string {
  switch (trend) {
    case "growing": return "Growing";
    case "flat": return "Flat";
    case "declining": return "Declining";
  }
}

export function getTrendColor(trend: UsageTrend): string {
  switch (trend) {
    case "growing": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "flat": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
    case "declining": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
  }
}

export function getPaymentStatusLabel(status: string | undefined): string {
  switch (status) {
    case "current": return "Current";
    case "overdue": return "Overdue";
    case "delinquent": return "Delinquent";
    default: return "N/A";
  }
}

export function getPaymentStatusColor(status: string | undefined): string {
  switch (status) {
    case "current": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "overdue": return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
    case "delinquent": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    default: return "bg-muted text-muted-foreground";
  }
}
