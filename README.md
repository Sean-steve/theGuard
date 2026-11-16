# Nflake Guard

**GitHub-first licensing safeguard for Nflake Technologies.**

Nflake Guard records client project licences and can consume authenticated financial events from the existing Financial Document OS: https://github.com/Sean-steve/ledger-flow-zen. It does **not** generate invoices, replace payment reconciliation, delete customer data or secretly disable websites.

> **MVP / LOCAL ENGINEERING PREVIEW — NOT PRODUCTION READY.**
> Defaults: DRY RUN ON; verified finance events OFF; all new projects unenforced; loopback binding. Never connect to real client websites before legal, operational and security review.

## Implemented

- Node 22+ HTTP API + PostgreSQL 16+ persistent project registry, signed financial-event deduplication, and audit trail.
- Responsive Guard console: overview, project registration (one-time backend key), license policy, notices, dispute holds, permanent licences, and audit.
- Licence states: ACTIVE / GRACE / RESTRICTED / PERMANENT. A RESTRICTED decision requires eligible Nflake-controlled hosting, accepted written contract, verified overdue balance, recorded written notice evidence, completed grace period, explicit operator opt-in, and global dry-run OFF.
- Backend-only per-project key hashed at rest; GET /v1/license/:projectId provides advisory licensing decision.
- HMAC-SHA256 events using timestamp, event ID and signed raw body; sandbox events cannot trigger real restrictions.
- Automated unit tests and local PostgreSQL CI smoke checks.

**Deliberate MVP limitations:** single agency administrator token (not production OIDC/MFA or multi-tenant roles); one invoice reference per licence; no automatic email; no live Financial Document OS connector; no public HTTPS deployment; no website-integrated SDK; no client-side or remote kill switch. Guard issues server-side entitlement decisions; it does not modify any website.

## Repository responsibilities

| Repository | Responsibility |
| --- | --- |
| Sean-steve/ledger-flow-zen | Invoices, payments, reversals, financial truth |
| Sean-steve/theGuard | Projects, notices, holds, licence decisions, audit |

As checked 16 November 2026: Financial Document OS Phase 7 is merged on main; Phase 8 security/recovery is an open draft PR #11, not deployed. Its local Node / PostgreSQL API blocks production hosting and M-Pesa is still sandbox/preview by default. A manually posted ledger payment is NOT proof of merchant/bank settlement.

## Run locally

Requirements: Node.js >=22 and a separate local PostgreSQL 16+ database.

1. Clone: `git clone https://github.com/Sean-steve/theGuard.git`
2. Enter directory and branch: `cd theGuard && git switch feat/guard-mvp`
3. Install: `npm install`
4. Provision an empty PostgreSQL database; copy `.env.example` to `.env`, then set DATABASE_URL plus two independent strong random secrets for GUARD_ADMIN_TOKEN and GUARD_CONNECTOR_SECRET. Never commit `.env`.
5. Migrate: `node --env-file=.env src/migrate.mjs`
6. Start: `node --env-file=.env src/server.mjs`
7. Open http://127.0.0.1:4080 and enter GUARD_ADMIN_TOKEN. The browser keeps the value in memory only.
8. Register a **fictional** project with a demo invoice ID such as INV-DEMO-001, and securely copy the generated project backend key.
9. Test with `node --env-file=.env scripts/send-demo-event.mjs INV-DEMO-001` to deliver a signed sandbox-only overdue event; the licence will remain non-restricting.

Run `npm test` and `npm run check` for unit and syntax validation. CI also runs a smoke test with disposable PostgreSQL 16.

## API

- GET /healthz — readiness flags.
- GET /api/projects, GET /api/audit — private, Bearer GUARD_ADMIN_TOKEN.
- POST /api/projects — create project; one-time project backend key.
- POST /api/projects/:id/policy — contract, scope, grace and operator opt-in.
- POST /api/projects/:id/notice — evidence reference for written notice **already sent externally**.
- POST /api/projects/:id/hold — place/release dispute hold.
- POST /api/projects/:id/permanent — permanent licence requires verified fully settled balance and handover reference.
- GET /v1/license/:id — project backend uses x-guard-project-key; no browser credentials.
- POST /webhooks/financial — HMAC-protected finance event contract (see docs/FINANCIAL_CONNECTOR.md).

## Restrictions and safety

Guard never injects hidden disabling code. A Nflake-controlled backend may separately limit only *contractually authorized licensed functionality* based on a verified server-side entitlement decision. Never restrict or delete client data, exports, security access, or client-owned source. Never enforce on a static client-controlled deployment. Guard API outages must not become accidental suspensions: downstream servers should cache last-known ACTIVE decisions, time out quickly, and never restrict due solely to an unavailable Guard server.

## Before production

Production-grade OIDC/MFA and admin role controls, tenant isolation, TLS/hosting, verified authoritative settlements, transactional financial outbox, webhook key rotation, event sequencing, rate-limiting, independent monitoring, secure DB backups, complaint/dispute procedures, legal review, privacy review and real end-to-end testing remain required. No production entitlement restrictions are enabled.
