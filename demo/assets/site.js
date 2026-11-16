// Public, optional presentation script. No Guard API keys or other secrets.
const status = document.querySelector("[data-guard-status]");
async function updateStatus() {
  if (!status) return;
  try {
    const response = await fetch("/api/demo/status", { cache: "no-store" });
    if (!response.ok) throw new Error("unavailable");
    const state = await response.json();
    status.textContent = state.status === "UNKNOWN" ? "GUARD OFFLINE · ACCESS PRESERVED" :
      state.status + " · DEMO LICENSE";
    status.dataset.mode = state.status;
  } catch {
    status.textContent = "GUARD STATUS UNAVAILABLE";
    status.dataset.mode = "UNKNOWN";
  }
}
updateStatus();
setInterval(updateStatus, 25000);
