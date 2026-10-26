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

/** The API is read-only: anything but GET/HEAD is refused before routing. */
export const readOnlyMethods: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  res.setHeader('Allow', 'GET, HEAD');
  const body: ApiError = {
    error: { code: 'METHOD_NOT_ALLOWED', message: 'This API is read-only.' },
  };
  res.status(405).json(body);
};

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
