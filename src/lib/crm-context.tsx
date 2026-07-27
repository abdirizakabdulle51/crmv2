import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { createContext, useContext } from "react";

export type UserRole =
  | "account_manager"
  | "country_gm"
  | "head_of_business"
  | "ceo";

export type CrmUser = Doc<"users">;

type CrmContextType = {
  currentUser: CrmUser | null | undefined;
  isAdmin: boolean;
  canViewAll: boolean;
};

const CrmContext = createContext<CrmContextType>({
  currentUser: undefined,
  isAdmin: false,
  canViewAll: false,
});

export function CrmProvider({ children }: { children: React.ReactNode }) {
  const currentUser = useQuery(api.users.getCurrentUser, {});

  const isAdmin =
    currentUser?.role === "ceo" || currentUser?.role === "head_of_business";
  const canViewAll = isAdmin;

  return (
    <CrmContext.Provider value={{ currentUser, isAdmin, canViewAll }}>
      {children}
    </CrmContext.Provider>
  );
}

export function useCrm() {
  return useContext(CrmContext);
}

export function getRoleLabel(role: UserRole | undefined): string {
  switch (role) {
    case "account_manager":
      return "Account Manager";
    case "country_gm":
      return "Country GM";
    case "head_of_business":
      return "Head of Business";
    case "ceo":
      return "CEO";
    default:
      return "Unassigned";
  }
}
