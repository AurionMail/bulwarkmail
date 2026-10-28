/**
 * Why Bulwark signed the user out on its own, for the login page to say.
 * Kept in sessionStorage: the tab that signed out shows it once.
 */

export type SessionEndReason =
  | { kind: 'idle'; minutes: number }
  | { kind: 'max'; hours: number };

const KEY = 'session_end_reason';

export function rememberSessionEnd(reason: SessionEndReason): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(reason));
  } catch {
    /* storage unavailable */
  }
}

/** The reason, once; null when the user wasn't signed out by a session limit. */
export function consumeSessionEnd(): SessionEndReason | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.kind === 'idle' && typeof parsed.minutes === 'number') return { kind: 'idle', minutes: parsed.minutes };
    if (parsed.kind === 'max' && typeof parsed.hours === 'number') return { kind: 'max', hours: parsed.hours };
    return null;
  } catch {
    return null;
  }
}
