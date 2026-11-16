/**
 * Integration smoke for GitHub Actions only. Uses its disposable PostgreSQL 16.
 * Never sends live payment events, emails, or restrictions.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { signPayload } from "../src/webhook.mjs";

const url = "http://127.0.0.1:" + (process.env.GUARD_PORT || 4080);
const token = process.env.GUARD_ADMIN_TOKEN;
const signingSecret = process.env.GUARD_CONNECTOR_SECRET;
if (!process.env.DATABASE_URL || !token || !signingSecret ||
    process.env.GUARD_DRY_RUN !== "YES" || process.env.GUARD_VERIFIED_EVENTS_ENABLED !== "NO")
  throw new Error("CI smoke only runs with isolated DB, sandbox finance events and global dry run");
const server = spawn(process.execPath, ["src/server.mjs"], {
  env: process.env, stdio: ["ignore", "pipe", "pipe"]
});
let out = "";
server.stdout.on("data", chunk => { out += String(chunk); });
server.stderr.on("data", chunk => { out += String(chunk); });
async function request(path, method = "GET", obj, headers = {}) {
  const response = await fetch(url + path, {
    method,
    headers: { Authorization: "Bearer " + token, ...headers,
      ...(obj === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(obj === undefined ? {} : { body: JSON.stringify(obj) })
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
async function checkReady() {
  for (let tries = 0; tries < 80; tries++) {
    try {
      const result = await request("/healthz");
      if (result.status === 200) return result;
    } catch { /* awaiting the server */ }
    if (server.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Guard failed to start: " + out);
}
try {
  const health = await checkReady();
  assert.equal(health.data.dry_run, true);
  assert.equal(health.data.live_financial_events, false);
  const noAuth = await fetch(url + "/api/projects");
  assert.equal(noAuth.status, 401);
  const invoice = "CI-" + randomUUID();
  const created = await request("/api/projects", "POST", {
    name: "Fictional CI Website", client_name: "Fictional Example Client",
    domain: "example.test", external_invoice_id: invoice,
    deployment_kind: "nflake_hosted"
  });
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal(created.data.project_key_once.length, 64);
  const projectId = created.data.project_id;
  const noKey = await fetch(url + "/v1/license/" + projectId);
  assert.equal(noKey.status, 401);
  const initial = await request("/v1/license/" + projectId, "GET", undefined, {
    "x-guard-project-key": created.data.project_key_once
  });
  assert.equal(initial.data.status, "ACTIVE");
  const stamp = String(Math.floor(Date.now() / 1000));
  const eventId = "ci-test-" + randomUUID();
  const body = JSON.stringify({
    type: "invoice.overdue", source: "sandbox", external_invoice_id: invoice,
    balance_minor: 950000, due_at: new Date(Date.now() - 15*86400000).toISOString()
  });
  const webhookHeaders = {
    "Content-Type": "application/json", "x-guard-event-id": eventId,
    "x-guard-timestamp": stamp, "x-guard-signature": signPayload(signingSecret, stamp, body)
  };
  const send = () => fetch(url + "/webhooks/financial", {
    method: "POST", headers: webhookHeaders, body
  });
  assert.equal((await send()).status, 202);
  assert.equal((await send()).status, 200, "identical event ID must be idempotent");
  const savedPolicy = await request("/api/projects/" + projectId + "/policy", "POST", {
    restriction_scope: "licensed_marketing_site", grace_days: 7,
    enforcement_enabled: true, contract_reference: "CI-DEMO-AGREEMENT",
    contract_accepted_at: "2026-01-01T00:00:00Z"
  });
  assert.equal(savedPolicy.status, 200, JSON.stringify(savedPolicy));
  const notice = await request("/api/projects/" + projectId + "/notice", "POST", {
    notice_evidence: "CI-SIMULATED-NOTICE-ONLY"
  });
  assert.equal(notice.status, 200);
  const licence = await request("/v1/license/" + projectId, "GET", undefined, {
    "x-guard-project-key": created.data.project_key_once
  });
  assert.equal(licence.data.restrict, false, "sandbox debt must not restrict");
  assert.equal(licence.data.status, "GRACE");
  const permanent = await request("/api/projects/" + projectId + "/permanent", "POST", {
    handover_reference: "CI-TEST-NOT-PAID"
  });
  assert.equal(permanent.status, 409, "unverified unpaid balances cannot issue permanent licences");
  const hold = await request("/api/projects/" + projectId + "/hold", "POST", {
    reason: "CI simulated dispute"
  });
  assert.equal(hold.status, 200);
  assert.equal(hold.data.license.restrict, false);
  const history = await request("/api/audit");
  assert.equal(history.status, 200);
  assert.ok(history.data.events.length >= 4);
  console.log("Guard smoke PASSED: auth, registration, HMAC, idempotency, policy, notice, sandbox non-enforcement and audit.");
} finally {
  server.kill("SIGTERM");
}
