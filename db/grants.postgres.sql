-- ─────────────────────────────────────────────────────────────────────────────
-- Least-privilege role for the MARS agent.
--
-- This is the "allow that one table, deny everything else" boundary from the
-- brief, enforced where it cannot be argued with: Postgres itself. The agent's
-- action_code sandbox connects as `mars_writer`, which can insert a ticket and
-- mark a complaint done. It cannot read complaint bodies it was not handed, it
-- can add a summary but never read one, and it cannot DELETE or DROP anything
-- at all.
--
-- Applied by deploy.sh. ${MARS_DB_PASSWORD} is substituted at deploy time.
-- ─────────────────────────────────────────────────────────────────────────────

-- Start from nothing. PUBLIC gets CREATE on `public` by default in PG < 15;
-- revoke it so a new role cannot create its own scratch tables.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mars_writer') THEN
    CREATE ROLE mars_writer LOGIN PASSWORD '${MARS_DB_PASSWORD}';
  ELSE
    ALTER ROLE mars_writer LOGIN PASSWORD '${MARS_DB_PASSWORD}';
  END IF;
END
$$;

-- Nothing inherited, nothing assumed.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM mars_writer;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM mars_writer;
REVOKE ALL ON SCHEMA public FROM mars_writer;

-- See the schema, and nothing more.
GRANT USAGE ON SCHEMA public TO mars_writer;

-- The one table it may write.
GRANT INSERT ON TABLE tickets TO mars_writer;
GRANT USAGE  ON SEQUENCE tickets_id_seq TO mars_writer;

-- One column of SELECT, and only one. `INSERT ... RETURNING id` reads the
-- value back, which Postgres treats as a SELECT and refuses without this —
-- the failure surfaces as a flat "permission denied for table tickets", which
-- looks nothing like the RETURNING clause that caused it. Column-level, so the
-- agent still cannot read a single ticket it or anyone else has filed.
GRANT SELECT (id) ON TABLE tickets TO mars_writer;

-- And the three columns it fills in once it has opened the GitHub issue.
-- Still no UPDATE on anything describing the ticket itself, and none on
-- `closed_at`, which is the app's column and not an agent's.
--
-- `issue_closed_at` is no longer granted: the close agent that wrote it is
-- gone, and issues are now only removed in bulk by Reset. The REVOKE ALL
-- above strips the old grant from existing clusters.
GRANT UPDATE (issue_number, issue_url, issue_at) ON TABLE tickets TO mars_writer;

-- Close the loop on the complaint it was handed: three columns, no more.
GRANT UPDATE (status, error, session_id) ON TABLE complaints TO mars_writer;

-- And SELECT on `id` alone, for the same reason as tickets.id above: the
-- agent's statement is `UPDATE complaints ... WHERE id = %s`, and a WHERE
-- clause is a read. Without this the UPDATE is denied, which would be fine
-- on its own — except the denial raises inside psycopg's connection context
-- manager, which rolls the transaction back and silently takes the perfectly
-- good INSERT with it. The visible symptom is tickets that intermittently
-- never appear, which looks like anything but a missing column grant.
-- Complaint bodies stay unreadable: `body` is not granted.
GRANT SELECT (id) ON TABLE complaints TO mars_writer;

-- The summary agent writes one row per press of "Generate now". It is handed
-- the figures in its payload, so it needs no read access at all: INSERT on
-- the four columns it fills, and the sequence behind `id`. No SELECT, not
-- even on `id` — its statement has no RETURNING clause, and the prompt says
-- so, because asking for one would fail the whole insert.
--
-- Same role again, for the reason the close agent shares it: one more
-- narrowly scoped write is cheaper than a third password to plumb through.
GRANT INSERT (total_tickets, top_components, headcount_ask, narrative) ON TABLE summaries TO mars_writer;
GRANT USAGE ON SEQUENCE summaries_id_seq TO mars_writer;

-- Explicitly denied, for the avoidance of doubt and for anyone reading this
-- over your shoulder at the conference:
--   complaints : no SELECT, no INSERT, no DELETE
--   tickets    : no SELECT, no UPDATE, no DELETE
--   summaries  : no SELECT, no UPDATE, no DELETE
-- Future tables default to no access, since PUBLIC was revoked above.

-- ─────────────────────────────────────────────────────────────────────────────
-- Retire mars_reporter.
--
-- It existed for an earlier, scheduled summary agent that queried tickets
-- itself. Today's summary agent is handed its figures and writes through
-- mars_writer, so it needs no read role at all. Removing
-- it from this file is not enough: the role would survive in the cluster with
-- SELECT on tickets and nobody using it, which is the worst kind of leftover.
--
-- Its grants have to go before the role can. Guarded so a fresh deploy, where
-- the role was never created, is a no-op rather than an error.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mars_reporter') THEN
    REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM mars_reporter;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM mars_reporter;
    REVOKE ALL ON SCHEMA public FROM mars_reporter;
    DROP ROLE mars_reporter;
  END IF;
END
$$;
