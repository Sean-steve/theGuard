/**
 * Read-only licence evaluator. It never changes a client's website, files or data.
 * RESTRICTED is an entitlement decision for operator-controlled licensed services.
 */
export const DEPLOYMENTS = Object.freeze(["nflake_hosted", "nflake_backend", "client_hosted_static"]);
export const RESTRICTABLE_DEPLOYMENTS = new Set(["nflake_hosted", "nflake_backend"]);

export function evaluateLicense(project, options = {}) {
  const now = new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime())) throw new TypeError("Invalid evaluation time");
  const dryRun = options.dryRun ?? true;
  const balance = Number(project.balance_minor ?? 0);
  const base = { status: "ACTIVE", restrict: false, reason: "No overdue verified balance" };

  if (project.permanent_at) return { ...base, status: "PERMANENT", reason: "Final licence issued" };
  if (!project.invoice_overdue || balance <= 0) return base;
  if (project.due_at && new Date(project.due_at).getTime() > now.getTime()) {
    return { ...base, reason: "Payment is not due yet" };
  }
  if (project.hold_reason) return { ...base, status: "GRACE", reason: "Manual dispute / collection hold" };
  if (!project.contract_accepted_at || !project.contract_reference) {
    return { ...base, status: "GRACE", reason: "No recorded contract authorization" };
  }
  if (!project.notice_sent_at || !project.notice_evidence) {
    return { ...base, status: "GRACE", reason: "Written notice evidence required" };
  }
  const graceDays = Math.max(1, Math.min(90, Number(project.grace_days ?? 7)));
  const deadline = new Date(project.notice_sent_at).getTime() + graceDays * 86400000;
  if (!Number.isFinite(deadline) || now.getTime() < deadline) {
    return { ...base, status: "GRACE", reason: "Notice grace period is active", grace_ends_at: new Date(deadline).toISOString() };
  }
  if (!RESTRICTABLE_DEPLOYMENTS.has(project.deployment_kind)) {
    return { ...base, status: "GRACE", reason: "Client-controlled deployment is ineligible" };
  }
  if (!project.restriction_scope || project.restriction_scope === "none") {
    return { ...base, status: "GRACE", reason: "No permitted restricted functionality selected" };
  }
  if (project.payment_source !== "verified") {
    return { ...base, status: "GRACE", reason: "No independently verified financial event" };
  }
  if (!project.enforcement_enabled) {
    return { ...base, status: "GRACE", reason: "Enforcement not authorized by operator" };
  }
  if (dryRun) return { ...base, status: "GRACE", reason: "Guard is in dry-run mode" };

  return {
    status: "RESTRICTED", restrict: true,
    reason: "Eligible licensed functionality restricted after notice and grace period",
    scope: project.restriction_scope,
    grace_ends_at: new Date(deadline).toISOString()
  };
}
