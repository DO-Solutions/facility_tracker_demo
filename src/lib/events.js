import { EventEmitter } from 'node:events';

/**
 * Process-local fan-out for the dashboard's SSE stream.
 *
 * Deliberately not the source of truth. Tickets are discovered by polling the
 * database (src/lib/ticket-watcher.js), because in mars mode the rows are
 * written by an agent in a different microVM entirely — this process never
 * sees that INSERT happen. Events are just the delivery mechanism to browsers.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export const EVENTS = {
  TICKET: 'ticket',
  COMPLAINT: 'complaint',
  STATS: 'stats',
  SESSIONS: 'sessions',
  SUMMARY: 'summary',
};

export function emit(type, payload) {
  bus.emit(type, payload);
}
