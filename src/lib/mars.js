import crypto from 'node:crypto';
import { config } from './../config.js';

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
 * Fires the summary trigger with the figures the summary should cite.
 *
 * The app computes the figures because the agent's database role cannot read
 * a ticket; the agent writes the prose and inserts the row. That split is
 * what keeps the model key off this process entirely. The row reaches the
 * dashboard through the same polling loop as tickets, so this only has to
 * deliver — the caller answers the button before the summary exists.
 */
export async function fireSummaryWebhook(figures) {
  const { summaryWebhookUrl, summaryWebhookSecret } = config.ingest;
  if (!summaryWebhookUrl) throw new Error('no summary trigger configured — run ./deploy.sh');

  const payload = JSON.stringify({ ...figures, requested_at: new Date().toISOString() });
  const headers = { 'content-type': 'application/json' };
  if (summaryWebhookSecret) {
    const sig = signPayload(payload, summaryWebhookSecret);
    headers['X-DigitalOcean-Signature'] = sig;
    headers['do-signature'] = sig;
  }

  const res = await fetch(summaryWebhookUrl, {
    method: 'POST',
    headers,
    body: payload,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`summary trigger returned ${res.status}: ${text.slice(0, 200)}`);
  }
}
