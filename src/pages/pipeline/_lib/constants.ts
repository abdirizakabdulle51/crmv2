import type { Doc } from "@/convex/_generated/dataModel.d.ts";

export type LeadStage =
  | "new_lead"
  | "qualified"
  | "discovery"
  | "proposal"
  | "negotiation"
  | "won"
  | "lost";

export const STAGES: LeadStage[] = [
  "new_lead",
  "qualified",
  "discovery",
  "proposal",
  "negotiation",
  "won",
  "lost",
];

export const STAGE_LABELS: Record<LeadStage, string> = {
  new_lead: "New Lead",
  qualified: "Qualified",
  discovery: "Discovery",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

export const STAGE_COLORS: Record<LeadStage, string> = {
  new_lead: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  qualified: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
  discovery: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  proposal: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  negotiation: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  lost: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export const STAGE_BORDER_COLORS: Record<LeadStage, string> = {
  new_lead: "border-t-blue-500",
  qualified: "border-t-indigo-500",
  discovery: "border-t-purple-500",
  proposal: "border-t-amber-500",
  negotiation: "border-t-orange-500",
  won: "border-t-emerald-500",
  lost: "border-t-red-500",
};

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
