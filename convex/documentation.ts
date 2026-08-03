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

**crmv2** ("the CRM") — internal tool for AMs/GMs/HOB/CEO to manage companies, pipeline, quotes, usage, Cloud Advisor, documentation, and Cloud Health operations. The frontend is React; the backend is self-hosted Convex with TypeScript query/mutation/internal/httpAction functions. It runs on the server referred to as \`new-crm\`.

**htgweb** ("the website") — the public-facing site and integration backend where customers sign up, verify email, and get cloud tenant provisioning handled through ManageOne. Its backend is Express/Node with PostgreSQL via Prisma. It runs on \`htg-website-on-new-vpc\` (IP \`102.203.134.53\`).

**Integration direction:** htgweb owns calls to external systems such as ManageOne, OC/ManageOne alarms, OpenAI, ICMP ping execution, and SMTP. crmv2 receives the results over authenticated Convex HTTP actions. crmv2 does not call ManageOne directly.

**htgweb → crmv2 sync:** scheduled PM2 jobs push data into Convex using \`X-Sync-Secret\` headers: ManageOne tenants, tenant usage history, Cloud Advisor AI narratives, capacity snapshots, active alarms, ping results, service/DNS health results, and host group utilization.

**crmv2 → htgweb mail relay:** crmv2 can call htgweb's \`POST /internal/send-email\` endpoint, protected by \`MAIL_RELAY_SECRET\`, to send quote emails through htgweb's Nodemailer/SMTP setup.

**Cloud Advisor architecture:** recommendations are detected by a deterministic rule engine, not by an AI model. \`convex/recommendations.ts\` computes recommendations from companies, usage, sectors, service catalog, and cloud/tenant signals using the shared rules in \`src/lib/recommendations/rules.ts\`. AI narratives are stored separately in \`aiRecommendations\` and are generated by htgweb's weekly OpenAI job from rule-engine context. Lifecycle state is stored as an overlay in \`cloudAdvisorStatuses\` using a stable recommendation key; "open" is derived when no overlay exists. The overlay stores acknowledged/in-progress/snoozed/dismissed/resolved status, snooze dates, and short workflow notes.

**Cloud Advisor quote flow:** a recommendation can start a quote review flow, but it does not create a quote immediately. \`quotes.buildQuotePreviewFromAdvisor\` rebuilds the recommendation server-side and only prepares a line item when there is a safe, single service-catalog match. The review page creates a draft quote only when a safe \`lineItemPreview\` exists.

**Cloud Health architecture:** Cloud Health combines ManageOne/OC alarms, region capacity, capacity snapshots, ping monitoring, host group utilization, and hidden service/DNS health infrastructure. The visible page is organized into Overview, Alarms, Capacity, Network, and Host Groups tabs. It is viewable by CEO, Head of Business, and Country GM; ping target management is CEO/HOB only.

**Documentation architecture:** Documentation articles are stored in the Convex \`documentationSections\` table. CEO/HOB can edit live docs from the Documentation page with no deploy. \`convex/documentation.ts\` is seed/default content for fresh environments and does not automatically overwrite existing live rows.`,
  },
  {
    slug: "tech-stack",
    title: "Tech Stack",
    group: "Technical Reference",
    order: 5,
    visibility: "restricted",
    content: `**crmv2 frontend:**
- React 19 + React DOM 19
- React Router 7 for page routing
- Vite 7 build pipeline with the React SWC plugin
- Tailwind CSS 4 with \`@tailwindcss/vite\` and typography support
- Radix UI primitives / shadcn-style local components in \`src/components/ui\`
- Lucide React icons, Sonner toasts, next-themes for light/dark theme
- Recharts for dashboard, usage, Cloud Health, and company trend charts
- React Hook Form + Zod for forms/validation
- React Markdown + Remark GFM for the Documentation page
- PapaParse for CSV imports

**crmv2 backend:**
- Self-hosted Convex 1.x for reactive database, queries, mutations, internal functions, and HTTP actions
- TypeScript schema and backend modules in \`convex/\`
- \`@convex-dev/auth\` for CRM staff authentication
- Backend RBAC enforced in Convex functions, not only hidden in the UI
- Shared-secret HTTP actions for htgweb sync jobs

**Major CRM subsystems:**
- Usage + Quotes: consumption entries, service catalog pricing, quote creation/detail/email, Generate from Usage, and Cloud Advisor quote review
- Cloud Advisor: deterministic recommendation rules, stored AI narratives, status overlay, workflow notes, and quote preview/review flow
- Cloud Health: ManageOne/OC alarms, region capacity, capacity snapshots, ping targets/results, host groups, hidden service/DNS health backend, and NOC auto-rotate UI
- Documentation: Convex-backed articles editable live by CEO/HOB

**Testing and quality:**
- TypeScript 5 with \`pnpm exec tsc -b\`
- Vitest with jsdom, Testing Library, user-event, jest-dom, and \`convex-test\`
- ESLint 9 with TypeScript/React hooks/React refresh config
- Prettier for formatting checks/fixes

**Deployment:**
- \`./scripts/deploy.sh\` runs \`pnpm exec convex deploy\`, builds the Vite frontend, publishes \`dist\` to \`/var/www/crm\`, and reloads Nginx.

**htgweb (public site + integration backend):**
- React + Vite frontend
- Express (Node.js) backend in \`server/index.js\`
- PostgreSQL via Prisma ORM
- Nodemailer over SMTP for transactional email and CRM mail relay
- PM2 for the always-on web backend and scheduled sync jobs
- Runs behind Nginx, which itself sits behind Huawei Cloud WAF (CloudWAF) on the public domain

**Integration technologies:**
- htgweb jobs call crmv2 Convex HTTP actions with \`X-Sync-Secret\`
- OpenAI is called only from htgweb's weekly Cloud Advisor narrative job
- ManageOne/OC calls originate from htgweb, not crmv2
- crmv2 calls htgweb only for the mail relay path used by quote email sending`,
  },
  {
    slug: "technical-htgweb",
    title: "HTGweb",
    group: "Technical Reference",
    order: 12,
    visibility: "restricted",
    content: `HTGweb is the public website and integration backend. It is separate from crmv2 and has its own codebase, database, deployment process, and runtime.

**Runtime stack:**
- React + Vite frontend for the public marketing/onboarding UI.
- Express/Node backend in \`server/index.js\`.
- PostgreSQL accessed through Prisma ORM.
- Nodemailer over SMTP for verification, password reset, transactional email, and CRM quote mail relay.
- PM2 for the always-on backend and scheduled jobs.
- Nginx in front of the Express backend, with the public domain also protected by Huawei Cloud WAF.

**Primary responsibilities:**
- Customer-facing signup/login/onboarding flows.
- ManageOne tenant provisioning and tenant sync jobs.
- Scheduled integration jobs that collect ManageOne/OC/OpenAI/network data and push normalized payloads into crmv2.
- Mail relay endpoint \`POST /internal/send-email\`, protected by \`MAIL_RELAY_SECRET\`, used by crmv2 quote emailing.

**Scheduled jobs that feed crmv2:**
- \`sync-manageone-tenants.js\` — tenant/VDC/resource usage sync.
- \`generate-ai-recommendations.js\` — weekly OpenAI narrative generation based on crmv2 rule-engine context.
- \`sync-cloud-capacity.js\` — region capacity and capacity snapshots.
- \`ping-monitor.js\` — reads active ping targets from crmv2 and posts ICMP results back.
- \`sync-manageone-alarms.js\` — active ManageOne/OC alarms.
- \`sync-manageone-host-groups.js\` — host group utilization and risk levels.
- \`service-health-monitor.js\` — HTTP/TCP/DNS synthetic check results; CRM UI is currently hidden.

**Boundary rule:** htgweb and crmv2 do not read each other's databases directly. All cross-system traffic goes through authenticated HTTP endpoints with shared secrets.`,
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

const PAGE_DOCUMENTATION_SECTIONS: SeedDocumentationSection[] = [
  {
    slug: "page-dashboard",
    title: "Dashboard",
    group: "Team Guide",
    order: 2,
    visibility: "public",
    content: `The Dashboard is your personal landing page — it's what you see first after logging in.

- Greets you by name and role (e.g. "Welcome back, Jane — Account Manager").
- A year selector lets you switch which year's data the metric cards reflect.
- Key metrics are shown as clickable cards (revenue, pipeline, targets) — clicking a card navigates you to the relevant page (e.g. clicking a pipeline metric takes you to Pipeline) for a closer look.

There's nothing to configure here — it's a read-only overview to orient you at the start of a session.`,
  },
  {
    slug: "page-companies",
    title: "Companies",
    group: "Team Guide",
    order: 3,
    visibility: "public",
    content: `The Companies page is the master list of every company in the CRM, and the entry point to each company's detail page.

**Finding a company:**
- Search box: "Search by name or contact..." — matches on company name or contact name.
- Status filter: All Statuses / Active / Pending / Expired / Terminated.
- Sector filter: All Sectors, or a specific industry sector.
- Country filter: All Countries, or a specific country.

**What each row shows:** company name, sector, country (with region), assigned account manager ("AM: {name}"), contact name, and a color-coded status badge (Active = green, Pending = amber, Expired = gray, Terminated = red).

**Actions:**
- Click anywhere on a company's row to open its detail page (contract/payment status, contact info, linked ManageOne tenant, Usage Trends chart).
- **Add Company** button — opens a form to create a new company from scratch.
- **Import CSV** button — bulk-creates companies from a spreadsheet.

If no companies exist yet, you'll see an empty state with an Add Company prompt. If your filters just don't match anything, you'll see "No results" instead.`,
  },
  {
    slug: "page-pipeline",
    title: "Pipeline",
    group: "Team Guide",
    order: 4,
    visibility: "public",
    content: `Pipeline is where sales opportunities are tracked from first lead to final outcome.

Use Pipeline to understand what deals are open, which stage each opportunity is in, who owns it, and how much potential revenue is in progress.

## Pipeline Stages

Pipeline uses these stages:

- New Lead - a new opportunity has been identified.
- Qualified - the opportunity looks real and worth pursuing.
- Discovery - the team is gathering requirements and understanding the customer need.
- Proposal - a proposal or offer is being prepared or has been shared.
- Negotiation - commercial or technical details are being finalized.
- Won - the deal has been successfully closed.
- Lost - the opportunity did not close.

## Board and List Views

Pipeline has two views:

- Board - Kanban-style columns by stage.
- List - a table view of the same opportunities.

Use Board view for stage movement and quick pipeline scanning. Use List view when you want a flatter table.

## What Each Lead Shows

Each lead/opportunity includes:

- Title
- Company
- Account Manager
- Stage
- Potential value
- Expected close date
- Next action
- Notes

## What Users Can Do

Users can:

- Add a lead
- Import leads from CSV
- Edit an existing lead
- Move a lead between stages
- Mark a lead Won or Lost
- Delete a lead if they have permission
- View lead value and expected close date

## How to Move a Deal Forward

Update the stage as the opportunity progresses.

Example:

New Lead -> Qualified -> Discovery -> Proposal -> Negotiation -> Won

If the opportunity is no longer valid, move it to Lost.

## Permissions

Pipeline access follows CRM role scope:

- Account Managers see and manage their own leads.
- Country GMs see and manage leads for companies in their country.
- Head of Business and CEO see and manage all leads.

Permissions are enforced by the backend.

## Relationship to Dashboard, Targets, Pace, and Coach

Pipeline affects several CRM areas:

- Dashboard pipeline value comes from open deals.
- Won deals contribute to sales achievement.
- Targets and Pace use Won deal value to compare performance against target.
- Coach uses Proposal and Negotiation deals to suggest daily priorities.

## Important Notes

Pipeline is not a task manager, quote builder, or activity log.

Use Tasks for internal work assignment.
Use Quotes to create customer quotes.
Use Activities to log calls, meetings, and proposals sent.`,
  },
  {
    slug: "page-targets",
    title: "Targets",
    group: "Team Guide",
    order: 5,
    visibility: "public",
    content: `Targets is where quarterly sales goals are set for Account Managers.

Targets are used by Dashboard, Pace, and Coach to compare actual won deals against expected performance.

## Who Uses Targets

Targets are managed by leadership.

Account Managers use Targets indirectly through Dashboard, Pace, and Coach.

## What Targets Shows

For each Account Manager, Targets shows:

- Q1 target
- Q2 target
- Q3 target
- Q4 target
- Annual target total
- Achievement against won Pipeline deals

## Year Selector

Use the year selector to view or manage targets for a specific year.

Targets are stored by Account Manager, year, and quarter.

## Quarterly Targets

Quarters are calendar quarters:

- Q1: January to March
- Q2: April to June
- Q3: July to September
- Q4: October to December

The annual target is the sum of Q1, Q2, Q3, and Q4.

## Setting or Editing Targets

Leadership can set a target for:

- Account Manager
- Year
- Quarter
- Target amount

Existing quarter values can be updated. The updated value is immediately reflected wherever target calculations are used.

## How Achievement Is Calculated

Achievement is based on Pipeline deals marked Won.

Open or Lost deals do not count as achieved revenue.

## Relationship to Pace

Pace uses quarterly targets to calculate whether the team is ahead, on track, or behind for the current period.

Pace compares:

- Target expected by today
- Actual won deal value
- Remaining target gap

## Relationship to Dashboard

Dashboard uses Targets to show target achievement and sales progress.

## Important Notes

Targets does not create deals or change Pipeline stages.

To update actual sales progress, update Pipeline deals. To update goals, use Targets.`,
  },
  {
    slug: "page-pace",
    title: "Pace",
    group: "Team Guide",
    order: 6,
    visibility: "public",
    content: `Pace shows whether sales performance is moving fast enough to hit target.

It is a read-only performance view based on Targets and Won Pipeline deals.

## What Pace Shows

Pace shows:

- Annual target
- Current quarter target
- Expected progress by today
- Achieved amount
- Gap
- Remaining working days
- Daily pace needed
- Ahead / On Track / Behind status

## How Pace Works

Pace uses quarterly targets and compares them with actual won deal value.

Expected progress is calculated using working days in the current quarter. Working days are Monday to Friday.

The page answers:

Are we ahead, on track, or behind compared with where we should be today?

## Status Meaning

- Ahead - achieved value is above expected progress.
- On Track - achieved value is close to expected progress.
- Behind - achieved value is below expected progress.

## What Counts as Achieved

Only Pipeline deals marked Won count as achieved revenue.

Open deals and Lost deals do not count toward achievement.

## Relationship to Targets

Targets provides the quarterly and annual goals used by Pace.

If targets are missing, Pace cannot calculate meaningful progress.

## Relationship to Pipeline

Pipeline provides the Won deal value used as achieved revenue.

To improve Pace, move real closed deals to Won in Pipeline.

## What Users Can Do

Users can view pace, change the selected year/quarter if controls are available, and use the result to decide where attention is needed.

Users do not edit targets or deals directly from Pace.

## Important Notes

Pace is not a forecasting tool and does not guess future deals.

It compares current target expectations with actual closed sales.`,
  },
  {
    slug: "page-usage",
    title: "Usage",
    group: "Team Guide",
    order: 7,
    visibility: "public",
    content: `Usage Tracking is where monthly customer cloud consumption is recorded.

Usage is the source data used for customer consumption totals, quote generation, Dashboard usage summaries, and Cloud Advisor recommendations.

## What Usage Tracks

Each usage entry belongs to:

- Company
- Month
- Service type
- Catalog item when available
- Quantity
- Amount

Month values use year-month format, for example 2026-07.

## Summary Cards

The summary cards show totals for the currently selected usage dataset:

- Total Entries - number of usage rows matching the selected filters.
- Total Consumption - total amount for the selected usage rows.
- Tenants with Data - number of companies/tenants with usage entries in the selected dataset.

If Month is set to All Months, the summary shows all matching months.

If a specific month is selected, such as 2026-07, the summary shows that month only.

The month picker and month filter should stay aligned so the visible month matches the totals being shown.

## Filters and Paging

Users can filter by:

- Company
- Month
- Rows per page

Use the month filter to focus on a billing month. Use All Months when reviewing historical totals.

## Adding Usage

Usage can be added manually when needed.

Manual entry is useful when:

- ManageOne data is unavailable
- A service needs manual pricing review
- A correction must be entered directly

## CSV Import

CSV import can bulk-load usage entries from a spreadsheet.

Imported rows are validated before they are saved. Pricing may be calculated from the Service Catalog when a confident match exists.

## Auto-fill from ManageOne

Auto-fill from ManageOne helps create usage entries from linked ManageOne tenant data.

Workflow:

1. Select a company.
2. Select the month.
3. Review detected ManageOne usage.
4. Select the rows to create.
5. Create usage entries after review.

The system does not blindly create usage entries without review.

Some services can be auto-priced from the Service Catalog. Others may require manual entry if the catalog match is not safe.

## Pricing

Usage totals use the saved amount on each usage entry.

When possible, the CRM uses the Service Catalog to calculate pricing automatically from quantity and catalog price.

If pricing cannot be matched confidently, the user should review and enter the correct service or amount manually.

## Relationship to Quotes

Quotes can be generated from Usage for a selected company and month.

Before generating a quote, confirm the usage entries for that company and month are complete and correct.

## Relationship to Cloud Advisor

Cloud Advisor uses usage history to find cross-sell, risk, and optimization opportunities.

Accurate usage data makes Advisor recommendations more useful.

## Important Notes

Usage Tracking does not provision resources in ManageOne.

It records CRM billing/consumption data and can use synced ManageOne data as an input.`,
  },
  {
    slug: "page-at-risk",
    title: "At Risk",
    group: "Team Guide",
    order: 8,
    visibility: "public",
    content: `At Risk is an early-warning page for accounts whose usage may be shrinking.

It helps the team identify customers that may need follow-up before the issue becomes churn, downgrade, or lost revenue.

## What At Risk Looks For

At Risk focuses on usage decline patterns.

Companies are flagged when their usage has declined for consecutive months and there is enough history to evaluate the trend.

## What the Summary Cards Mean

The top cards summarize:

- Companies currently flagged as at risk
- Month-over-month usage movement
- Accounts with enough usage history to evaluate
- Potential revenue attention areas

## What Each Row Shows

At Risk rows help identify:

- Company
- Account Manager
- Recent usage trend
- Decline pattern
- Latest usage value
- Previous usage comparison

## What Users Should Do

Use At Risk as a follow-up list.

Recommended workflow:

1. Open At Risk.
2. Review the highest-risk accounts.
3. Click into the company detail page.
4. Check Usage Trends and recent consumption.
5. Contact the customer or Account Manager if the decline needs explanation.
6. Create a Task if follow-up work is needed.

## Relationship to Usage

At Risk depends on Usage Tracking data.

If usage entries are missing or incomplete, At Risk may not show the full picture.

## Relationship to Company Detail

Company detail pages show Usage Trends where available.

Use the trend chart to understand whether the decline is temporary or consistent.

## Important Notes

At Risk is read-only.

It does not send customer notifications, create tasks automatically, or change company status.

It is a signal for the sales and leadership team to investigate.`,
  },
  {
    slug: "page-quotes",
    title: "Quotes",
    group: "Team Guide",
    order: 9,
    visibility: "public",
    content: `Quotes is where the team creates, reviews, sends, and tracks customer quotes.

Quotes can be created manually, generated from Usage, or started from a Cloud Advisor recommendation review.

## Quote List

The Quotes page shows existing quotes with:

- Company
- Date
- Status
- Monthly total
- Yearly total
- Created by

Open a quote to review details.

## Quote Statuses

Quotes use these statuses:

- Draft - still being prepared or reviewed.
- Sent - sent to the customer.
- Accepted - customer accepted the quote.

## Generate from Usage

Generate from Usage is the main workflow for consumption-based quotes.

Workflow:

1. Confirm Usage entries exist for the company and month.
2. Open Quotes.
3. Choose Generate from Usage.
4. Select company and month.
5. Review the line items and totals.
6. Save the draft quote.

Pricing comes from the Service Catalog and saved usage entries.

## Cloud Advisor Quote Flow

Cloud Advisor can open a quote review page from a recommendation.

The CRM only creates a draft quote automatically when it can safely match the recommendation to one catalog-backed line item.

If the catalog match or quantity is not safe, the review page asks for manual review instead of inventing pricing.

## Quote Detail Page

On a quote detail page, users can:

- Review line items
- Review monthly and yearly totals
- Print or export the quote
- Change status
- Send the quote to the customer
- Delete a draft quote if permitted

## Sending to Customer

Send to Customer emails the quote to the company contact email.

If the company has no contact email, update the company record first.

Quote email is sent through the CRM mail relay integration.

## Important Notes

Quotes do not change Usage entries.

Quotes do not provision cloud resources.

Always review quote line items and totals before sending to the customer.`,
  },
  {
    slug: "page-ai-recs",
    title: "Cloud Advisor",
    group: "Team Guide",
    order: 10,
    visibility: "public",
    content: `Cloud Advisor surfaces cross-sell, risk, and cloud-improvement opportunities based on actual CRM and cloud data. The recommendations are rule-based; AI narratives only summarize the rule-based findings in clearer language.

**Summary cards:** Open Recommendations, High Priority, Estimated Monthly Value, and Companies with Opportunities.

**Filters:** category, company, rule, priority, status, and page size. Categories include Cost Optimization, Security, Reliability, Performance, Backup & Recovery, Capacity / Limits, and Sales Opportunities.

**Two kinds of cards you'll see:**
- **AI-generated narrative** — a weekly narrative summary per company, generated outside the CRM by htgweb. It should help explain the opportunity; it does not decide whether the recommendation exists.
- **Rule-based recommendations** — one per triggered rule, showing the title, company, category, priority, estimated monthly value, reason, evidence/basis, source rule, and recommended service/action.

**Workflow status:** each recommendation is Open by default unless someone has updated it. Available statuses/actions are Acknowledge, Start Progress, Snooze, Dismiss, Resolve, and Reopen. The default Active filter shows open, acknowledged, and in-progress recommendations; snoozed, dismissed, and resolved items are available through the status filter.

**Workflow notes:** use the note field for a short internal handoff or investigation note. Notes are stored on the recommendation's status overlay, not on the computed rule itself.

**Create Quote:** the Create Quote button opens a review page first. The CRM only creates a draft quote automatically when the backend can safely match the recommendation to exactly one catalog-backed line item. If the catalog or quantity is ambiguous, the page asks for manual review instead of inventing pricing.`,
  },
  {
    slug: "page-coach",
    title: "Coach",
    group: "Team Guide",
    order: 11,
    visibility: "public",
    content: `Coach is the daily sales guidance page for Account Managers and leadership. It helps the team quickly understand who is ahead, who is behind, which deals need attention, and what each Account Manager should focus on today.

## What Coach Shows

Each Account Manager card shows:

- Yearly target
- Expected progress to date
- Achieved amount
- Gap against expected progress
- Pace status: Ahead, On Track, or Behind
- Active proposal and negotiation deals
- Today's recommended priorities

## How Pace Is Calculated

Coach uses the Account Manager's current-year quarterly targets.

The yearly target is calculated from:

Q1 + Q2 + Q3 + Q4

Achieved amount comes from Pipeline deals marked as Won.

Expected progress is calculated based on completed quarters plus the current quarter progress by working days. Working days are Monday to Friday.

Pace status means:

- Ahead: achieved is more than expected
- On Track: achieved is close to expected
- Behind: achieved is below expected

## Active Proposals

Coach shows active deals from Pipeline when the deal is in:

- Proposal
- Negotiation

These are sorted by highest value first so the team can focus on the most important opportunities.

## Today's Priorities

Coach automatically suggests up to two priorities for each Account Manager.

Examples:

- Follow up on a high-value proposal closing soon
- Recover pace if the Account Manager is behind target
- Maintain momentum if the Account Manager is ahead
- Review a Cloud Advisor cross-sell opportunity if there are no active proposals

## Who Can See Coach

Access depends on role:

- Account Manager: sees their own coaching summary
- Country GM: sees Account Managers in their country
- Head of Business: sees all Account Managers
- CEO: sees all Account Managers

## How to Use Coach

1. Open Coach from the Sales section.
2. Review the pace badge for each Account Manager.
3. Check the Gap value to see who is ahead or behind.
4. Review Active Proposals for deals that need follow-up.
5. Use Today's Priorities as the daily action plan.
6. Update the related Pipeline, Targets, or customer activity pages as work progresses.

## Important Notes

Coach is read-only. It does not create leads, change targets, move deals, or send notifications.

To update the data shown in Coach, update the source areas:

- Pipeline for deals and stages
- Targets for quarterly sales targets
- Usage and Cloud Advisor data for recommendation opportunities`,
  },
  {
    slug: "page-activities",
    title: "Activities",
    group: "Team Guide",
    order: 12,
    visibility: "public",
    content: `Activities is the sales activity log for customer follow-ups and opportunity work. Use it to record calls, meetings, and proposals sent for Pipeline leads.

## What Activities Tracks

Each activity records:

- Account Manager
- Related lead or opportunity
- Activity type
- Date
- Optional notes

Activity types are:

- Call
- Meeting
- Proposal Sent

## How to Log an Activity

1. Open Activities from the Sales section.
2. Click Log Activity.
3. Select the related Lead / Opportunity.
4. Choose the activity type.
5. Select the activity date.
6. Add notes if needed.
7. Click Log Activity.

The activity will appear in the Activity Log and will be tied to the selected Pipeline lead.

## Filters

Use the filters at the top of the page to narrow the activity list:

- Activity Type: All Types, Call, Meeting, Proposal Sent
- Account Manager: All Managers or a specific user

## Who Can See Activities

Access depends on role:

- Account Manager: sees their own activities
- Country GM: sees activities for users in their country
- Head of Business: sees all activities
- CEO: sees all activities

## Deleting Activities

CEO and Head of Business users can delete activity records.

Deletion is permanent, so only delete an activity if it was logged by mistake.

## Relationship to Pipeline

Activities are linked to Pipeline leads. They help show what follow-up has happened on an opportunity.

Activities do not move a lead from one stage to another. To update the sales stage, use the Pipeline page.

## Best Practice

Log important customer interactions as soon as they happen:

- After a customer call
- After a meeting
- When a proposal is sent
- When a follow-up note is important for leadership or the team

Keeping Activities updated helps managers understand progress without needing separate manual reports.

## Important Notes

Activities is a sales log, not a task manager. For internal work assignment, use Tasks.

Activities does not send emails, create reminders, attach files, or update Pipeline stages automatically.`,
  },
  {
    slug: "page-manageone",
    title: "ManageOne",
    group: "Team Guide",
    order: 13,
    visibility: "public",
    content: `ManageOne shows tenant and VDC information synced from Huawei ManageOne into the CRM. It helps leadership connect cloud platform tenants to CRM companies so usage, Cloud Health, and customer reporting can work correctly.

## What ManageOne Shows

The ManageOne page lists synced tenants with:

- Tenant name
- VDC ID
- Region and level
- Domain ID
- Manager contact
- ECS used
- EVS used
- Project count
- Last synced time
- Linked CRM company

## Who Can Access ManageOne

ManageOne is restricted to:

- CEO
- Head of Business

Other users will see an access restricted message.

## How Tenant Linking Works

Each ManageOne tenant should be linked to the correct CRM company.

If CRM finds a possible match, it shows a suggested company. Click Confirm Link to connect the ManageOne tenant to that company.

If no company exists yet, click Create Company. Choose:

- Sector
- Country
- Account Manager

The CRM will create a pending company and link it to the ManageOne tenant.

## Why Linking Matters

Linking ManageOne tenants to CRM companies helps the CRM connect cloud data to the correct customer.

This supports:

- Usage Tracking auto-fill
- Company cloud usage visibility
- Cloud Health customer-impact mapping
- Cloud Advisor recommendations
- Better customer reporting

## Usage Auto-Fill from ManageOne

Usage Tracking can use linked ManageOne tenant data to preview usage entries.

Use Auto-fill from ManageOne on the Usage page to:

1. Select a company.
2. Select a month.
3. Review detected ManageOne usage.
4. Confirm which entries should be created.
5. Create usage entries after review.

The system does not blindly create usage entries without user review.

## Company Usage Trends

For linked tenants, CRM can show usage history on the company detail page. Trends appear after enough sync snapshots have been collected.

## Sync Notes

ManageOne data is synced into CRM by backend/sync tooling. The browser page does not connect directly to ManageOne.

If no tenants appear, the ManageOne sync has not loaded tenant data yet.

## Best Practice

Use ManageOne regularly to keep tenant-to-company mapping clean.

Recommended workflow:

1. Open ManageOne.
2. Review unlinked tenants.
3. Confirm suggested matches when correct.
4. Create missing companies when needed.
5. Assign the correct sector, country, and account manager.
6. Use Usage Tracking auto-fill after tenants are linked.

## Important Notes

ManageOne is not the live ManageOne console. It does not edit cloud tenants or platform resources.

It is the CRM mapping and visibility layer for synced ManageOne tenant data.`,
  },
  {
    slug: "page-cloud-health",
    title: "Cloud Health",
    group: "Team Guide",
    order: 14,
    visibility: "public",
    content: `*Leadership and Country GM only — everyone else sees a restricted-access notice here. CEO and Head of Business can also manage ping targets; Country GM is view-only for ping target management.*

Cloud Health is the internal operations dashboard for monitored cloud regions. It is organized into tabs: Overview, Alarms, Capacity, Network, and Host Groups.

**Overview:** quick scan view for NOC/leadership. It shows alarm summary cards, Top Active Alarms, Top Repeated Patterns, capacity summary, network status summary, and Host Group Risk.

**Alarms:** current ManageOne/OC alarms scoped to HTG's monitored regions: Hoa-Mogadishu-2 and Mogadishu-region-hq3. Summary cards show Active, Critical, Major, Linked Tenants, and Regions. Use New Alarms for today's active alarms, All Alarms for the full active list, and Repeated Patterns to find recurring issues on the same resource/region/company. Operational focus views group alarms into Security, Backup / DR, Platform Services, Storage Risk, and Customer Impact. Filters include search, severity, region, category, time range, custom date range, and pagination. Click an alarm row to open its detail page with Affected Resource, probable cause, engineering next steps, and raw ManageOne payload.

**Capacity:** per-region CPU, memory, and storage usage with oversubscription ratios. Green is under 70%, warning begins at 70%, and critical begins at 90%. Click a region to open the drill-down page with capacity trends, top tenant consumers, region alarms, and region host groups.

**Network:** ICMP ping monitoring for upstream/provider targets. Active targets are checked by the htgweb ping monitor; paused targets remain saved but are not checked. The table shows current up/down state, latest latency, and 24-hour uptime. The Latency Trend chart supports ranges from Last 5 minutes through Last 30 days / Previous month and charts all active targets together. Add Ping Target is collapsed by default; click + Add Target to show name, IP address, and notes.

**Host Groups:** ManageOne host group utilization and risk. By default, the table focuses on host groups requiring attention (Critical + Watch). Risk is based on CPU/memory pressure: Watch at 70%+, Critical at 85%+. Summary cards can switch between all groups, critical, watch, healthy, and total hosts. Click a row to open the detail page with worst CPU/memory hosts, full host list, risk reasons, and raw ManageOne payloads.

**Auto Rotate:** optional NOC display mode. It is off by default. When enabled, it rotates Overview → Alarms → Capacity → Network → Host Groups every 60 seconds and updates the URL tab query. Manual tab clicks turn Auto Rotate off so the user can investigate without the screen moving away.

Cloud Health is for catching alarm, network, capacity, and host-pressure issues early — before customers notice impact.`,
  },
  {
    slug: "page-tasks",
    title: "Tasks",
    group: "Team Guide",
    order: 15,
    visibility: "public",
    content: `Tasks helps the team create, assign, track, and discuss internal CRM work without using a separate project-management tool.

Use it for follow-ups, handoffs, operational work, customer tasks, quote preparation, cloud investigations, and anything that needs an owner and visible progress.

## Dashboard Tasks Card

The main Dashboard includes a **Tasks** summary card.

It shows:
- Your open active tasks.
- How many are overdue.
- How many are due this week.
- Blocked count, when any blocked tasks exist.

Click the card to open the Tasks page.

## Tasks Page

The Tasks page is the main work queue.

By default, it opens in **Board** view. You can switch between:

- **Board** - Kanban-style columns by status.
- **List** - flat task list with the same tasks and controls.

Both views use the same filters.

## Summary Cards and Quick Filters

At the top of the Tasks page, summary cards help you quickly focus:

- **My Open Tasks** - tasks assigned to you that are still active.
- **Overdue** - active tasks past their due date.
- **Due This Week** - active tasks due within the next week.
- **Blocked** - tasks currently marked Blocked.

Clicking a summary card applies the relevant filters automatically.

## Ownership Filters

The ownership dropdown controls whose tasks you are viewing:

| Filter | Meaning |
|---|---|
| My Tasks | Tasks assigned to you |
| Reported to Me | Tasks where you are the Report To person |
| Created by Me | Tasks you created |
| All Visible | Every task you are allowed to see |

These combine with the status and priority filters.

## Status and Priority Filters

Status filters:
- All Active
- To Do
- In Progress
- Blocked
- Done
- Canceled

Priority filters:
- All Priorities
- Low
- Medium
- High
- Urgent

Active tasks exclude Done and Canceled.

## Board View

Board view groups tasks into columns:

- To Do
- In Progress
- Blocked
- Done
- Canceled

Each task card shows:
- Title
- Priority
- Assignee
- Report To
- Due date
- Company, if linked
- Comment count, if comments exist
- Attachment count, if files exist

Use the status dropdown on a card to move it between columns. Drag-and-drop is not enabled yet.

Click the task card or Open button to go to the task detail page.

## List View

List view shows the same tasks in rows.

Each row shows:
- Title
- Description preview
- Status
- Priority
- Assignee
- Report To
- Created by
- Due date
- Company, if linked
- Updated date
- Comment and attachment counts, when present

Click the row or title to open the task detail page.

Use the inline controls to change status, assignee, or Report To without opening the task.

## Creating a Task

Click **New Task**.

Fields:
- **Title** - required.
- **Description** - optional context.
- **Assignee** - the person responsible for doing the work.
- **Report To** - the person who should receive updates or review progress.
- **Priority** - Low, Medium, High, or Urgent.
- **Due date** - optional.
- **Company** - optional company link.

Use Company when the task is related to a customer/account.

## Assignee vs Report To

**Assignee** means the person responsible for completing the task.

**Report To** means the person who should be informed, review progress, or receive updates.

Example:
- Assignee: Account Manager doing the work.
- Report To: Country GM or Head of Business reviewing completion.

## Task Detail Page

Click a task to open its detail page.

The detail page shows:
- Task title
- Status
- Priority
- Assignee
- Report To
- Due date
- Company
- Description
- Attachments
- Comments

Use **Back to Tasks** to return to the Tasks page.

## Editing a Task

On the task detail page, click **Edit Task**.

You can update:
- Title
- Description
- Priority
- Due date
- Company

Status, Assignee, and Report To can still be changed from the Tasks list/board controls.

## Comments

Use comments for progress updates, handoffs, or discussion.

Comments show:
- Comment body
- Comment author
- Created date/time

You can add comments from the task detail page.

Comment authors can edit/remove their own comments. CEO and Head of Business can moderate comments.

## Attachments

Use attachments for supporting files such as:
- PDF invoices
- Screenshots/images
- Excel or CSV files
- Word documents
- Text files

Attachments appear on the task detail page.

Each attachment shows:
- File name
- File type
- File size
- Uploaded by
- Uploaded date/time

Actions:
- **Download** opens the file.
- **Remove** removes the attachment from the task.

Removing an attachment uses a soft archive. It does not change the task itself.

## Remove / Archive Behavior

Tasks and attachments use safe removal behavior.

- Removing a task archives it instead of hard-deleting it.
- Removing an attachment archives the attachment metadata instead of hard-deleting the task.
- Done and Canceled tasks are not counted as active.

## Permissions

Tasks follow CRM role access rules.

In simple terms:
- Account Managers can see tasks assigned to them, created by them, reported to them, or linked to their companies.
- Country GMs can see tasks for users and companies in their country.
- Head of Business and CEO can see all tasks.
- Assignment and Report To choices are validated by the backend.

If you cannot see or assign a task, it is usually because it is outside your role/country/company scope.`,
  },
  {
    slug: "page-team",
    title: "Team",
    group: "Team Guide",
    order: 16,
    visibility: "public",
    content: `*Leadership only (CEO / Head of Business) can make changes here — other roles can view team members' roles and country assignments, but can't edit anything.*

**Creating a new team member** (leadership only): **Create Team Member** button — set their name, email, role (Account Manager / Country GM / Head of Business / CEO), and optional country assignment. A temporary password is auto-generated (you can regenerate it) and shown once after creation — copy it to give to the new team member.

**Managing an existing member** (leadership only):
- Change their role or country assignment directly via inline dropdowns.
- **Reset Password** — generates a new temporary password, shown once for you to copy and share.
- **Disable** / **Re-enable** — deactivates or restores a team member's access without deleting their account (their historical records stay intact either way).
- Delete — permanently removes the account. Note: a team member who's still assigned to companies, leads, or targets can't be deleted until those assignments are reassigned elsewhere.`,
  },
  {
    slug: "page-settings",
    title: "Settings",
    group: "Team Guide",
    order: 17,
    visibility: "public",
    content: `**Profile** (everyone) — update your own display name here.

**Everything below Profile is leadership-only** (CEO / Head of Business); other roles see a restricted-access notice instead.

- **Countries & Regions** — add/edit/delete the countries and regions used elsewhere in the CRM (company assignment, GM scoping, etc.).
- **Industry Sectors** — add/edit/delete the industry sector list used to categorize companies.
- **Service Catalog** — this is where you manage pricing directly. Every catalog item has an edit (pencil) icon that opens a form with the item's monthly/yearly/hourly price, billing unit, and specs — change the number and save, and it takes effect everywhere immediately (Quotes, auto-pricing, everywhere else that reads pricing) since the CRM updates in real time. Use **Add** to create a brand-new service with its own pricing, or **Import** to bulk-load catalog items from a spreadsheet. You do not need to ask anyone to update a price for you — this is self-service.`,
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

export const replaceNavigationSection = internalMutation({
  args: {},
  handler: async (ctx) => {
    const navigationSection = await ctx.db
      .query("documentationSections")
      .withIndex("by_slug", (q) => q.eq("slug", "navigating-the-crm"))
      .unique();
    let removed = false;

    if (navigationSection) {
      await ctx.db.delete(navigationSection._id);
      removed = true;
    }

    const inserted: string[] = [];
    const now = Date.now();

    for (const section of PAGE_DOCUMENTATION_SECTIONS) {
      const existing = await ctx.db
        .query("documentationSections")
        .withIndex("by_slug", (q) => q.eq("slug", section.slug))
        .unique();

      if (existing) {
        continue;
      }

      await ctx.db.insert("documentationSections", {
        ...section,
        updatedAt: now,
      });
      inserted.push(section.slug);
    }

    const commonWorkflows = await ctx.db
      .query("documentationSections")
      .withIndex("by_slug", (q) => q.eq("slug", "common-workflows"))
      .unique();

    if (commonWorkflows) {
      await ctx.db.patch(commonWorkflows._id, { order: 18 });
    }

    return { removed, inserted };
  },
});
