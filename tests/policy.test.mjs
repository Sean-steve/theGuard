import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLicense } from "../src/policy.mjs";
const today = "2026-11-16T08:00:00Z";
const project = {
  invoice_overdue: true, balance_minor: 1250000, due_at: "2026-11-01T00:00:00Z",
  notice_sent_at: "2026-11-05T08:00:00Z", notice_evidence: "email-delivery-123",
  grace_days: 7, contract_reference: "signed-sow-01",
  contract_accepted_at: "2026-10-10T00:00:00Z", deployment_kind: "nflake_hosted",
  restriction_scope: "licensed_marketing_site", payment_source: "verified",
  enforcement_enabled: true
};
test("notice and eligible verified debt can restrict only when explicitly enabled", () => {
  assert.equal(evaluateLicense(project, { now: today, dryRun: false }).status, "RESTRICTED");
  assert.equal(evaluateLicense(project, { now: today, dryRun: true }).restrict, false);
});
test("paid, disputed, transferred/static and sandbox projects cannot restrict", () => {
  for (const changes of [
    { balance_minor: 0 }, { hold_reason: "disputed" },
    { deployment_kind: "client_hosted_static" }, { payment_source: "sandbox" },
    { enforcement_enabled: false }, { contract_accepted_at: null },
    { notice_evidence: null }, { restriction_scope: "none" }
  ]) assert.equal(evaluateLicense({ ...project, ...changes }, { now: today, dryRun: false }).restrict, false);
});
test("grace period is measured from written notice, not invoice due date", () => {
  const outcome = evaluateLicense(project, { now: "2026-11-06T08:00:00Z", dryRun: false });
  assert.equal(outcome.status, "GRACE");
  assert.equal(outcome.grace_ends_at, "2026-11-12T08:00:00.000Z");
});
test("permanent licences do not expire based on old invoices", () => {
  assert.equal(evaluateLicense({ ...project, permanent_at: today }, { now: today, dryRun: false }).status, "PERMANENT");
});
