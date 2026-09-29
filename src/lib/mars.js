import crypto from 'node:crypto';
import { config } from './../config.js';

const DO_API = 'https://api.digitalocean.com';

/**
 * Signs a payload the way DigitalOcean's `custom` webhook provider expects.
 *
 * Scheme `do-signature-v1`:
 *   HMAC-SHA256(secret, "<unix_seconds>" + "." + <raw body bytes>)  -> hex
 *   header value: "t=<unix_seconds>,v1=<hex>"
 *
 * The receiver applies a 300-second tolerance on the timestamp, so a badly
 * skewed clock on the sender looks exactly like a bad secret. Worth knowing at
 * 9am on a conference stage.
 */
export function signPayload(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = crypto.createHmac('sha256', secret);
  mac.update(Buffer.from(String(timestamp)));
  mac.update(Buffer.from('.'));
  mac.update(Buffer.from(rawBody));
  return `t=${timestamp},v1=${mac.digest('hex')}`;
}

/** Constant-time comparison of two signature header values. */
export function verifySignature(rawBody, secret, header, toleranceSeconds = 300) {
  if (!header) return false;

  const parts = Object.fromEntries(
    String(header)
      .split(',')
      .map((p) => p.split('='))
      .filter((p) => p.length === 2),
  );

  const ts = Number.parseInt(parts.t ?? '', 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;

  const expected = signPayload(rawBody, secret, ts);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Which shard the next complaint goes to.
 *
 * Round-robin rather than random: every run costs about the same, so an even
 * spread is exactly optimal and needs no bookkeeping. It resets on restart,
 * which is fine — the spread only has to be even across one talk.
 */
let nextShard = 0;

/**
 * Fires one complaint at a Harness Runtime intake trigger.
 *
 * Each delivery starts a fresh session in its own microVM. We do not wait for
 * the ticket — the agent writes it straight to Postgres, and the dashboard's
 * watcher notices the new row. That decoupling is why the form stays instant
 * however many people submit.
 *
 * A trigger runs one session at a time, so throughput is the shard count.
 * deploy.sh creates several identical triggers and this round-robins across
 * them; with one shard the behaviour is exactly what it was before.
 *
 * On a delivery failure it tries the next shard once. A trigger that has been
 * deleted or had its secret rotated would otherwise take out every complaint
 * that happened to land on it.
 */
export async function fireWebhook({ complaintId, body, table }) {
  const { shards, ticketTable } = config.ingest;
  if (!shards.length) throw new Error('no intake trigger configured');

  const payload = JSON.stringify({
    complaint_id: complaintId,
    complaint: body,
    table: table || ticketTable,
    submitted_at: new Date().toISOString(),
  });

  const start = nextShard++ % shards.length;
  const attempts = shards.length > 1 ? 2 : 1;
  let lastErr;

  for (let i = 0; i < attempts; i++) {
    const shard = shards[(start + i) % shards.length];
    try {
      return await deliver(shard, payload);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function deliver(shard, payload) {
  const headers = { 'content-type': 'application/json' };
  if (shard.secret) {
    const sig = signPayload(payload, shard.secret);
    // doctl advertises X-DigitalOcean-Signature; the DO webhook SDK reads
    // do-signature. Send both — they carry the same value.
    headers['X-DigitalOcean-Signature'] = sig;
    headers['do-signature'] = sig;
  }

  const res = await fetch(shard.url, {
    method: 'POST',
    headers,
    body: payload,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`webhook trigger returned ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json().catch(() => ({}));
}

/**
 * Fires the close trigger for one ticket's GitHub issue.
 *
 * A trigger again, and for the actor reason in fireResetWebhook above: the
 * app holds no GitHub credential, so the only way to reach the tracker is a
 * session started by a trigger.
 *
 * The caller has already written `closed_at`. This is the tracker catching
 * up, so it is fired and forgotten — a ticket that is closed on the wall but
 * whose issue is still open is a footnote, not a failure.
 */
export async function fireCloseIssueWebhook({ ticketId, issueNumber }) {
  const { closeWebhookUrl, closeWebhookSecret } = config.ingest;
  if (!closeWebhookUrl) return { fired: false, reason: 'no close trigger configured' };

  const payload = JSON.stringify({
    ticket_id: ticketId,
    issue_number: issueNumber,
    requested_at: new Date().toISOString(),
  });
  const headers = { 'content-type': 'application/json' };
  if (closeWebhookSecret) {
    const sig = signPayload(payload, closeWebhookSecret);
    headers['X-DigitalOcean-Signature'] = sig;
    headers['do-signature'] = sig;
  }

  const res = await fetch(closeWebhookUrl, {
    method: 'POST',
    headers,
    body: payload,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`close trigger returned ${res.status}: ${text.slice(0, 200)}`);
  }
  return { fired: true };
}

/**
 * Live session census for the dashboard — the "scale story without saying the
 * word scale". Counts sessions by status across the team.
 */
export async function sessionCensus() {
  if (!config.digitalocean.token) return null;

  const res = await fetch(`${DO_API}/v2/agents/sessions`, {
    headers: {
      authorization: `Bearer ${config.digitalocean.token}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`sessions API returned ${res.status}`);

  const { sessions = [] } = await res.json();

  const tally = { total: sessions.length, running: 0, paused: 0, other: 0 };
  for (const s of sessions) {
    const status = String(s.status || '').replace('SESSION_STATUS_', '').toLowerCase();
    if (['running', 'ready', 'starting', 'creating', 'active'].includes(status)) tally.running += 1;
    else if (status === 'paused') tally.paused += 1;
    else tally.other += 1;
  }

  return tally;
}
