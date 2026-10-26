import { isIP } from 'node:net';
import { getClientIP } from '@/lib/admin/session';

/**
 * Every credential the sign-in routes check reaches the mail server from this
 * host's address. Stalwart counts failed logins per address (fail2ban) and
 * bans the address once the allowance is spent, so wrong passwords typed by
 * or fired at the webmail would eventually lock the webmail itself out for
 * everyone. Handing Stalwart the real client address lets it attribute the
 * failure to that client instead, once the admin tells it to read the header:
 * on 0.16 `Http.useXForwarded` (it then prefers a `Forwarded` header and
 * otherwise takes the first `X-Forwarded-For` entry), on 1.0
 * `Http.clientIpSource` = `xForwardedFor` with `forwardedHops` = 1 (the last
 * entry; more when proxies between the webmail and Stalwart append their
 * own). Neither checks where the connection comes from, so only enable it
 * when every HTTP client of Stalwart goes through the webmail or a proxy
 * that sets the header. Left at its default, Stalwart ignores the header.
 *
 * Only a syntactically valid address is forwarded: the client-facing value
 * comes from the request's own `X-Forwarded-For` when no reverse proxy
 * rewrites it, and anything else would be a stranger's text in an upstream
 * header.
 */
export function forwardedClientHeaders(clientIp: string | undefined): Record<string, string> {
  if (!clientIp || clientIp === '0.0.0.0' || isIP(clientIp) === 0) return {};
  return { 'X-Forwarded-For': clientIp };
}

/** The client address of `request` as the sign-in routes forward and budget it. */
export function loginClientAddress(request: Request): string {
  return getClientIP(request);
}
