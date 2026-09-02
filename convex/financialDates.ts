export const FINANCIAL_TIME_ZONE = "Africa/Nairobi";

function dateParts(timestamp: number) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: FINANCIAL_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function financialMonth(timestamp: number) {
  const parts = dateParts(timestamp);
  return `${parts.year}-${parts.month}`;
}

export function financialDay(timestamp: number) {
  const parts = dateParts(timestamp);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function financialYear(timestamp: number) {
  return Number(dateParts(timestamp).year);
}

export function financialMonthStart(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return Date.UTC(year, monthNumber - 1, 1, -3);
}

export function historicalDateMonth(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

export function historicalDateDay(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function historicalDateAsFinancialTimestamp(timestamp: number) {
  const [year, month, day] = historicalDateDay(timestamp).split("-").map(Number);
  return Date.UTC(year, month - 1, day, -3);
}
