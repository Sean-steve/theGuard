import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { sql } from "./db.mjs";
import { DEPLOYMENTS, evaluateLicense } from "./policy.mjs";
import { verifySignedWebhook, parseFinancialEvent } from "./webhook.mjs";

const PORT = Number(process.env.GUARD_PORT || 4080);
const HOST = process.env.GUARD_HOST || "127.0.0.1";
const DRY_RUN = process.env.GUARD_DRY_RUN !== "NO";
const VERIFIED_EVENTS = process.env.GUARD_VERIFIED_EVENTS_ENABLED === "YES";
const ADMIN_TOKEN = process.env.GUARD_ADMIN_TOKEN || "";
const CONNECTOR_SECRET = process.env.GUARD_CONNECTOR_SECRET || "";
const ORIGIN = process.env.GUARD_ORIGIN || "http://" + (HOST === "localhost" ? "localhost" : HOST) + ":" + PORT;
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error("Invalid GUARD_PORT");
if (!["127.0.0.1","localhost"].includes(HOST) && process.env.GUARD_PUBLIC_HOST_APPROVED !== "YES")
  throw new Error("Guard refuses public network binding without explicit approval");
if (ADMIN_TOKEN.length < 32 || CONNECTOR_SECRET.length < 32 || ADMIN_TOKEN === CONNECTOR_SECRET)
  throw new Error("Independent GUARD_ADMIN_TOKEN and GUARD_CONNECTOR_SECRET of 32+ characters required");

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const securityHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
function reply(res, status, body) {
  res.writeHead(status, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function q(db, query, args = []) { return db.unsafe(query, args); }
function safeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const one = Buffer.from(a), two = Buffer.from(b);
  return one.length === two.length && timingSafeEqual(one, two);
}
function authorized(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ") || !safeEquals(h.slice(7), ADMIN_TOKEN))
    throw new HttpError(401, "Administrator token required");
}
function sameOrigin(req) {
  // Browsers send Origin on mutations. Server-to-server signed requests do not.
  if (req.headers.origin && req.headers.origin !== ORIGIN)
    throw new HttpError(403, "Cross-origin request rejected");
}
async function rawBody(req) {
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "application/json required");
  let size = 0; const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 32768) throw new HttpError(413, "Payload too large");
    parts.push(part);
  }
  return Buffer.concat(parts).toString("utf8");
}
async function jsonBody(req) {
  let obj;
  try { obj = JSON.parse(await rawBody(req)); }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, "Invalid JSON body"); }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new HttpError(400, "Object required");
  return obj;
}
function str(value, max, label, required = true) {
  if (value == null && !required) return null;
  if (typeof value !== "string" || value.trim().length < (required ? 1 : 0) || value.trim().length > max)
    throw new HttpError(400, "Invalid " + label);
  return value.trim();
}
function validUuid(v) { return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v); }
function selectDecision(p) { return evaluateLicense(p, { dryRun: DRY_RUN }); }
async function addAudit(db, projectId, action, details = {}) {
  await q(db, "INSERT INTO audit_logs (id,project_id,action,details) VALUES ($1,$2,$3,$4::jsonb)",
    [randomUUID(), projectId, action, JSON.stringify(details)]);
}
async function findProject(id, db = sql, lock = false) {
  if (!validUuid(id)) throw new HttpError(404, "Project not found");
  const rows = await q(db, "SELECT * FROM projects WHERE id=$1" + (lock ? " FOR UPDATE" : ""), [id]);
  if (!rows.length) throw new HttpError(404, "Project not found");
  return rows[0];
}
async function handleFinancialWebhook(req, res) {
  const raw = await rawBody(req);
  if (!verifySignedWebhook({ headers: req.headers, rawBody: raw, secret: CONNECTOR_SECRET }))
    throw new HttpError(401, "Invalid webhook signature or timestamp");
  let event;
  try { event = parseFinancialEvent(raw, VERIFIED_EVENTS); }
  catch (e) { throw new HttpError(400, e.message); }
  const eventId = req.headers["x-guard-event-id"];
  const outcome = await sql.begin(async tx => {
    const matches = await q(tx, "SELECT * FROM projects WHERE external_invoice_id=$1 FOR UPDATE", [event.external_invoice_id]);
    if (matches.length !== 1) throw new HttpError(404, "Invoice reference is not registered");
    const project = matches[0];
    if (event.project_id && event.project_id !== project.id) throw new HttpError(400, "Project reference mismatch");
    if (event.source === "sandbox" && project.payment_source === "verified")
      throw new HttpError(409, "Sandbox events cannot replace a verified financial state");
    if (event.source === "verified" && event.sequence <= Number(project.financial_version))
      throw new HttpError(409, "Out-of-order verified financial event");
    const digest = createHash("sha256").update(raw).digest("hex");
    const inserted = await q(tx,
      "INSERT INTO financial_events(event_id,project_id,type,source,payload,payload_hash) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
      [eventId, project.id, event.type, event.source, raw, digest]);
    if (!inserted.length) {
      const previous = await q(tx, "SELECT payload_hash,project_id FROM financial_events WHERE event_id=$1", [eventId]);
      if (!previous.length || previous[0].payload_hash !== digest || previous[0].project_id !== project.id)
        throw new HttpError(409, "Conflicting reuse of financial event ID");
      return "duplicate";
    }
    if (event.type === "invoice.overdue") {
      if (event.balance_minor === 0) throw new HttpError(400, "Overdue event cannot have zero balance");
      await q(tx, "UPDATE projects SET invoice_overdue=TRUE,balance_minor=$1,due_at=$2,payment_source=$3,updated_at=NOW() WHERE id=$4",
        [event.balance_minor, event.due_at || project.due_at, event.source, project.id]);
    } else if (event.type === "invoice.balance_updated") {
      await q(tx, "UPDATE projects SET balance_minor=$1,invoice_overdue=$2,due_at=$3,payment_source=$4,updated_at=NOW() WHERE id=$5",
        [event.balance_minor, event.balance_minor > 0 && project.invoice_overdue,
          event.due_at || project.due_at, event.source, project.id]);
    } else if (event.type === "payment.reversed") {
      await q(tx, "UPDATE projects SET balance_minor=$1,invoice_overdue=$2,payment_source=$3,updated_at=NOW() WHERE id=$4",
        [event.balance_minor, event.balance_minor > 0, event.source, project.id]);
    } else if (event.type === "invoice.settled") {
      await q(tx, "UPDATE projects SET balance_minor=0,invoice_overdue=FALSE,payment_source=$1,notice_sent_at=NULL,notice_evidence=NULL,updated_at=NOW() WHERE id=$2",
        [event.source, project.id]);
    } else if (event.type === "invoice.disputed") {
      await q(tx, "UPDATE projects SET hold_reason='Disputed invoice — administrator review required',updated_at=NOW() WHERE id=$1", [project.id]);
    }
    // dispute_resolved NEVER clears a hold without explicit operator review.
    if (event.source === "verified")
      await q(tx,"UPDATE projects SET financial_version=$1 WHERE id=$2",[event.sequence,project.id]);
    await addAudit(tx, project.id, "financial." + event.type, { event_id: eventId, source: event.source, sequence: event.sequence || null });
    return "accepted";
  });
  reply(res, outcome === "accepted" ? 202 : 200, { status: outcome });
}
async function handle(req, res) {
  const path = new URL(req.url || "/", ORIGIN).pathname;
  if (req.method === "GET" && path === "/healthz")
    return reply(res, 200, { status: "ok", dry_run: DRY_RUN, live_financial_events: VERIFIED_EVENTS });
  if (req.method === "GET" && ["/", "/app.js", "/styles.css"].includes(path)) {
    const filename = path === "/app.js" ? "app.js" : path === "/styles.css" ? "styles.css" : "index.html";
    const type = filename.endsWith(".js") ? "text/javascript" : filename.endsWith(".css") ? "text/css" : "text/html";
    res.writeHead(200, { ...securityHeaders, "Content-Type": type + "; charset=utf-8" });
    return res.end(readFileSync(new URL("../public/" + filename, import.meta.url)));
  }
  if (req.method === "POST") sameOrigin(req);
  if (req.method === "POST" && path === "/webhooks/financial") return handleFinancialWebhook(req, res);
  if (req.method === "GET" && path.startsWith("/v1/license/")) {
    const p = await findProject(path.slice("/v1/license/".length));
    const key = req.headers["x-guard-project-key"];
    const presented = typeof key === "string" ? createHash("sha256").update(key).digest("hex") : "";
    if (!safeEquals(p.backend_key_hash, presented)) throw new HttpError(401, "Invalid project key");
    const outcome = selectDecision(p);
    return reply(res, 200, {
      project_id: p.id, status: outcome.status, restrict: outcome.restrict,
      scope: outcome.restrict ? outcome.scope : null, reason: outcome.reason, dry_run: DRY_RUN,
      issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60000).toISOString()
    });
  }
  if (!path.startsWith("/api/")) throw new HttpError(404, "Not found");
  authorized(req);
  if (req.method === "GET" && path === "/api/projects") {
    const rows = await q(sql,
      "SELECT id,name,client_name,domain,deployment_kind,external_invoice_id,contract_accepted_at,contract_reference,restriction_scope,grace_days,enforcement_enabled,notice_sent_at,notice_evidence,due_at,balance_minor,invoice_overdue,payment_source,hold_reason,permanent_at,handover_reference,created_at FROM projects ORDER BY created_at DESC");
    return reply(res, 200, { dry_run: DRY_RUN, projects: rows.map(p => ({ ...p, license: selectDecision(p) })) });
  }
  if (req.method === "GET" && path === "/api/audit") {
    const rows = await q(sql, "SELECT id,project_id,action,details,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 100");
    return reply(res, 200, { events: rows });
  }
  if (req.method === "POST" && path === "/api/projects") {
    const b = await jsonBody(req);
    const name = str(b.name, 120, "name"), client = str(b.client_name, 120, "client_name");
    const domain = str(b.domain, 253, "domain").toLowerCase();
    if (!/^(?=.{3,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.includes(".."))
      throw new HttpError(400, "Valid registered hostname required");
    const invoice = str(b.external_invoice_id, 120, "external_invoice_id");
    const deployment = str(b.deployment_kind, 40, "deployment_kind");
    if (!DEPLOYMENTS.includes(deployment)) throw new HttpError(400, "Unsupported deployment");
    const id = randomUUID(), key = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(key).digest("hex");
    await sql.begin(async tx => {
      await q(tx,
        "INSERT INTO projects(id,name,client_name,domain,deployment_kind,external_invoice_id,external_client_id,backend_key_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, name, client, domain, deployment, invoice,
          b.external_client_id ? str(b.external_client_id, 120, "external_client_id") : null, hash]);
      await addAudit(tx, id, "project.created", { deployment_kind: deployment });
    });
    return reply(res, 201, {
      project_id: id, project_key_once: key,
      warning: "Store the project key in the project's backend secret manager, never in frontend JavaScript."
    });
  }
  const match = path.match(/^\/api\/projects\/([\da-f-]{36})\/(policy|notice|hold|permanent)$/i);
  if (!match || req.method !== "POST") throw new HttpError(404, "Not found");
  const [, id, action] = match, b = await jsonBody(req);
  await sql.begin(async tx => {
    const p = await findProject(id, tx, true);
    if (action === "policy") {
      if (p.permanent_at) throw new HttpError(409, "Permanent licences cannot be modified");
      const scope = str(b.restriction_scope, 60, "restriction_scope");
      if (!["none", "licensed_marketing_site", "premium_features"].includes(scope))
        throw new HttpError(400, "Invalid restriction scope");
      if (!Number.isInteger(b.grace_days) || b.grace_days < 1 || b.grace_days > 90)
        throw new HttpError(400, "Grace period must be 1–90 days");
      if (typeof b.enforcement_enabled !== "boolean") throw new HttpError(400, "Invalid enforcement_enabled");
      const reference = b.contract_reference ? str(b.contract_reference, 240, "contract_reference") : null;
      const accepted = b.contract_accepted_at ? new Date(b.contract_accepted_at) : null;
      if (accepted && (Number.isNaN(accepted.getTime()) || accepted.getTime() > Date.now()))
        throw new HttpError(400, "Invalid contract acceptance timestamp");
      if (b.enforcement_enabled && (!reference || !accepted || scope === "none" ||
          !["nflake_hosted", "nflake_backend"].includes(p.deployment_kind)))
        throw new HttpError(409, "Cannot enable enforcement without contract and eligible scope");
      await q(tx,
        "UPDATE projects SET restriction_scope=$1,grace_days=$2,enforcement_enabled=$3,contract_reference=$4,contract_accepted_at=$5,updated_at=NOW() WHERE id=$6",
        [scope, b.grace_days, b.enforcement_enabled, reference, accepted, id]);
      await addAudit(tx, id, "policy.updated", {
        scope, grace_days: b.grace_days, enforcement_enabled: b.enforcement_enabled
      });
    } else if (action === "notice") {
      const evidence = str(b.notice_evidence, 240, "notice_evidence");
      if (!p.invoice_overdue || Number(p.balance_minor) <= 0)
        throw new HttpError(409, "No overdue invoice balance exists");
      if (!p.contract_accepted_at || !p.contract_reference)
        throw new HttpError(409, "Contract authority must be recorded first");
      if (p.notice_sent_at) throw new HttpError(409, "Notice already recorded; cannot reset grace clock");
      await q(tx,
        "UPDATE projects SET notice_sent_at=NOW(),notice_evidence=$1,updated_at=NOW() WHERE id=$2",
        [evidence, id]);
      await addAudit(tx, id, "notice.recorded", { evidence });
    } else if (action === "hold") {
      const reason = b.clear === true ? null : str(b.reason, 240, "hold reason");
      await q(tx, "UPDATE projects SET hold_reason=$1,updated_at=NOW() WHERE id=$2", [reason, id]);
      await addAudit(tx, id, reason ? "hold.placed" : "hold.cleared", { reason });
    } else if (action === "permanent") {
      const handover = str(b.handover_reference, 240, "handover reference");
      if (Number(p.balance_minor) !== 0 || p.payment_source !== "verified" ||
          !p.contract_reference || !p.contract_accepted_at)
        throw new HttpError(409, "Require a verified final balance and recorded contract");
      if (p.permanent_at) throw new HttpError(409, "Already permanent");
      await q(tx,
        "UPDATE projects SET permanent_at=NOW(),handover_reference=$1,enforcement_enabled=FALSE,updated_at=NOW() WHERE id=$2",
        [handover, id]);
      await addAudit(tx, id, "licence.permanent", { handover_reference: handover });
    }
  });
  const after = await findProject(id);
  return reply(res, 200, { project_id: id, license: selectDecision(after) });
}
const server = createServer(async (req, res) => {
  try { await handle(req, res); }
  catch (e) {
    const status = e instanceof HttpError ? e.status : e.code === "23505" ? 409 : 500;
    if (status === 500) console.error("Guard request failed:", e.message);
    if (!res.headersSent) reply(res, status, {
      error: status === 500 ? "Internal server error" : e.message
    });
  }
});
server.listen(PORT, HOST, () => console.log(
  "Nflake Guard listening at http://" + HOST + ":" + PORT +
  " (dry run: " + DRY_RUN + ", verified payment events: " + VERIFIED_EVENTS + ")"
));
