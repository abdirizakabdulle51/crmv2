import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Runs at 06:00 Africa/Mogadishu. The overdue marker itself owns the
// business-day cutoff logic so manual and scheduled runs behave the same.
crons.daily(
  "mark overdue invoices",
  { hourUTC: 3, minuteUTC: 0 },
  internal.invoices.markOverdueInvoices,
);

export default crons;
