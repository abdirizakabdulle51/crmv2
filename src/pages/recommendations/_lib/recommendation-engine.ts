import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { determineTrend } from "@/pages/at-risk/_lib/risk-utils.ts";

export type Recommendation = {
  companyId: Id<"companies">;
  companyName: string;
  rule: string;
  triggerReason: string;
  recommendedService: string;
  estimatedValue: string; // formatted string - rate for per-GB, monthly for per-instance
  priority: "high" | "medium" | "low";
};

type CompanyUsageProfile = {
  company: Doc<"companies">;
  serviceTypes: Set<string>;
  monthlyTotals: { month: string; total: number }[];
  trend: "growing" | "flat" | "declining";
  sectorName: string;
};

/**
 * Build a usage profile per company from consumption data.
 */
function buildCompanyProfiles(
  companies: Doc<"companies">[],
  consumption: Doc<"consumption">[],
  sectors: Doc<"sectors">[],
): CompanyUsageProfile[] {
  const sectorMap = new Map(sectors.map((s) => [s._id, s.name]));

  return companies.map((company) => {
    const companyEntries = consumption.filter((c) => c.companyId === company._id);
    const serviceTypes = new Set(companyEntries.map((e) => e.serviceType));

    // Build monthly totals
    const byMonth = new Map<string, number>();
    for (const entry of companyEntries) {
      const current = byMonth.get(entry.month) || 0;
      byMonth.set(entry.month, current + entry.amount);
    }
    const monthlyTotals = [...byMonth.entries()]
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const trend = determineTrend(monthlyTotals);
    const sectorName = sectorMap.get(company.sectorId) || "";

    return {
      company,
      serviceTypes,
      monthlyTotals,
      trend,
      sectorName,
    };
  });
}

/**
 * Find a catalog item matching a service type by category or name keywords.
 * Returns the best match's monthly price and billing unit for the estimate.
 */
function findCatalogEstimate(
  catalog: Doc<"serviceCatalog">[],
  serviceKeywords: string[],
): { price: number; billingUnit: string; itemName: string } | null {
  for (const keyword of serviceKeywords) {
    const match = catalog.find(
      (item) =>
        item.serviceCategory.toLowerCase().includes(keyword.toLowerCase()) ||
        item.itemName.toLowerCase().includes(keyword.toLowerCase()),
    );
    if (match) {
      return { price: match.monthlyPrice, billingUnit: match.billingUnit, itemName: match.itemName };
    }
  }
  return null;
}

/** Per-GB items should show rate not a total */
const PER_GB_UNITS = ["gb", "tb", "gb/mo", "gb-month"];

function formatEstimate(price: number, billingUnit: string): string {
  const isPerGb = PER_GB_UNITS.some((u) => billingUnit.toLowerCase().includes(u));
  if (isPerGb) {
    return `$${price.toFixed(3)}/${billingUnit}`;
  }
  return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}/mo per ${billingUnit}`;
}

/**
 * Generate recommendations for all companies based on cross-sell rules.
 */
export function generateRecommendations(
  companies: Doc<"companies">[],
  consumption: Doc<"consumption">[],
  sectors: Doc<"sectors">[],
  catalog: Doc<"serviceCatalog">[],
): Recommendation[] {
  const profiles = buildCompanyProfiles(companies, consumption, sectors);
  const recommendations: Recommendation[] = [];

  for (const profile of profiles) {
    const { company, serviceTypes, trend, sectorName } = profile;

    // Skip companies with no usage data
    if (serviceTypes.size === 0) continue;

    // Rule 1: ECS with no backup (CSBS or VBS)
    if (serviceTypes.has("ECS") && !serviceTypes.has("CSBS") && !serviceTypes.has("VBS")) {
      const estimate = findCatalogEstimate(catalog, ["CSBS", "VBS", "backup"]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "backup",
        triggerReason: "Uses ECS compute but has no backup service (CSBS/VBS)",
        recommendedService: "CSBS or VBS (Cloud Backup)",
        estimatedValue: estimate ? formatEstimate(estimate.price, estimate.billingUnit) : "See catalog",
        priority: "high",
      });
    }

    // Rule 2: High EVS/SFS with no OBS
    if ((serviceTypes.has("EVS") || serviceTypes.has("SFS")) && !serviceTypes.has("OBS")) {
      const estimate = findCatalogEstimate(catalog, ["OBS", "object storage"]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "object_storage",
        triggerReason: "Uses block/file storage (EVS/SFS) but no object storage (OBS)",
        recommendedService: "OBS (Object Storage)",
        estimatedValue: estimate ? formatEstimate(estimate.price, estimate.billingUnit) : "See catalog",
        priority: "medium",
      });
    }

    // Rule 3: ECS-CCE with no LTS
    if (serviceTypes.has("ECS-CCE") && !serviceTypes.has("LTS")) {
      const estimate = findCatalogEstimate(catalog, ["LTS", "log"]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "log_management",
        triggerReason: "Uses container engine (ECS-CCE) but no log management (LTS)",
        recommendedService: "LTS (Log Tank Service)",
        estimatedValue: estimate ? formatEstimate(estimate.price, estimate.billingUnit) : "See catalog",
        priority: "medium",
      });
    }

    // Rule 4: BMS or high ECS with no VPN/VPN Gateway
    if (
      (serviceTypes.has("BMS") || serviceTypes.has("ECS")) &&
      !serviceTypes.has("VPN") &&
      !serviceTypes.has("VPN Gateway")
    ) {
      const estimate = findCatalogEstimate(catalog, ["VPN", "vpn gateway", "connectivity"]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "secure_connectivity",
        triggerReason: "Uses BMS/ECS compute but no VPN or VPN Gateway for secure connectivity",
        recommendedService: "VPN or VPN Gateway",
        estimatedValue: estimate ? formatEstimate(estimate.price, estimate.billingUnit) : "See catalog",
        priority: "medium",
      });
    }

    // Rule 5: Growing usage with no WAF
    if (trend === "growing" && !serviceTypes.has("WAF")) {
      const estimate = findCatalogEstimate(catalog, ["WAF", "web application firewall"]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "waf",
        triggerReason: "Usage is growing but no WAF protection in place",
        recommendedService: "WAF (Web Application Firewall)",
        estimatedValue: estimate ? formatEstimate(estimate.price, estimate.billingUnit) : "See catalog",
        priority: "medium",
      });
    }

    // Rule 6: Overdue/delinquent + growing → flag for AM
    if (
      (company.paymentStatus === "overdue" || company.paymentStatus === "delinquent") &&
      trend === "growing"
    ) {
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "payment_risk",
        triggerReason: `Payment status is ${company.paymentStatus} while usage continues growing — high revenue risk`,
        recommendedService: "AM Review Required",
        estimatedValue: "N/A — revenue protection",
        priority: "high",
      });
    }

    // Rule 7: Banking/fintech sector with no CBH
    const isBankingFintech = ["bank", "banking", "fintech", "financial"].some(
      (kw) => sectorName.toLowerCase().includes(kw),
    );
    if (isBankingFintech && !serviceTypes.has("CBH")) {
      const estimate = findCatalogEstimate(catalog, ["CBH", "bastion", "compliance"]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "compliance",
        triggerReason: `Banking/fintech sector (${sectorName}) but no CBH for compliance audit`,
        recommendedService: "CBH (Cloud Bastion Host)",
        estimatedValue: estimate ? formatEstimate(estimate.price, estimate.billingUnit) : "See catalog",
        priority: "high",
      });
    }
  }

  // Sort: high priority first, then medium, then low
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}
