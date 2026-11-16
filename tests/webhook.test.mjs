import test from "node:test";
import assert from "node:assert/strict";
import { signPayload, verifySignedWebhook, parseFinancialEvent } from "../src/webhook.mjs";
const secret = "a-private-test-signing-secret-that-is-more-than-32-bytes";
const stamp = "1794816000";
const body = JSON.stringify({ type: "invoice.overdue", source: "sandbox", external_invoice_id: "INV-1", balance_minor: 12300 });
const headers = { "x-guard-event-id": "test-id-0001", "x-guard-timestamp": stamp, "x-guard-signature": signPayload(secret, stamp, body) };
test("authentic webhook accepts a current timestamp and matching body", () => {
  assert.equal(verifySignedWebhook({ headers, rawBody: body, secret, nowMs: Number(stamp) * 1000 }), true);
  assert.equal(verifySignedWebhook({ headers, rawBody: body + " ", secret, nowMs: Number(stamp) * 1000 }), false);
  assert.equal(verifySignedWebhook({ headers, rawBody: body, secret, nowMs: Number(stamp) * 1000 + 301000 }), false);
});
test("verified financial events require an independent feature gate", () => {
  assert.equal(parseFinancialEvent(body).source, "sandbox");
  const verified = JSON.stringify({ type: "invoice.settled", source: "verified", external_invoice_id: "INV-1", balance_minor: 0 });
  assert.throws(() => parseFinancialEvent(verified), /not activated/);
  assert.equal(parseFinancialEvent(verified, true).balance_minor, 0);
  assert.throws(() => parseFinancialEvent(JSON.stringify({type:"invoice.overdue", source:"sandbox", external_invoice_id:"INV", balance_minor:-1})), /balance_minor/);
});
