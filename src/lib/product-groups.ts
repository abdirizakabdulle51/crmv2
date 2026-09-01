export const PRODUCT_GROUPS = [
  { value: "compute", label: "Compute" },
  { value: "storage", label: "Storage" },
  { value: "network", label: "Network" },
  { value: "databases", label: "Databases" },
  { value: "applications", label: "Applications" },
  { value: "security_compliance", label: "Security & Compliance" },
] as const;

export type ProductGroup = (typeof PRODUCT_GROUPS)[number]["value"];

export function productGroupLabel(value?: string) {
  return PRODUCT_GROUPS.find((group) => group.value === value)?.label ??
    "Unclassified";
}
