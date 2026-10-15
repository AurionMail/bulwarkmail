'use client';

/**
 * Bridges third-party OAuth callbacks to plugins.
 *
 * The generic callback page (`/[locale]/plugins/oauth/callback`) parks the
 * provider's `{ code, state }` payload in localStorage. A `storage` event
 * fires in every OTHER same-origin tab - i.e. in the tab where the plugin's
 * background sandbox instance is actually running. This listener forwards
 * those payloads (and same-tab CustomEvents from the callback page) into the
 * `authHooks.onOAuthCallback` hook bus so plugins can finish their PKCE
 * exchange.
 *
 * This component intentionally does nothing when mounted ON the callback
 * route: the callback tab must not process its own payload, otherwise two
 * app instances would race to exchange the single-use authorization code.
 */

import { authHooks } from '@/lib/plugin-hooks';
import {
  PLUGIN_OAUTH_EVENT as EVENT_NAME,
  PLUGIN_OAUTH_STORAGE_KEY as STORAGE_KEY,
  takeOAuthStateOwner,
  type OAuthCallbackPayload,
} from '@/lib/plugin-oauth';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Window in which identical payloads are treated as duplicates. */
const DEDUP_MS = 60_000;

function parsePayload(raw: string | null | undefined): OAuthCallbackPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const state = typeof parsed.state === 'string' ? parsed.state : undefined;
    // A payload without `state` cannot be matched to any pending flow, so
    // drop it instead of broadcasting an unmatchable event.
    if (state === undefined) {
      return null;
    }
    const receivedAt = typeof parsed.receivedAt === 'number' ? parsed.receivedAt : Date.now();
    // Success payloads carry { code, ... }; error/denial payloads carry
    // { error, ... }. Exactly one must identify the kind.
    if (typeof parsed.code === 'string') {
      return { code: parsed.code, state, receivedAt };
    }
    if (typeof parsed.error === 'string') {
      return {
        error: parsed.error,
        state,
        error_description:
          typeof parsed.error_description === 'string' ? parsed.error_description : undefined,
        receivedAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function PluginOAuthCallbackListener() {
  const pathname = usePathname();
  // The callback route ends with /plugins/oauth/callback (locale is a
  // preceding segment). On that route this component is a no-op.
  const isCallbackRoute = !!pathname && pathname.endsWith('/plugins/oauth/callback');

  useEffect(() => {
    if (isCallbackRoute) return;

    let lastCode: string | null = null;
    let lastState: string | null = null;
    let lastAt = 0;

    const deliver = (payload: OAuthCallbackPayload | null) => {
      if (!payload) return;
      const now = Date.now();
      const code = 'code' in payload ? payload.code : null;
      if (code === lastCode && payload.state === lastState && now - lastAt < DEDUP_MS) return;
      lastCode = code;
      lastState = payload.state ?? null;
      lastAt = now;
      // Only the plugin that created this state gets the code.
      const pluginId = takeOAuthStateOwner(payload.state);
      if (pluginId) {
        void authHooks.onOAuthCallback.emitTo(pluginId, payload);
      } else {
        console.warn('[plugin-oauth] callback with a state no plugin asked for; ignored');
      }
      // Best-effort cleanup so a reload doesn't replay an old payload.
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    };

    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== STORAGE_KEY && ev.key !== null) return;
      deliver(parsePayload(ev.newValue ?? (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })()));
    };
    const onCustomEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<OAuthCallbackPayload>).detail;
      if (detail) deliver(detail);
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT_NAME, onCustomEvent);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT_NAME, onCustomEvent);
    };
  }, [isCallbackRoute]);

  return null;
}
