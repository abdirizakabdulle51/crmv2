import type { CrmUser } from "@/lib/crm-context.tsx";

export const isDrMode = import.meta.env.VITE_DR_MODE === "true";

export const drCurrentUser = {
  _id: "dr-head-of-business",
  _creationTime: Date.now(),
  name: "Abdirizak Abdulle",
  email: "dr@htgclouds.com",
  role: "head_of_business",
  tokenIdentifier: "dr-mode",
  disabled: false,
} as unknown as CrmUser;
