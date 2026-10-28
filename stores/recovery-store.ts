import { create } from 'zustand';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { classifyArchiveError } from '@/lib/recovery/archived-items';
import { onFullSignOut } from '@/lib/sign-out-cleanup';
import { debug } from '@/lib/debug';

/**
 * Whether "Recover deleted items" works for an account, asked once per
 * session and account with a one-item x:ArchivedItem/query. The answer can
 * change while Bulwark stays open (an admin installs the license, or it runs
 * out), so a "no" is asked again after a while. Separately, whether the
 * archive holds a recent message, which decides the Trash link.
 */

/** A server that said no (no license, not Stalwart) is asked again after this. */
export const UNSUPPORTED_RETRY_MS = 30 * 60_000;
/** An error that says nothing about the server (offline, a server error) is asked again sooner. */
export const ERROR_RETRY_MS = 2 * 60_000;
/** How long the Trash link trusts its look at the archive. */
export const RECENT_TTL_MS = 5 * 60_000;

export interface RecoveryCheck {
  supported: boolean;
  /** When to ask again; null while supported. */
  retryAt: number | null;
}

export interface RecentCheck {
  has: boolean;
  days: number;
  checkedAt: number;
}

interface RecoveryState {
  checks: Record<string, RecoveryCheck>;
  recent: Record<string, RecentCheck>;
  /** Asks the server unless a fresh answer is cached; resolves to whether it works. */
  detect: (client: IJMAPClient, key: string, options?: { force?: boolean }) => Promise<boolean>;
  /** Records what a list or restore call learned, so the page and the Trash link agree. */
  record: (key: string, outcome: 'supported' | 'unsupported' | 'error') => void;
  /** Whether the archive holds a message inside the days window, for the Trash link. */
  checkRecent: (client: IJMAPClient, key: string, days: number) => Promise<boolean>;
  /** The archive changed (a restore): look again next time. */
  forgetRecent: (key: string) => void;
  reset: () => void;
}

const inFlight = new Map<string, Promise<boolean>>();
const recentInFlight = new Map<string, Promise<boolean>>();

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
    if (Object.keys(kept).length === 0) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
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
  recent: {},

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
    const probe = client.queryArchivedItemIds(undefined, { limit: 1 })
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

  checkRecent: (client, key, days) => {
    const cached = get().recent[key];
    if (cached && cached.days === days && Date.now() - cached.checkedAt < RECENT_TTL_MS) return Promise.resolve(cached.has);
    if (!client.hasArchivedEmail) return Promise.resolve(false);
    const flightKey = `${key}|${days}`;
    const running = recentInFlight.get(flightKey);
    if (running) return running;
    const look = client.hasArchivedEmail(undefined, { days })
      .catch((error: unknown) => {
        if (classifyArchiveError(error) === 'unsupported') get().record(key, 'unsupported');
        return false;
      })
      .then((has) => {
        set((state) => ({ recent: { ...state.recent, [key]: { has, days, checkedAt: Date.now() } } }));
        return has;
      })
      .finally(() => recentInFlight.delete(flightKey));
    recentInFlight.set(flightKey, look);
    return look;
  },

  forgetRecent: (key) => {
    set((state) => {
      const recent = { ...state.recent };
      delete recent[key];
      return { recent };
    });
  },

  reset: () => {
    inFlight.clear();
    recentInFlight.clear();
    set({ checks: {}, recent: {} });
    saveChecks({});
  },
}));

// Nobody signed in any more: forget what the accounts' servers said.
onFullSignOut(() => useRecoveryStore.getState().reset());
