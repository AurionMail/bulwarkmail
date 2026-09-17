import { NextResponse } from 'next/server';

/**
 * CSRF gate for cookie-writing and cookie-authed requests.
 *
 * Every identity cookie this app writes is `SameSite=Lax`, which still allows
 * top-level cross-site POST navigations (e.g. a form auto-submitted by an
 * attacker page the victim is tricked into visiting). A `text/plain` form
 * body is accepted by `request.json()`, so without an origin check any
 * website can drive the unauthenticated `/api/auth/*` routes in a victim's
 * browser and fix their webmail session to attacker-chosen credentials
 * (GHSA-qvr9-m8cq-7wvg), or trigger cookie-authed admin actions.
 *
 * Strategy: state-changing requests must come from the same origin. Modern
 * browsers (since 2020) always send `Sec-Fetch-Site` and that header cannot
 * be set by JS, so it is the authoritative signal. Older browsers fall back
 * to `Origin`. Non-browser clients (curl, scripts, the native apps) send
 * neither header and cannot ride a victim's cookie cross-origin, so the
 * absence of both headers is allowed.
 */
export function isSameOriginRequest(request: Request): boolean {
  const method = typeof request.method === 'string' ? request.method.toUpperCase() : '';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== null) {
    return fetchSite === 'same-origin';
  }

  const origin = request.headers.get('origin');
  if (!origin) return true;

  try {
    const originHost = new URL(origin).host;
    const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    return !!requestHost && originHost === requestHost;
  } catch {
    return false;
  }
}

/**
 * Handler-level guard for the mutating `/api/auth/*` routes. Returns a 403
 * response for cross-origin requests and `null` when the handler may proceed.
 * Runs before the body is read so nothing attacker-controlled is parsed.
 */
export function rejectCrossOriginRequest(request: Request): NextResponse | null {
  if (isSameOriginRequest(request)) return null;
  return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
}
