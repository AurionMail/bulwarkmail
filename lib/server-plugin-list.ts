// GET /api/plugins, shared by the plugin store and the theme store.
//
// Both sync from the same list when the app starts, and each used to fetch
// it: two copies of a response that carries every plugin's translations
// (hundreds of kB compressed) on every page load. Calls that overlap share
// one request; a later call (after signing in, say) fetches again.

import { apiFetch } from '@/lib/browser-navigation';

export interface ServerPluginListResult {
  ok: boolean;
  status: number;
  /** The parsed body when `ok`, otherwise null. */
  data: unknown;
}

let inFlight: Promise<ServerPluginListResult> | null = null;

export function fetchServerPluginList(): Promise<ServerPluginListResult> {
  if (!inFlight) {
    inFlight = (async () => {
      const res = await apiFetch('/api/plugins');
      return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
    })().finally(() => { inFlight = null; });
  }
  return inFlight;
}
