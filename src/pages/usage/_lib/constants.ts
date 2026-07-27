/** Service types available for consumption tracking */
export const SERVICE_TYPES = [
  "ECS",
  "ECS-CCE",
  "BMS",
  "EVS",
  "SFS",
  "OBS",
  "CSBS",
  "VBS",
  "EIP",
  "ELB",
  "NAT Gateway",
  "VPN",
  "VPN Gateway",
  "VPCEP",
  "WAF",
  "CBH",
  "LTS",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

/** Normalize service type for matching (case-insensitive, trim) */
export function matchServiceType(input: string): string | null {
  const normalized = input.trim();
  const found = SERVICE_TYPES.find(
    (s) => s.toLowerCase() === normalized.toLowerCase(),
  );
  return found ?? null;
}

/** Validate YYYY-MM month format */
export function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Get the current month in YYYY-MM */
export function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
