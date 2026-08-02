import { describe, expect, it } from "vitest";
import {
  formatAdvisorEstimatedValue,
  getAdvisorCategory,
  getAdvisorRecommendationTitle,
  getAdvisorRecommendedAction,
  getAdvisorRuleLabel,
} from "./advisorPresentation";

describe("advisorPresentation", () => {
  it("maps rule keys to Cloud Advisor categories and labels", () => {
    expect(getAdvisorCategory("backup")).toBe("Backup & Recovery");
    expect(getAdvisorCategory("object_storage")).toBe("Cost Optimization");
    expect(getAdvisorCategory("waf")).toBe("Security");
    expect(getAdvisorCategory("unknown_rule")).toBe("Sales Opportunities");
    expect(getAdvisorRuleLabel("secure_connectivity")).toBe("Connectivity");
    expect(getAdvisorRuleLabel("custom_rule")).toBe("custom_rule");
  });

  it("formats recommendation title and action text from existing fields", () => {
    const recommendation = {
      rule: "waf",
      recommendedService: "WAF",
    };

    expect(getAdvisorRecommendationTitle(recommendation)).toBe("WAF: WAF");
    expect(getAdvisorRecommendedAction(recommendation)).toBe("Add/Review WAF.");
  });

  it("formats monthly estimate when numeric value is available", () => {
    expect(
      formatAdvisorEstimatedValue({
        estimatedMonthlyValue: 493.344,
        estimatedValue: "Estimated upsell: ~$493.34/month",
      }),
    ).toBe("$493.34/mo");
  });

  it("falls back to existing estimatedValue text when numeric value is absent", () => {
    expect(
      formatAdvisorEstimatedValue({
        estimatedValue: "See catalog",
      }),
    ).toBe("See catalog");
  });
});
