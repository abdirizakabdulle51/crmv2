import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Runs at 06:00 Africa/Mogadishu. The overdue marker itself owns the
// business-day cutoff logic so manual and scheduled runs behave the same.
crons.daily(
  "mark overdue invoices",
  { hourUTC: 3, minuteUTC: 0 },
  internal.invoices.markOverdueInvoices,
  {},
);

crons.daily(
  "send internal overdue invoice reminders",
  { hourUTC: 3, minuteUTC: 15 },
  internal.invoices.sendInternalOverdueReminders,
  {},
);

crons.daily(
  "send customer overdue invoice reminders",
  { hourUTC: 3, minuteUTC: 30 },
  internal.invoices.sendCustomerOverdueReminders,
  {},
);

export default crons;
