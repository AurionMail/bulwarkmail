import { create } from 'zustand';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { classifyArchiveError } from '@/lib/recovery/archived-items';
import { debug } from '@/lib/debug';

/**
 * Whether "Recover deleted items" works for an account, asked once per
 * session and account with x:ArchivedItem/query. The answer can change
 * while Bulwark stays open (an admin installs the license, or it runs out),
 * so a "no" is asked again after a while.
 */

/** A server that said no (no license, not Stalwart) is asked again after this. */
export const UNSUPPORTED_RETRY_MS = 30 * 60_000;
/** An error that says nothing about the server (offline, a server error) is asked again sooner. */
export const ERROR_RETRY_MS = 2 * 60_000;

export interface RecoveryCheck {
  supported: boolean;
  /** When to ask again; null while supported. */
  retryAt: number | null;
}

interface RecoveryState {
  checks: Record<string, RecoveryCheck>;
  /** Asks the server unless a fresh answer is cached; resolves to whether it works. */
  detect: (client: IJMAPClient, key: string, options?: { force?: boolean }) => Promise<boolean>;
  /** Records what a list or restore call learned, so the page and the Trash link agree. */
  record: (key: string, outcome: 'supported' | 'unsupported' | 'error') => void;
  reset: () => void;
}

const inFlight = new Map<string, Promise<boolean>>();

// Kept for the browser session (the tab), so a reload doesn't ask again.
const STORAGE_KEY = 'bulwark-recovery-checks';

function loadChecks(): Record<string, RecoveryCheck> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, RecoveryCheck> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const check = value as Partial<RecoveryCheck> | null;
      if (check?.supported === true) out[key] = { supported: true, retryAt: null };
      else if (check?.supported === false && typeof check.retryAt === 'number') out[key] = { supported: false, retryAt: check.retryAt };
    }
    return out;
  } catch {
    return {};
  }
}

function saveChecks(checks: Record<string, RecoveryCheck>): void {
  try {
    const kept = Object.fromEntries(Object.entries(checks).filter(([, c]) => c.supported || Number.isFinite(c.retryAt)));
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch { /* private mode, storage full: asked again after a reload */ }
}

function checkFor(outcome: 'supported' | 'unsupported' | 'error', now: number): RecoveryCheck {
  if (outcome === 'supported') return { supported: true, retryAt: null };
  return { supported: false, retryAt: now + (outcome === 'unsupported' ? UNSUPPORTED_RETRY_MS : ERROR_RETRY_MS) };
}

/** The cache key: the signed-in account and the JMAP account in it. */
export function recoveryKey(localAccountId: string | null | undefined, client: IJMAPClient): string {
  return `${localAccountId ?? ''}|${client.getAccountId()}`;
}

export const useRecoveryStore = create<RecoveryState>()((set, get) => ({
  checks: loadChecks(),

  detect: (client, key, options) => {
    const cached = get().checks[key];
    if (!options?.force && cached && (cached.supported || (cached.retryAt ?? 0) > Date.now())) {
      return Promise.resolve(cached.supported);
    }
    if (!client.queryArchivedItemIds || !(client.advertisesArchivedItems?.() ?? false)) {
      // Not Stalwart (or the demo client): nothing will change while it runs.
      set((state) => ({ checks: { ...state.checks, [key]: { supported: false, retryAt: Infinity } } }));
      return Promise.resolve(false);
    }
    const running = inFlight.get(key);
    if (running) return running;
    const probe = client.queryArchivedItemIds()
      .then(() => 'supported' as const)
      .catch((error: unknown) => {
        debug.log('jmap', 'Recover deleted items unavailable:', error);
        return classifyArchiveError(error);
      })
      .then((outcome) => {
        get().record(key, outcome);
        return outcome === 'supported';
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, probe);
    return probe;
  },

  record: (key, outcome) => {
    set((state) => ({ checks: { ...state.checks, [key]: checkFor(outcome, Date.now()) } }));
    saveChecks(get().checks);
  },

  reset: () => {
    inFlight.clear();
    set({ checks: {} });
    saveChecks({});
  },
}));
