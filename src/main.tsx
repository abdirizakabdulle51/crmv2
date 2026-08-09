import { createRoot } from "react-dom/client";
import App from "./App.tsx";

const reloadFlag = "crm:stale-asset-reload";

function reloadOnceForStaleAsset() {
  if (sessionStorage.getItem(reloadFlag) === "1") {
    return;
  }

  sessionStorage.setItem(reloadFlag, "1");
  window.location.reload();
}

window.addEventListener("vite:preloadError", reloadOnceForStaleAsset);
window.addEventListener("unhandledrejection", (event) => {
  const message =
    event.reason instanceof Error
      ? event.reason.message
      : String(event.reason ?? "");

  if (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Loading chunk")
  ) {
    reloadOnceForStaleAsset();
  }
});

window.addEventListener("load", () => {
  sessionStorage.removeItem(reloadFlag);
});

createRoot(document.getElementById("root")!).render(<App />);
