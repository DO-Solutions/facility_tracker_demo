#!/usr/bin/env node
/**
 * Applies the schema and the two least-privilege roles to Managed Postgres.
 *
 * Run by deploy.sh with the cluster's admin connection string. Uses the `pg`
 * dependency the app already has, so no psql client is needed on the machine
 * doing the deploying.
 *
 *   ADMIN_DATABASE_URL=postgresql://doadmin:...@host:25060/complaints?sslmode=require \
 *   MARS_DB_PASSWORD=... MARS_REPORTER_PASSWORD=... \
 *   node scripts/migrate-postgres.js
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { splitSslMode, sslConfig, caFromEnv } from '../src/db/ssl.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, '..', 'db');

const url = process.env.ADMIN_DATABASE_URL;
const writerPassword = process.env.MARS_DB_PASSWORD;

const missing = [
  !url && 'ADMIN_DATABASE_URL',
  !writerPassword && 'MARS_DB_PASSWORD',
].filter(Boolean);

if (missing.length) {
  console.error(`migrate-postgres: missing ${missing.join(', ')}`);
  process.exit(1);
}

// Passwords are interpolated into a CREATE ROLE literal, so refuse anything
// that could break out of the quoting. deploy.sh generates hex, but this
// script is runnable by hand.
for (const [name, value] of [
  ['MARS_DB_PASSWORD', writerPassword],
]) {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(value)) {
    console.error(`migrate-postgres: ${name} must be >=16 chars of [A-Za-z0-9_-]`);
    process.exit(1);
  }
}

const { url: cleanUrl, sslmode } = splitSslMode(url);
const caCert = caFromEnv();

if (!caCert) {
  console.warn('  ! DB_CA_CERT not set — connecting without certificate verification');
}

const client = new pg.Client({
  connectionString: cleanUrl,
  ssl: sslConfig({ sslmode, caCert }),
  connectionTimeoutMillis: 20_000,
});

await client.connect();

try {
  const schema = await fs.readFile(path.join(dbDir, 'schema.postgres.sql'), 'utf8');
  await client.query(schema);

  // CREATE TABLE IF NOT EXISTS will not add a column to a table that already
  // exists, so bring older clusters forward explicitly.
  await client.query('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issue_number INTEGER');
  await client.query('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issue_url TEXT');
  await client.query('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issue_at TIMESTAMPTZ');
  await client.query('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ');
  await client.query('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS issue_closed_at TIMESTAMPTZ');
  await client.query('ALTER TABLE complaints ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ');
  console.log('  schema applied');

  const grants = (await fs.readFile(path.join(dbDir, 'grants.postgres.sql'), 'utf8'))
    .replaceAll('${MARS_DB_PASSWORD}', writerPassword);
  await client.query(grants);
  console.log('  role mars_writer applied');

  // Prove the boundary rather than trusting it. If any of these succeed the
  // deploy should fail loudly, because the demo's security story is a lie.
  const checks = [
    ['mars_writer',   'SELECT', 'complaints', false],
    ['mars_writer',   'INSERT', 'tickets',    true],
    ['mars_writer',   'DELETE', 'tickets',    false],
    ['mars_writer',   'SELECT', 'summaries',  false],
  ];

  // Column-level: the agent may read back the id it just inserted, and
  // nothing else. Verifying the negative here matters more than the positive.
  const columnChecks = [
    ['mars_writer', 'SELECT', 'tickets', 'id',    true],
    ['mars_writer', 'SELECT', 'tickets', 'title', false],
    ['mars_writer', 'SELECT', 'tickets', 'root_cause_hypothesis', false],
    ['mars_writer', 'UPDATE', 'tickets', 'issue_url', true],
    ['mars_writer', 'UPDATE', 'tickets', 'issue_at',  true],
    ['mars_writer', 'UPDATE', 'tickets', 'title',     false],
    ['mars_writer', 'SELECT', 'complaints', 'id',   true],
    ['mars_writer', 'SELECT', 'complaints', 'body', false],
    ['mars_writer', 'UPDATE', 'complaints', 'status', true],
    ['mars_writer', 'UPDATE', 'complaints', 'body',   false],
  ];

  let failures = 0;
  for (const [role, priv, table, column, expected] of columnChecks) {
    const { rows } = await client.query(
      'SELECT has_column_privilege($1, $2, $3, $4) AS ok',
      [role, table, column, priv],
    );
    if (rows[0].ok !== expected) {
      failures += 1;
      console.error(
        `  ✗ ${role} ${priv} ${table}.${column}: expected ${expected ? 'allowed' : 'DENIED'}, got ${rows[0].ok ? 'allowed' : 'denied'}`,
      );
    }
  }

  for (const [role, priv, table, expected] of checks) {
    const { rows } = await client.query(
      'SELECT has_table_privilege($1, $2, $3) AS ok',
      [role, table, priv],
    );
    const actual = rows[0].ok;
    if (actual !== expected) {
      failures += 1;
      console.error(
        `  ✗ ${role} ${priv} ${table}: expected ${expected ? 'allowed' : 'DENIED'}, got ${actual ? 'allowed' : 'denied'}`,
      );
    }
  }

  if (failures) {
    console.error(`\nmigrate-postgres: ${failures} privilege check(s) failed — refusing to continue.`);
    process.exit(1);
  }

  console.log(`  ${checks.length + columnChecks.length} privilege checks passed`);
} finally {
  await client.end();
}
