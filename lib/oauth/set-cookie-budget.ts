/**
 * Most bytes the Set-Cookie headers of a sign-in or refresh response may take.
 * nginx holds an upstream's response headers in `proxy_buffer_size`, one
 * memory page (4 KB) unless raised, as does ingress-nginx, and answers 502
 * "upstream sent too big header" when they do not fit. The route's other
 * headers take about 300 bytes. Providers that issue large JWTs such as
 * Keycloak hand out refresh, access and id tokens of 1-2 KB each, so only
 * the refresh token is always stored; the cookies that merely save work
 * (the access-token cache and the id token for sign-out) are left out when
 * they would push the response over the limit (#1096, #1237).
 */
const MAX_SET_COOKIE_BYTES = 3500;

/**
 * A Set-Cookie header's size beyond the cookie value: header and cookie
 * name, attributes (path, expiry, flags) and line break. About 120-135 bytes
 * for these cookies, rounded up.
 */
const SET_COOKIE_OVERHEAD_BYTES = 150;

function setCookieBytes(values: ReadonlyArray<string | null | undefined>): number {
  return values.reduce((sum, value) => (value ? sum + value.length + SET_COOKIE_OVERHEAD_BYTES : sum), 0);
}

/** Whether cookies with these values, set by one response, fit its header budget. */
export function fitsSetCookieBudget(values: ReadonlyArray<string | null | undefined>): boolean {
  return setCookieBytes(values) <= MAX_SET_COOKIE_BYTES;
}
