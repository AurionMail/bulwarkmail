/**
 * `policy.defaults` (#1248): the values users start with for settings they
 * have not chosen themselves. policy.json is written by hand and the server
 * does not know the client's settings, so only the shape is checked here: a
 * plain object of plain values (boolean, finite number, string). The client
 * checks each key and value against its own settings before applying it
 * (adminPolicyPatch in stores/settings-store.ts).
 */
export function sanitizePolicyDefaults(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (
      typeof value === 'boolean' ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      out[key] = value;
    }
  }
  return out;
}
