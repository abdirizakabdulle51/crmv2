export function matchesOwnerFilter(
  accountManagerId: string | undefined,
  ownerFilter: string,
  currentUserId?: string,
) {
  if (ownerFilter === "all") return true;
  if (ownerFilter === "mine") return accountManagerId === currentUserId;
  if (ownerFilter === "unassigned") return !accountManagerId;
  return accountManagerId === ownerFilter;
}
