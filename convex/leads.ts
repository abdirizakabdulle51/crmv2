import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";
import {
  assertAccountManagerIsInActorScope,
  assertCanManageLead,
  assertNotMonitoring,
  canViewCompany,
} from "./authorization";

async function getCurrentUserOrThrow(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
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
  assertNotMonitoring(user);
  return user;
}

function opportunityNumberForSequence(now: Date, sequence: number) {
  return `OPP-${now.getUTCFullYear()}-${String(sequence).padStart(5, "0")}`;
}

async function nextOpportunityNumber(ctx: MutationCtx, now: Date) {
  const prefix = `OPP-${now.getUTCFullYear()}-`;
  const opportunities = await ctx.db.query("leads").collect();
  const count = opportunities.filter((lead) =>
    lead.opportunityNumber?.startsWith(prefix),
  ).length;
  return opportunityNumberForSequence(now, count + 1);
}

async function logOpportunityEvent(
  ctx: MutationCtx,
  lead: Doc<"leads">,
  actor: Doc<"users">,
  type: "stage_changed" | "won" | "lost" | "note",
  description: string,
) {
  const accountManagerId = lead.accountManagerId ?? actor._id;
  await ctx.db.insert("activities", {
    accountManagerId,
    leadId: lead._id,
    type,
    description,
    date: new Date().toISOString(),
    createdAt: Date.now(),
  });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUserOrThrow(ctx);

    let leads: Doc<"leads">[];

    // Role-based visibility
    if (currentUser.role === "ceo" || currentUser.role === "head_of_business") {
      leads = await ctx.db.query("leads").collect();
    } else if (currentUser.role === "country_gm" && currentUser.countryId) {
      // Get all companies in this country, then filter leads
      const countryCompanies = await ctx.db
        .query("companies")
        .withIndex("by_country", (q) =>
          q.eq("countryId", currentUser.countryId!),
        )
        .collect();
      const companyIds = new Set(countryCompanies.map((c) => c._id));
      const allLeads = await ctx.db.query("leads").collect();
      leads = allLeads.filter(
        (l) =>
          l.countryId === currentUser.countryId ||
          (l.companyId !== undefined && companyIds.has(l.companyId)),
      );
    } else {
      // Account managers see only their own leads
      leads = await ctx.db
        .query("leads")
        .withIndex("by_account_manager", (q) =>
          q.eq("accountManagerId", currentUser._id),
        )
        .collect();
    }

    return leads;
  },
});

export const getById = query({
  args: { id: v.id("leads") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const lead = await ctx.db.get(args.id);
    if (!lead)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opportunity not found",
      });
    await assertCanManageLead(ctx, currentUser, lead);
    return lead;
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    companyId: v.optional(v.id("companies")),
    accountManagerId: v.id("users"),
    stage: v.union(
      v.literal("new_lead"),
      v.literal("qualified"),
      v.literal("discovery"),
      v.literal("proposal"),
      v.literal("negotiation"),
      v.literal("won"),
      v.literal("lost"),
    ),
    potentialValue: v.number(),
    expectedCloseDate: v.string(),
    nextAction: v.optional(v.string()),
    nextActionDate: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    source: v.optional(v.string()),
    serviceInterests: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    if (
      !args.title.trim() ||
      args.potentialValue <= 0 ||
      !Date.parse(args.expectedCloseDate)
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Complete the opportunity title, positive value, and close date",
      });
    if (
      args.stage === "won" ||
      args.stage === "lost" ||
      args.stage === "negotiation"
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "New opportunities must start in an open pre-proposal stage",
      });
    const company = args.companyId ? await ctx.db.get(args.companyId) : null;
    if (args.stage === "proposal" && !company)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select the prospect organization before creating a proposal",
      });
    if (args.companyId) {
      if (!company) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Company not found",
        });
      }
      if (!canViewCompany(currentUser, company)) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message:
            "You do not have permission to create a lead for this company",
        });
      }
    }
    const accountManagerId =
      currentUser.role === "account_manager"
        ? currentUser._id
        : args.accountManagerId;
    const accountManager = await ctx.db.get(accountManagerId);
    const countryId = company?.countryId ?? accountManager?.countryId;
    await assertAccountManagerIsInActorScope(
      ctx,
      currentUser,
      accountManagerId,
      countryId,
    );

    const now = new Date();
    const leadId = await ctx.db.insert("leads", {
      opportunityNumber: await nextOpportunityNumber(ctx, now),
      title: args.title,
      companyId: args.companyId,
      countryId,
      accountManagerId,
      stage: args.stage,
      potentialValue: args.potentialValue,
      expectedCloseDate: args.expectedCloseDate,
      nextAction: args.nextAction,
      nextActionDate: args.nextActionDate,
      contactName: args.contactName,
      contactEmail: args.contactEmail,
      source: args.source,
      serviceInterests: args.serviceInterests,
      notes: args.notes,
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    });
    const lead = await ctx.db.get(leadId);
    if (lead)
      await logOpportunityEvent(
        ctx,
        lead,
        currentUser,
        "note",
        `Opportunity ${lead.opportunityNumber ?? "created"} created`,
      );
    return leadId;
  },
});

export const update = mutation({
  args: {
    id: v.id("leads"),
    title: v.string(),
    companyId: v.optional(v.id("companies")),
    accountManagerId: v.id("users"),
    stage: v.union(
      v.literal("new_lead"),
      v.literal("qualified"),
      v.literal("discovery"),
      v.literal("proposal"),
      v.literal("negotiation"),
      v.literal("won"),
      v.literal("lost"),
    ),
    potentialValue: v.number(),
    expectedCloseDate: v.string(),
    nextAction: v.optional(v.string()),
    nextActionDate: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    source: v.optional(v.string()),
    serviceInterests: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    if (
      !args.title.trim() ||
      args.potentialValue <= 0 ||
      !Date.parse(args.expectedCloseDate)
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Complete the opportunity title, positive value, and close date",
      });
    const lead = await ctx.db.get(args.id);
    if (!lead) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    await assertCanManageLead(ctx, currentUser, lead);
    if (args.stage !== lead.stage)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Use the opportunity stage control to change stage",
      });
    const company = args.companyId ? await ctx.db.get(args.companyId) : null;
    if (args.companyId) {
      if (!company) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Company not found",
        });
      }
      if (!canViewCompany(currentUser, company)) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message:
            "You do not have permission to move this lead to that company",
        });
      }
    }
    const accountManagerId =
      currentUser.role === "account_manager"
        ? currentUser._id
        : args.accountManagerId;
    const accountManager = await ctx.db.get(accountManagerId);
    const countryId = company?.countryId ?? accountManager?.countryId;
    await assertAccountManagerIsInActorScope(
      ctx,
      currentUser,
      accountManagerId,
      countryId,
    );
    const { id, ...fields } = args;
    await ctx.db.patch(id, {
      ...fields,
      accountManagerId,
      countryId,
      updatedAt: Date.now(),
    });
    await logOpportunityEvent(
      ctx,
      { ...lead, ...fields, accountManagerId, countryId },
      currentUser,
      "note",
      "Opportunity details updated",
    );
  },
});

export const updateStage = mutation({
  args: {
    id: v.id("leads"),
    stage: v.union(
      v.literal("new_lead"),
      v.literal("qualified"),
      v.literal("discovery"),
      v.literal("proposal"),
      v.literal("negotiation"),
      v.literal("won"),
      v.literal("lost"),
    ),
    lossReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const lead = await ctx.db.get(args.id);
    if (!lead) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    await assertCanManageLead(ctx, currentUser, lead);
    if (args.stage === "proposal" && !lead.companyId)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select the prospect organization before creating a proposal",
      });
    if (args.stage === "lost" && !args.lossReason?.trim())
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Add a loss reason before closing the opportunity",
      });
    const linkedQuotes = lead.companyId
      ? (
          await ctx.db
            .query("quotes")
            .withIndex("by_company", (q) => q.eq("companyId", lead.companyId!))
            .collect()
        ).filter((quote) => quote.leadId === lead._id)
      : [];
    if (
      (args.stage === "negotiation" || args.stage === "won") &&
      !linkedQuotes.some((quote) =>
        args.stage === "won"
          ? quote.status === "accepted"
          : quote.status === "sent" || quote.status === "accepted",
      )
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          args.stage === "won"
            ? "Accept an opportunity quote before marking the deal won"
            : "Send an opportunity quote before moving to negotiation",
      });
    if (args.stage === "won") {
      if (!lead.companyId)
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Complete the prospect organization before marking it won",
        });
      const acceptedQuote = linkedQuotes.find(
        (quote) => quote.status === "accepted",
      );
      if (!acceptedQuote)
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Accept an opportunity quote before marking the deal won",
        });
      await ctx.db.patch(lead.companyId, {
        commercialModel: acceptedQuote.commercialModel ?? "payg",
      });
    }
    await ctx.db.patch(args.id, {
      stage: args.stage,
      lossReason: args.stage === "lost" ? args.lossReason?.trim() : undefined,
      updatedAt: Date.now(),
    });
    await logOpportunityEvent(
      ctx,
      lead,
      currentUser,
      args.stage === "won"
        ? "won"
        : args.stage === "lost"
          ? "lost"
          : "stage_changed",
      `Stage changed from ${lead.stage} to ${args.stage}${
        args.lossReason ? `: ${args.lossReason}` : ""
      }`,
    );
  },
});

export const remove = mutation({
  args: { id: v.id("leads") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const lead = await ctx.db.get(args.id);
    if (!lead) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Lead not found" });
    }
    await assertCanManageLead(ctx, currentUser, lead);
    await ctx.db.delete(args.id);
  },
});
