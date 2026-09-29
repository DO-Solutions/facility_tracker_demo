/**
 * TLS configuration for DigitalOcean Managed Postgres.
 *
 * Two things to know:
 *
 * 1. DigitalOcean signs cluster certificates with its own CA, which is not in
 *    the system trust store. Without that CA, verification fails with
 *    SELF_SIGNED_CERT_IN_CHAIN. Set DB_CA_CERT (deploy.sh fetches it with
 *    `doctl databases get-ca`) and the connection is fully verified.
 *
 * 2. `sslmode` in the connection string wins over the `ssl` option object in
 *    recent pg versions, and `require` is now treated as `verify-full`. So we
 *    strip sslmode from the URL and decide here, explicitly, rather than
 *    letting two half-configurations fight.
 */

export function splitSslMode(url) {
  if (!url) return { url, sslmode: null };

  try {
    const parsed = new URL(url);
    const sslmode = parsed.searchParams.get('sslmode');
    parsed.searchParams.delete('sslmode');
    return { url: parsed.toString(), sslmode };
  } catch {
    // Not a parseable URL; hand it back untouched and let pg complain.
    return { url, sslmode: null };
  }
}

export function sslConfig({ sslmode, caCert }) {
  if (sslmode === 'disable') return false;

  if (caCert) {
    // The good path: verify against DigitalOcean's CA.
    return { ca: caCert, rejectUnauthorized: true };
  }

  // No CA available. Encrypt, but we cannot prove who we are talking to.
  // Acceptable inside a VPC; not something to do over the public internet.
  return { rejectUnauthorized: false };
}

/** Reads the CA from DB_CA_CERT, accepting either raw PEM or base64 PEM. */
export function caFromEnv(value = process.env.DB_CA_CERT) {
  if (!value) return null;
  const raw = value.includes('BEGIN CERTIFICATE')
    ? value
    : Buffer.from(value, 'base64').toString('utf8');
  return raw.includes('BEGIN CERTIFICATE') ? raw : null;
}
