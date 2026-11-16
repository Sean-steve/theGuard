# Phase 3 — Fictional Guard demonstration website

**Local-only demo. No real client, invoice, production website, financial settlement or live restrictions.**

The fictional **Verde Atelier** creative agency is a separate Node.js website using Guard's private server-side SDK. The project key never goes into HTML, JavaScript, or public API responses.

## What to expect

| State | Homepage | Portfolio | Explanation |
| --- | --- | --- | --- |
| ACTIVE | Available | Available | Normal licence |
| GRACE | Available | Available | Notices and grace do not restrict |
| RESTRICTED: licensed_marketing_site | Holding page | Holding page | HTML containing licensed content is not sent |
| RESTRICTED: premium_features | Available | Holding page | Scope remains narrow |
| PERMANENT | Available | Available | Final handover licence |
| UNKNOWN / Guard offline | Available | Available | No outage-triggered restriction |

No customer data, financial details, or public accusations are exposed. The holding page uses CSS skeletons that contain **no protected content**. This is real server-side content gating, not simply CSS blur.

## Running the safe demo locally

Requirements: Node 22+, PostgreSQL 16+, Guard installed and initialized per ../README.md.

1. Start Guard locally using its own `.env` with `GUARD_DRY_RUN=YES`, `GUARD_VERIFIED_EVENTS_ENABLED=NO`.
2. Visit the local Guard console at http://127.0.0.1:4080, register a fictional project using deployment `nflake_hosted` and invoice reference `VERDE-DEMO-001`.
3. Copy the project UUID and one-time backend key to a private `demo/.env` created from `demo/.env.example`.
4. Set `DEMO_ENABLED=YES` in that private file.
5. Start the independent demo server: `node --env-file=demo/.env demo/server.mjs`.
6. Open http://127.0.0.1:4190 and http://127.0.0.1:4190/portfolio.
7. To see GRACE, deliver a sandbox-only overdue event for the fictional invoice through the existing demo sender. With safe defaults, sandbox events **cannot cause RESTRICTED**.

**Never commit demo/.env.** GitHub Pages is static hosting and cannot run the required Guard-backed Node server.

## Real restricted/restored demonstration — CI only

A dedicated workflow `.github/workflows/phase3-demo.yml` runs against a **disposable** PostgreSQL database (`nflake_guard_demo_ci`). It starts the real Guard API and this separate website on loopback interfaces. The integration script explicitly refuses to run outside CI or without an additional synthetic-fixture gate.

Within that isolated fixture environment only, the Guard process sets `GUARD_DRY_RUN=NO` and `GUARD_VERIFIED_EVENTS_ENABLED=YES` to test how Guard would behave after a *hypothetical* independently verified event. These are invented **test events**, NOT genuine bank-verified settlements. No real customer is registered and no production service is restricted.

The E2E suite tests: ACTIVE → OVERDUE/GRACE → notice/grace → RESTRICTED (after simulated notice expiry) → partial balance remains RESTRICTED → dispute hold restores site → review hold removed → synthetic settlement restores full site → PERMANENT licence → stale event blocked → Guard outage fails open. All transitions use the actual backend SDK, Guard API, and HTML responses.

CI also checks that protected content is **absent** from restricted HTML (rather than visually blurred), and no backend secrets or balances reach the browser.

## Integration architecture

`Financial Document OS` (separate repo) → signed sandbox finance event → `Nflake Guard` (separate DB) → server-side Guard SDK → `Verde Atelier demo server` → browser.

No direct cross-database access, no forced code injection into third-party websites, no production deployment. Real activation needs explicit signed contracts, external settlement certification, HTTPS, OIDC/MFA, audits, monitoring, independent incident fallback and appropriate legal review.
