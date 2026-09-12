import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import OrgChartPage from "./org-chart-page.tsx";

const employees = [
  {
    _id: "manager-a",
    employeeNumber: "EMP-00001",
    fullName: "Manager A",
    jobTitle: "Director",
    departmentName: "Operations",
    countryName: "Somalia",
    countryId: "country-a",
    status: "active",
    managers: [],
  },
  {
    _id: "manager-b",
    employeeNumber: "EMP-00002",
    fullName: "Manager B",
    jobTitle: "Technical Director",
    departmentName: "Technology",
    countryName: "Kenya",
    countryId: "country-b",
    status: "active",
    managers: [],
  },
  {
    _id: "employee",
    employeeNumber: "EMP-00003",
    fullName: "Dual Report",
    jobTitle: "Engineer",
    departmentName: "Technology",
    countryName: "Kenya",
    countryId: "country-b",
    status: "active",
    managers: [
      { id: "manager-a", name: "Manager A", type: "primary" },
      { id: "manager-b", name: "Manager B", type: "secondary" },
    ],
  },
];

vi.mock("@/convex/_generated/api.js", () => ({
  api: { hr: { listEmployees: "employees" } },
}));
vi.mock("convex/react", () => ({ useQuery: () => employees }));

describe("organizational chart", () => {
  it("draws both primary and secondary reporting connections", () => {
    const { container } = render(
      <MemoryRouter>
        <OrgChartPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Dual Report")).toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-line-type="primary"]'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-line-type="secondary"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-line-type="secondary"]'),
    ).toHaveAttribute("stroke-dasharray", "6 5");
  });
});
