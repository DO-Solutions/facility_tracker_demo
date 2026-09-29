#!/usr/bin/env node
/**
 * Wipes every row. Schema stays. Use between rehearsals.
 *
 *   npm run db:reset -- --yes
 *   npm run db:reset -- --yes --start-at 20
 *
 * `--start-at N` restarts the ticket sequence at N instead of 1. GitHub
 * issue numbers never restart and never reuse a deleted number, so after a
 * few rehearsals ticket #1 ends up filed as issue #20 and the footer on
 * every issue disagrees with the issue it is on. Pass the next issue number
 * and the two read the same again. Find it on the repo's issues page, or
 * take the highest number ever used and add one.
 */
import { initDb, closeDb, db } from '../src/db/index.js';
import { config } from '../src/config.js';

const argv = process.argv.slice(2);
const force = argv.includes('--yes') || argv.includes('-y');

const startAtIdx = argv.indexOf('--start-at');
const startAt = startAtIdx >= 0 ? Number.parseInt(argv[startAtIdx + 1], 10) : 1;
if (!Number.isInteger(startAt) || startAt < 1) {
  console.error('--start-at needs a positive integer');
  process.exit(1);
}
if (!force) {
  console.error('This deletes every complaint, ticket and summary.');
  const host = (() => {
    try { return new URL(config.db.url).host; } catch { return '(unparseable DATABASE_URL)'; }
  })();
  console.error(`Target: Managed Postgres at ${host}`);
  console.error('\nRe-run with --yes to confirm.');
  process.exit(1);
}

await initDb();
await db().exec('DELETE FROM summaries');
await db().exec('DELETE FROM tickets');
await db().exec('DELETE FROM complaints');

await db().exec('ALTER SEQUENCE complaints_id_seq RESTART WITH 1');
await db().exec('ALTER SEQUENCE summaries_id_seq RESTART WITH 1');
// Tickets are the ones that surface in GitHub, so they are the ones worth
// aligning. Complaint ids are internal and stay at 1.
await db().exec(`ALTER SEQUENCE tickets_id_seq RESTART WITH ${startAt}`);

console.log(startAt === 1 ? 'Wiped.' : `Wiped. Next ticket will be #${startAt}.`);
await closeDb();
