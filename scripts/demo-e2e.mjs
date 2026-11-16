/**
 * CI-only synthetic settlement lifecycle through the real Guard API and
 * independent fictional website server. Uses a disposable PostgreSQL database.
 *
 * Do NOT run with real financial data. "verified" here is an explicit TEST
 * FIXTURE to exercise the policy engine; it is NOT bank-verified settlement.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { signPayload } from "../src/webhook.mjs";

if (process.env.CI !== "true" || process.env.DEMO_E2E_SYNTHETIC_FIXTURES !== "YES") {
  throw new Error("Synthetic verified-transaction lifecycle can only run in isolated CI");
}
const dbUrl = new URL(process.env.DATABASE_URL || "");
if (!["127.0.0.1", "localhost"].includes(dbUrl.hostname) ||
    dbUrl.pathname !== "/nflake_guard_demo_ci") {
  throw new Error("Refusing non-disposable or remote PostgreSQL database");
}
const HOST = "127.0.0.1", GUARD_PORT = 4087, DEMO_PORT = 4197;
const guardBase = "http://" + HOST + ":" + GUARD_PORT;
const siteBase = "http://" + HOST + ":" + DEMO_PORT;
const admin = randomBytes(36).toString("hex");
const connector = randomBytes(36).toString("hex");
const commonEnv = {
  ...process.env, GUARD_HOST: HOST, GUARD_PORT: String(GUARD_PORT),
  GUARD_ADMIN_TOKEN: admin, GUARD_CONNECTOR_SECRET: connector,
  GUARD_DRY_RUN: "NO", GUARD_VERIFIED_EVENTS_ENABLED: "YES"
};
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 4, idle_timeout: 6 });
const watchdog = setTimeout(() => {
  console.error("Phase 3 E2E exceeded 90 seconds — refusing to leave synthetic CI processes running");
  for (const { child } of children) child.kill("SIGKILL");
  process.exit(1);
}, 90_000);
watchdog.unref();
const children = [];
async function waitHealth(base) {
  for (let attempt = 0; attempt < 70; attempt++) {
    try {
      const response = await fetch(base + "/healthz", { signal: AbortSignal.timeout(500) });
      if (response.ok) return response.json();
    } catch { /* server is starting */ }
    await new Promise(resolve => setTimeout(resolve, 130));
  }
  throw new Error("Unable to start isolated test server at " + base);
}
function spawnServer(path, env) {
  const child = spawn(process.execPath, [path], {
    env, stdio: ["ignore", "pipe", "pipe"]
  });
  let diagnostic = "";
  child.stdout.on("data", chunk => { diagnostic += String(chunk).slice(-1000); });
  child.stderr.on("data", chunk => { diagnostic += String(chunk).slice(-1000); });
  children.push(child);
  return { child, diagnostics: () => diagnostic.slice(-2000) };
}
async function api(path, method = "GET", payload) {
  const response = await fetch(guardBase + path, {
    method, signal: AbortSignal.timeout(5000), headers: {
      "Authorization": "Bearer " + admin,
      ...(payload === undefined ? {} : { "Content-Type": "application/json" })
    }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  const data = await response.json();
  return { status: response.status, data };
}
async function demo(path) {
  const response = await fetch(siteBase + path, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  return { status: response.status, body: text };
}
async function event(projectId, invoiceId, type, sequence, balanceMinor, dueAt) {
  const body = JSON.stringify({
    type, source: "verified", sequence,
    external_invoice_id: invoiceId, project_id: projectId,
    ...(balanceMinor === null ? {} : { balance_minor: balanceMinor }),
    ...(dueAt ? { due_at: dueAt } : {})
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(guardBase + "/webhooks/financial", {
    method: "POST", signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      "x-guard-event-id": "synthetic-ci-" + randomUUID(),
      "x-guard-timestamp": timestamp,
      "x-guard-signature": signPayload(connector, timestamp, body)
    }, body
  });
  return { status: response.status, data: await response.json() };
}
async function assertDemoStatus(expected) {
  const snapshot = await demo("/api/demo/status");
  assert.equal(snapshot.status, 200);
  const state = JSON.parse(snapshot.body);
  assert.equal(state.status, expected);
  assert.equal(state.demonstration_only, true);
  assert.equal(snapshot.body.includes("balance_minor"), false,
    "Public demo status must not reveal balances");
  return state;
}
async function assertContent(expectedAvailable) {
  const home = await demo("/");
  const portfolio = await demo("/portfolio");
  assert.equal(home.status, 200);
  assert.equal(portfolio.status, 200);
  if (expectedAvailable) {
    assert.match(home.body, /Ideas that/);
    assert.match(portfolio.body, /Bloomfield Botanics/);
  } else {
    assert.match(home.body, /is taking a pause/);
    assert.match(portfolio.body, /is taking a pause/);
    assert.doesNotMatch(home.body, /Ideas that|Bloomfield Botanics|Thoughtful identities/);
    assert.doesNotMatch(portfolio.body, /Bloomfield Botanics|Common Ground/);
  }
}
let projectId, invoiceId;
try {
  await sql.unsafe("SET statement_timeout = 5000");
  const g = spawnServer("src/server.mjs", commonEnv);
  const health = await waitHealth(guardBase);
  assert.equal(health.dry_run, false);
  assert.equal(health.live_financial_events, true);
  // All "verified" transactions below are invented CI test fixtures only.
  invoiceId = "FICTIONAL-TEST-" + randomUUID();
  const created = await api("/api/projects", "POST", {
    name: "Verde Atelier • Synthetic Licence Test",
    client_name: "Fictional Demonstration",
    domain: "verde-demo.example.test",
    deployment_kind: "nflake_hosted",
    external_invoice_id: invoiceId
  });
  assert.equal(created.status, 201, JSON.stringify(created));
  projectId = created.data.project_id;
  const projectKey = created.data.project_key_once;
  assert.match(projectKey, /^[0-9a-f]{64}$/);
  const s = spawnServer("demo/server.mjs", {
    ...commonEnv,
    DEMO_ENABLED: "YES", DEMO_HOST: HOST, DEMO_PORT: String(DEMO_PORT),
    DEMO_PROJECT_ID: projectId, DEMO_PROJECT_KEY: projectKey,
    GUARD_BASE_URL: guardBase
  });
  await waitHealth(siteBase);

  await assertDemoStatus("ACTIVE");
  await assertContent(true);
  console.log("PASS: ACTIVE => full fictional site is delivered");

  const due = new Date(Date.now() - 20*86400000).toISOString();
  const overdue = await event(projectId, invoiceId, "invoice.overdue", 1, 150000, due);
  assert.equal(overdue.status, 202, JSON.stringify(overdue));
  await assertDemoStatus("GRACE");
  await assertContent(true);
  console.log("PASS: OVERDUE without notice => GRACE, website available");

  const policy = await api("/api/projects/" + projectId + "/policy", "POST", {
    contract_reference: "CI-FICTIONAL-CONTRACT-NOT-LEGALLY-BINDING",
    contract_accepted_at: new Date(Date.now()-30*86400000).toISOString(),
    restriction_scope: "licensed_marketing_site",
    grace_days: 7,
    enforcement_enabled: true
  });
  assert.equal(policy.status, 200, JSON.stringify(policy));
  const notice = await api("/api/projects/" + projectId + "/notice", "POST", {
    notice_evidence: "CI-FICTIONAL-NOTICE-NEVER-SENT"
  });
  assert.equal(notice.status, 200);
  await assertDemoStatus("GRACE");
  await assertContent(true);
  console.log("PASS: written notice within grace => content still available");

  // Test fixture time travel: only the disposable CI database is modified.
  const updated = await sql.unsafe(
    "UPDATE projects SET notice_sent_at=NOW()-interval '9 days' WHERE id=$1 RETURNING id",
    [projectId]
  );
  assert.equal(updated.length, 1);
  await assertDemoStatus("RESTRICTED");
  await assertContent(false);
  console.log("PASS: expired synthetic notice => real Guard server gates marketing HTML");

  const partial = await event(projectId, invoiceId, "invoice.balance_updated", 2, 75000, due);
  assert.equal(partial.status, 202);
  await assertDemoStatus("RESTRICTED");
  await assertContent(false);
  console.log("PASS: simulated partial balance => restricted state remains until resolved");

  const dispute = await event(projectId, invoiceId, "invoice.disputed", 3, null);
  assert.equal(dispute.status, 202);
  await assertDemoStatus("GRACE");
  await assertContent(true);
  console.log("PASS: dispute hold => content restored, dispute review preserved");

  const released = await api("/api/projects/" + projectId + "/hold", "POST", { clear: true });
  assert.equal(released.status, 200);
  await assertDemoStatus("RESTRICTED");
  await assertContent(false);
  console.log("PASS: review hold released => eligible synthetic restriction resumes");

  const settled = await event(projectId, invoiceId, "invoice.settled", 4, 0);
  assert.equal(settled.status, 202);
  await assertDemoStatus("ACTIVE");
  await assertContent(true);
  const [row] = await sql.unsafe("SELECT notice_sent_at,notice_evidence FROM projects WHERE id=$1", [projectId]);
  assert.equal(row.notice_sent_at, null);
  assert.equal(row.notice_evidence, null);
  console.log("PASS: synthetic settlement => immediate server-side restoration");

  const permanent = await api("/api/projects/" + projectId + "/permanent", "POST", {
    handover_reference: "CI-ONLY-DEMO-FINAL-HANDOVER"
  });
  assert.equal(permanent.status, 200);
  await assertDemoStatus("PERMANENT");
  await assertContent(true);
  console.log("PASS: synthetic final handover => permanent licence");

  const stale = await event(projectId, invoiceId, "invoice.overdue", 2, 100000, due);
  assert.equal(stale.status, 409);
  await assertDemoStatus("PERMANENT");
  console.log("PASS: stale financial event cannot roll back latest state");

  g.child.kill("SIGTERM");
  for (let i = 0; i < 30; i++) {
    try { await fetch(guardBase + "/healthz", { signal: AbortSignal.timeout(250) }); }
    catch { break; }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  await assertDemoStatus("UNKNOWN");
  await assertContent(true);
  console.log("PASS: Guard outage => NO accidental website restriction");
  console.log("PHASE 3 PASS — All tests ran in an isolated fictional local/CI environment.");
} finally {
  for (const { child } of children) {
    try { child.kill("SIGTERM"); } catch { /* already stopped */ }
  }
  await sql.end({ timeout: 5 });
  clearTimeout(watchdog);
}
