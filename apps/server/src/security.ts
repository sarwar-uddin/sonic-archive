import { timingSafeEqual } from 'node:crypto';
import type { ApiError } from '@sonic-archive/contracts';
import type { RequestHandler } from 'express';

/**
 * Host names the server answers to. A request whose Host header names
 * anything else is refused. This defeats DNS rebinding: a malicious page
 * can point its own domain at 127.0.0.1, but the browser still sends that
 * domain in the Host header. (docs/safety.md, #6)
 */
export const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export function hostGuard(allowed: ReadonlySet<string> = LOOPBACK_HOSTNAMES): RequestHandler {
  return (req, res, next) => {
    const host = req.headers.host?.toLowerCase() ?? '';
    // Strip the port; IPv6 literals keep their brackets.
    const hostname = host.startsWith('[')
      ? host.slice(0, host.indexOf(']') + 1)
      : host.split(':')[0];
    if (hostname && allowed.has(hostname)) return next();
    const body: ApiError = { error: { code: 'FORBIDDEN', message: 'Host not allowed.' } };
    res.status(403).json(body);
  };
}

/**
 * The few actions that change anything: choosing the music folder, starting
 * a rescan, and settings. None of them can write to the music folder.
 */
export const WRITE_ROUTES: ReadonlySet<string> = new Set([
  'PUT /api/library',
  'POST /api/library/scan',
  'PUT /api/library/settings',
]);

/**
 * Everything but GET/HEAD is refused before routing, except WRITE_ROUTES,
 * which must also prove they come from the app's own page (`writeGuard`).
 */
export const readOnlyMethods: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (WRITE_ROUTES.has(`${req.method} ${req.path}`)) return next();
  res.setHeader('Allow', 'GET, HEAD');
  const body: ApiError = {
    error: { code: 'METHOD_NOT_ALLOWED', message: 'Only reading is allowed here.' },
  };
  res.status(405).json(body);
};

/**
 * Protects WRITE_ROUTES from other websites (cross-site request forgery).
 * A request must
 * - carry an `Origin` that is this server itself (browsers always send it
 *   on these requests, and pages cannot forge it);
 * - carry the session token, which only the app's own page can read from
 *   `/api/session` (no CORS headers are ever sent, so other sites cannot);
 * - be JSON, which other sites cannot send without a preflight we never grant.
 */
export function writeGuard(
  token: string,
  allowed: ReadonlySet<string> = LOOPBACK_HOSTNAMES,
): RequestHandler {
  const expected = Buffer.from(token);
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const refuse = (status: number, code: ApiError['error']['code'], message: string) => {
      const body: ApiError = { error: { code, message } };
      res.status(status).json(body);
    };
    const origin = req.headers.origin;
    let sameOrigin = false;
    try {
      const url = origin ? new URL(origin) : null;
      sameOrigin =
        url !== null &&
        url.protocol === 'http:' &&
        allowed.has(url.hostname === '::1' ? '[::1]' : url.hostname) &&
        url.host === req.headers.host;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) return refuse(403, 'FORBIDDEN', 'Requests must come from the app itself.');
    const given = Buffer.from(String(req.headers['x-sonic-token'] ?? ''));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return refuse(403, 'FORBIDDEN', 'Missing or wrong session token.');
    }
    if (!req.is('application/json')) {
      return refuse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON.');
    }
    next();
  };
}

/** Conservative headers for every response. No CORS headers are ever sent. */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
};

/** API responses are data, never documents: forbid them from running anything. */
export const apiContentSecurityPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  next();
};

/**
 * The web app loads only its own bundled scripts, styles, fonts and images.
 * Inline style attributes are allowed (placeholder sleeve tints); inline
 * scripts are not.
 */
export const webContentSecurityPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  next();
};
