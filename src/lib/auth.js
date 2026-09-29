import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Minimal signed-cookie session. One shared password, one cookie, no user
 * table — this guards a conference dashboard, not a bank.
 */

function sign(value) {
  return crypto.createHmac('sha256', config.admin.sessionSecret).update(value).digest('base64url');
}

export function issueToken() {
  const expires = Date.now() + config.admin.maxAgeMs;
  const payload = `admin.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!token) return false;

  const idx = token.lastIndexOf('.');
  if (idx < 0) return false;

  const payload = token.slice(0, idx);
  const provided = token.slice(idx + 1);

  const expected = sign(payload);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const expires = Number.parseInt(payload.split('.')[1] ?? '', 10);
  return Number.isFinite(expires) && Date.now() < expires;
}

/** Constant-time password check, so the dashboard does not leak length. */
export function checkPassword(supplied) {
  const a = Buffer.from(String(supplied ?? ''));
  const b = Buffer.from(config.admin.password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function setSessionCookie(res) {
  res.cookie(config.admin.cookieName, issueToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.admin.maxAgeMs,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.admin.cookieName, { path: '/' });
}

export function requireAdmin(req, res, next) {
  if (verifyToken(req.cookies?.[config.admin.cookieName])) return next();
  // The whole surface is JSON now — the SPA turns a 401 into a redirect.
  return res.status(401).json({ error: 'unauthorised' });
}
