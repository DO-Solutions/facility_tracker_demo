import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { createPostgres } from './postgres.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(here, '..', '..', 'db');

let driver = null;

export function db() {
  if (!driver) throw new Error('database not initialised — call initDb() first');
  return driver;
}

export async function initDb({ applySchema = true } = {}) {
  if (driver) return driver;

  driver = createPostgres({ url: config.db.url });

  if (applySchema) {
    await driver.exec(await fs.readFile(path.join(schemaDir, 'schema.postgres.sql'), 'utf8'));
  }

  return driver;
}

export async function closeDb() {
  if (driver) await driver.close();
  driver = null;
}

/* ── row normalisation ──────────────────────────────────────────────────────
   Postgres hands back Date objects and BIGINT ids; everything above this file
   expects ISO strings and numbers. Flatten here rather than in the views. */

function iso(v) {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapComplaint(r) {
  if (!r) return null;
  return {
    ...r,
    id: Number(r.id),
    submitted_at: iso(r.submitted_at),
    dispatched_at: iso(r.dispatched_at),
  };
}

function mapTicket(r) {
  if (!r) return null;
  return {
    ...r,
    id: Number(r.id),
    complaint_id: r.complaint_id == null ? null : Number(r.complaint_id),
    affected_users: Number(r.affected_users),
    sla_hours: Number(r.sla_hours),
    created_at: iso(r.created_at),
    closed_at: r.closed_at ? iso(r.closed_at) : null,
    issue_closed_at: r.issue_closed_at ? iso(r.issue_closed_at) : null,
  };
}

function mapSummary(r) {
  if (!r) return null;
  let top = [];
  try {
    top = JSON.parse(r.top_components);
  } catch {
    top = [];
  }
  return { ...r, id: Number(r.id), generated_at: iso(r.generated_at), top_components: top };
}

/* ── complaints ─────────────────────────────────────────────────────────── */

export async function insertComplaint({ body, source = 'web' }) {
  const row = await db().get(
    'INSERT INTO complaints (body, source) VALUES (?, ?) RETURNING *',
    [body, source],
  );
  return mapComplaint(row);
}

export async function getComplaint(id) {
  return mapComplaint(await db().get('SELECT * FROM complaints WHERE id = ?', [id]));
}

export async function markComplaint(
  id,
  { status, error = null, sessionId = null, dispatched = false },
) {
  await db().run(
    `UPDATE complaints
        SET status = ?,
            error = ?,
            session_id = COALESCE(?, session_id),
            dispatched_at = CASE WHEN ? THEN now() ELSE dispatched_at END
      WHERE id = ?`,
    [status, error, sessionId, dispatched, id],
  );
}

/** One complaint with its ticket, for the intake detail view. */
export async function complaintDetail(id) {
  const row = await db().get(
    `SELECT c.*,
            t.id            AS ticket_id,
            t.title         AS ticket_title,
            t.component, t.severity, t.affected_users, t.suggested_owner,
            t.sla_hours, t.root_cause_hypothesis,
            t.created_at    AS ticket_created_at,
            t.issue_number, t.issue_url, t.issue_at
       FROM complaints c
       LEFT JOIN tickets t ON t.complaint_id = c.id
      WHERE c.id = ?`,
    [id],
  );
  if (!row) return null;
  return {
    ...mapComplaint(row),
    dispatched_at: iso(row.dispatched_at),
    ticket: row.ticket_id
      ? {
          id: Number(row.ticket_id),
          title: row.ticket_title,
          component: row.component,
          severity: row.severity,
          affected_users: Number(row.affected_users),
          suggested_owner: row.suggested_owner,
          sla_hours: Number(row.sla_hours),
          root_cause_hypothesis: row.root_cause_hypothesis,
          created_at: iso(row.ticket_created_at),
          issue_number: row.issue_number == null ? null : Number(row.issue_number),
          issue_url: row.issue_url,
          issue_at: iso(row.issue_at),
        }
      : null,
  };
}

export async function listComplaints({ status = null, limit = 100 } = {}) {
  const rows = status
    ? await db().all(
        'SELECT * FROM complaints WHERE status = ? ORDER BY id DESC LIMIT ?',
        [status, limit],
      )
    : await db().all('SELECT * FROM complaints ORDER BY id DESC LIMIT ?', [limit]);
  return rows.map(mapComplaint);
}

/* ── tickets ────────────────────────────────────────────────────────────── */

export async function insertTicket(t) {
  const row = await db().get(
    `INSERT INTO tickets
       (complaint_id, title, component, severity, affected_users,
        suggested_owner, sla_hours, root_cause_hypothesis, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      t.complaint_id ?? null,
      t.title,
      t.component,
      t.severity,
      t.affected_users,
      t.suggested_owner,
      t.sla_hours,
      t.root_cause_hypothesis,
      t.session_id ?? null,
    ],
  );
  return mapTicket(row);
}

/**
 * Close one ticket.
 *
 * `closed_at` is ours and is written here and now — the operator clicked, so
 * the row is closed before anything is asked of an agent. Closing the GitHub
 * issue happens separately and later; `issue_closed_at` is the agent's column
 * and stays null until it confirms.
 *
 * Returns null if there is no such ticket, and the existing row untouched if
 * it was already closed, so a double click is not an error.
 */
export async function closeTicket(id) {
  const existing = await db().get('SELECT * FROM tickets WHERE id = ?', [id]);
  if (!existing) return null;
  if (existing.closed_at) return mapTicket(existing);

  const row = await db().get(
    `UPDATE tickets
        SET closed_at = now()
      WHERE id = ?
      RETURNING *`,
    [id],
  );
  return mapTicket(row);
}

/**
 * Tickets newer than `afterId`, oldest first. This is how the dashboard picks
 * up rows regardless of who wrote them — this process in local mode, or a MARS
 * agent writing straight to Postgres through Action Gateway in mars mode.
 */
export async function ticketsAfter(afterId, limit = 100) {
  const rows = await db().all(
    `SELECT t.*, c.body AS complaint_body
       FROM tickets t
       LEFT JOIN complaints c ON c.id = t.complaint_id
      WHERE t.id > ?
      ORDER BY t.id ASC
      LIMIT ?`,
    [afterId, limit],
  );
  return rows.map(mapTicket);
}

export async function listTickets({ q = '', component = '', severity = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];

  if (q) {
    where.push('(LOWER(t.title) LIKE LOWER(?) OR LOWER(t.root_cause_hypothesis) LIKE LOWER(?) OR LOWER(c.body) LIKE LOWER(?))');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (component) {
    where.push('t.component = ?');
    params.push(component);
  }
  if (severity) {
    where.push('t.severity = ?');
    params.push(severity);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await db().all(
    `SELECT t.*, c.body AS complaint_body
       FROM tickets t
       LEFT JOIN complaints c ON c.id = t.complaint_id
       ${clause}
      ORDER BY t.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const { n } = await db().get(
    `SELECT COUNT(*) AS n
       FROM tickets t
       LEFT JOIN complaints c ON c.id = t.complaint_id
       ${clause}`,
    params,
  );

  return { tickets: rows.map(mapTicket), total: Number(n) };
}

export async function maxTicketId() {
  const row = await db().get('SELECT COALESCE(MAX(id), 0) AS n FROM tickets');
  return Number(row.n);
}

/* ── stats ──────────────────────────────────────────────────────────────── */

export async function stats() {
  const [totals, byComponent, bySeverity, owners] = await Promise.all([
    db().get(
      `SELECT
         (SELECT COUNT(*) FROM complaints)                          AS complaints,
         (SELECT COUNT(*) FROM tickets)                             AS tickets,
         (SELECT COUNT(*) FROM complaints WHERE status = 'pending')    AS pending,
         (SELECT COUNT(*) FROM complaints WHERE status = 'processing') AS processing,
         (SELECT COUNT(*) FROM complaints WHERE status = 'failed')     AS failed,
         -- Ticket #N is supposed to be issue #N. GitHub never reuses a
         -- number, so one failed issue step puts the two counters out of
         -- step for good, and every card after it cites the wrong issue.
         -- Both numbers are already on the row, so the drift is detectable
         -- here — no GitHub credential needed, which matters because the
         -- app deliberately has none.
         (SELECT COUNT(*) FROM tickets
           WHERE issue_number IS NOT NULL AND issue_number <> id)   AS drifted,
         (SELECT COALESCE(MAX(ABS(issue_number - id)), 0) FROM tickets
           WHERE issue_number IS NOT NULL)                          AS drift_max`,
    ),
    db().all(
      'SELECT component, COUNT(*) AS count FROM tickets GROUP BY component ORDER BY count DESC, component ASC',
    ),
    db().all(
      'SELECT severity, COUNT(*) AS count FROM tickets GROUP BY severity ORDER BY severity ASC',
    ),
    db().all(
      'SELECT suggested_owner, COUNT(*) AS count FROM tickets GROUP BY suggested_owner ORDER BY count DESC, suggested_owner ASC LIMIT 10',
    ),
  ]);

  const num = (o, k) => Number(o?.[k] ?? 0);

  return {
    complaints: num(totals, 'complaints'),
    tickets: num(totals, 'tickets'),
    pending: num(totals, 'pending'),
    processing: num(totals, 'processing'),
    failed: num(totals, 'failed'),
    // How many tickets cite an issue number that is not their own, and the
    // widest gap. Zero is the only healthy value.
    drifted: num(totals, 'drifted'),
    driftMax: num(totals, 'drift_max'),
    byComponent: byComponent.map((r) => ({ component: r.component, count: Number(r.count) })),
    bySeverity: bySeverity.map((r) => ({ severity: r.severity, count: Number(r.count) })),
    byOwner: owners.map((r) => ({ owner: r.suggested_owner, count: Number(r.count) })),
  };
}

/**
 * Wipes every row and restarts the sequences.
 *
 * `ticketStartAt` keeps ticket numbering in step with GitHub, which never
 * reuses an issue number — so after a reset the next ticket has to continue
 * from where the issues left off, not from 1.
 */
export async function resetAll({ ticketStartAt = 1 } = {}) {
  await db().exec('DELETE FROM summaries');
  await db().exec('DELETE FROM tickets');
  await db().exec('DELETE FROM complaints');
  await db().exec('ALTER SEQUENCE complaints_id_seq RESTART WITH 1');
  await db().exec('ALTER SEQUENCE summaries_id_seq RESTART WITH 1');
  await db().exec(`ALTER SEQUENCE tickets_id_seq RESTART WITH ${Number(ticketStartAt) || 1}`);
}

/**
 * Where ticket numbering should resume so it stays level with GitHub.
 *
 * Three sources, and the highest wins:
 *
 *   the highest issue this demo has filed — the direct signal, but it is
 *     zero after a wipe, and zero for seeded rows that never reached GitHub
 *   the current ticket sequence — survives a wipe, so it carries the
 *     alignment forward when the tickets themselves no longer can
 *   1 — a floor for a genuinely fresh database
 *
 * Taking the maximum is what makes repeated resets safe. Trusting the first
 * alone would restart at 1 after any reset with no issue-linked tickets,
 * quietly putting ticket #1 under issue #27.
 */
export async function nextTicketNumber() {
  const [issue, seq] = await Promise.all([
    db().get('SELECT COALESCE(MAX(issue_number), 0) AS n FROM tickets'),
    db().get("SELECT last_value, is_called FROM tickets_id_seq"),
  ]);
  const fromIssues = Number(issue.n) + 1;
  const fromSeq = seq.is_called ? Number(seq.last_value) + 1 : Number(seq.last_value);
  return Math.max(fromIssues, fromSeq, 1);
}

/* ── executive summaries ────────────────────────────────────────────────── */

export async function insertSummary({ totalTickets, topComponents, headcountAsk, narrative }) {
  const row = await db().get(
    `INSERT INTO summaries (total_tickets, top_components, headcount_ask, narrative)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
    [totalTickets, JSON.stringify(topComponents), headcountAsk, narrative],
  );
  return mapSummary(row);
}

export async function latestSummary() {
  return mapSummary(await db().get('SELECT * FROM summaries ORDER BY id DESC LIMIT 1'));
}

export async function listSummaries(limit = 10) {
  const rows = await db().all('SELECT * FROM summaries ORDER BY id DESC LIMIT ?', [limit]);
  return rows.map(mapSummary);
}
