import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth.ts";

export const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
export const LAST_ACTIVITY_STORAGE_KEY = "crm:lastActivityAt";

const MOUSEMOVE_THROTTLE_MS = 1000;

function readLastActivity() {
  try {
    const stored = window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
    const parsed = stored ? Number(stored) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : Date.now();
  } catch {
    return Date.now();
  }
}

function writeLastActivity(timestamp: number) {
  try {
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(timestamp));
  } catch {
    // Some privacy modes can block localStorage. The per-tab timer still works.
  }
}

export function InactivityLogout() {
  const { signout } = useAuth();
  const timeoutRef = useRef<number | null>(null);
  const signedOutRef = useRef(false);
  const lastMousemoveRef = useRef(0);

  useEffect(() => {
    function clearLogoutTimer() {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }

    function scheduleLogoutCheck() {
      clearLogoutTimer();
      const elapsed = Date.now() - readLastActivity();
      const remaining = INACTIVITY_TIMEOUT_MS - elapsed;

      if (remaining <= 0) {
        if (!signedOutRef.current) {
          signedOutRef.current = true;
          void signout();
        }
        return;
      }

      timeoutRef.current = window.setTimeout(scheduleLogoutCheck, remaining);
    }

    function recordActivity() {
      if (signedOutRef.current) {
        return;
      }
      writeLastActivity(Date.now());
      scheduleLogoutCheck();
    }

    function recordMousemoveActivity() {
      const now = Date.now();
      if (now - lastMousemoveRef.current < MOUSEMOVE_THROTTLE_MS) {
        return;
      }
      lastMousemoveRef.current = now;
      recordActivity();
    }

    function recordVisibleActivity() {
      if (document.visibilityState === "visible") {
        recordActivity();
      }
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === LAST_ACTIVITY_STORAGE_KEY) {
        scheduleLogoutCheck();
      }
    }

    recordActivity();

    window.addEventListener("mousedown", recordActivity);
    window.addEventListener("pointerdown", recordActivity);
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("scroll", recordActivity, { passive: true });
    window.addEventListener("touchstart", recordActivity, { passive: true });
    window.addEventListener("focus", recordActivity);
    window.addEventListener("mousemove", recordMousemoveActivity);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", recordVisibleActivity);

    return () => {
      clearLogoutTimer();
      window.removeEventListener("mousedown", recordActivity);
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("scroll", recordActivity);
      window.removeEventListener("touchstart", recordActivity);
      window.removeEventListener("focus", recordActivity);
      window.removeEventListener("mousemove", recordMousemoveActivity);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", recordVisibleActivity);
    };
  }, [signout]);

  return null;
}
