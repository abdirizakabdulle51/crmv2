import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import DashboardPage from "./page.tsx";

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    dashboard: { summary: "dashboard.summary" },
  },
}));

const mocks = vi.hoisted(() => ({
  summary: {
    year: 2026,
    month: "2026-07",
    companies: { total: 43, activeContracts: 12 },
    leads: { active: 14, won: 6, wonValue: 39209 },
    targets: { target: 210000, achieved: 39209, achievementPercent: 19 },
    collectionSummary: {
      target: 210000,
      collected: 39209,
      remaining: 170791,
      achievementPercent: 19,
      outstanding: 42000,
      totalInvoiced: 81209,
    },
    pipeline: {
      stageCounts: {
        new_lead: 2,
        qualified: 3,
        discovery: 4,
        proposal: 5,
        negotiation: 0,
        won: 6,
        lost: 1,
      },
      value: 120000,
    },
    usage: {
      month: "2026-07",
      total: 24189.85,
      entries: 150,
      companiesWithUsage: 14,
    },
    quotes: {
      total: 7,
      draft: 2,
      sent: 3,
      accepted: 2,
      monthlyValue: 50000,
      acceptedMonthlyValue: 20000,
    },
    aiRecommendations: {
      openOpportunityCount: 40,
      highPriorityCount: 9,
      estimatedMonthlyValue: 4000,
      companiesWithOpportunities: 12,
    },
    atRisk: { count: 5 },
    tasks: {
      myOpen: 3,
      overdue: 1,
      dueThisWeek: 1,
      blocked: 1,
    },
    cloudHealth: {
      regions: 2,
      healthyRegions: 1,
      warningRegions: 1,
      criticalRegions: 0,
      activePingTargets: 3,
      upPingTargets: 2,
      downPingTargets: 1,
    },
    charts: {
      accountManagers: [
        {
          name: "Faisal",
          fullName: "Faisal Adan",
          target: 70000,
          achieved: 20000,
          percentage: 29,
        },
      ],
      countries: [
        {
          name: "Somalia",
          target: 210000,
          achieved: 39209,
          percentage: 19,
        },
      ],
    },
  },
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string) =>
    query === "dashboard.summary" ? mocks.summary : undefined,
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  getRoleLabel: () => "CEO",
  useCrm: () => ({
    currentUser: {
      name: "Abdirizak Abdulle",
      role: "ceo",
    },
  }),
}));

vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CartesianGrid: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <>
              <DashboardPage />
              <LocationProbe />
            </>
          }
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  it("renders the server summary and navigates metric cards to existing routes", async () => {
    const user = userEvent.setup();
    renderDashboard();

    expect(
      screen.getByText("Welcome back, Abdirizak Abdulle"),
    ).toBeInTheDocument();
    expect(screen.getByText("Executive Summary")).toBeInTheDocument();
    expect(
      screen.getByText("Executive Collection Summary"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Operational Details" }));

    expect(screen.getByText("43")).toBeInTheDocument();
    expect(screen.getByText("$24,190")).toBeInTheDocument();
    expect(
      screen.getByText("$4,000 estimated monthly value"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tasks/i })).toBeInTheDocument();
    expect(
      screen.getByText("1 overdue · 1 due this week · 1 blocked"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /Quotes/i }));
    expect(screen.getByTestId("location")).toHaveTextContent("/quotes");
  });

  it("navigates the Tasks card to the tasks page", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await user.click(screen.getByRole("tab", { name: "Operational Details" }));
    await user.click(screen.getByRole("link", { name: /Tasks/i }));
    expect(screen.getByTestId("location")).toHaveTextContent("/tasks");
  });
});
