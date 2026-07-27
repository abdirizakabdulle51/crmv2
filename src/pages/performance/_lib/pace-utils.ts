/**
 * Yearly pace calculation utilities.
 * "Target" = full yearly target (sum of all 4 quarters).
 * "Expected" = completed quarters count in full + current quarter prorated by working days elapsed.
 * All calculations assume Mon-Fri working days only (no public holidays).
 */

export type Quarter = 1 | 2 | 3 | 4;

/** Quarterly target breakdown */
export type QuarterlyTargets = {
  q1: number;
  q2: number;
  q3: number;
  q4: number;
};

/** Get quarter start/end for a given date */
export function getQuarterRange(date: Date): { start: Date; end: Date; quarter: Quarter } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const quarter = (Math.floor(month / 3) + 1) as Quarter;
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0); // last day of last month in quarter
  return { start, end, quarter };
}

/** Get start/end for a specific quarter in a year */
function getQuarterRangeForQ(year: number, q: Quarter): { start: Date; end: Date } {
  const startMonth = (q - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  return { start, end };
}

/** Count working days (Mon-Fri) between two dates inclusive */
export function countWorkingDays(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

export type PaceStatus = "ahead" | "on_track" | "behind";

export type PaceMetrics = {
  yearlyTarget: number;
  currentQuarterTarget: number;
  totalWorkingDaysInQuarter: number;
  elapsedWorkingDaysInQuarter: number;
  remainingWorkingDaysInQuarter: number;
  dailyPace: number;
  expectedToDate: number;
  achieved: number;
  gap: number;
  status: PaceStatus;
  percentOfExpected: number;
  currentQuarter: Quarter;
};

/**
 * Calculate pace metrics using yearly cumulative logic.
 * - yearlyTarget = sum of all 4 quarter targets
 * - expectedToDate = full targets of completed quarters + prorated current quarter
 * - dailyPace = current quarter target / working days in current quarter
 */
export function calculatePace(
  quarterlyTargets: QuarterlyTargets,
  achieved: number,
  today: Date = new Date(),
): PaceMetrics {
  const year = today.getFullYear();
  const { start, end, quarter } = getQuarterRange(today);

  const yearlyTarget = quarterlyTargets.q1 + quarterlyTargets.q2 + quarterlyTargets.q3 + quarterlyTargets.q4;

  // Sum of fully completed quarters
  const completedQuarters: Quarter[] = ([1, 2, 3, 4] as Quarter[]).filter((q) => q < quarter);
  const completedTotal = completedQuarters.reduce((sum, q) => {
    const key = `q${q}` as keyof QuarterlyTargets;
    return sum + quarterlyTargets[key];
  }, 0);

  // Prorated current quarter
  const totalWorkingDaysInQuarter = countWorkingDays(start, end);
  const elapsedWorkingDaysInQuarter = countWorkingDays(start, today);
  const remainingWorkingDaysInQuarter = Math.max(0, totalWorkingDaysInQuarter - elapsedWorkingDaysInQuarter);

  const currentQuarterKey = `q${quarter}` as keyof QuarterlyTargets;
  const currentQuarterTarget = quarterlyTargets[currentQuarterKey];

  const proratedCurrentQuarter = totalWorkingDaysInQuarter > 0
    ? currentQuarterTarget * (elapsedWorkingDaysInQuarter / totalWorkingDaysInQuarter)
    : 0;

  const expectedToDate = completedTotal + proratedCurrentQuarter;

  // Daily pace is based on current quarter
  const dailyPace = totalWorkingDaysInQuarter > 0 ? currentQuarterTarget / totalWorkingDaysInQuarter : 0;

  const gap = achieved - expectedToDate;
  const percentOfExpected = expectedToDate > 0
    ? Math.round((achieved / expectedToDate) * 100)
    : achieved > 0 ? 999 : 0;

  let status: PaceStatus = "on_track";
  if (percentOfExpected > 105) status = "ahead";
  else if (percentOfExpected < 95) status = "behind";

  return {
    yearlyTarget,
    currentQuarterTarget,
    totalWorkingDaysInQuarter,
    elapsedWorkingDaysInQuarter,
    remainingWorkingDaysInQuarter,
    dailyPace,
    expectedToDate,
    achieved,
    gap,
    status,
    percentOfExpected,
    currentQuarter: quarter,
  };
}

export function getStatusLabel(status: PaceStatus): string {
  switch (status) {
    case "ahead": return "Ahead";
    case "on_track": return "On Track";
    case "behind": return "Behind";
  }
}

export function getStatusColor(status: PaceStatus): string {
  switch (status) {
    case "ahead": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "on_track": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
    case "behind": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  }
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
