export type RecommendationPriority = "high" | "medium" | "low";

export type Recommendation<CompanyId = string> = {
  companyId: CompanyId;
  companyName: string;
  rule: string;
  triggerReason: string;
  recommendedService: string;
  estimatedValue: string;
  priority: RecommendationPriority;
};

type CompanyLike<CompanyId = string, SectorId = string> = {
  _id: CompanyId;
  name: string;
  sectorId: SectorId;
  paymentStatus?: "current" | "overdue" | "delinquent";
};

type ConsumptionLike<CompanyId = string> = {
  companyId: CompanyId;
  serviceType: string;
  month: string;
  amount: number;
};

type SectorLike<SectorId = string> = {
  _id: SectorId;
  name: string;
};

type CatalogLike = {
  serviceCategory: string;
  itemName: string;
  billingUnit: string;
  monthlyPrice: number;
};

type CompanyUsageProfile<Company extends CompanyLike> = {
  company: Company;
  serviceTypes: Set<string>;
  monthlyTotals: { month: string; total: number }[];
  trend: "growing" | "flat" | "declining";
  sectorName: string;
};

function determineTrend(monthlyTotals: { month: string; total: number }[]) {
  if (monthlyTotals.length < 2) {
    return "flat" as const;
  }

  const sorted = [...monthlyTotals].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  const recent = sorted.slice(-3);
  if (recent.length < 2) {
    return "flat" as const;
  }

  const first = recent[0].total;
  const last = recent[recent.length - 1].total;
  const change = first === 0 ? (last > 0 ? 1 : 0) : (last - first) / first;

  if (change > 0.1) {
    return "growing" as const;
  }
  if (change < -0.1) {
    return "declining" as const;
  }
  return "flat" as const;
}

function buildCompanyProfiles<
  CompanyId extends string,
  SectorId extends string,
  Company extends CompanyLike<CompanyId, SectorId>,
>(
  companies: Company[],
  consumption: ConsumptionLike<CompanyId>[],
  sectors: SectorLike<SectorId>[],
): CompanyUsageProfile<Company>[] {
  const sectorMap = new Map(sectors.map((sector) => [sector._id, sector.name]));

  return companies.map((company) => {
    const companyEntries = consumption.filter(
      (entry) => entry.companyId === company._id,
    );
    const serviceTypes = new Set(
      companyEntries.map((entry) => entry.serviceType),
    );

    const byMonth = new Map<string, number>();
    for (const entry of companyEntries) {
      const current = byMonth.get(entry.month) || 0;
      byMonth.set(entry.month, current + entry.amount);
    }

    const monthlyTotals = [...byMonth.entries()]
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      company,
      serviceTypes,
      monthlyTotals,
      trend: determineTrend(monthlyTotals),
      sectorName: sectorMap.get(company.sectorId) || "",
    };
  });
}

function findCatalogEstimate(
  catalog: CatalogLike[],
  serviceKeywords: string[],
): { price: number; billingUnit: string; itemName: string } | null {
  for (const keyword of serviceKeywords) {
    const lowerKeyword = keyword.toLowerCase();
    const match = catalog.find(
      (item) =>
        item.serviceCategory.toLowerCase().includes(lowerKeyword) ||
        item.itemName.toLowerCase().includes(lowerKeyword),
    );
    if (match) {
      return {
        price: match.monthlyPrice,
        billingUnit: match.billingUnit,
        itemName: match.itemName,
      };
    }
  }
  return null;
}

const PER_GB_UNITS = ["gb", "tb", "gb/mo", "gb-month"];

function formatEstimate(price: number, billingUnit: string): string {
  const isPerGb = PER_GB_UNITS.some((unit) =>
    billingUnit.toLowerCase().includes(unit),
  );
  if (isPerGb) {
    return `$${price.toFixed(3)}/${billingUnit}`;
  }
  return `$${price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
  })}/mo per ${billingUnit}`;
}

export function generateRecommendations<
  CompanyId extends string,
  SectorId extends string,
  Company extends CompanyLike<CompanyId, SectorId>,
>(
  companies: Company[],
  consumption: ConsumptionLike<CompanyId>[],
  sectors: SectorLike<SectorId>[],
  catalog: CatalogLike[],
): Recommendation<CompanyId>[] {
  const profiles = buildCompanyProfiles(companies, consumption, sectors);
  const recommendations: Recommendation<CompanyId>[] = [];

  for (const profile of profiles) {
    const { company, serviceTypes, trend, sectorName } = profile;

    if (serviceTypes.size === 0) continue;

    if (
      serviceTypes.has("ECS") &&
      !serviceTypes.has("CSBS") &&
      !serviceTypes.has("VBS")
    ) {
      const estimate = findCatalogEstimate(catalog, ["CSBS", "VBS", "backup"]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "backup",
        triggerReason: "Uses ECS compute but has no backup service (CSBS/VBS)",
        recommendedService: "CSBS or VBS (Cloud Backup)",
        estimatedValue: estimate
          ? formatEstimate(estimate.price, estimate.billingUnit)
          : "See catalog",
        priority: "high",
      });
    }

    if (
      (serviceTypes.has("EVS") || serviceTypes.has("SFS")) &&
      !serviceTypes.has("OBS")
    ) {
      const estimate = findCatalogEstimate(catalog, ["OBS", "object storage"]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "object_storage",
        triggerReason:
          "Uses block/file storage (EVS/SFS) but no object storage (OBS)",
        recommendedService: "OBS (Object Storage)",
        estimatedValue: estimate
          ? formatEstimate(estimate.price, estimate.billingUnit)
          : "See catalog",
        priority: "medium",
      });
    }

    if (serviceTypes.has("ECS-CCE") && !serviceTypes.has("LTS")) {
      const estimate = findCatalogEstimate(catalog, ["LTS", "log"]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "log_management",
        triggerReason:
          "Uses container engine (ECS-CCE) but no log management (LTS)",
        recommendedService: "LTS (Log Tank Service)",
        estimatedValue: estimate
          ? formatEstimate(estimate.price, estimate.billingUnit)
          : "See catalog",
        priority: "medium",
      });
    }

    if (
      (serviceTypes.has("BMS") || serviceTypes.has("ECS")) &&
      !serviceTypes.has("VPN") &&
      !serviceTypes.has("VPN Gateway")
    ) {
      const estimate = findCatalogEstimate(catalog, [
        "VPN",
        "vpn gateway",
        "connectivity",
      ]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "secure_connectivity",
        triggerReason:
          "Uses BMS/ECS compute but no VPN or VPN Gateway for secure connectivity",
        recommendedService: "VPN or VPN Gateway",
        estimatedValue: estimate
          ? formatEstimate(estimate.price, estimate.billingUnit)
          : "See catalog",
        priority: "medium",
      });
    }

    if (trend === "growing" && !serviceTypes.has("WAF")) {
      const estimate = findCatalogEstimate(catalog, [
        "WAF",
        "web application firewall",
      ]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "waf",
        triggerReason: "Usage is growing but no WAF protection in place",
        recommendedService: "WAF (Web Application Firewall)",
        estimatedValue: estimate
          ? formatEstimate(estimate.price, estimate.billingUnit)
          : "See catalog",
        priority: "medium",
      });
    }

    if (
      (company.paymentStatus === "overdue" ||
        company.paymentStatus === "delinquent") &&
      trend === "growing"
    ) {
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "payment_risk",
        triggerReason: `Payment status is ${company.paymentStatus} while usage continues growing - high revenue risk`,
        recommendedService: "AM Review Required",
        estimatedValue: "N/A - revenue protection",
        priority: "high",
      });
    }

    const isBankingFintech = ["bank", "banking", "fintech", "financial"].some(
      (keyword) => sectorName.toLowerCase().includes(keyword),
    );
    if (isBankingFintech && !serviceTypes.has("CBH")) {
      const estimate = findCatalogEstimate(catalog, [
        "CBH",
        "bastion",
        "compliance",
      ]);
      recommendations.push({
        companyId: company._id,
        companyName: company.name,
        rule: "compliance",
        triggerReason: `Banking/fintech sector (${sectorName}) but no CBH for compliance audit`,
        recommendedService: "CBH (Cloud Bastion Host)",
        estimatedValue: estimate
          ? formatEstimate(estimate.price, estimate.billingUnit)
          : "See catalog",
        priority: "high",
      });
    }
  }

  const priorityOrder: Record<RecommendationPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  recommendations.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );

  return recommendations;
}
