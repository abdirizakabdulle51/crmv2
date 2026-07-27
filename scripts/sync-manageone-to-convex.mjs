import { ConvexHttpClient } from "convex/browser";
import { internal } from "../convex/_generated/api.js";
import fs from "node:fs";
import path from "node:path";

const convexUrl = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
const deployKey = process.env.CONVEX_DEPLOY_KEY;

if (!convexUrl) {
  throw new Error("Set CONVEX_URL or VITE_CONVEX_URL before running sync");
}

if (!deployKey) {
  throw new Error("Set CONVEX_DEPLOY_KEY before running sync");
}

const inputPath = path.resolve(
  process.env.MANAGEONE_TENANTS_JSON ??
    "C:/Users/cabdi/Downloads/crm-seed/manageone_tenants.json",
);

const client = new ConvexHttpClient(convexUrl);
client.setAdminAuth(deployKey);

function optionalNumber(value) {
  if (value == null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const tenants = JSON.parse(fs.readFileSync(inputPath, "utf-8")).map((tenant) => ({
  vdcId: tenant.vdc_id,
  domainId: tenant.domain_id ?? undefined,
  name: tenant.name,
  level: optionalNumber(tenant.level),
  upperVdcId: tenant.upper_vdc_id ?? undefined,
  enabled: tenant.enabled ?? undefined,
  managerName: tenant.manager_name ?? undefined,
  managerPhone: tenant.manager_phone ?? undefined,
  managerEmail: tenant.manager_email ?? undefined,
  ecsUsed: optionalNumber(tenant.ecs_used),
  evsUsed: optionalNumber(tenant.evs_used),
  projectCount: optionalNumber(tenant.project_count),
}));

const count = await client.mutation(internal.manageOneTenants.bulkUpsert, {
  tenants,
});

console.log(`Upserted ${count} ManageOne tenants`);
