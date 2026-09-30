import { stats } from '../db/index.js';
import { fireSummaryWebhook } from './mars.js';

/**
 * The closing beat of the talk: total tickets, top three components by volume,
 * and a recommended headcount ask for Facilities.
 *
 * This process does not write it. It gathers the figures — which it can read
 * and the agent cannot — and hands them to the summary trigger, whose agent
 * writes the narrative and inserts the row. The model key therefore lives
 * only in that sandbox, never on the web tier.
 *
 * Returns as soon as the trigger accepts the delivery. The summary lands
 * about a minute later and reaches every open dashboard through the watcher
 * in ticket-watcher.js, the same way tickets do.
 */
export async function requestSummary() {
  const s = await stats();

  await fireSummaryWebhook({
    total_tickets: s.tickets,
    total_complaints: s.complaints,
    top_components: s.byComponent.slice(0, 3),
    by_severity: s.bySeverity,
    by_owner: s.byOwner,
  });

  return { requested: true };
}
