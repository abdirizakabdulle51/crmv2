import { ConvexError } from "convex/values";

export type MoneyCents = number & { readonly __moneyCents: unique symbol };

export type CalculableLineItem = {
  quantity: number;
  monthlyUnitPrice: number;
  monthlyTotal?: number;
  yearlyTotal?: number;
};

export type CalculatedLineItem<T extends CalculableLineItem> = Omit<
  T,
  "monthlyTotal" | "yearlyTotal"
> & {
  monthlyTotal: number;
  yearlyTotal: number;
};

export type InvoiceTotals = {
  subtotal: number;
  monthlyTotal: number;
  yearlyTotal: number;
  grandTotal: number;
};

export type ContractChargeInput = {
  includedQuantity: number;
  contractUnitPrice: number;
  discountType?: "percentage" | "amount";
  discountValue?: number;
  overageUnitPrice?: number;
  actualQuantity: number;
  monthFraction: number;
};

export function withLineMoneyCents<T extends CalculableLineItem>(line: T) {
  return {
    ...line,
    monthlyUnitPriceCents: toCents(line.monthlyUnitPrice),
    monthlyTotalCents: toCents(line.monthlyTotal ?? 0),
    yearlyTotalCents: toCents(line.yearlyTotal ?? 0),
  };
}

export function withInvoiceMoneyCents(totals: InvoiceTotals, amountPaid = 0) {
  const balanceDue = calculateBalance(totals.grandTotal, amountPaid);
  return {
    ...totals,
    amountPaid,
    balanceDue,
    subtotalCents: toCents(totals.subtotal),
    monthlyTotalCents: toCents(totals.monthlyTotal),
    yearlyTotalCents: toCents(totals.yearlyTotal),
    grandTotalCents: toCents(totals.grandTotal),
    amountPaidCents: toCents(amountPaid),
    balanceDueCents: toCents(balanceDue),
  };
}

function assertFinite(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label} must be a finite number`,
    });
  }
}

export function toCents(value: number, label = "Amount"): MoneyCents {
  assertFinite(value, label);
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + 1e-9) * 100)) as MoneyCents;
}

export function fromCents(value: MoneyCents | number): number {
  assertFinite(value, "Amount in cents");
  if (!Number.isSafeInteger(value)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Amount in cents must be a safe integer",
    });
  }
  return value / 100;
}

export function roundMoney(value: number): number {
  return fromCents(toCents(value));
}

export function roundQuantity(value: number, precision = 6): number {
  assertFinite(value, "Quantity");
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function normalizeRate(value: number, label = "Rate"): number {
  assertFinite(value, label);
  if (value < 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label} cannot be negative`,
    });
  }
  return roundQuantity(value, 6);
}

export function addCents(...values: Array<MoneyCents | number>): MoneyCents {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Calculated monetary amount exceeds the supported range",
    });
  }
  return total as MoneyCents;
}

export function sumMoney(values: number[]): number {
  return fromCents(addCents(...values.map((value) => toCents(value))));
}

export function allocateMoney<T extends { weight: number }>(
  total: number,
  recipients: T[],
): Array<T & { amount: number }> {
  const positive = recipients.filter((recipient) => recipient.weight > 0);
  const totalWeight = positive.reduce(
    (sum, recipient) => sum + recipient.weight,
    0,
  );
  if (positive.length === 0 || totalWeight <= 0) return [];

  const totalCents = toCents(total);
  let allocatedCents = 0;
  return positive.map((recipient, index) => {
    const amountCents =
      index === positive.length - 1
        ? totalCents - allocatedCents
        : Math.round((totalCents * recipient.weight) / totalWeight);
    allocatedCents += amountCents;
    return { ...recipient, amount: fromCents(amountCents) };
  });
}

export function multiplyMoney(
  unitPrice: number,
  quantity: number,
  label = "Line item",
): number {
  assertFinite(quantity, `${label} quantity`);
  if (quantity < 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label} quantity cannot be negative`,
    });
  }
  assertFinite(unitPrice, `${label} unit price`);
  if (unitPrice < 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label} unit price cannot be negative`,
    });
  }
  // Unit rates can legitimately be fractions of one cent (for example per-GB
  // cloud pricing). Round only the extended line amount to integer cents.
  return fromCents(toCents(unitPrice * quantity, `${label} total`));
}

export function multiplySignedMoney(
  unitAmount: number,
  quantity: number,
  label = "Line item",
): number {
  assertFinite(quantity, `${label} quantity`);
  if (quantity < 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: `${label} quantity cannot be negative`,
    });
  }
  assertFinite(unitAmount, `${label} unit amount`);
  return roundMoney(unitAmount * quantity);
}

export function calculateLineItem<T extends CalculableLineItem>(
  line: T,
  index?: number,
): CalculatedLineItem<T> {
  const label = index === undefined ? "Line item" : `Line item ${index + 1}`;
  const monthlyTotal = multiplyMoney(
    line.monthlyUnitPrice,
    line.quantity,
    label,
  );
  return {
    ...line,
    monthlyTotal,
    yearlyTotal: fromCents((toCents(monthlyTotal) * 12) as MoneyCents),
  };
}

export function calculateLineItems<T extends CalculableLineItem>(
  lines: T[],
): CalculatedLineItem<T>[] {
  if (lines.length === 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "At least one line item is required",
    });
  }
  return lines.map((line, index) => calculateLineItem(line, index));
}

export function calculateInvoiceTotals(
  lines: Array<Pick<CalculableLineItem, "monthlyTotal" | "yearlyTotal">>,
): InvoiceTotals {
  const monthlyCents = lines.map((line, index) =>
    toCents(line.monthlyTotal ?? 0, `Line item ${index + 1} monthly total`),
  );
  const yearlyCents = lines.map((line, index) =>
    toCents(line.yearlyTotal ?? 0, `Line item ${index + 1} yearly total`),
  );
  const monthlyTotal = fromCents(addCents(...monthlyCents));
  const yearlyTotal = fromCents(addCents(...yearlyCents));
  return {
    subtotal: monthlyTotal,
    monthlyTotal,
    yearlyTotal,
    grandTotal: monthlyTotal,
  };
}

export function calculateBalance(grandTotal: number, amountPaid: number) {
  const balanceCents =
    toCents(grandTotal, "Grand total") - toCents(amountPaid, "Amount paid");
  if (balanceCents < 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Amount paid cannot exceed the invoice grand total",
    });
  }
  return fromCents(balanceCents as MoneyCents);
}

export function assertSupportedCurrency(currency: string | undefined) {
  const normalized = (currency ?? "USD").trim().toUpperCase();
  if (normalized !== "USD") {
    throw new ConvexError({
      code: "UNSUPPORTED_CURRENCY",
      message: `Currency ${normalized || "[blank]"} is not supported until exchange rates are configured`,
    });
  }
  return "USD" as const;
}

export function monetaryDifference(expected: number, actual: number) {
  return fromCents(Math.abs(toCents(expected) - toCents(actual)) as MoneyCents);
}

export function calculateTaxedLine(args: {
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
}) {
  for (const [label, value] of [
    ["Discount percent", args.discountPercent],
    ["Tax rate", args.taxRate],
  ] as const) {
    assertFinite(value, label);
    if (value < 0 || value > 100) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `${label} must be between 0 and 100`,
      });
    }
  }
  const baseCents = toCents(
    multiplyMoney(args.unitPrice, args.quantity),
    "Line subtotal",
  );
  const discountCents = Math.round(
    (baseCents * args.discountPercent) / 100,
  ) as MoneyCents;
  const taxableCents = (baseCents - discountCents) as MoneyCents;
  const taxCents = Math.round(
    (taxableCents * args.taxRate) / 100,
  ) as MoneyCents;
  return {
    subtotal: fromCents(baseCents),
    discount: fromCents(discountCents),
    tax: fromCents(taxCents),
    total: fromCents(addCents(taxableCents, taxCents)),
  };
}

export function calculateContractCharges(args: ContractChargeInput) {
  const includedQuantity = roundQuantity(args.includedQuantity);
  const actualQuantity = roundQuantity(args.actualQuantity);
  const monthFraction = Math.min(1, Math.max(0, args.monthFraction));
  const contractUnitPrice = normalizeRate(
    args.contractUnitPrice,
    "Contract unit price",
  );
  const overageUnitPrice = normalizeRate(
    args.overageUnitPrice ?? contractUnitPrice,
    "Overage unit price",
  );
  const proratedIncludedQuantity = roundQuantity(
    includedQuantity * monthFraction,
  );
  const grossBaseAmount = multiplyMoney(
    contractUnitPrice,
    proratedIncludedQuantity,
    "Contract base charge",
  );

  let fullDiscount = 0;
  const fullGross = contractUnitPrice * includedQuantity;
  if (args.discountValue !== undefined) {
    if (!Number.isFinite(args.discountValue) || args.discountValue < 0) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Contract discount cannot be negative",
      });
    }
    if (args.discountType === "percentage" && args.discountValue > 100) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Contract percentage discount must be between 0 and 100",
      });
    }
    fullDiscount =
      args.discountType === "percentage"
        ? Math.min(fullGross, fullGross * (args.discountValue / 100))
        : args.discountType === "amount"
          ? Math.min(fullGross, args.discountValue)
          : 0;
  }
  const discountAmount = roundMoney(fullDiscount * monthFraction);
  const overageQuantity = roundQuantity(
    Math.max(0, actualQuantity - proratedIncludedQuantity),
  );
  const overageAmount = multiplyMoney(
    overageUnitPrice,
    overageQuantity,
    "Contract overage charge",
  );
  const total = sumMoney([grossBaseAmount, -discountAmount, overageAmount]);

  return {
    proratedIncludedQuantity,
    grossBaseAmount,
    discountAmount,
    overageQuantity,
    overageUnitPrice,
    overageAmount,
    total,
  };
}

export function calculateMonthProration(args: {
  startDate: number;
  endDate: number;
  month: string;
}) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(args.month);
  if (!match) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Source month must use YYYY-MM format",
    });
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const monthStart = Date.UTC(year, monthIndex, 1);
  const monthEnd = Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999);
  const totalDays = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const overlapStart = Math.max(monthStart, args.startDate);
  const overlapEnd = Math.min(monthEnd, args.endDate);
  if (overlapStart > overlapEnd) {
    return { activeDays: 0, totalDays, fraction: 0 };
  }
  const activeDays =
    Math.floor(
      (Date.UTC(
        new Date(overlapEnd).getUTCFullYear(),
        new Date(overlapEnd).getUTCMonth(),
        new Date(overlapEnd).getUTCDate(),
      ) -
        Date.UTC(
          new Date(overlapStart).getUTCFullYear(),
          new Date(overlapStart).getUTCMonth(),
          new Date(overlapStart).getUTCDate(),
        )) /
        (24 * 60 * 60 * 1000),
    ) + 1;
  return { activeDays, totalDays, fraction: activeDays / totalDays };
}
