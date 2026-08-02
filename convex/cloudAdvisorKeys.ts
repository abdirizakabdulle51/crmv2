import type { Id } from "./_generated/dataModel.d.ts";

export function normalizeCloudAdvisorRecommendedService(service: string) {
  return encodeURIComponent(service.trim().toLowerCase().replace(/\s+/g, " "));
}

export function buildCloudAdvisorRecommendationKey(
  companyId: Id<"companies"> | string,
  rule: string,
  recommendedService: string,
) {
  return `${companyId}:${rule}:${normalizeCloudAdvisorRecommendedService(
    recommendedService,
  )}`;
}
