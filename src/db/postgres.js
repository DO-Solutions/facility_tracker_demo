import pg from 'pg';
import { splitSslMode, sslConfig, caFromEnv } from './ssl.js';

// BIGSERIAL ids arrive as strings by default (int8 exceeds JS safe integers).
// Our ids never will, and the rest of the app compares them numerically.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

/**
 * DigitalOcean Managed Postgres — the only database this app talks to, in
 * every environment including a local `npm run dev`.
 *
 * The query layer above writes `?` placeholders, which this rewrites to
 * $1..$n. Keeping the query layer free of pg-specific syntax means the SQL
 * reads the same as the schema files.
 */
function toPositional(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

export function createPostgres({ url }) {
  const { url: cleanUrl, sslmode } = splitSslMode(url);

  const pool = new pg.Pool({
    connectionString: cleanUrl,
    ssl: sslConfig({ sslmode, caCert: caFromEnv() }),
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });

  return {
    kind: 'postgres',

    async exec(sql) {
      await pool.query(sql);
    },

    async all(sql, params = []) {
      const res = await pool.query(toPositional(sql), params);
      return res.rows;
    },

    async get(sql, params = []) {
      const res = await pool.query(toPositional(sql), params);
      return res.rows[0] ?? null;
    },

    async run(sql, params = []) {
      const res = await pool.query(toPositional(sql), params);
      return { changes: res.rowCount, lastId: res.rows[0]?.id ?? null };
    },

    async close() {
      await pool.end();
    },
  };
}
