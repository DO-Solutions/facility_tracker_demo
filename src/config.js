import dotenv from 'dotenv';

// .env is the committed-shape config; .env.local overrides it and wins.
// scripts/link-local.sh writes .env.local to point a local run at the
// deployed Managed Postgres and the live webhook trigger.
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

function bool(v, dflt = false) {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, dflt) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
}

/**
 * The intake triggers, as [{ url, secret }].
 *
 * A Harness Runtime trigger runs exactly one session at a time — measured,
 * see docs/PLATFORM-NOTES.md — so the number of triggers *is* the number of
 * complaints that can be processed at once. deploy.sh creates several and
 * writes them here as JSON.
 *
 * Falls back to the single MARS_WEBHOOK_URL pair, which is what a stack
 * deployed before sharding has, and what link-local.sh wrote then. Bad JSON
 * falls back too rather than throwing: an unparseable env var should cost
 * throughput, not the whole app.
 */
function intakeShards() {
  const single = process.env.MARS_WEBHOOK_URL
    ? [{ url: process.env.MARS_WEBHOOK_URL, secret: process.env.MARS_WEBHOOK_SECRET || '' }]
    : [];

  const raw = process.env.MARS_WEBHOOK_SHARDS;
  if (!raw) return single;

  try {
    // Accepts raw JSON or base64 JSON, like DB_CA_CERT. The App Platform
    // spec carries it base64'd because bare `[{...}]` is read as a YAML
    // array; link-local.sh writes it plain.
    const text = raw.trimStart().startsWith('[')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text);
    const shards = (Array.isArray(parsed) ? parsed : [])
      .filter((s) => s && typeof s.url === 'string' && s.url)
      .map((s) => ({ url: s.url, secret: typeof s.secret === 'string' ? s.secret : '' }));
    return shards.length ? shards : single;
  } catch {
    console.error('[config] MARS_WEBHOOK_SHARDS is not valid JSON — falling back to one trigger');
    return single;
  }
}

export const config = {
  port: int(process.env.PORT, 3000),
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  admin: {
    password: process.env.ADMIN_PASSWORD || 'complaints',
    sessionSecret: process.env.SESSION_SECRET || 'dev-only-change-me',
    cookieName: 'cd_admin',
    // Eight hours: long enough for a conference day.
    maxAgeMs: 8 * 60 * 60 * 1000,
  },

  // DigitalOcean Managed Postgres, in every environment. There is no local
  // database: `scripts/link-local.sh` points a local run at the deployed
  // cluster, so what you develop against is what the demo runs on.
  db: {
    url: process.env.DATABASE_URL || '',
  },

  // Every complaint goes to Harness Runtime. There is no in-process path:
  // the agent's instructions live in agents/complaint-prompt.txt and are run
  // by the trigger, so there is only one prompt and only one thing to test.
  ingest: {
    webhookUrl: process.env.MARS_WEBHOOK_URL || '',
    // Every intake trigger, round-robined by fireWebhook. One entry means
    // one complaint at a time, which is the platform's behaviour per trigger.
    shards: intakeShards(),
    // Fires the summary agent, which writes one executive summary row.
    summaryWebhookUrl: process.env.SUMMARY_WEBHOOK_URL || '',
    summaryWebhookSecret: process.env.SUMMARY_WEBHOOK_SECRET || '',
    webhookSecret: process.env.MARS_WEBHOOK_SECRET || '',
    ticketTable: process.env.MARS_TICKET_TABLE || 'tickets',
  },

  // The only GitHub credential in this app, and it is not part of the demo.
  // Everything the demo does with GitHub goes through Action Gateway so no
  // token reaches a sandbox. This one exists solely so the Reset button can
  // *delete* issues between rehearsals — a capability Action Gateway
  // deliberately does not expose to agents. See src/lib/github-admin.js.
  // Optional: without it, Reset leaves the tracker alone.
  //
  // `enabled` follows ENABLE_GITHUB_ISSUES by way of deploy.sh, which leaves
  // GITHUB_ISSUE_REPO empty when the integration is off — so the repo being
  // set is the one signal, here and in the agents.
  github: {
    issueRepo: process.env.GITHUB_ISSUE_REPO || '',
    issueToken: process.env.GITHUB_ISSUE_TOKEN || '',
    get enabled() {
      return Boolean(this.issueRepo);
    },
  },

  // How often the dashboard polls the DB for rows the agent wrote directly.
  pollIntervalMs: int(process.env.POLL_INTERVAL_MS, 1500),

  // Rate limiting on the public form, so one enthusiast cannot drown the demo.
  rateLimit: {
    windowMs: int(process.env.RATE_WINDOW_MS, 60_000),
    max: int(process.env.RATE_MAX, 12),
    enabled: bool(process.env.RATE_LIMIT_ENABLED, true),
  },
};

export function validateConfig() {
  const problems = [];

  if (!config.db.url) {
    problems.push(
      'DATABASE_URL is not set. For a local run against the deployed cluster: ./scripts/link-local.sh > .env.local',
    );
  }
  if (!config.ingest.shards.length) {
    problems.push(
      'No intake trigger configured (MARS_WEBHOOK_SHARDS or MARS_WEBHOOK_URL). For a local run against the deployed triggers: ./scripts/link-local.sh > .env.local',
    );
  }
  // No check for SUMMARY_WEBHOOK_URL. Like the close trigger it is one
  // button's worth of functionality, so its absence is reported by
  // /healthz?deep=1 and by the button itself rather than refusing to boot.
  if (config.isProd && config.admin.sessionSecret === 'dev-only-change-me') {
    problems.push('SESSION_SECRET is still the default — set a real one in production');
  }

  return problems;
}
