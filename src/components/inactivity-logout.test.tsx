import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InactivityLogout,
  INACTIVITY_TIMEOUT_MS,
  LAST_ACTIVITY_STORAGE_KEY,
  MONITORING_MODE_EVENT,
  MONITORING_MODE_TIMEOUT_MS,
} from "./inactivity-logout.tsx";

const signout = vi.fn();

vi.mock("@/hooks/use-auth.ts", () => ({
  useAuth: () => ({
    signout,
  }),
}));

function setSystemTime(timestamp: number) {
  vi.setSystemTime(new Date(timestamp));
}

describe("InactivityLogout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSystemTime(1_000_000);
    window.localStorage.clear();
    signout.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("signs out after five minutes idle", () => {
    render(<InactivityLogout />);

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS - 1);
    expect(signout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(signout).toHaveBeenCalledTimes(1);
  });

  it("resets the timer when activity is recorded", () => {
    render(<InactivityLogout />);

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS - 60_000);
    setSystemTime(1_000_000 + INACTIVITY_TIMEOUT_MS - 60_000);
    window.dispatchEvent(new KeyboardEvent("keydown"));

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS - 1);
    expect(signout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(signout).toHaveBeenCalledTimes(1);
  });

  it("cleans up event listeners and timers on unmount", () => {
    const addWindowListener = vi.spyOn(window, "addEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");

    const { unmount } = render(<InactivityLogout />);
    unmount();

    expect(addWindowListener).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
    );
    expect(removeWindowListener).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
    );
    expect(addDocumentListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS);
    window.dispatchEvent(new KeyboardEvent("keydown"));
    expect(signout).not.toHaveBeenCalled();
  });

  it("uses cross-tab activity to prevent logout from a background tab", () => {
    render(<InactivityLogout />);

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS - 1_000);
    const activityInAnotherTabAt = 1_000_000 + INACTIVITY_TIMEOUT_MS - 1_000;
    window.localStorage.setItem(
      LAST_ACTIVITY_STORAGE_KEY,
      String(activityInAnotherTabAt),
    );
    setSystemTime(activityInAnotherTabAt);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LAST_ACTIVITY_STORAGE_KEY,
        newValue: String(activityInAnotherTabAt),
      }),
    );

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS - 1);
    expect(signout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(signout).toHaveBeenCalledTimes(1);
  });

  it("does not treat unrelated automatic page updates as activity", () => {
    render(<InactivityLogout />);

    window.dispatchEvent(new CustomEvent("cloud-health:autoRotateTick"));

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS);
    expect(signout).toHaveBeenCalledTimes(1);
  });

  it("extends the idle timeout while monitoring mode is active", () => {
    render(<InactivityLogout />);

    window.dispatchEvent(
      new CustomEvent(MONITORING_MODE_EVENT, {
        detail: {
          enabled: true,
          timeoutMs: MONITORING_MODE_TIMEOUT_MS,
        },
      }),
    );

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS);
    expect(signout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MONITORING_MODE_TIMEOUT_MS - INACTIVITY_TIMEOUT_MS);
    expect(signout).toHaveBeenCalledTimes(1);
  });

  it("returns to the five-minute timeout when monitoring mode is disabled", () => {
    render(<InactivityLogout />);

    window.dispatchEvent(
      new CustomEvent(MONITORING_MODE_EVENT, {
        detail: {
          enabled: true,
          timeoutMs: MONITORING_MODE_TIMEOUT_MS,
        },
      }),
    );

    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS + 1);
    expect(signout).not.toHaveBeenCalled();

    window.dispatchEvent(
      new CustomEvent(MONITORING_MODE_EVENT, {
        detail: { enabled: false },
      }),
    );

    expect(signout).toHaveBeenCalledTimes(1);
  });

  it("does not run when the component is not mounted", () => {
    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS);
    expect(signout).not.toHaveBeenCalled();
  });
});
