import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export async function assertUniqueAccountTransactionId(
  ctx: MutationCtx,
  accountId: Id<"receivingAccounts">,
  value: string,
) {
  const transactionId = value.trim();
  const [entry, payment, expense] = await Promise.all([
    ctx.db
      .query("accountTransactions")
      .withIndex("by_account_transaction", (q) =>
        q.eq("accountId", accountId).eq("transactionId", transactionId),
      )
      .first(),
    ctx.db
      .query("invoicePayments")
      .withIndex("by_account_transaction", (q) =>
        q
          .eq("receivingAccountId", accountId)
          .eq("transactionId", transactionId),
      )
      .first(),
    ctx.db
      .query("expenseRequests")
      .withIndex("by_account_transaction", (q) =>
        q
          .eq("fundingAccountId", accountId)
          .eq("paymentTransactionId", transactionId),
      )
      .first(),
  ]);
  if (entry || payment || expense) {
    throw new ConvexError({
      code: "CONFLICT",
      message: "This transaction ID is already recorded for the account",
    });
  }
}
