import { formatCurrency } from "@/lib/format.ts";
import type { Recommendation } from "./rules.ts";

export const ADVISOR_CATEGORY_OPTIONS = [
  "All",
  "Cost Optimization",
  "Security",
  "Reliability",
  "Performance",
  "Backup & Recovery",
  "Capacity / Limits",
  "Sales Opportunities",
] as const;

export type AdvisorCategory = (typeof ADVISOR_CATEGORY_OPTIONS)[number];

export const ADVISOR_RULE_LABELS: Record<string, string> = {
  backup: "Backup",
  object_storage: "Object Storage",
  log_management: "Log Management",
  secure_connectivity: "Connectivity",
  waf: "WAF",
  payment_risk: "Payment Risk",
  compliance: "Compliance",
};

const RULE_CATEGORIES: Record<string, AdvisorCategory> = {
  backup: "Backup & Recovery",
  object_storage: "Cost Optimization",
  log_management: "Reliability",
  secure_connectivity: "Security",
  waf: "Security",
  payment_risk: "Sales Opportunities",
  compliance: "Security",
};

export function getAdvisorCategory(rule: string): AdvisorCategory {
  return RULE_CATEGORIES[rule] ?? "Sales Opportunities";
}

export function getAdvisorRuleLabel(rule: string) {
  return ADVISOR_RULE_LABELS[rule] ?? rule;
}

export function getAdvisorRecommendationTitle(
  recommendation: Pick<Recommendation, "rule" | "recommendedService">,
) {
  const ruleLabel =
    ADVISOR_RULE_LABELS[recommendation.rule] ?? "Recommendation";
  return `${ruleLabel}: ${recommendation.recommendedService}`;
}

export function getAdvisorRecommendedAction(
  recommendation: Pick<Recommendation, "recommendedService">,
) {
  return `Add/Review ${recommendation.recommendedService}.`;
}

export function formatAdvisorEstimatedValue(
  recommendation: Pick<
    Recommendation,
    "estimatedMonthlyValue" | "estimatedValue"
  >,
) {
  return typeof recommendation.estimatedMonthlyValue === "number"
    ? `${formatCurrency(recommendation.estimatedMonthlyValue)}/mo`
    : recommendation.estimatedValue;
}
