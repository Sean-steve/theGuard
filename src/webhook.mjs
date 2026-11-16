import { createHmac, timingSafeEqual } from "node:crypto";

const EVENTS = new Set([
  "invoice.overdue", "invoice.balance_updated", "invoice.settled",
  "payment.reversed", "invoice.disputed", "invoice.dispute_resolved"
]);
export function signPayload(secret, timestamp, body) {
  return createHmac("sha256", secret).update(String(timestamp) + "." + body).digest("hex");
}
export function verifySignedWebhook({ headers, rawBody, secret, nowMs = Date.now() }) {
  if (typeof secret !== "string" || secret.length < 32) return false;
  const id = headers["x-guard-event-id"];
  const stamp = headers["x-guard-timestamp"];
  const signature = headers["x-guard-signature"];
  if (typeof id !== "string" || !/^[\w.:-]{8,128}$/.test(id)) return false;
  if (typeof stamp !== "string" || !/^\d{10}$/.test(stamp)) return false;
  const seconds = Number(stamp);
  if (Math.abs(nowMs - seconds * 1000) > 300000) return false;
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signPayload(secret, stamp, rawBody), "hex");
  const provided = Buffer.from(signature, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
export function parseFinancialEvent(rawBody, allowVerified = false) {
  let value;
  try { value = JSON.parse(rawBody); } catch { throw new Error("Invalid JSON event"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid event object");
  if (!EVENTS.has(value.type)) throw new Error("Unknown event type");
  if (typeof value.external_invoice_id !== "string" ||
      value.external_invoice_id.length < 1 || value.external_invoice_id.length > 120)
    throw new Error("Invoice reference required");
  if (!["sandbox", "verified"].includes(value.source)) throw new Error("Invalid payment source");
  if (value.source === "verified" && !allowVerified) throw new Error("Verified events are not activated");
  if (value.source === "verified" && (!Number.isSafeInteger(value.sequence) || value.sequence < 1))
    throw new Error("Verified financial event sequence required");
  if (value.sequence != null && (!Number.isSafeInteger(value.sequence) || value.sequence < 1))
    throw new Error("Invalid event sequence");
  if (value.project_id != null && (typeof value.project_id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(value.project_id))) throw new Error("Invalid project id");
  const balanceRequired = ["invoice.overdue", "invoice.balance_updated", "payment.reversed"].includes(value.type);
  if (balanceRequired && (!Number.isSafeInteger(value.balance_minor) ||
      value.balance_minor < 0)) throw new Error("Valid balance_minor required");
  if (value.type === "invoice.settled" && value.balance_minor !== 0) throw new Error("Settled invoice balance must be zero");
  if (value.due_at != null && (typeof value.due_at !== "string" ||
      Number.isNaN(Date.parse(value.due_at)))) throw new Error("Invalid due_at");
  return value;
}
