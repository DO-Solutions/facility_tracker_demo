import { config } from '../config.js';
import { maxTicketId, ticketsAfter, stats } from '../db/index.js';
import { sessionCensus } from './mars.js';
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
  maxTicketId()
    .then((id) => {
      lastId = id;
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

/**
 * Polls the MARS session census. Separate loop and a slower cadence: it hits
 * the DigitalOcean API rather than our own database, and a 429 mid-demo would
 * be a bad look.
 */
export function startSessionWatcher(intervalMs = 4000) {
  if (!config.digitalocean.token) return () => {};

  let stopped = false;
  let timer = null;
  let consecutiveFailures = 0;

  async function tick() {
    if (stopped) return;

    try {
      const census = await sessionCensus();
      if (census) emit(EVENTS.SESSIONS, census);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      // Log the first couple, then go quiet rather than spamming the console
      // for the rest of the talk.
      if (consecutiveFailures <= 2) {
        console.error('[sessions] poll failed:', err.message);
      }
    }

    // Back off on sustained failure, capped at a minute.
    const delay = Math.min(intervalMs * 2 ** Math.min(consecutiveFailures, 4), 60_000);
    if (!stopped) timer = setTimeout(tick, delay);
  }

  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
