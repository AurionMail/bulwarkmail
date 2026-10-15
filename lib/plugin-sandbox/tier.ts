// Single source of truth for which execution tier a plugin runs in.
//
// The decision is security-critical: granting 'privileged' creates a
// same-origin iframe (full WebCrypto + IndexedDB + access to the host origin),
// so it must NEVER be granted to an unsigned or unapproved bundle. This helper
// is called by BOTH the loader (load gate, before the same-origin iframe is
// created) and the plugin store (enable gate), so the rules live in one place.
//
// A plugin that *requests* privileged but fails any gate is REFUSED (returns
// `{ tier: null, error }`), never silently downgraded — a crypto plugin cannot
// run in a null-origin sandbox, and a silent downgrade would mask tampering.

import type { InstalledPlugin, PluginTier } from '../plugin-types';

export type TierResolution =
  | { tier: PluginTier; error?: undefined }
  | { tier: null; error: string };

/**
 * Resolves the execution tier for a plugin. Returns `{ tier }` on success or
 * `{ tier: null, error }` when a requested tier cannot be granted (the caller
 * should put the plugin into an error state and NOT create an iframe).
 *
 * Privileged tier gates (ALL required):
 *  1. Manifest declares the umbrella high-risk permission `crypto:full`.
 *  2. An admin installed it (`managed`). Admin installs are the operator's
 *     decision, so there is no separate approval or per-user consent step.
 *  3. Its bundle verifies against the signature made at install time; the
 *     download refuses an unsigned or mis-signed privileged bundle.
 */
export function resolvePluginTier(plugin: InstalledPlugin): TierResolution {
  if (plugin.tier !== 'privileged') {
    return { tier: 'untrusted' };
  }

  // 1. Must declare the umbrella high-risk permission.
  if (!plugin.permissions.includes('crypto:full')) {
    return { tier: null, error: 'Privileged tier requires the "crypto:full" permission' };
  }

  // 2. Only an admin can install a privileged plugin. A plugin the user
  // uploaded is never privileged, whatever its manifest claims; installing
  // over an admin plugin's id is refused (see installPlugin). The bundle
  // itself must carry the signature made at admin install time, which the
  // bundle download checks for privileged plugins (downloadManagedBundle).
  if (!plugin.managed) {
    return { tier: null, error: 'Privileged tier requires a signed bundle delivered through the admin channel' };
  }

  return { tier: 'privileged' };
}
