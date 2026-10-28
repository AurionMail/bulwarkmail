/**
 * Names of the people and groups the user gave access to, kept in this
 * browser. Stalwart 1.0 with directory queries off (its default) won't name
 * a principal the user shares with unless that principal also shares
 * something back, so the "Who has access" list would otherwise show bare
 * ids for the very people the user just picked by name. Per account, at
 * most MAX entries, and only a convenience: losing it costs names, not
 * access.
 */

import type { Principal } from '@/lib/jmap/types';

const STORAGE_KEY = 'bulwark-delegate-names';
const MAX = 200;

type Entry = Pick<Principal, 'id' | 'name' | 'email' | 'type'>;
type Store = Record<string, Record<string, Entry>>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

/** Remember these principals for `accountKey` (the signed-in account). */
export function rememberPrincipals(accountKey: string, principals: Principal[]): void {
  if (!accountKey || principals.length === 0) return;
  try {
    const store = readStore();
    const own = { ...(store[accountKey] ?? {}) };
    for (const p of principals) {
      delete own[p.id];
      own[p.id] = { id: p.id, name: p.name, email: p.email ?? null, type: p.type };
    }
    const ids = Object.keys(own);
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX))) delete own[id];
    store[accountKey] = own;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private window or storage full: the list shows ids instead.
  }
}

/** The principals remembered for `accountKey`, by id. */
export function rememberedPrincipals(accountKey: string): Map<string, Principal> {
  const own = readStore()[accountKey] ?? {};
  return new Map(Object.values(own).map((entry) => [entry.id, entry as Principal]));
}
