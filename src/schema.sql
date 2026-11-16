-- Nflake Guard MVP: standalone single-agency licensing store.
-- No access to Financial Document OS tables or credentials is required.
BEGIN;
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  client_name TEXT NOT NULL CHECK (length(client_name) BETWEEN 1 AND 120),
  domain TEXT NOT NULL,
  deployment_kind TEXT NOT NULL CHECK (deployment_kind IN ('nflake_hosted','nflake_backend','client_hosted_static')),
  external_invoice_id TEXT NOT NULL UNIQUE,
  external_client_id TEXT,
  backend_key_hash TEXT NOT NULL UNIQUE,
  contract_accepted_at TIMESTAMPTZ,
  contract_reference TEXT,
  restriction_scope TEXT NOT NULL DEFAULT 'none'
    CHECK (restriction_scope IN ('none','licensed_marketing_site','premium_features')),
  grace_days INTEGER NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 1 AND 90),
  enforcement_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  notice_sent_at TIMESTAMPTZ,
  notice_evidence TEXT,
  due_at TIMESTAMPTZ,
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  invoice_overdue BOOLEAN NOT NULL DEFAULT FALSE,
  payment_source TEXT NOT NULL DEFAULT 'none' CHECK (payment_source IN ('none','sandbox','verified')),
  hold_reason TEXT,
  permanent_at TIMESTAMPTZ,
  handover_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS financial_events (
  event_id TEXT PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_time_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_project_time_idx ON audit_logs (project_id,created_at DESC);
COMMIT;
