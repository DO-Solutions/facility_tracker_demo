-- Facility Issue Tracker — schema for DigitalOcean Managed Postgres.
--
-- The only schema there is. Local runs point at the deployed cluster via
-- scripts/link-local.sh, so there is no second dialect to keep in step.

CREATE TABLE IF NOT EXISTS complaints (
  id            BIGSERIAL   PRIMARY KEY,
  body          TEXT        NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT        NOT NULL DEFAULT 'web',
  -- pending | processing | ticketed | failed
  status        TEXT        NOT NULL DEFAULT 'pending',
  error         TEXT,
  -- The Harness Runtime session that processed this complaint
  session_id    TEXT,
  -- When the webhook was fired. The gap between this and submitted_at is
  -- ours; everything after it belongs to the agent.
  dispatched_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tickets (
  id                     BIGSERIAL   PRIMARY KEY,
  complaint_id           BIGINT      REFERENCES complaints(id),
  title                  TEXT        NOT NULL,
  component              TEXT        NOT NULL,
  severity               TEXT        NOT NULL,
  affected_users         INTEGER     NOT NULL,
  suggested_owner        TEXT        NOT NULL,
  sla_hours              INTEGER     NOT NULL,
  root_cause_hypothesis  TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id             TEXT,
  -- Filled in by the agent after it opens the GitHub issue. Nullable on
  -- purpose: the ticket is written first and the issue second, so a GitHub
  -- outage costs you a link, not a ticket.
  issue_number           INTEGER,
  issue_url              TEXT,
  -- Set by the agent when the GitHub issue is opened, so the detail view
  -- can show that stage rather than inferring it from issue_number.
  issue_at               TIMESTAMPTZ,
  -- Set by the app the moment an operator closes the ticket. Local and
  -- immediate: the dashboard must not wait on an agent to look right.
  closed_at              TIMESTAMPTZ,
  -- Set by the close agent once the GitHub issue is actually closed, which
  -- happens a minute or so later. Nullable on purpose, exactly like
  -- issue_at: a tracker failure costs the confirmation, not the close.
  issue_closed_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS summaries (
  id             BIGSERIAL   PRIMARY KEY,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_tickets  INTEGER     NOT NULL,
  -- JSON: [{"component": "Beverages", "count": 12}, ...]
  top_components TEXT        NOT NULL,
  headcount_ask  TEXT        NOT NULL,
  narrative      TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_complaints_status  ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_component  ON tickets(component);
