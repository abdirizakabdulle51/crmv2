/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activities from "../activities.js";
import type * as aiRecommendations from "../aiRecommendations.js";
import type * as auth from "../auth.js";
import type * as authorization from "../authorization.js";
import type * as cloudAlarms from "../cloudAlarms.js";
import type * as cloudCapacity from "../cloudCapacity.js";
import type * as cloudCapacitySnapshots from "../cloudCapacitySnapshots.js";
import type * as cloudHostGroups from "../cloudHostGroups.js";
import type * as companies from "../companies.js";
import type * as companiesImport from "../companiesImport.js";
import type * as consumption from "../consumption.js";
import type * as countries from "../countries.js";
import type * as dashboard from "../dashboard.js";
import type * as documentation from "../documentation.js";
import type * as http from "../http.js";
import type * as leads from "../leads.js";
import type * as leadsImport from "../leadsImport.js";
import type * as manageOneTenants from "../manageOneTenants.js";
import type * as pingResults from "../pingResults.js";
import type * as pingTargets from "../pingTargets.js";
import type * as quotes from "../quotes.js";
import type * as recommendations from "../recommendations.js";
import type * as regionConsumers from "../regionConsumers.js";
import type * as salesTargets from "../salesTargets.js";
import type * as sectors from "../sectors.js";
import type * as serviceCatalog from "../serviceCatalog.js";
import type * as serviceHealthResults from "../serviceHealthResults.js";
import type * as serviceHealthTargets from "../serviceHealthTargets.js";
import type * as snapshotImport from "../snapshotImport.js";
import type * as tenantUsageHistory from "../tenantUsageHistory.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activities: typeof activities;
  aiRecommendations: typeof aiRecommendations;
  auth: typeof auth;
  authorization: typeof authorization;
  cloudAlarms: typeof cloudAlarms;
  cloudCapacity: typeof cloudCapacity;
  cloudCapacitySnapshots: typeof cloudCapacitySnapshots;
  cloudHostGroups: typeof cloudHostGroups;
  companies: typeof companies;
  companiesImport: typeof companiesImport;
  consumption: typeof consumption;
  countries: typeof countries;
  dashboard: typeof dashboard;
  documentation: typeof documentation;
  http: typeof http;
  leads: typeof leads;
  leadsImport: typeof leadsImport;
  manageOneTenants: typeof manageOneTenants;
  pingResults: typeof pingResults;
  pingTargets: typeof pingTargets;
  quotes: typeof quotes;
  recommendations: typeof recommendations;
  regionConsumers: typeof regionConsumers;
  salesTargets: typeof salesTargets;
  sectors: typeof sectors;
  serviceCatalog: typeof serviceCatalog;
  serviceHealthResults: typeof serviceHealthResults;
  serviceHealthTargets: typeof serviceHealthTargets;
  snapshotImport: typeof snapshotImport;
  tenantUsageHistory: typeof tenantUsageHistory;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
