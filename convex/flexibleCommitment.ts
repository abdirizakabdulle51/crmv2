import { fromCents, toCents } from "./money";

export type FlexibleUsage = {
  key: string;
  grossAmount: number;
  discountPercent: number;
};

export type FlexibleUsageAllocation = FlexibleUsage & {
  discountedAmount: number;
  commitmentConsumed: number;
  overageAmount: number;
  remainingCommitment: number;
};

function coveredGrossCents(
  grossCents: number,
  consumedCents: number,
  discountPercent: number,
) {
  if (discountPercent >= 100) return grossCents;
  const rate = 1 - discountPercent / 100;
  let covered = Math.min(grossCents, Math.floor(consumedCents / rate));
  while (covered < grossCents && Math.round((covered + 1) * rate) <= consumedCents) {
    covered += 1;
  }
  while (covered > 0 && Math.round(covered * rate) > consumedCents) {
    covered -= 1;
  }
  return covered;
}

export function allocateFlexibleCommitment(
  contractValue: number,
  usage: FlexibleUsage[],
): FlexibleUsageAllocation[] {
  let remainingCents: number = toCents(contractValue);
  return usage.map((entry) => {
    const grossCents = toCents(entry.grossAmount);
    const discount = Math.min(100, Math.max(0, entry.discountPercent));
    const discountedCents = Math.round(grossCents * (1 - discount / 100));
    const consumedCents = Math.min(remainingCents, discountedCents);
    const coveredCents = coveredGrossCents(
      grossCents,
      consumedCents,
      discount,
    );
    const overageCents = Math.max(0, grossCents - coveredCents);
    remainingCents -= consumedCents;
    return {
      ...entry,
      discountedAmount: fromCents(discountedCents),
      commitmentConsumed: fromCents(consumedCents),
      overageAmount: fromCents(overageCents),
      remainingCommitment: fromCents(remainingCents),
    };
  });
}
