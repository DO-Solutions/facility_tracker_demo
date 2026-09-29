import express from 'express';
import { config } from '../config.js';
import {
  listTickets,
  listComplaints,
  complaintDetail,
  stats,
  listSummaries,
  resetAll,
  nextTicketNumber,
  closeTicket,
} from '../db/index.js';
import { COMPONENTS, SEVERITIES } from '../lib/ticket-schema.js';
import { generateSummary } from '../lib/summarize.js';
import { sessionCensus, fireCloseIssueWebhook } from '../lib/mars.js';
import { clearTracker, tokenConfigured } from '../lib/github-admin.js';
import {
  checkPassword,
  clearSessionCookie,
  requireAdmin,
  setSessionCookie,
  verifyToken,
} from '../lib/auth.js';

export const adminRouter = express.Router();

/* ── session ────────────────────────────────────────────────────────────── */

adminRouter.get('/me', (req, res) => {
  res.json({ authenticated: verifyToken(req.cookies?.[config.admin.cookieName]) });
});

adminRouter.post('/login', (req, res) => {
  if (!checkPassword(req.body?.password)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  setSessionCookie(res);
  res.json({ authenticated: true });
});

adminRouter.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

/* ── everything below requires a session ────────────────────────────────── */

adminRouter.use(requireAdmin);

adminRouter.get('/stats', async (req, res, next) => {
  try {
    res.json(await stats());
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/sessions', async (req, res) => {
  try {
    res.json((await sessionCensus()) ?? { total: 0, running: 0, paused: 0, other: 0 });
  } catch {
    // A dashboard that 500s because the census failed is worse than one
    // showing a dash.
    res.json({ total: 0, running: 0, paused: 0, other: 0 });
  }
});

adminRouter.get('/tickets', async (req, res, next) => {
  try {
    const limit = Math.min(200, Number.parseInt(String(req.query.limit ?? '50'), 10) || 50);
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0);
    res.json(
      await listTickets({
        q: String(req.query.q ?? '').trim(),
        component: String(req.query.component ?? ''),
        severity: String(req.query.severity ?? ''),
        limit,
        offset,
      }),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * Close one ticket.
 *
 * Two halves that fail independently, the same shape as /reset. Closing the
 * row is ours and always happens; closing the GitHub issue is the agent's
 * job, fired as a webhook so it runs under the actor the GitHub connection
 * is authorized against.
 *
 * The response does not wait for the tracker. A trigger runs one execution
 * at a time, so closing several tickets in a row would otherwise queue the
 * UI behind a minute of agent time per click.
 */
adminRouter.post('/tickets/:id/close', async (req, res, next) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'bad ticket id' });
  }

  try {
    const ticket = await closeTicket(id);
    if (!ticket) return res.status(404).json({ error: 'no such ticket' });

    let tracker = 'skipped — no issue on this ticket';
    if (ticket.issue_number && !ticket.issue_closed_at) {
      try {
        const { fired, reason } = await fireCloseIssueWebhook({
          ticketId: ticket.id,
          issueNumber: ticket.issue_number,
        });
        tracker = fired ? 'closing' : `skipped — ${reason}`;
      } catch (err) {
        // The ticket is closed; do not fail the request over the tracker.
        console.error(`[admin] close trigger for ticket ${id} failed:`, err.message);
        tracker = `failed — ${err.message}`;
      }
    } else if (ticket.issue_closed_at) {
      tracker = 'already closed';
    }

    res.json({ ticket, tracker });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/complaints', async (req, res, next) => {
  try {
    const status = String(req.query.status ?? '');
    res.json({ complaints: await listComplaints({ status: status || null, limit: 200 }) });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/complaints/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const detail = await complaintDetail(id);
    if (!detail) return res.status(404).json({ error: 'not found' });
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/summaries', async (req, res, next) => {
  try {
    res.json({ summaries: await listSummaries(10) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/summaries/run', async (req, res) => {
  try {
    res.json(await generateSummary());
  } catch (err) {
    console.error('[admin] summary failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Reset the demo between rehearsals.
 *
 * Two halves, and they fail independently on purpose. The database wipe is
 * ours and always happens. Closing the tracker's issues is the agent's job,
 * fired as a webhook so it runs under the actor the GitHub connection is
 * authorized against — if that is not configured or not authorized, the
 * wipe still succeeds and the response says the tracker was left alone.
 *
 * Ticket numbering continues from the highest issue this demo has filed,
 * because GitHub never reuses a number. Restarting at 1 would put ticket #1
 * under issue #27 and make every issue footer disagree with the issue it is
 * on.
 */
adminRouter.post('/reset', async (req, res) => {
  const result = { database: 'pending', tracker: 'pending', nextTicket: 1 };

  // The tracker goes first now, and the order matters. Deleting the issues is
  // what tells us the number the next one will take, and the database has to
  // be re-seeded to that number so ticket #N lines up with issue #N. Wiping
  // first would mean guessing.
  let nextIssue = null;
  try {
    if (tokenConfigured()) {
      const { deleted, nextIssue: next, failures } = await clearTracker();
      nextIssue = next;
      result.tracker =
        failures?.length
          ? `deleted ${deleted}, ${failures.length} failed`
          : `deleted ${deleted}`;
      if (failures?.length) console.error('[admin] reset: some issues survived:', failures.slice(0, 5));
    } else {
      result.tracker = 'skipped — no GITHUB_ISSUE_TOKEN configured';
    }
  } catch (err) {
    // A tracker that will not empty is annoying, not fatal. The database wipe
    // below is the half that has to happen for the next run-through to work.
    console.error('[admin] reset: clearing the tracker failed:', err.message);
    result.tracker = `failed — ${err.message}`;
  }

  try {
    // Fall back to the database's own idea of the next number when GitHub
    // could not be asked, so a tracker failure still leaves usable numbering.
    result.nextTicket = nextIssue ?? (await nextTicketNumber());
    await resetAll({ ticketStartAt: result.nextTicket });
    result.database = 'wiped';
  } catch (err) {
    console.error('[admin] reset failed:', err.message);
    return res.status(500).json({ ...result, database: 'failed', error: err.message });
  }

  res.json(result);
});

/** Vocabularies for the filter dropdowns. */
adminRouter.get('/vocab', (req, res) => {
  res.json({ components: COMPONENTS, severities: SEVERITIES });
});
