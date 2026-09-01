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

async function reconcileCompanyLifecycle(
  ctx: MutationCtx,
  companyId: Doc<"companies">["_id"] | undefined,
) {
  if (!companyId) return;
  const company = await ctx.db.get(companyId);
  if (!company) return;
  const opportunities = await ctx.db
    .query("leads")
    .withIndex("by_company", (q) => q.eq("companyId", company._id))
    .collect();
  if (
    company.lifecycleStatus === "customer" ||
    opportunities.some((opportunity) => opportunity.stage === "won")
  ) {
    await ctx.db.patch(company._id, {
      lifecycleStatus: "customer",
      lostReason: undefined,
      lostAt: undefined,
    });
    return;
  }
  const hasOpenOpportunity = opportunities.some(
    (opportunity) =>
      opportunity.stage !== "won" && opportunity.stage !== "lost",
  );
  const latestLost = opportunities
    .filter((opportunity) => opportunity.stage === "lost")
    .sort(
      (a, b) =>
        (b.updatedAt ?? b._creationTime) - (a.updatedAt ?? a._creationTime),
    )[0];
  await ctx.db.patch(company._id, {
    lifecycleStatus: hasOpenOpportunity || !latestLost ? "prospect" : "lost",
    lostReason: !hasOpenOpportunity ? latestLost?.lossReason : undefined,
    lostAt:
      !hasOpenOpportunity && latestLost
        ? (latestLost.updatedAt ?? Date.now())
        : undefined,
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
    if (lead.companyId !== args.companyId) {
      await reconcileCompanyLifecycle(ctx, lead.companyId);
      await reconcileCompanyLifecycle(ctx, args.companyId);
    }
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
    quoteId: v.optional(v.id("quotes")),
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
      const acceptedQuotes = linkedQuotes.filter(
        (quote) => quote.status === "accepted",
      );
      const acceptedQuote = args.quoteId
        ? acceptedQuotes.find((quote) => quote._id === args.quoteId)
        : acceptedQuotes.length === 1
          ? acceptedQuotes[0]
          : undefined;
      if (!acceptedQuote)
        throw new ConvexError({
          code: "BAD_REQUEST",
          message:
            acceptedQuotes.length > 1
              ? "Select the accepted quote that won this opportunity"
              : "Accept an opportunity quote before marking the deal won",
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
    await reconcileCompanyLifecycle(ctx, lead.companyId);
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

export const createProspectCompany = mutation({
  args: {
    leadId: v.id("leads"),
    name: v.string(),
    sectorId: v.id("sectors"),
    countryId: v.id("countries"),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opportunity not found",
      });
    await assertCanManageLead(ctx, currentUser, lead);
    if (lead.companyId)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "This opportunity already has a company",
      });
    if (!args.name.trim())
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Company name is required",
      });
    const accountManagerId = lead.accountManagerId ?? currentUser._id;
    await assertAccountManagerIsInActorScope(
      ctx,
      currentUser,
      accountManagerId,
      args.countryId,
    );
    const normalizedName = args.name.trim().toLowerCase();
    const duplicate =
      (await ctx.db
        .query("companies")
        .withIndex("by_country_normalized_name", (q) =>
          q
            .eq("countryId", args.countryId)
            .eq("normalizedName", normalizedName),
        )
        .first()) ??
      (
        await ctx.db
          .query("companies")
          .withIndex("by_country", (q) => q.eq("countryId", args.countryId))
          .collect()
      ).find((company) => company.name.trim().toLowerCase() === normalizedName);
    if (duplicate)
      throw new ConvexError({
        code: "CONFLICT",
        message: "A company with this name already exists in this country",
      });
    const companyId = await ctx.db.insert("companies", {
      name: args.name.trim(),
      normalizedName,
      sectorId: args.sectorId,
      countryId: args.countryId,
      accountManagerId,
      contractStatus: "pending",
      paymentStatus: "current",
      contactName: lead.contactName,
      contactEmail: lead.contactEmail,
      lifecycleStatus: "prospect",
    });
    await ctx.db.patch(lead._id, {
      companyId,
      countryId: args.countryId,
      updatedAt: Date.now(),
    });
    await logOpportunityEvent(
      ctx,
      { ...lead, companyId, countryId: args.countryId },
      currentUser,
      "note",
      `Prospect company ${args.name.trim()} created and linked`,
    );
    return companyId;
  },
});

export const attachCompany = mutation({
  args: { leadId: v.id("leads"), companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUserOrThrow(ctx);
    const [lead, company] = await Promise.all([
      ctx.db.get(args.leadId),
      ctx.db.get(args.companyId),
    ]);
    if (!lead)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opportunity not found",
      });
    if (!company)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Company not found",
      });
    await assertCanManageLead(ctx, currentUser, lead);
    if (!canViewCompany(currentUser, company))
      throw new ConvexError({ code: "FORBIDDEN", message: "Access denied" });
    if (lead.accountManagerId)
      await assertAccountManagerIsInActorScope(
        ctx,
        currentUser,
        lead.accountManagerId,
        company.countryId,
      );
    const previousCompanyId = lead.companyId;
    await ctx.db.patch(lead._id, {
      companyId: company._id,
      countryId: company.countryId,
      updatedAt: Date.now(),
    });
    await reconcileCompanyLifecycle(ctx, previousCompanyId);
    await reconcileCompanyLifecycle(ctx, company._id);
    await logOpportunityEvent(
      ctx,
      { ...lead, companyId: company._id, countryId: company.countryId },
      currentUser,
      "note",
      `Company ${company.name} linked to opportunity`,
    );
  },
});

export const prepareProposal = mutation({
  args: {
    leadId: v.id("leads"),
    companyId: v.optional(v.id("companies")),
    newCompany: v.optional(
      v.object({
        name: v.string(),
        sectorId: v.id("sectors"),
        countryId: v.id("countries"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await getCurrentUserOrThrow(ctx);
    const lead = await ctx.db.get(args.leadId);
    if (!lead)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opportunity not found",
      });
    await assertCanManageLead(ctx, actor, lead);
    if (lead.companyId || !!args.companyId === !!args.newCompany)
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Choose exactly one company option",
      });
    let companyId = args.companyId;
    if (companyId) {
      const company = await ctx.db.get(companyId);
      if (!company || !canViewCompany(actor, company))
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Company is not available",
        });
      if (lead.accountManagerId)
        await assertAccountManagerIsInActorScope(
          ctx,
          actor,
          lead.accountManagerId,
          company.countryId,
        );
      await ctx.db.patch(lead._id, { companyId, countryId: company.countryId });
    } else {
      const input = args.newCompany!;
      const name = input.name.trim();
      if (!name)
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Company name is required",
        });
      const normalizedName = name.toLowerCase();
      const duplicate =
        (await ctx.db
          .query("companies")
          .withIndex("by_country_normalized_name", (q) =>
            q
              .eq("countryId", input.countryId)
              .eq("normalizedName", normalizedName),
          )
          .first()) ??
        (
          await ctx.db
            .query("companies")
            .withIndex("by_country", (q) => q.eq("countryId", input.countryId))
            .collect()
        ).find(
          (company) => company.name.trim().toLowerCase() === normalizedName,
        );
      if (duplicate)
        throw new ConvexError({
          code: "CONFLICT",
          message: "A company with this name already exists in this country",
        });
      const accountManagerId = lead.accountManagerId ?? actor._id;
      await assertAccountManagerIsInActorScope(
        ctx,
        actor,
        accountManagerId,
        input.countryId,
      );
      companyId = await ctx.db.insert("companies", {
        name,
        normalizedName,
        sectorId: input.sectorId,
        countryId: input.countryId,
        accountManagerId,
        contractStatus: "pending",
        paymentStatus: "current",
        contactName: lead.contactName,
        contactEmail: lead.contactEmail,
        lifecycleStatus: "prospect",
      });
      await ctx.db.patch(lead._id, { companyId, countryId: input.countryId });
    }
    const now = Date.now();
    await ctx.db.patch(lead._id, { stage: "proposal", updatedAt: now });
    await logOpportunityEvent(
      ctx,
      { ...lead, companyId, stage: "proposal", updatedAt: now },
      actor,
      "stage_changed",
      "Company linked and opportunity moved to proposal",
    );
    return companyId;
  },
});

export const acceptQuoteAndWin = mutation({
  args: {
    leadId: v.id("leads"),
    quoteId: v.id("quotes"),
    acceptedByContact: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getCurrentUserOrThrow(ctx);
    const [lead, quote] = await Promise.all([
      ctx.db.get(args.leadId),
      ctx.db.get(args.quoteId),
    ]);
    if (!lead || !quote)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opportunity or quote not found",
      });
    await assertCanManageLead(ctx, actor, lead);
    if (
      !lead.companyId ||
      quote.leadId !== lead._id ||
      quote.companyId !== lead.companyId
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select a quote linked to this opportunity",
      });
    if (quote.status !== "sent" && quote.status !== "accepted")
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Send the quote before accepting it",
      });
    const now = Date.now();
    await ctx.db.patch(quote._id, {
      status: "accepted",
      acceptedAt: quote.acceptedAt ?? now,
      acceptedByContact:
        args.acceptedByContact?.trim() || quote.acceptedByContact,
    });
    await ctx.db.patch(lead.companyId, {
      lifecycleStatus: "customer",
      commercialModel: quote.commercialModel ?? "payg",
      lostReason: undefined,
      lostAt: undefined,
    });
    await ctx.db.patch(lead._id, {
      stage: "won",
      lossReason: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("activities", {
      accountManagerId: lead.accountManagerId ?? actor._id,
      leadId: lead._id,
      type: "quote_accepted",
      description: `Quote ${quote.quoteNumber ?? quote._id} accepted`,
      date: new Date(now).toISOString(),
      createdAt: now,
    });
    await logOpportunityEvent(
      ctx,
      lead,
      actor,
      "won",
      `Opportunity won with quote ${quote.quoteNumber ?? quote._id}`,
    );
  },
});

export const sendQuoteAndNegotiate = mutation({
  args: { leadId: v.id("leads"), quoteId: v.id("quotes") },
  handler: async (ctx, args) => {
    const actor = await getCurrentUserOrThrow(ctx);
    const [lead, quote] = await Promise.all([
      ctx.db.get(args.leadId),
      ctx.db.get(args.quoteId),
    ]);
    if (!lead || !quote)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Opportunity or quote not found",
      });
    await assertCanManageLead(ctx, actor, lead);
    if (
      !lead.companyId ||
      quote.leadId !== lead._id ||
      quote.companyId !== lead.companyId
    )
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Select a quote linked to this opportunity",
      });
    if (quote.status !== "draft" && quote.status !== "sent")
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Only a draft or sent quote can start negotiation",
      });
    const now = Date.now();
    await ctx.db.patch(quote._id, {
      status: "sent",
      sentAt: quote.sentAt ?? now,
    });
    await ctx.db.patch(lead._id, { stage: "negotiation", updatedAt: now });
    await ctx.db.insert("activities", {
      accountManagerId: lead.accountManagerId ?? actor._id,
      leadId: lead._id,
      type: "quote_sent",
      description: `Quote ${quote.quoteNumber ?? quote._id} sent; negotiation started`,
      date: new Date(now).toISOString(),
      createdAt: now,
    });
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
    await reconcileCompanyLifecycle(ctx, lead.companyId);
  },
});
