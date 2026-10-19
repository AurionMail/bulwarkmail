/**
 * The browser-login handoff to the Bulwark mobile app.
 *
 * The app opens `/login?mobile_redirect_uri=…&mobile_state=…` in the system
 * browser; once the user has signed in, the page navigates to that URI with
 * the credential material in the fragment. Two things bound what that page
 * will do with a user's password or tokens:
 *
 *  - The target is the app's one callback link, not any `bulwarkmobile://`
 *    URL a query string names. A custom scheme is claimable by any app on
 *    the device (RFC 8252 §8.4), so a narrower target is not proof of who
 *    receives it, but it is the one the app registers and nothing else.
 *  - The page never navigates on its own. It shows what is about to happen
 *    and lets the user confirm (components/auth/mobile-handoff-consent.tsx):
 *    a link that opens the webmail with these parameters otherwise reads
 *    exactly like the normal sign-in page and hands the typed password to
 *    whichever app owns the scheme.
 */
export const MOBILE_HANDOFF_REDIRECT_URI = 'bulwarkmobile://auth/callback';

/** The handoff target when `raw` is the app's callback link, else ''. */
export function mobileHandoffTarget(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed === MOBILE_HANDOFF_REDIRECT_URI || trimmed === `${MOBILE_HANDOFF_REDIRECT_URI}/`
    ? MOBILE_HANDOFF_REDIRECT_URI
    : '';
}

/** The URL the browser hands to the app: the target plus the fragment. */
export function buildMobileHandoffUrl(target: string, fragment: Record<string, string>): string {
  return `${target}#${new URLSearchParams(fragment).toString()}`;
}
