/**
 * Computes the union of CSP `frame-src` origins declared by installed and
 * enabled plugins. The proxy reads this on each request so that plugins can
 * embed external content (YouTube, Vimeo, Jitsi, …) without us hard-coding
 * domains in the host CSP.
 *
 * Origins are validated at install time and re-validated here as defense in
 * depth - any malformed value is dropped so a corrupted registry can never
 * inject arbitrary CSP fragments.
 */

import { getPluginRegistry } from './plugin-registry';
import { sanitizeFrameOrigins } from '../extension-origins';

export {
  isValidFrameOrigin,
  sanitizeFrameOrigins,
  sanitizeHttpOrigins,
  isValidApiPostPath,
  sanitizeApiPostPaths,
} from '../extension-origins';

// In-memory cache. The proxy fires on every page navigation; reading the
// registry JSON every time is fine but cheap to skip when nothing has
// changed. Five seconds is short enough to make plugin install/uninstall
// feel snappy without measurable overhead.
let cachedAt = 0;
let cachedOrigins: string[] = [];
const CACHE_TTL_MS = 5_000;

/**
 * Returns the union of frame origins declared by every enabled plugin in
 * the server-side registry, deduped and validated.
 *
 * Returns an empty array on any failure (missing file, parse error, …) so
 * a broken registry only ever shrinks the CSP - never widens it.
 */
export async function getEnabledPluginFrameOrigins(): Promise<string[]> {
  const now = Date.now();
  if (now - cachedAt < CACHE_TTL_MS) return cachedOrigins;

  try {
    const registry = await getPluginRegistry();
    const seen = new Set<string>();
    const out: string[] = [];
    for (const plugin of registry.plugins) {
      if (!plugin.enabled) continue;
      const origins = sanitizeFrameOrigins(plugin.frameOrigins);
      for (const o of origins) {
        const key = o.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(o);
      }
    }
    cachedOrigins = out;
    cachedAt = now;
    return out;
  } catch {
    cachedOrigins = [];
    cachedAt = now;
    return [];
  }
}

/** Force the next call to re-read the registry. Used by install/uninstall. */
export function invalidateFrameOriginsCache(): void {
  cachedAt = 0;
  cachedOrigins = [];
}
