import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const snapshotRoot = path.join(root, "snapshot_extracted");
const convexUrl = process.env.VITE_CONVEX_URL ?? "http://127.0.0.1:3210";

const client = new ConvexHttpClient(convexUrl);

function stripConvexMetadata(doc) {
  const { _id, _creationTime, ...rest } = doc;
  return rest;
}

function omitUserReferences(doc) {
  const copy = { ...doc };
  for (const key of Object.keys(copy)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("accountmanager") ||
      lower === "userid" ||
      lower === "createdby" ||
      lower === "updatedby" ||
      lower === "ownerid"
    ) {
      delete copy[key];
    }
  }
  return copy;
}

async function readTable(table) {
  const file = path.join(snapshotRoot, table, "documents.jsonl");
  const content = await readFile(file, "utf8");
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function rowsFor(docs, transform = (doc) => doc) {
  return docs.map((raw) => {
    const oldId = raw._id;
    if (!oldId) {
      throw new Error("Snapshot row is missing _id");
    }
    return {
      oldId,
      doc: transform(stripConvexMetadata(raw)),
    };
  });
}

function requireMappedId(map, table, oldId) {
  const newId = map[oldId];
  if (!newId) {
    throw new Error(`Missing ${table} ID mapping for old ID ${oldId}`);
  }
  return newId;
}

async function main() {
  const counts = {
    countries: 0,
    sectors: 0,
    companies: 0,
    leads: 0,
    serviceCatalog: 0,
    salesTargets: 0,
  };

  const countries = rowsFor(await readTable("countries"));
  const countryIds = await client.mutation(
    api.snapshotImport.insertCountries,
    { rows: countries },
  );
  counts.countries = countries.length;

  const sectors = rowsFor(await readTable("sectors"));
  const sectorIds = await client.mutation(api.snapshotImport.insertSectors, {
    rows: sectors,
  });
  counts.sectors = sectors.length;

  const companies = rowsFor(await readTable("companies"), (doc) => {
    const clean = omitUserReferences(doc);
    clean.countryId = requireMappedId(countryIds, "countries", clean.countryId);
    clean.sectorId = requireMappedId(sectorIds, "sectors", clean.sectorId);
    return clean;
  });
  const companyIds = await client.mutation(
    api.snapshotImport.insertCompanies,
    { rows: companies },
  );
  counts.companies = companies.length;

  const leads = rowsFor(await readTable("leads"), (doc) => {
    const clean = omitUserReferences(doc);
    clean.companyId = requireMappedId(companyIds, "companies", clean.companyId);
    return clean;
  });
  await client.mutation(api.snapshotImport.insertLeads, { rows: leads });
  counts.leads = leads.length;

  const serviceCatalog = rowsFor(await readTable("serviceCatalog"));
  await client.mutation(api.snapshotImport.insertServiceCatalog, {
    rows: serviceCatalog,
  });
  counts.serviceCatalog = serviceCatalog.length;

  const salesTargets = rowsFor(await readTable("salesTargets"), (doc) =>
    omitUserReferences(doc),
  );
  await client.mutation(api.snapshotImport.insertSalesTargets, {
    rows: salesTargets,
  });
  counts.salesTargets = salesTargets.length;

  console.log(JSON.stringify(counts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
