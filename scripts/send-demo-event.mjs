/**
 * Local-only helper: sends a signed, explicitly SANDBOX overdue event to Guard.
 */
import { randomUUID } from "node:crypto";
import { signPayload } from "../src/webhook.mjs";

if (process.env.GUARD_HOST && !["127.0.0.1", "localhost"].includes(process.env.GUARD_HOST))
  throw new Error("Demo sender may only target loopback Guard");
const invoice = process.argv[2];
if (!invoice || invoice.length > 120) throw new Error("Pass an existing sample invoice reference");
const secret = process.env.GUARD_CONNECTOR_SECRET;
if (!secret || secret.length < 32) throw new Error("GUARD_CONNECTOR_SECRET is required");
const body = JSON.stringify({
  type: "invoice.overdue", source: "sandbox",
  external_invoice_id: invoice, balance_minor: 1250000,
  due_at: new Date(Date.now() - 86400000 * 14).toISOString()
});
const stamp = String(Math.floor(Date.now() / 1000));
const response = await fetch("http://127.0.0.1:" + (process.env.GUARD_PORT || 4080) + "/webhooks/financial", {
  method: "POST", headers: {
    "content-type": "application/json",
    "x-guard-event-id": randomUUID(),
    "x-guard-timestamp": stamp,
    "x-guard-signature": signPayload(secret, stamp, body)
  }, body
});
console.log("Sandbox event response:", response.status, await response.text());
if (!response.ok) process.exitCode = 1;
