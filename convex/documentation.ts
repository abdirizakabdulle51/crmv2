import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel.d.ts";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { isCeoOrHob } from "./authorization";

type Ctx = QueryCtx | MutationCtx;

type SeedDocumentationSection = {
  slug: string;
  title: string;
  group: string;
  content: string;
  order: number;
  visibility: "public" | "restricted";
};

async function getCurrentUserOrThrow(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "User not logged in",
    });
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();

  if (!user) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "User profile not found",
    });
  }

  return user;
}

function assertCanEditDocumentation(user: Doc<"users">) {
  if (isCeoOrHob(user)) {
    return;
  }
  throw new ConvexError({
    code: "FORBIDDEN",
    message: "Only CEO or Head of Business can edit documentation",
  });
}

function visibleToUser(
  section: Doc<"documentationSections">,
  user: Doc<"users">,
) {
  return section.visibility === "public" || isCeoOrHob(user);
}

const INITIAL_DOCUMENTATION_SECTIONS: SeedDocumentationSection[] = [
  {
    slug: "roles-and-access",
    title: "Roles & Access",
    group: "Team Guide",
    order: 1,
    visibility: "public",
    content: `HTGCLOUDS CRM is the internal tool for managing companies, sales pipeline, usage-based quoting, and cloud infrastructure monitoring in one place. Everyone with a login sees the same navigation sidebar, but what each person can actually do — and to which records — depends on their role.

| Role | Scope |
|---|---|
| **Account Manager (AM)** | Can only view/manage companies, leads, quotes, and usage for companies assigned to them personally. |
| **Country GM** | Can view/manage everything belonging to companies and AMs within their assigned country. |
| **Head of Business (HOB)** | Full access across all countries and companies. |
| **CEO** | Full access across everything. |

Permission checks are enforced on the backend, not just hidden in the UI — an AM genuinely cannot pull up or edit a company that isn't theirs, even by guessing a URL.`,
  },
  {
    slug: "navigating-the-crm",
    title: "Navigating the CRM",
    group: "Team Guide",
    order: 2,
    visibility: "public",
    content: `**Dashboard** — Personal landing page. Greets you by name and role, shows key metrics as clickable cards (revenue, pipeline, targets), with a year selector.

**Companies** — The core company list, filterable by status/AM/etc. Click into a company for its detail page: contract and payment status, contact info, linked ManageOne tenant (if provisioned), and a Usage Trends chart showing resource consumption over time.

**Pipeline** — Sales deals ("leads") moving through stages: New Lead to Qualified to Discovery to Proposal to Negotiation to Won/Lost. Each lead is tied to a company and an account manager.

**Targets** — Quarterly sales targets per account manager.

**Pace** (labeled "Performance Pace") — Shows year-to-date progress against yearly/quarterly targets, including how many working days have elapsed in the current quarter and whether you're tracking on pace to hit the number.

**Usage** — Monthly per-company usage/consumption entries, the raw input that quotes are generated from. Includes an "Auto-fill from ManageOne" page that pulls real tenant resource usage and converts it into priced usage entries automatically.

**At Risk** — Flags companies whose usage has been declining for 2+ months running — an early warning list for accounts that might be shrinking or churning.

**Quotes** — Quote list plus "Generate from Usage" (builds a draft quote automatically from a company's usage entries for a given month) and the quote detail page (review line items, print/export, change status draft to sent to accepted, and email the quote directly to the customer's contact address).

**AI Recs** — Weekly, per-company AI-generated recommendations with real dollar estimates behind each suggestion, generated from an internal rule engine and written up by AI — the numbers trace back to actual usage data, never invented by the model.

**Coach** ("Daily Sales Coach") — A daily per-AM summary: current pace against target, active proposals and their total value, and suggested priorities for the day.

**Activities** — Log of AM activity against leads: calls, meetings, proposals sent, with dates and notes.

**ManageOne** *(leadership only)* — Read-only view of tenants synced nightly from ManageOne: VDC info, resource usage, ECS instance flavors, EVS volume types.

**Cloud Health** *(leadership + country GM)* — Infrastructure monitoring: per-region capacity gauges, a region drill-down page, and network monitoring with a latency trend chart.

**Team** — User/team management: see team members, their roles and country assignments.

**Settings** — Account-level settings (e.g. light/dark theme, which defaults to light).`,
  },
  {
    slug: "common-workflows",
    title: "Common Workflows",
    group: "Team Guide",
    order: 3,
    visibility: "public",
    content: `**Generating and sending a quote:** Usage page — make sure the company's usage entries exist for the target month (or use Auto-fill from ManageOne) — then Quotes, Generate from Usage, pick company + month, review the auto-priced draft, save, open the quote, and either Print/Export for a formatted copy or Send to Customer to email it directly (requires the company to have a contact email on file).

**Checking if a company is at risk:** At Risk page shows anyone with 2+ consecutive declining usage months — click through to their Companies detail page to see the actual Usage Trends chart and decide on outreach.

**Starting the day as an AM:** Coach page for today's priorities and pace check, then Pipeline to see where deals stand, then Activities to log any calls/meetings as you go.

**Checking infrastructure health:** Cloud Health (if your role allows) — capacity gauges at the top, Network Status/ping targets below, Latency Trend chart with the range picker for historical views.`,
  },
  {
    slug: "architecture-overview",
    title: "Architecture Overview",
    group: "Technical Reference",
    order: 4,
    visibility: "restricted",
    content: `The system is two separate applications on two separate servers, talking to each other over HTTP with shared secrets — not a single monolith.

**crmv2** ("the CRM") — internal tool for AMs/GMs/HOB/CEO to manage companies, leads, quotes, usage, and monitoring. Frontend is React, backend is Convex (a reactive, hosted-database-plus-serverless-functions platform), **self-hosted** on our own server rather than Convex's cloud. Runs on the server referred to as \`new-crm\`.

**htgweb** ("the website") — the public-facing site where customers sign up, verify email, and get their cloud tenant provisioned via ManageOne. Its backend is a plain Express/Node server with its own PostgreSQL database (via Prisma). Runs on the server \`htg-website-on-new-vpc\` (IP \`102.203.134.53\`).

These two systems are connected by one-directional and now bidirectional integrations:
- htgweb → crmv2: several scheduled jobs (PM2 cron-style) push data INTO Convex over authenticated HTTP endpoints — tenant sync, cloud capacity, AI recommendation narratives, ICMP ping results, service/DNS health results.
- crmv2 → htgweb: as of the mail relay feature, crmv2 can also call OUT to htgweb to trigger real emails (quotes, later monitoring alerts), since htgweb owns the working SMTP setup.

Neither system talks to ManageOne (Huawei's cloud management platform) except htgweb — all ManageOne API calls originate from htgweb, never directly from crmv2.`,
  },
  {
    slug: "tech-stack",
    title: "Tech Stack",
    group: "Technical Reference",
    order: 5,
    visibility: "restricted",
    content: `**crmv2 (CRM):**
- React 19 + React Router 7, Vite build
- Tailwind CSS 4, Radix UI primitives / shadcn-style components
- Convex (self-hosted) — reactive database + serverless query/mutation/action functions, written in TypeScript
- @convex-dev/auth for CRM staff login
- Recharts for charts, react-hook-form + zod for forms
- Vitest for tests, deployed as a static build served by Nginx

**htgweb (public site + integration backend):**
- React + Vite frontend (marketing/onboarding UI)
- Express (Node.js) backend, \`server/index.js\`
- PostgreSQL via Prisma ORM (customer accounts, onboarding, provisioning state)
- Nodemailer over SMTP (Google Workspace) for transactional email
- PM2 for process management
- Runs behind Nginx, which itself sits behind a Huawei Cloud WAF (CloudWAF) on the public domain`,
  },
  {
    slug: "data-model",
    title: "Data Model",
    group: "Technical Reference",
    order: 6,
    visibility: "restricted",
    content: `Two separate databases — don't confuse them.

**crmv2's Convex tables** (all in \`convex/schema.ts\`):
- \`users\` — CRM staff accounts. Role is one of \`account_manager\`, \`country_gm\`, \`head_of_business\`, \`ceo\`. Optionally scoped to a \`countryId\`.
- \`countries\`, \`sectors\` — simple lookup tables.
- \`companies\` — the core CRM record: sector, country, assigned account manager, contract/payment status, contact info (\`contactEmail\` used for the Send-to-Customer feature).
- \`leads\` — sales pipeline records tied to a company and an account manager, with \`stage\` (new_lead → qualified → discovery → proposal → negotiation → won/lost).
- \`salesTargets\` — quarterly targets per account manager.
- \`manageOneTenants\` — synced nightly from htgweb: VDC/tenant info, resource usage, ECS flavor breakdown, EVS volume type breakdown, linked to a \`companies\` record via \`linkedCompanyId\`.
- \`cloudCapacityRegions\` / \`cloudCapacitySnapshots\` — region-level CPU/memory/storage capacity and oversubscription, synced every 15 minutes.
- \`tenantUsageHistory\` — nightly per-company resource usage snapshot for the Usage Trends section.
- \`pingTargets\` / \`pingResults\` — ICMP monitoring targets and check history, synced every 2 minutes.
- \`serviceHealthTargets\` / \`serviceHealthResults\` — HTTP/TCP/DNS synthetic checks, currently hidden from the Cloud Health UI pending target-entry UX design.
- \`activities\` — AM call/meeting/proposal logs tied to a lead.
- \`consumption\` — monthly per-company usage entries used to generate quotes.
- \`serviceCatalog\` — priced service items used for quote line items and auto-pricing.
- \`aiRecommendations\` — weekly AI-generated per-company narratives plus a snapshot of the rule-engine output.
- \`quotes\` — company quotes: status, line items, monthly/yearly totals.

**htgweb's PostgreSQL tables** (via Prisma, \`prisma/schema.prisma\`):
- \`User\` — customer accounts for the public site: email/password auth, onboarding state, ManageOne provisioning fields.
- \`VerificationCode\`, \`PasswordResetToken\` — auth flow support tables.
- \`Onboarding\` — onboarding wizard state per user.

These two databases are never queried directly across the boundary — all cross-system data flow goes through authenticated HTTP sync endpoints.`,
  },
  {
    slug: "external-apis",
    title: "External APIs & Integrations",
    group: "Technical Reference",
    order: 7,
    visibility: "restricted",
    content: `**ManageOne (Huawei Cloud management platform)** — called only from htgweb, via \`server/manageone.js\`. Auth is token-based: \`POST {MANAGEONE_AUTH_BASE_URL}/v3/auth/tokens\` using \`MANAGEONE_USERNAME\`/\`MANAGEONE_PASSWORD\`/\`MANAGEONE_AUTH_DOMAIN\`, returns an \`X-Subject-Token\` used as \`X-Auth-Token\` on subsequent calls (cached in memory, ~20 min TTL). Used for: tenant/VDC provisioning during customer signup, listing VDCs and resource usage, and reading the cloud service catalog. The tenant-assurance alarm APIs are NOT yet accessible — permission grant received so far doesn't cover them (see Troubleshooting).

**OpenAI** — called only from htgweb's weekly \`generate-ai-recommendations\` job. Real dollar estimates come from the rule engine, not the model.

**Internal sync endpoints (htgweb job → crmv2 Convex HTTP actions):** each protected by its own shared-secret header, values in htgweb's \`.env\`: \`CRM_SYNC_URL\`/\`CRM_SYNC_SECRET\` (tenant sync), \`AI_RECS_SYNC_SECRET\`, \`CLOUD_HEALTH_SYNC_SECRET\` (capacity/ping/service-health), \`TENANT_HISTORY_SYNC_SECRET\`.

**Mail relay (crmv2 → htgweb):** \`POST /internal/send-email\` on htgweb, protected by \`MAIL_RELAY_SECRET\`. crmv2 builds the email HTML and calls this endpoint; htgweb sends it via its existing Nodemailer/SMTP setup.`,
  },
  {
    slug: "roles-permissions-technical",
    title: "Roles & Permissions — Technical",
    group: "Technical Reference",
    order: 8,
    visibility: "restricted",
    content: `Four CRM roles, defined in \`convex/authorization.ts\`:
- **account_manager** — can only manage companies/leads/quotes they're assigned to (\`accountManagerId === self\`).
- **country_gm** — can manage anything belonging to companies/AMs in their assigned \`countryId\`.
- **head_of_business** and **ceo** — unrestricted access to everything (\`isCeoOrHob()\` check appears throughout the authorization logic).

Every mutation/query that touches a company, lead, quote, or usage record calls one of \`assertCanManageCompany\`, \`assertCanManageLead\`, \`assertCanManageUsage\`, \`assertCanManageTarget\`, or \`canManageUser\` — permission checks live in the Convex functions themselves.`,
  },
  {
    slug: "deployment-ops",
    title: "Deployment & Operations",
    group: "Technical Reference",
    order: 9,
    visibility: "restricted",
    content: `**Servers:**
- \`new-crm\` — runs crmv2 (self-hosted Convex + Nginx-served static frontend)
- \`htg-website-on-new-vpc\` (\`102.203.134.53\`) — runs htgweb (Express backend on port \`4001\`, PM2-managed, behind Nginx and Huawei CloudWAF)

**Deploying crmv2:** from the app root on \`new-crm\`:
\`\`\`
git pull
./scripts/deploy.sh
\`\`\`
This pulls latest code, runs \`pnpm exec convex deploy\`, builds the frontend, copies the build to \`/var/www/crm\`, and reloads Nginx.

**Deploying htgweb:** \`git pull\` on \`htg-website-on-new-vpc\`, then \`pm2 restart htgweb-backend\` (check \`pm2 ls\` first — other entries are cron jobs, not the web server).

**htgweb's PM2 processes** (\`ecosystem.config.cjs\`):
| Name | Script | Schedule |
|---|---|---|
| \`htgweb-backend\` | \`server/index.js\` | always-on |
| \`manageone-tenant-sync\` | \`sync-manageone-tenants.js\` | nightly, 3am |
| \`ai-recommendations-sync\` | \`generate-ai-recommendations.js\` | weekly, Sun 4am |
| \`cloud-capacity-sync\` | \`sync-cloud-capacity.js\` | every 15 min |
| \`ping-monitor\` | \`ping-monitor.js\` | every 2 min |
| \`service-health-monitor\` | \`service-health-monitor.js\` | every 2 min |

**Important:** the cron-scheduled jobs use \`cron_restart\` + \`autorestart: false\` — they run, finish, and go idle (\`status: stopped\`, \`pid: 0\`) between scheduled runs. That's normal, not broken. Judge job health by the restart count trending up and by fresh data appearing, not the PM2 status column alone.

**Reading Convex data/env (from the crmv2 app directory):**
\`\`\`
npx convex env list --prod
npx convex env set KEY value --prod
npx convex data <tableName> --prod
npx convex logs --prod
\`\`\``,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting Playbook",
    group: "Technical Reference",
    order: 10,
    visibility: "restricted",
    content: `**"A cron job shows \`stopped\` in \`pm2 ls\` — is it broken?"** No, by design. Check \`pm2 logs <job-name> --lines 30 --nostream\` for the most recent run's outcome, or check that fresh data is showing up in the relevant CRM page.

**"A new htgweb endpoint returns 405/blocked on the public domain but works fine on localhost."** Signature of the Huawei CloudWAF blocking POST to a brand-new path by default: response has \`HWWAFSESID\`/\`HWWAFSESTIME\` cookies and a \`server: CloudWAF\` header. Test locally first (\`curl localhost:4001/...\`), then test the public domain to isolate Nginx vs. WAF.

**"Need to bypass the WAF for a server-to-server call."** Call the origin server directly (private or public IP + port) instead of the WAF-fronted public domain. If using the private IP, also open the port on the cloud provider's Security Group console — separate from and takes priority over any OS-level firewall (\`connection refused\` with \`ufw\` confirmed inactive means the block is at the Security Group layer). Always scope firewall/security-group rules to the specific caller's IP (\`/32\`), never \`0.0.0.0/0\`.

**"ManageOne access was just granted but a specific endpoint still 403s."** Permission grants can be partial — test the specific endpoint with a live call and check the actual error code rather than assuming a broader grant covers it.

**"Latency/history chart query might be slow at scale."** \`pingResults\` and similar time-series tables are append-only with no retention/downsampling job yet. Fine at current scale; revisit if the target list grows significantly.

**"Region/ECS console is unavailable."** Cloud-console-dependent tasks (Security Group changes, WAF rules) are blocked until the region recovers. SSH-level access may still work independently; check what's actually down before assuming everything is.`,
  },
  {
    slug: "reading-the-database",
    title: "Reading the Database",
    group: "Technical Reference",
    order: 11,
    visibility: "restricted",
    content: `**Convex (crmv2's database)** — no traditional SQL client, use the CLI:
\`\`\`
npx convex data <tableName> --prod
npx convex data <tableName> --prod --limit 20
\`\`\`

**PostgreSQL (htgweb's database)** — connection string in \`DATABASE_URL\`:
\`\`\`
psql "$DATABASE_URL"
\\dt
SELECT * FROM "User" LIMIT 10;
\`\`\`
Or via Prisma: \`npx prisma studio\``,
  },
];

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);
    const sections = await ctx.db
      .query("documentationSections")
      .withIndex("by_order")
      .collect();

    return sections
      .filter((section) => visibleToUser(section, user))
      .map(({ slug, title, group, order, visibility }) => ({
        slug,
        title,
        group,
        order,
        visibility,
      }));
  },
});

export const getBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const section = await ctx.db
      .query("documentationSections")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!section) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Documentation section not found",
      });
    }

    if (!visibleToUser(section, user)) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You do not have permission to view this documentation",
      });
    }

    const updatedByUser = section.updatedBy
      ? await ctx.db.get(section.updatedBy)
      : null;

    return {
      ...section,
      updatedByName: updatedByUser?.name ?? updatedByUser?.email ?? null,
    };
  },
});

export const upsert = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    group: v.string(),
    content: v.string(),
    order: v.number(),
    visibility: v.union(v.literal("public"), v.literal("restricted")),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanEditDocumentation(user);

    const existing = await ctx.db
      .query("documentationSections")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
        updatedBy: user._id,
      });
      return existing._id;
    }

    return await ctx.db.insert("documentationSections", {
      ...args,
      updatedAt: now,
      updatedBy: user._id,
    });
  },
});

export const remove = mutation({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    assertCanEditDocumentation(user);

    const existing = await ctx.db
      .query("documentationSections")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();

    if (!existing) {
      return false;
    }

    await ctx.db.delete(existing._id);
    return true;
  },
});

export const seedInitialDocs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("documentationSections").first();
    if (existing) {
      return { inserted: 0, byGroup: {} as Record<string, number> };
    }

    const now = Date.now();
    const byGroup: Record<string, number> = {};

    for (const section of INITIAL_DOCUMENTATION_SECTIONS) {
      await ctx.db.insert("documentationSections", {
        ...section,
        updatedAt: now,
      });
      byGroup[section.group] = (byGroup[section.group] ?? 0) + 1;
    }

    return {
      inserted: INITIAL_DOCUMENTATION_SECTIONS.length,
      byGroup,
    };
  },
});
