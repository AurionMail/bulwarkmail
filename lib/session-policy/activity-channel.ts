/**
 * Activity shared between Bulwark tabs, so working in one tab keeps the
 * others signed in. Tabs tell each other through a BroadcastChannel; where
 * there is none, through `storage` events on a localStorage key. The last
 * activity is also kept in localStorage, so a tab opened (or reloaded) after
 * a long pause starts from it rather than from the page load.
 */

const CHANNEL = 'bulwark-session-activity';
export const LAST_ACTIVITY_KEY = 'bulwark-last-activity';

export interface ActivityChannel {
  /** Tell the other tabs about activity at `at` (ms). */
  post(at: number): void;
  close(): void;
}

function parse(value: unknown): number | null {
  const at = typeof value === 'string' ? Number(value) : value;
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;
}

/** The last activity any tab recorded, or null. */
export function readLastActivity(): number | null {
  try {
    return parse(window.localStorage.getItem(LAST_ACTIVITY_KEY));
  } catch {
    return null;
  }
}

export function openActivityChannel(onActivity: (at: number) => void): ActivityChannel {
  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (event: MessageEvent) => {
        const at = parse((event.data as { at?: unknown } | null)?.at);
        if (at) onActivity(at);
      };
    } catch {
      channel = null;
    }
  }

  // Without a channel, the localStorage write below reaches the other tabs as a storage event.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LAST_ACTIVITY_KEY) return;
    const at = parse(event.newValue);
    if (at) onActivity(at);
  };
  if (!channel) window.addEventListener('storage', onStorage);

  return {
    post(at) {
      try {
        window.localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
      } catch {
        /* storage unavailable */
      }
      try {
        channel?.postMessage({ at });
      } catch {
        /* channel closed */
      }
    },
    close() {
      channel?.close();
      if (!channel) window.removeEventListener('storage', onStorage);
    },
  };
}
