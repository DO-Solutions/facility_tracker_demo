import { config } from '../config.js';
import { maxTicketId, ticketsAfter, stats, maxSummaryId, summariesAfter } from '../db/index.js';
import { emit, EVENTS } from './events.js';

/**
 * Polls the tickets table and pushes anything new onto the event bus.
 *
 * Polling rather than an in-process hook, on purpose: in mars mode the INSERT
 * happens inside an agent's sandbox against Managed Postgres, in a different
 * machine entirely. The database is the only thing both sides can agree on.
 * The same loop therefore covers local mode for free.
 */
export function startTicketWatcher() {
  let lastId = 0;
  let lastSummaryId = 0;
  let lastStatsJson = '';
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;

    try {
      const fresh = await ticketsAfter(lastId);
      for (const ticket of fresh) {
        lastId = Math.max(lastId, ticket.id);
        emit(EVENTS.TICKET, ticket);
      }

      // Summaries are written by the summary agent in its own sandbox, so
      // they are discovered exactly like tickets.
      for (const summary of await summariesAfter(lastSummaryId)) {
        lastSummaryId = Math.max(lastSummaryId, summary.id);
        emit(EVENTS.SUMMARY, summary);
      }

      // Only push stats when they actually moved, to keep the SSE stream quiet.
      const s = await stats();
      const json = JSON.stringify(s);
      if (json !== lastStatsJson) {
        lastStatsJson = json;
        emit(EVENTS.STATS, s);
      }
    } catch (err) {
      console.error('[watcher] poll failed:', err.message);
    }

    if (!stopped) timer = setTimeout(tick, config.pollIntervalMs);
  }

  // Start from the current high-water mark so a restart does not replay the
  // entire backlog into every open dashboard.
  Promise.all([maxTicketId(), maxSummaryId()])
    .then(([ticketId, summaryId]) => {
      lastId = ticketId;
      lastSummaryId = summaryId;
      tick();
    })
    .catch((err) => {
      console.error('[watcher] could not read high-water mark:', err.message);
      tick();
    });

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
