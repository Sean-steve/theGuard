# Financial Document OS → Nflake Guard connector contract

## Phase 2 sandbox connector implemented in Financial Document OS (draft)

The independent repository [ledger-flow-zen](https://github.com/Sean-steve/ledger-flow-zen)
now has a **draft** branch `feat/guard-sandbox-connector` (based on its open Phase 8 security branch).
It includes an additive local PostgreSQL outbox, owner-authorized invoice-to-Guard links,
HMAC-signed **sandbox-only** delivery, a local optional reconciliation worker, an invoicing
integration screen, and two-database GitHub Actions tests against the real Guard receiver.

**This is not live integration**: FDOS financial balances remain canonical but do not prove
independent bank settlement. Source is always `sandbox`, Guard is DRY RUN,
and neither application is deployed to production. No client website is restricted.
See `docs/phase-9/GUARD_SANDBOX_INTEGRATION.md` in the finance branch.


**Source:** https://github.com/Sean-steve/ledger-flow-zen

Confirmed 16 November 2026: main HEAD 6bb459e8a596c4fc19b2cb1c6d7e2182a80d4dbd (Phase 7 merged). Phase 8 security/recovery is OPEN/DRAFT PR #11 with a local-only certification candidate. Its backend deliberately rejects public production hosting. Live Safaricom settlement and live provider delivery are NOT certified; preview/sandbox M-Pesa receipts are test-only.

## How we will integrate (NOT implemented in Financial Document OS)

1. Add an outbound connector in ledger-flow-zen on a separate feature branch after reviewing Phase 8. Do not modify the ledger, bypass its API, or write into the Guard database.
2. Use the canonical issued invoice, atomic payment allocation/reversal, and a verified merchant/bank settlement evidence ID before marking source as verified. A manual ledger posting or unverified M-Pesa callback is NOT proof of external settlement.
3. Require explicit invoice-to-Guard project mapping. One invoice per Guard licence in v0.1; do not guess based on client name.
4. Transactional finance-side outbox + independently scheduled signed sender with idempotent event ID, retry, backoff, monitoring, and a dead-letter queue.
5. Reconcile missed/unknown events without automatically restricting client services.
6. Activate GUARD_VERIFIED_EVENTS_ENABLED=YES only after independently certifying the sender's truth model. Keep GUARD_DRY_RUN=YES until the legal/technical release gate is complete.

## HMAC-SHA256 event protocol

POST /webhooks/financial — Content-Type: application/json — max 32768 bytes.

Headers:
- x-guard-event-id: durable unique identifier (8–128 letters, numbers, underscore, dot, colon or dash)
- x-guard-timestamp: Unix epoch seconds
- x-guard-signature: 64-character hex HMAC-SHA256 of timestamp + "." + the *exact raw JSON body*, keyed with server-only GUARD_CONNECTOR_SECRET

Receiver accepts timestamps within ±300 seconds, rejects invalid HMAC and references, and handles retries idempotently (new event HTTP 202, duplicate HTTP 200). Keep the exact event ID and payload for retries.

Example SANDBOX event (never real funds or license restriction):

~~~json
{
  "type": "invoice.overdue",
  "source": "sandbox",
  "external_invoice_id": "INV-DEMO-001",
  "balance_minor": 1250000,
  "due_at": "2026-11-01T00:00:00Z"
}
~~~

Amount is an integer in **minor currency units**, e.g. KES cents. If invoices store decimal amounts, convert using decimal arithmetic rather than floating-point rounding. Event types:
- invoice.overdue: positive balance required.
- invoice.balance_updated: nonnegative current balance required.
- invoice.settled: balance_minor must equal zero; restores ACTIVE.
- payment.reversed: recalculated nonnegative balance required.
- invoice.disputed: automatic operator hold.
- invoice.dispute_resolved: records the event ONLY; an administrator must explicitly release the hold.

**Verified events additionally require sequence:** a positive, strictly increasing integer per Guard project/invoice mapping. Old or out-of-order verified balances are rejected (409), preventing an older overdue event from reversing a newer settlement. Sandbox events do not establish an authoritative sequence.

source=sandbox or source=verified. Verified events are rejected by default until the environment gate is explicitly enabled. The Guard receiver's signature validation verifies the sender, NOT that the M-Pesa provider has independently settled funds. Production verification must happen before signing.

## Licence transition

Verified overdue → GRACE. A signed contract, authorized scope, independently recorded notice evidence, grace-period expiry, Nflake-controlled hosting, operator approval, no dispute hold, and global dry-run OFF are ALL required for RESTRICTED. Settled → ACTIVE. An administrator issues PERMANENT only after verified final settlement and documented handover. A client-owned static website is never eligible.

**Critical protection:** The licence endpoint returns *advisory server-side entitlements*, not access to client data. Never withhold customer data, exports or security endpoints, and never insert undisclosed kill switches.

## Mandatory release follow-ups

Production OIDC/MFA, HTTPS/reverse proxy, separate provider reconciliation, finance outbox, retries/receipts, versioned financial events, cryptographic key rotation, revocation, alerting, DR backups, data protection assessment, signed notice delivery, contract counsel review, E2E integration tests and incident rollback plan. Current source remains localhost-only and is not production ready.
