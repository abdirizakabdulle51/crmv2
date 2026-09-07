export const DEFAULT_PAYMENT_TERM_DAYS = 7;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function paymentTermDaysOrDefault(paymentTermDays?: number) {
  return paymentTermDays ?? DEFAULT_PAYMENT_TERM_DAYS;
}

export function defaultDueDateForIssue(
  issueDate: number,
  paymentTermDays = DEFAULT_PAYMENT_TERM_DAYS,
) {
  return issueDate + paymentTermDays * MS_PER_DAY;
}
