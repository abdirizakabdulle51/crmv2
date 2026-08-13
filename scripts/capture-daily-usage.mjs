#!/usr/bin/env node
import { ConvexHttpClient } from "convex/browser";
import { internal } from "../convex/_generated/api.js";

const convexUrl =
  process.env.CONVEX_URL ||
  process.env.VITE_CONVEX_URL ||
  process.env.CONVEX_SITE_URL;
const deployKey = process.env.CONVEX_DEPLOY_KEY;

if (!convexUrl) {
  console.error("ERROR: set CONVEX_URL or VITE_CONVEX_URL");
  process.exit(1);
}

if (!deployKey) {
  console.error("ERROR: set CONVEX_DEPLOY_KEY");
  process.exit(1);
}

const client = new ConvexHttpClient(convexUrl);
client.setAdminAuth(deployKey);

const usageDate = process.env.DAILY_USAGE_DATE;
const result = await client.mutation(
  internal.dailyUsage.captureFromManageOneSnapshots,
  usageDate ? { usageDate } : {},
);

console.log(JSON.stringify(result, null, 2));
