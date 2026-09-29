import express from 'express';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { submitComplaint } from '../lib/ingest.js';
import { pingInference } from '../lib/inference.js';
import { db } from '../db/index.js';
import { formPage, thanksPage, qrPage, MAX_LENGTH } from '../lib/public-pages.js';

export const publicRouter = express.Router();

/** Crude in-memory throttle. Resets on restart, which is fine for one talk. */
const hits = new Map();

function rateLimited(ip) {
  if (!config.rateLimit.enabled) return false;

  const now = Date.now();
  const { windowMs, max } = config.rateLimit;
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);

  // Opportunistic cleanup so the map does not grow for the whole event.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    }
  }

  return recent.length > max;
}

/* ── the public pages ────────────────────────────────────────────────────
   Served as self-contained HTML rather than by the React app: this is what
   a room full of phones loads at once, and the SPA bundle is ~112 KB
   gzipped of admin they will never open. These are about two, in a single
   request, and the form posts without JavaScript. */

publicRouter.get('/', (req, res) => {
  res.type('html').set('cache-control', 'no-cache').send(formPage());
});

publicRouter.get('/thanks', (req, res) => {
  const id = Number.parseInt(String(req.query.id ?? ''), 10);
  res.type('html').set('cache-control', 'no-cache')
    .send(thanksPage({ id: Number.isFinite(id) ? id : null }));
});

publicRouter.get('/qr', (req, res) => {
  res.type('html').set('cache-control', 'no-cache')
    .send(qrPage({ target: `${req.protocol}://${req.get('host')}/` }));
});

/** The form's own target. Redirects, so the page works with no JavaScript. */
publicRouter.post('/complain', async (req, res) => {
  const body = String(req.body?.body ?? '').trim();

  const reject = (status, error) =>
    res.status(status).type('html').send(formPage({ error, body: body.slice(0, MAX_LENGTH) }));

  if (!body) return reject(400, 'The form requires a complaint. That is the whole form.');
  if (body.length > MAX_LENGTH) {
    return reject(400, `One sentence, please. That was ${body.length} characters; the limit is ${MAX_LENGTH}.`);
  }
  if (rateLimited(req.ip)) {
    return reject(429, 'Your grievances are being processed. Please allow the queue to drain.');
  }

  try {
    const complaint = await submitComplaint({ body, source: 'web' });
    return res.redirect(303, `/thanks?id=${complaint.id}`);
  } catch (err) {
    console.error('[public] submit failed:', err.message);
    return reject(500, 'Intake is temporarily unavailable. Your dissatisfaction has been noted informally.');
  }
});

/** JSON equivalent, kept for scripts and anything programmatic. */
publicRouter.post('/api/complain', async (req, res) => {
  const body = String(req.body?.body ?? '').trim();

  if (!body) {
    return res.status(400).json({ error: 'The form requires a complaint. That is the whole form.' });
  }
  if (body.length > MAX_LENGTH) {
    return res.status(400).json({
      error: `One sentence, please. That was ${body.length} characters; the limit is ${MAX_LENGTH}.`,
    });
  }
  if (rateLimited(req.ip)) {
    return res.status(429).json({
      error: 'Your grievances are being processed. Please allow the queue to drain.',
    });
  }

  try {
    const complaint = await submitComplaint({ body, source: 'web' });
    return res.status(201).json({ id: complaint.id });
  } catch (err) {
    console.error('[public] submit failed:', err.message);
    return res.status(500).json({
      error: 'Intake is temporarily unavailable. Your dissatisfaction has been noted informally.',
    });
  }
});

/** QR code pointing at the public form — projected by the /qr page. */
publicRouter.get('/qr.svg', async (req, res) => {
  const target = String(req.query.url || `${req.protocol}://${req.get('host')}/`);
  try {
    const svg = await QRCode.toString(target, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.type('image/svg+xml').set('cache-control', 'public, max-age=300').send(svg);
  } catch (err) {
    res.status(500).type('text/plain').send(`could not render QR: ${err.message}`);
  }
});

/**
 * Liveness by default, and `?deep=1` for the things that actually break.
 *
 * The shallow check answers "is the process up", which App Platform wants
 * and which never fails interestingly. The deep one exercises the two
 * dependencies that fail silently and separately: the database, and the
 * inference credential. Worth hitting the morning of a talk, because a dead
 * model key looks exactly like a working demo until the closing summary.
 *
 * It deliberately does not fire the intake triggers. Checking those means
 * spending a microVM per shard, and their health is already visible in the
 * trigger execution history.
 */
publicRouter.get('/healthz', async (req, res) => {
  if (!req.query.deep) return res.json({ ok: true });

  const checks = {};

  checks.database = await db()
    .get('SELECT 1 AS ok')
    .then(() => ({ ok: true }))
    .catch((err) => ({ ok: false, error: err.message }));

  checks.inference = await pingInference()
    .then((r) => ({ ok: true, model: r.model }))
    .catch((err) => ({ ok: false, error: err.message }));

  checks.intakeShards = { ok: config.ingest.shards.length > 0, count: config.ingest.shards.length };

  const ok = Object.values(checks).every((c) => c.ok);
  res.status(ok ? 200 : 503).json({ ok, checks });
});
