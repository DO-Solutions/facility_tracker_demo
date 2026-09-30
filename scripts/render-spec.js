#!/usr/bin/env node
/**
 * Renders .do/app.template.yaml to stdout.
 *
 * Substitutes only the placeholders this deploy owns, from an explicit
 * allowlist. Anything else — notably App Platform's own `${db.DATABASE_URL}`,
 * which the platform resolves at run time — is left exactly as written.
 *
 * Using this instead of envsubst keeps the deploy working on a stock macOS
 * (no gettext) and makes it impossible to accidentally clobber a platform
 * variable with an empty local one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const templatePath = process.argv[2] || path.join(here, '..', '.do', 'app.template.yaml');

const KEYS = [
  'STACK_NAME',
  'DO_REGION_SLUG',
  'DB_CLUSTER_NAME',
  'DB_NAME',
  'APP_SIZE',
  'GITHUB_REPO',
  'GITHUB_BRANCH',
  'MARS_WEBHOOK_URL',
  'MARS_WEBHOOK_SECRET',
  'MARS_WEBHOOK_SHARDS_B64',
  'GITHUB_ISSUE_REPO',
  'GITHUB_ISSUE_TOKEN',
  'SUMMARY_WEBHOOK_URL',
  'SUMMARY_WEBHOOK_SECRET',
  'ADMIN_PASSWORD',
  'SESSION_SECRET',
  'DB_CA_CERT_B64',
];

// Substituted, but allowed to be empty. The GitHub tracker is optional —
// the README promises the demo still runs without it — and the shard list
// falls back to the single MARS_WEBHOOK_URL. Requiring them would turn
// "no tracker" into "no deploy".
const OPTIONAL = new Set([
  'MARS_WEBHOOK_SHARDS_B64',
  'GITHUB_ISSUE_REPO',
  'GITHUB_ISSUE_TOKEN',
]);

const template = fs.readFileSync(templatePath, 'utf8');

const missing = KEYS.filter((k) => !process.env[k] && !OPTIONAL.has(k));
if (missing.length) {
  console.error(`render-spec: missing ${missing.join(', ')}`);
  process.exit(1);
}

let out = template;
for (const key of KEYS) {
  out = out.replaceAll(`\${${key}}`, process.env[key] ?? '');
}

// Any leftover placeholder that is not a platform binding is a template bug.
const leftover = [...out.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
  .map((m) => m[1])
  .filter((name) => !KEYS.includes(name));

if (leftover.length) {
  console.error(`render-spec: unsubstituted placeholder(s): ${[...new Set(leftover)].join(', ')}`);
  process.exit(1);
}

process.stdout.write(out);
