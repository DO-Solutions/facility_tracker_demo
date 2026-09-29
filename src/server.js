import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, validateConfig } from './config.js';
import { initDb, closeDb } from './db/index.js';
import { startTicketWatcher, startSessionWatcher } from './lib/ticket-watcher.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { streamRouter } from './routes/stream.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const clientDir = path.join(root, 'web', 'dist');

const problems = validateConfig();
if (problems.length) {
  console.error('\nConfiguration problems:\n');
  for (const p of problems) console.error(`  • ${p}`);
  console.error('\nSee .env.example. Copy it to .env and fill in the blanks.\n');
  process.exit(1);
}

const app = express();

// App Platform terminates TLS upstream; trust it so req.protocol and req.ip
// reflect the real client rather than the proxy.
app.set('trust proxy', true);

app.use(express.json({ limit: '32kb' }));
// The public form posts a plain HTML form, not JSON.
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(cookieParser());

// Order matters here, and getting it wrong is silent. adminRouter calls
// `use(requireAdmin)` for everything that reaches it, so mounting it at /api
// ahead of the public router makes it answer 401 for /api/complain — a
// request it does not even have a route for. The public form breaks and the
// only symptom is an unexplained 401 from a page with no login on it.
app.use('/', publicRouter);
app.use('/api', streamRouter);
app.use('/api', adminRouter);

/* ── the built client ────────────────────────────────────────────────────
   Hashed asset filenames are immutable, so they cache hard; index.html must
   not, or a redeploy leaves browsers pointing at assets that no longer
   exist. */

const hasClient = fs.existsSync(path.join(clientDir, 'index.html'));

if (hasClient) {
  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders(res, filePath) {
        res.setHeader(
          'cache-control',
          filePath.includes(`${path.sep}assets${path.sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    }),
  );

  // Client-side routing: anything not matched above is the SPA. The public
  // pages are registered before this and so never reach it.
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(clientDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(503)
      .type('text/plain')
      .send('The client has not been built. Run: npm run build\n');
  });
}

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ error: config.isProd ? 'Something went wrong.' : String(err.message) });
});

const stops = [];

async function main() {
  await initDb();
  stops.push(startTicketWatcher());
  stops.push(startSessionWatcher());

  const server = app.listen(config.port, () => {
    const base = `http://localhost:${config.port}`;
    let dbHost = 'unknown';
    try {
      dbHost = new URL(config.db.url).host;
    } catch {
      /* startup validation already rejected an unusable URL */
    }

    console.log('');
    console.log('  The Facility Issue Tracker is open.');
    console.log('');
    console.log(`    form       ${base}/`);
    console.log(`    QR (proj)  ${base}/qr`);
    console.log(`    dashboard  ${base}/admin`);
    console.log(`    wall       ${base}/admin/wall`);
    console.log('');
    console.log(`    database: ${dbHost}`);
    if (!hasClient) console.log('    client:   NOT BUILT — run npm run build');
    console.log('');
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} — shutting down`);
    for (const stop of stops) stop();
    server.close();
    await closeDb().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
