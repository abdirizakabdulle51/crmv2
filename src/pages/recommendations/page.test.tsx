import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import RecommendationsPage from "./page.tsx";
import type { Recommendation } from "./_lib/recommendation-engine.ts";

type TestRecommendation = Recommendation & {
  recommendationKey?: string;
  status?:
    | "open"
    | "acknowledged"
    | "in_progress"
    | "snoozed"
    | "dismissed"
    | "resolved";
  statusUpdatedAt?: number;
  snoozedUntil?: number;
  note?: string;
};

Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
  value: vi.fn(() => false),
});
Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
  value: vi.fn(),
});
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
  value: vi.fn(),
});
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  value: vi.fn(),
});

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    companies: { list: "companies.list" },
    recommendations: { listComputed: "recommendations.listComputed" },
    aiRecommendations: { listVisible: "aiRecommendations.listVisible" },
    cloudAdvisorStatuses: {
      setRecommendationStatus: "cloudAdvisorStatuses.setRecommendationStatus",
      reopenRecommendation: "cloudAdvisorStatuses.reopenRecommendation",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  companies: [] as Doc<"companies">[],
  recommendations: [] as TestRecommendation[],
  aiRecommendations: [] as Doc<"aiRecommendations">[],
  setRecommendationStatus: vi.fn(),
  reopenRecommendation: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) => {
    if (query === "companies.list") return mocks.companies;
    if (query === "recommendations.listComputed") return mocks.recommendations;
    if (query === "aiRecommendations.listVisible")
      return mocks.aiRecommendations;
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "cloudAdvisorStatuses.setRecommendationStatus") {
      return mocks.setRecommendationStatus;
    }
    if (mutation === "cloudAdvisorStatuses.reopenRecommendation") {
      return mocks.reopenRecommendation;
    }
    return vi.fn();
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function company(id: string, name: string): Doc<"companies"> {
  return {
    _id: id as Id<"companies">,
    _creationTime: 1,
    name,
    sectorId: "sector-1" as Id<"sectors">,
    countryId: "country-1" as Id<"countries">,
    accountManagerId: "user-1" as Id<"users">,
    contractStatus: "active",
  };
}

function recommendation(index: number, priority: Recommendation["priority"]) {
  return {
    companyId: `company-${index}` as Id<"companies">,
    companyName: `Company ${String(index).padStart(2, "0")}`,
    rule: index % 2 === 0 ? "backup" : "waf",
    triggerReason: `Recommendation ${index}`,
    recommendedService: "Managed service",
    estimatedValue: "$10.00/mo",
    estimatedMonthlyValue: 10,
    priority,
    recommendationKey: `company-${index}:${
      index % 2 === 0 ? "backup" : "waf"
    }:managed%20service`,
  } satisfies TestRecommendation;
}

function seedRecommendations() {
  mocks.companies = Array.from({ length: 60 }, (_, index) =>
    company(
      `company-${index + 1}`,
      `Company ${String(index + 1).padStart(2, "0")}`,
    ),
  );
  mocks.recommendations = [
    ...Array.from({ length: 55 }, (_, index) =>
      recommendation(index + 1, "medium"),
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      recommendation(index + 56, "low"),
    ),
  ];
  mocks.aiRecommendations = [];
}

describe("RecommendationsPage pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setRecommendationStatus.mockResolvedValue("status-id");
    mocks.reopenRecommendation.mockResolvedValue({ deleted: true });
  });

  it("presents the page as Cloud Advisor with category filtering", async () => {
    const user = userEvent.setup();
    mocks.companies = [
      company("company-1", "Backup Co"),
      company("company-2", "Security Co"),
    ];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Backup Co",
        rule: "backup",
        triggerReason: "Needs backup",
      },
      {
        ...recommendation(2, "medium"),
        companyName: "Security Co",
        rule: "waf",
        triggerReason: "Needs WAF",
        recommendedService: "WAF",
        estimateBasis: "Growing usage trend",
        estimateCatalogItemName: "Basic WAF",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    expect(
      screen.getByRole("heading", { name: "Cloud Advisor" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Open Recommendations")).toBeInTheDocument();
    expect(screen.getByText("Estimated Monthly Value")).toBeInTheDocument();
    expect(screen.getByText("$20.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Security" }));

    expect(screen.getByText(/Security Co/)).toBeInTheDocument();
    expect(screen.getByText("WAF: WAF")).toBeInTheDocument();
    expect(screen.getByText("Recommended action:")).toBeInTheDocument();
    expect(screen.getByText("Add/Review WAF.")).toBeInTheDocument();
    expect(screen.getByText("Growing usage trend")).toBeInTheDocument();
    expect(screen.getByText("Basic WAF")).toBeInTheDocument();
    expect(screen.queryByText(/Backup Co/)).not.toBeInTheDocument();
  });

  it("changes page size and navigates recommendation pages", async () => {
    const user = userEvent.setup();
    seedRecommendations();

    render(<RecommendationsPage />);

    expect(screen.getAllByText("Showing 1-50 of 60")).toHaveLength(2);
    expect(screen.getByText(/Company 01/)).toBeInTheDocument();
    expect(screen.queryByText(/Company 51/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "Recommendations per page" }),
    );
    await user.click(screen.getByRole("option", { name: "25 per page" }));

    expect(screen.getAllByText("Showing 1-25 of 60")).toHaveLength(2);
    expect(screen.queryByText(/Company 26/)).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Next" })[0]);

    expect(screen.getAllByText("Showing 26-50 of 60")).toHaveLength(2);
    expect(screen.queryByText(/Company 01/)).not.toBeInTheDocument();
    expect(screen.getByText(/Company 26/)).toBeInTheDocument();
  });

  it("resets to page 1 when an existing filter changes", async () => {
    const user = userEvent.setup();
    seedRecommendations();

    render(<RecommendationsPage />);

    await user.click(screen.getAllByRole("button", { name: "Next" })[0]);
    expect(screen.getAllByText("Showing 51-60 of 60")).toHaveLength(2);

    await user.click(screen.getAllByRole("combobox")[2]);
    await user.click(screen.getByRole("option", { name: "Low" }));

    expect(screen.getAllByText("Showing 1-5 of 5")).toHaveLength(2);
    expect(screen.getByText(/Company 56/)).toBeInTheDocument();
  });

  it("shows status badges and subtle status timing text", () => {
    mocks.companies = [company("company-1", "Company 01")];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        status: "in_progress",
        statusUpdatedAt: Date.UTC(2026, 6, 29),
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
    expect(screen.getByText(/Company 01/)).toBeInTheDocument();
  });

  it("defaults to Active status recommendations and hides inactive statuses", () => {
    mocks.companies = [
      company("company-1", "Open Co"),
      company("company-2", "Acknowledged Co"),
      company("company-3", "Progress Co"),
      company("company-4", "Snoozed Co"),
      company("company-5", "Dismissed Co"),
      company("company-6", "Resolved Co"),
    ];
    mocks.recommendations = [
      { ...recommendation(1, "high"), companyName: "Open Co", status: "open" },
      {
        ...recommendation(2, "high"),
        companyName: "Acknowledged Co",
        status: "acknowledged",
      },
      {
        ...recommendation(3, "high"),
        companyName: "Progress Co",
        status: "in_progress",
      },
      {
        ...recommendation(4, "high"),
        companyName: "Snoozed Co",
        status: "snoozed",
      },
      {
        ...recommendation(5, "high"),
        companyName: "Dismissed Co",
        status: "dismissed",
      },
      {
        ...recommendation(6, "high"),
        companyName: "Resolved Co",
        status: "resolved",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    expect(screen.getAllByText("Showing 1-3 of 3")).toHaveLength(2);
    expect(screen.getByText(/Open Co/)).toBeInTheDocument();
    expect(screen.getByText(/Acknowledged Co/)).toBeInTheDocument();
    expect(screen.getByText(/Progress Co/)).toBeInTheDocument();
    expect(screen.queryByText(/Snoozed Co/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dismissed Co/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Resolved Co/)).not.toBeInTheDocument();
  });

  it("offers status filters and shows specific inactive statuses", async () => {
    const user = userEvent.setup();
    mocks.companies = [
      company("company-1", "Open Co"),
      company("company-2", "Snoozed Co"),
    ];
    mocks.recommendations = [
      { ...recommendation(1, "high"), companyName: "Open Co", status: "open" },
      {
        ...recommendation(2, "high"),
        companyName: "Snoozed Co",
        status: "snoozed",
        snoozedUntil: Date.UTC(2026, 7, 15),
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    expect(screen.getByRole("option", { name: "Active" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Open" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Acknowledged" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "In Progress" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Snoozed" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Dismissed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Resolved" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All" })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "Snoozed" }));

    expect(screen.getAllByText("Showing 1-1 of 1")).toHaveLength(2);
    expect(screen.getByText(/Snoozed Co/)).toBeInTheDocument();
    expect(screen.getAllByText("Snoozed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Snoozed until/)).toBeInTheDocument();
    expect(screen.queryByText(/Open Co/)).not.toBeInTheDocument();
  });

  it("shows open recommendation actions and acknowledges with the correct payload", async () => {
    const user = userEvent.setup();
    mocks.companies = [company("company-1", "Open Co")];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Open Co",
        status: "open",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    expect(
      screen.getByRole("button", { name: "Acknowledge" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start Progress" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Snooze" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Acknowledge" }));

    expect(mocks.setRecommendationStatus).toHaveBeenCalledWith({
      recommendationKey: "company-1:waf:managed%20service",
      companyId: "company-1",
      rule: "waf",
      recommendedService: "Managed service",
      status: "acknowledged",
    });
  });

  it("shows Snooze for open, acknowledged, and in progress recommendations", () => {
    mocks.companies = [
      company("company-1", "Open Co"),
      company("company-2", "Acknowledged Co"),
      company("company-3", "Progress Co"),
    ];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Open Co",
        status: "open",
      },
      {
        ...recommendation(2, "medium"),
        companyName: "Acknowledged Co",
        status: "acknowledged",
      },
      {
        ...recommendation(3, "medium"),
        companyName: "Progress Co",
        status: "in_progress",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    expect(screen.getAllByRole("combobox", { name: "Snooze" })).toHaveLength(
      3,
    );
  });

  it("snoozes for seven days with a future snoozedUntil timestamp", async () => {
    const user = userEvent.setup();
    const now = Date.UTC(2026, 7, 2, 9, 0, 0);
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    mocks.companies = [company("company-1", "Open Co")];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Open Co",
        status: "open",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    await user.click(screen.getByRole("combobox", { name: "Snooze" }));
    await user.click(screen.getByRole("option", { name: "Snooze 7 days" }));

    expect(mocks.setRecommendationStatus).toHaveBeenCalledWith({
      recommendationKey: "company-1:waf:managed%20service",
      companyId: "company-1",
      rule: "waf",
      recommendedService: "Managed service",
      status: "snoozed",
      snoozedUntil: now + 7 * 24 * 60 * 60 * 1000,
    });
    expect(
      mocks.setRecommendationStatus.mock.calls[0][0].snoozedUntil,
    ).toBeGreaterThan(now);

    dateSpy.mockRestore();
  });

  it("starts progress from open and acknowledged recommendations", async () => {
    const user = userEvent.setup();
    mocks.companies = [
      company("company-1", "Open Co"),
      company("company-2", "Acknowledged Co"),
    ];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Open Co",
        status: "open",
      },
      {
        ...recommendation(2, "medium"),
        companyName: "Acknowledged Co",
        status: "acknowledged",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    expect(screen.getAllByRole("button", { name: "Start Progress" })).toHaveLength(
      2,
    );

    await user.click(screen.getAllByRole("button", { name: "Start Progress" })[0]);

    expect(mocks.setRecommendationStatus).toHaveBeenCalledWith({
      recommendationKey: "company-1:waf:managed%20service",
      companyId: "company-1",
      rule: "waf",
      recommendedService: "Managed service",
      status: "in_progress",
    });
  });

  it("shows the correct actions for in progress recommendations", () => {
    mocks.companies = [company("company-1", "Progress Co")];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Progress Co",
        status: "in_progress",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Progress" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Snooze" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });

  it("shows Reopen only for snoozed recommendations", async () => {
    const user = userEvent.setup();
    mocks.companies = [company("company-1", "Snoozed Co")];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Snoozed Co",
        status: "snoozed",
        snoozedUntil: Date.UTC(2026, 7, 15),
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(screen.getByRole("option", { name: "Snoozed" }));

    expect(screen.getByText(/Snoozed Co/)).toBeInTheDocument();
    expect(screen.getByText(/Snoozed until/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Progress" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Snooze" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
  });

  it("displays an existing workflow note and saves note updates", async () => {
    const user = userEvent.setup();
    mocks.companies = [company("company-1", "Acknowledged Co")];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Acknowledged Co",
        status: "acknowledged",
        note: "Waiting for customer approval.",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    expect(screen.getByText("Workflow note")).toBeInTheDocument();
    expect(screen.getByText("Waiting for customer approval.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit note" }));
    await user.clear(screen.getByPlaceholderText("Add a short workflow note..."));
    await user.type(
      screen.getByPlaceholderText("Add a short workflow note..."),
      "Customer requested a follow-up next week.",
    );
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(mocks.setRecommendationStatus).toHaveBeenCalledWith({
      recommendationKey: "company-1:waf:managed%20service",
      companyId: "company-1",
      rule: "waf",
      recommendedService: "Managed service",
      status: "acknowledged",
      note: "Customer requested a follow-up next week.",
    });
  });

  it("adds a workflow note for an in progress recommendation", async () => {
    const user = userEvent.setup();
    mocks.companies = [company("company-1", "Progress Co")];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Progress Co",
        status: "in_progress",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    await user.click(screen.getByRole("button", { name: "Add note" }));
    await user.type(
      screen.getByPlaceholderText("Add a short workflow note..."),
      "Team is validating backup sizing.",
    );
    await user.click(screen.getByRole("button", { name: "Save note" }));

    expect(mocks.setRecommendationStatus).toHaveBeenCalledWith({
      recommendationKey: "company-1:waf:managed%20service",
      companyId: "company-1",
      rule: "waf",
      recommendedService: "Managed service",
      status: "in_progress",
      note: "Team is validating backup sizing.",
    });
  });

  it("shows in progress recommendations through the In Progress status filter", async () => {
    const user = userEvent.setup();
    mocks.companies = [
      company("company-1", "Open Co"),
      company("company-2", "Progress Co"),
    ];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Open Co",
        status: "open",
      },
      {
        ...recommendation(2, "medium"),
        companyName: "Progress Co",
        status: "in_progress",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(screen.getByRole("option", { name: "In Progress" }));

    expect(screen.getAllByText("Showing 1-1 of 1")).toHaveLength(2);
    expect(screen.getByText(/Progress Co/)).toBeInTheDocument();
    expect(screen.queryByText(/Open Co/)).not.toBeInTheDocument();
  });

  it("dismisses and resolves with the selected status", async () => {
    const user = userEvent.setup();
    mocks.companies = [company("company-1", "Open Co")];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Open Co",
        status: "open",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await user.click(screen.getByRole("button", { name: "Resolve" }));

    expect(mocks.setRecommendationStatus).toHaveBeenNthCalledWith(1, {
      recommendationKey: "company-1:waf:managed%20service",
      companyId: "company-1",
      rule: "waf",
      recommendedService: "Managed service",
      status: "dismissed",
    });
    expect(mocks.setRecommendationStatus).toHaveBeenNthCalledWith(2, {
      recommendationKey: "company-1:waf:managed%20service",
      companyId: "company-1",
      rule: "waf",
      recommendedService: "Managed service",
      status: "resolved",
    });
  });

  it("reopens inactive recommendations with the recommendation key", async () => {
    const user = userEvent.setup();
    mocks.companies = [company("company-1", "Resolved Co")];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Resolved Co",
        status: "resolved",
      },
    ];
    mocks.aiRecommendations = [];

    render(<RecommendationsPage />);

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(screen.getByRole("option", { name: "Resolved" }));
    await user.click(screen.getByRole("button", { name: "Reopen" }));

    expect(mocks.reopenRecommendation).toHaveBeenCalledWith({
      recommendationKey: "company-1:waf:managed%20service",
    });
  });

  it("hides resolved cards from Active when reactive data updates", async () => {
    const user = userEvent.setup();
    mocks.companies = [company("company-1", "Open Co")];
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Open Co",
        status: "open",
      },
    ];
    mocks.aiRecommendations = [];

    const { rerender } = render(<RecommendationsPage />);
    expect(screen.getByText(/Open Co/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    mocks.recommendations = [
      {
        ...recommendation(1, "high"),
        companyName: "Open Co",
        status: "resolved",
      },
    ];
    rerender(<RecommendationsPage />);

    expect(screen.queryByText(/Open Co/)).not.toBeInTheDocument();
    expect(screen.getByText("No matching results")).toBeInTheDocument();
  });

  it("shows stored AI narrative above the company's first visible rule", () => {
    seedRecommendations();
    mocks.recommendations = [recommendation(1, "high")];
    mocks.aiRecommendations = [
      {
        _id: "ai-1" as Id<"aiRecommendations">,
        _creationTime: 1,
        companyId: "company-1" as Id<"companies">,
        narrative:
          "Company 01 should prioritize backup and secure connectivity.",
        topPriority: "backup",
        ruleSnapshot: [recommendation(1, "high")],
        generatedAt: Date.UTC(2026, 6, 29),
        model: "gpt-test",
      },
    ];

    render(<RecommendationsPage />);

    expect(screen.getByText("AI-generated")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Company 01 should prioritize backup and secure connectivity.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Recommendation 1")).toBeInTheDocument();
  });
});
