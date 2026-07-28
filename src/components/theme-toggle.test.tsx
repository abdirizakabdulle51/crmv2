import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./theme-toggle.tsx";

const setTheme = vi.fn();
let resolvedTheme = "light";

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme,
    setTheme,
  }),
}));

describe("ThemeToggle", () => {
  it("switches from light to dark", async () => {
    resolvedTheme = "light";
    setTheme.mockClear();

    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));

    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("switches from dark to light", async () => {
    resolvedTheme = "dark";
    setTheme.mockClear();

    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));

    expect(setTheme).toHaveBeenCalledWith("light");
  });
});
