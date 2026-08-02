import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import DocumentationPage from "./page.tsx";

type DocumentationListItem = {
  slug: string;
  title: string;
  group: string;
  order: number;
  visibility: "public" | "restricted";
};

type DocumentationSection = DocumentationListItem & {
  _id: string;
  _creationTime: number;
  content: string;
  updatedAt: number;
  updatedByName: string | null;
};

vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    documentation: {
      list: "documentation.list",
      getBySlug: "documentation.getBySlug",
      upsert: "documentation.upsert",
    },
  },
}));

const mocks = vi.hoisted(() => ({
  sections: [
    {
      _id: "doc-dashboard",
      _creationTime: 1,
      slug: "page-dashboard",
      title: "Dashboard",
      group: "Team Guide",
      order: 1,
      visibility: "public" as const,
      content: "## Dashboard overview\n\nThe Dashboard is your personal landing page.",
      updatedAt: 1_000,
      updatedByName: "System",
    },
    {
      _id: "doc-cloud-health",
      _creationTime: 2,
      slug: "page-cloud-health",
      title: "Cloud Health",
      group: "Team Guide",
      order: 2,
      visibility: "public" as const,
      content: "## Cloud Health overview\n\nCloud Health monitors operations.",
      updatedAt: 2_000,
      updatedByName: "System",
    },
  ] as DocumentationSection[],
  upsert: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: string, args: { slug?: string } | "skip") => {
    if (query === "documentation.list") {
      return mocks.sections.map(
        ({ slug, title, group, order, visibility }) =>
          ({ slug, title, group, order, visibility }) satisfies DocumentationListItem,
      );
    }
    if (query === "documentation.getBySlug" && args !== "skip") {
      return mocks.sections.find((section) => section.slug === args.slug);
    }
    return undefined;
  },
  useMutation: (mutation: string) => {
    if (mutation === "documentation.upsert") {
      return mocks.upsert;
    }
    return vi.fn();
  },
}));

vi.mock("@/lib/crm-context.tsx", () => ({
  useCrm: () => ({
    currentUser: {
      _id: "user-1",
      name: "CEO",
      role: "ceo",
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderDocumentation(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/documentation"
          element={
            <>
              <DocumentationPage />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/documentation/:slug"
          element={
            <>
              <DocumentationPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DocumentationPage routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue("doc-id");
  });

  it("loads documentation successfully at /documentation", () => {
    renderDocumentation("/documentation");

    expect(
      screen.getByRole("heading", { name: "CRM Documentation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/documentation");
  });

  it("loads a matching article from a direct slug URL", () => {
    renderDocumentation("/documentation/page-cloud-health");

    expect(
      screen.getByRole("heading", { name: "Cloud Health" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cloud Health monitors operations.")).toBeInTheDocument();
  });

  it("updates the URL when a sidebar article is clicked", async () => {
    const user = userEvent.setup();
    renderDocumentation("/documentation/page-dashboard");

    await user.click(screen.getByRole("button", { name: "Cloud Health" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/documentation/page-cloud-health",
    );
    expect(
      screen.getByRole("heading", { name: "Cloud Health" }),
    ).toBeInTheDocument();
  });

  it("shows an in-page not found state for invalid slugs", () => {
    renderDocumentation("/documentation/no-such-article");

    expect(
      screen.getByRole("heading", {
        name: "Documentation article not found",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to Documentation" }),
    ).toBeInTheDocument();
  });

  it("keeps an existing article on its slug URL after saving", async () => {
    const user = userEvent.setup();
    renderDocumentation("/documentation/page-dashboard");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "page-dashboard" }),
      ),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/documentation/page-dashboard",
    );
  });

  it("navigates to the new slug after adding a section", async () => {
    const user = userEvent.setup();
    renderDocumentation("/documentation/page-dashboard");

    await user.click(screen.getByRole("button", { name: "Add Section" }));
    await user.type(screen.getByLabelText("Slug"), "new-runbook");
    await user.type(screen.getByLabelText("Title"), "New Runbook");
    await user.type(screen.getByLabelText("Content"), "## New Runbook");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "new-runbook" }),
      ),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/documentation/new-runbook",
    );
  });
});
