// Manifest origin and path validation shared by the client install path,
// the admin and marketplace routes and the CSP builder. No server imports,
// so the browser can use it too.

// `https://host`, `https://host:port`, or `https://*.host[:port]`
//
// Each label is alphanumeric with optional inner dashes; the final TLD label
// MUST start with a letter so we reject raw IPv4 literals.
//
// Disallowed by the regex (intentionally):
//   - any scheme other than https
//   - paths, queries, fragments
//   - userinfo, IPv4 literals, IPv6 literals (`[::1]`)
//   - bare wildcards (`https://*`)
const FRAME_ORIGIN_RE =
  /^https:\/\/(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?))*\.(?:[a-z](?:[a-z0-9-]*[a-z0-9])?)(?::[0-9]{1,5})?$/i;

export function isValidFrameOrigin(origin: unknown): origin is string {
  if (typeof origin !== 'string') return false;
  if (origin.length > 200) return false;
  if (!FRAME_ORIGIN_RE.test(origin)) return false;
  // Reject control characters / whitespace as a final safeguard against
  // anything that would let an attacker break out of the directive.
  if (/[\s'"`;,()]/.test(origin)) return false;
  return true;
}

/**
 * Sanitises a list of candidate origins from a manifest. Drops invalid
 * entries silently and dedupes (case-insensitive on the host).
 */
export function sanitizeFrameOrigins(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of input) {
    if (!isValidFrameOrigin(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Same syntax + validation as `sanitizeFrameOrigins`, but for the
 * `httpOrigins` manifest field. Kept as a separate exported function so the
 * intent is explicit at every call site (frame embedding vs. HTTP fetch).
 */
export const sanitizeHttpOrigins = sanitizeFrameOrigins;

// ─── apiPostPaths (manifest field) ────────────────────────────

/**
 * Validates an `/api/...` path entry. Must start with `/api/`, contain only
 * URL-path-safe characters, and have no `..` segment. The trailing slash is
 * meaningful (treated as a prefix at enforcement time).
 */
export function isValidApiPostPath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  if (path.length === 0 || path.length > 200) return false;
  if (!path.startsWith('/api/')) return false;
  // A route, not the whole API: `/api/` or `/api//x` would name every
  // endpoint at once, and the consent screen could not say which.
  if (!/^\/api\/[A-Za-z0-9._-]+/.test(path)) return false;
  if (path.includes('..')) return false;
  if (/[\s'"`;,()?#]/.test(path)) return false;
  if (!/^[/A-Za-z0-9._-]+$/.test(path)) return false;
  return true;
}

export function sanitizeApiPostPaths(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of input) {
    if (!isValidApiPostPath(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
