/**
 * Nflake Guard server-side entitlement reader.
 * Must be used ONLY from a private Nflake-controlled server environment.
 * Failure of Guard availability never causes a new restriction.
 */
export class GuardClient {
  constructor({ endpoint, projectId, projectKey, timeoutMs = 1500, fetchImpl = globalThis.fetch }) {
    if (!endpoint || !projectId || !projectKey || typeof fetchImpl !== "function")
      throw new TypeError("Guard requires endpoint, projectId, projectKey and fetch");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000)
      throw new TypeError("Invalid timeout");
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error("Guard requires HTTPS outside local development");
    this.endpoint = url.toString().replace(/\/$/, "");
    this.projectId = projectId;
    this.projectKey = projectKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }
  async decision() {
    try {
      const response = await this.fetchImpl(this.endpoint + "/v1/license/" + encodeURIComponent(this.projectId), {
        method: "GET",
        headers: { "x-guard-project-key": this.projectKey },
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Guard unavailable");
      const value = await response.json();
      if (!["ACTIVE", "GRACE", "RESTRICTED", "PERMANENT"].includes(value.status) ||
          value.project_id !== this.projectId) throw new Error("Unexpected Guard reply");
      if (Date.parse(value.expires_at) < Date.now()) throw new Error("Stale Guard reply");
      const eligibleRestriction =
        value.status === "RESTRICTED" && value.restrict === true &&
        value.dry_run === false &&
        ["premium_features", "licensed_marketing_site"].includes(value.scope);
      return {
        status: value.status,
        restrict: eligibleRestriction,
        scope: eligibleRestriction ? value.scope : null,
        reason: value.reason
      };
    } catch {
      return {
        status: "UNKNOWN", restrict: false, scope: null,
        reason: "Guard unavailable: preserve access to previously licensed functionality"
      };
    }
  }
}
