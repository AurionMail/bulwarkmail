/**
 * The shared tags of each group account a signed-in login reaches
 * (lib/shared-tags.ts): loaded the first time something on screen shows a
 * message or the sidebar of that account, kept per login and account.
 *
 * Refreshing: Stalwart bumps the Mailbox state of the group account when
 * its Inbox metadata changes, and every member's push channel reports the
 * state changes of the accounts it reaches. So another member's edit
 * arrives as a Mailbox change of the group account; reloads are debounced
 * per account (5 s, a Mailbox change also comes with new mail) and the push
 * of our own save is recognised by its state and skipped. Push can be off,
 * so a tab that comes back reads definitions older than two minutes again.
 * The scan for tags nobody named runs once per sign-in and then at most
 * every 30 minutes.
 *
 * Status per account:
 * - `loading`: not known yet, or the server wouldn't say whether the
 *   account is a group (asked again later; never guessed, since members
 *   write here). The user's own tags show meanwhile.
 * - `personal`: not a group principal (a mailbox a person shared).
 * - `unsupported`: a group, but the server advertises no metadata (0.16).
 * - `unavailable`: a group whose metadata couldn't be read yet (the 1.0
 *   test build drops the request). Read again after the client's pause.
 * - `ready`: the shared definitions. A later failed read keeps them.
 */

import { create } from 'zustand';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { MetadataPatchError, MetadataTooLargeError, MetadataUnsupportedError } from '@/lib/jmap/bulwark-metadata';
import { tagIdFromKeyword } from '@/lib/keyword-discovery';
import {
  EMPTY_SHARED_TAGS,
  SHARED_TAGS_KEY,
  applySharedTagChanges,
  planSharedTagsSave,
  readSharedTags,
  sharedDefinitions,
  type SharedTagChange,
  type StoredSharedTags,
} from '@/lib/shared-tags';
import { subscribePushStateChanges } from '@/lib/push-events';
import type { KeywordDefinition } from '@/stores/settings-store';

export type SharedTagsStatus = 'loading' | 'personal' | 'unsupported' | 'unavailable' | 'ready';

export interface SharedTagsEntry {
  status: SharedTagsStatus;
  /** The shared definitions with unsaved changes applied (status `ready`). */
  tags: KeywordDefinition[];
  /** What the server holds, as last read or written. */
  stored: StoredSharedTags | null;
  /** Changes a failed save left; sent again with the next good read. */
  pending: SharedTagChange[];
  /** Tag keywords found on the account's recent messages, with counts. */
  discovered: Record<string, number>;
  loadedAt: number;
  discoveredAt: number;
  /** When the last read failed; null after a good one. */
  readFailedAt: number | null;
}

export type SharedTagsClient = Pick<IJMAPClient, 'discoverKeywords'>
  & Partial<Pick<IJMAPClient, 'getPrincipalTypes' | 'supportsBulwarkMetadata' | 'advertisesBulwarkMetadata' | 'getBulwarkMetadata' | 'patchBulwarkMetadata'>>;

/** Messages scanned for tags nobody named: one request's worth. */
export const DISCOVERY_SCAN_LIMIT = 500;
/** A tab that comes back reads definitions older than this again. */
export const STALE_AFTER_MS = 2 * 60_000;
/** The scan for unnamed tags runs again after this, at the earliest. */
export const DISCOVERY_INTERVAL_MS = 30 * 60_000;
/** Push-triggered reloads of one account wait this long for quiet. */
export const PUSH_DEBOUNCE_MS = 5_000;
/** First retry when the server wouldn't say whether an account is a group. */
export const GROUP_CHECK_RETRY_MS = 30_000;

/** A save that didn't reach the server; its changes are kept and sent again. */
export class SharedTagsSaveDeferredError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The shared tags could not be saved');
    this.name = 'SharedTagsSaveDeferredError';
  }
}

interface SharedTagsState {
  entries: Record<string, SharedTagsEntry>;
}

export const useSharedTagsStore = create<SharedTagsState>()(() => ({ entries: {} }));

export function sharedTagsKey(loginId: string, accountId: string): string {
  return `${loginId}|${accountId}`;
}

const clients = new Map<string, SharedTagsClient>();
const inflight = new Map<string, Promise<void>>();
const accountIds = new Map<string, string>();
const groupConfirmed = new Set<string>();
const ownStates = new Map<string, Set<string>>();
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; delay: number }>();
let unsubscribePush: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

const NEW_ENTRY: SharedTagsEntry = {
  status: 'loading', tags: [], stored: null, pending: [], discovered: {}, loadedAt: 0, discoveredAt: 0, readFailedAt: null,
};

const entryOf = (key: string): SharedTagsEntry | undefined => useSharedTagsStore.getState().entries[key];

function setEntry(key: string, patch: Partial<SharedTagsEntry>): void {
  useSharedTagsStore.setState((state) => {
    const previous = state.entries[key] ?? NEW_ENTRY;
    const next = { ...previous, ...patch };
    if (next.stored) next.tags = sharedDefinitions(applySharedTagChanges(next.stored, next.pending));
    return { entries: { ...state.entries, [key]: next } };
  });
}

/** Whether the client's metadata pause is over for the account. */
const mayAskMetadata = (client: SharedTagsClient, accountId: string) =>
  typeof client.supportsBulwarkMetadata === 'function' && client.supportsBulwarkMetadata(accountId);

function scheduleGroupRetry(key: string): void {
  const previous = retryTimers.get(key);
  if (previous) clearTimeout(previous.timer);
  const delay = previous ? Math.min(previous.delay * 2, 10 * 60_000) : GROUP_CHECK_RETRY_MS;
  const timer = setTimeout(() => {
    const client = clients.get(key);
    const accountId = accountIds.get(key);
    if (client && accountId && entryOf(key)?.status === 'loading') void loadSharedTags(key, accountId, client, { force: true });
  }, delay);
  retryTimers.set(key, { timer, delay });
}

async function discover(key: string, client: SharedTagsClient, accountId: string): Promise<void> {
  setEntry(key, { discoveredAt: Date.now() });
  try {
    const scan = await client.discoverKeywords({ accountId, limit: DISCOVERY_SCAN_LIMIT });
    if (clients.get(key) !== client) return;
    const tags: Record<string, number> = {};
    for (const [keyword, count] of Object.entries(scan.keywords)) {
      if (tagIdFromKeyword(keyword)) tags[keyword] = count;
    }
    setEntry(key, { discovered: tags });
  } catch {
    // The tags on the messages still show on the messages themselves.
  }
}

async function read(key: string, client: SharedTagsClient, accountId: string): Promise<void> {
  if (!groupConfirmed.has(key)) {
    if (typeof client.getPrincipalTypes !== 'function') {
      // No way to confirm a group: nothing shared is written for it.
      setEntry(key, { status: 'personal', loadedAt: Date.now() });
      return;
    }
    const types = await client.getPrincipalTypes([accountId]).catch(() => null);
    if (clients.get(key) !== client) return;
    if (!types) {
      // Never guess: stay on the user's own tags and ask again later.
      scheduleGroupRetry(key);
      return;
    }
    const retry = retryTimers.get(key);
    if (retry) clearTimeout(retry.timer);
    retryTimers.delete(key);
    if (types[accountId] !== 'group') {
      setEntry(key, { status: 'personal', loadedAt: Date.now() });
      return;
    }
    groupConfirmed.add(key);
  }

  const advertised = typeof client.advertisesBulwarkMetadata === 'function'
    ? client.advertisesBulwarkMetadata(accountId)
    : mayAskMetadata(client, accountId);
  if (!advertised || typeof client.getBulwarkMetadata !== 'function') {
    // 0.16: no request at all.
    setEntry(key, { status: 'unsupported', loadedAt: Date.now() });
    return;
  }

  // getBulwarkMetadata sends its request on its own and answers null on any
  // failure, a dropped connection included; it then pauses the account.
  const metadata = mayAskMetadata(client, accountId) ? await client.getBulwarkMetadata(accountId) : null;
  if (clients.get(key) !== client) return;
  if (!metadata) {
    // A failed read keeps the last good tags.
    setEntry(key, { status: entryOf(key)?.status === 'ready' ? 'ready' : 'unavailable', readFailedAt: Date.now() });
    return;
  }
  setEntry(key, { status: 'ready', stored: readSharedTags(metadata[SHARED_TAGS_KEY]), loadedAt: Date.now(), readFailedAt: null });

  if ((entryOf(key)?.pending ?? []).length > 0) {
    await writeChanges(key, accountId, client, []).catch(() => {});
  }
  const discoveredAt = entryOf(key)?.discoveredAt ?? 0;
  if (!discoveredAt || Date.now() - discoveredAt >= DISCOVERY_INTERVAL_MS) await discover(key, client, accountId);
}

function startWatching(): void {
  if (!unsubscribePush) {
    unsubscribePush = subscribePushStateChanges((change, client) => {
      for (const [key, known] of clients) {
        if (known !== (client as unknown as SharedTagsClient)) continue;
        const accountId = accountIds.get(key);
        const state = accountId ? change.changed[accountId]?.Mailbox : undefined;
        if (!accountId || !state) continue;
        // The push of our own save.
        if (ownStates.get(key)?.delete(state)) continue;
        const status = entryOf(key)?.status;
        if (status !== 'ready' && status !== 'unavailable') continue;
        const waiting = pushTimers.get(key);
        if (waiting) clearTimeout(waiting);
        pushTimers.set(key, setTimeout(() => {
          pushTimers.delete(key);
          if (mayAskMetadata(known, accountId)) void loadSharedTags(key, accountId, known, { force: true });
        }, PUSH_DEBOUNCE_MS));
      }
    });
  }
  if (!visibilityHandler && typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      for (const [key, entry] of Object.entries(useSharedTagsStore.getState().entries)) {
        const client = clients.get(key);
        const accountId = accountIds.get(key);
        if (!client || !accountId) continue;
        const failed = entry.status === 'unavailable' || entry.readFailedAt !== null || entry.pending.length > 0;
        const due = entry.status === 'loading'
          || (failed && mayAskMetadata(client, accountId))
          || (entry.status === 'ready' && now - entry.loadedAt >= STALE_AFTER_MS);
        if (due) void loadSharedTags(key, accountId, client, { force: true });
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
}

/**
 * Loads an account's shared tags once per client; `force` reads the
 * definitions again. The scan for unnamed tags runs with the first load of
 * a sign-in and then at most every 30 minutes.
 */
export function loadSharedTags(
  key: string,
  accountId: string,
  client: SharedTagsClient,
  options: { force?: boolean } = {},
): Promise<void> {
  const running = inflight.get(key);
  if (running && clients.get(key) === client) return running;
  const sameClient = clients.get(key) === client;
  if (sameClient && !options.force && entryOf(key)) return Promise.resolve();
  if (!sameClient) {
    // Another sign-in of this login: nothing of the old one carries over.
    groupConfirmed.delete(key);
    ownStates.delete(key);
    useSharedTagsStore.setState((state) => {
      const entries = { ...state.entries };
      delete entries[key];
      return { entries };
    });
  }
  clients.set(key, client);
  accountIds.set(key, accountId);
  startWatching();
  if (!entryOf(key)) setEntry(key, {});
  const run = read(key, client, accountId)
    .catch(() => {
      if (clients.get(key) === client) setEntry(key, { readFailedAt: Date.now() });
    })
    .finally(() => {
      if (inflight.get(key) === run) inflight.delete(key);
    });
  inflight.set(key, run);
  return run;
}

/** Sends the pending changes plus `changes`; the stored tags follow. */
async function writeChanges(
  key: string,
  accountId: string,
  client: SharedTagsClient,
  changes: SharedTagChange[],
): Promise<void> {
  const entry = entryOf(key);
  const all = [...(entry?.pending ?? []), ...changes];
  let stored = entry?.stored ?? EMPTY_SHARED_TAGS;
  // Throws MetadataTooLargeError before anything is sent; nothing is kept then.
  planSharedTagsSave(stored, all);
  try {
    if (typeof client.patchBulwarkMetadata !== 'function' || typeof client.getBulwarkMetadata !== 'function') {
      throw new MetadataUnsupportedError();
    }
    // With nothing stored, patch first anyway: another member may have just
    // created the namespace, and writing it whole would drop their tag.
    const nothingStored = !stored.patchable && Object.keys(stored.entries).length === 0 && Object.keys(stored.extra).length === 0;
    if (nothingStored) stored = { ...stored, patchable: true };
    for (let attempt = 0; ; attempt++) {
      const plan = planSharedTagsSave(stored, all);
      try {
        const { newState } = await client.patchBulwarkMetadata(accountId, SHARED_TAGS_KEY, plan.patches);
        if (newState) {
          const own = ownStates.get(key) ?? new Set<string>();
          own.add(newState);
          ownStates.set(key, own);
        }
        setEntry(key, { status: 'ready', stored: plan.result, pending: [] });
        return;
      } catch (error) {
        if (!(error instanceof MetadataPatchError) || attempt > 0) throw error;
        // Not (or no longer) the map shape: read it, convert it, write it whole.
        const metadata = await client.getBulwarkMetadata(accountId);
        if (!metadata) throw new MetadataUnsupportedError();
        stored = readSharedTags(metadata[SHARED_TAGS_KEY]);
      }
    }
  } catch (error) {
    if (error instanceof MetadataTooLargeError) throw error;
    // Kept, shown, and sent again with the next good read.
    setEntry(key, { pending: all });
    throw new SharedTagsSaveDeferredError(error);
  }
}

/**
 * Changes the shared definitions of an account, one patch per changed tag,
 * so the other tags (and what other members change meanwhile) stay as they
 * are. Throws MetadataTooLargeError when the list no longer fits (nothing
 * kept), SharedTagsSaveDeferredError when the server didn't take it (the
 * change is kept, shown and sent again with the next good read).
 */
export async function saveSharedTags(
  key: string,
  accountId: string,
  client: SharedTagsClient,
  changes: SharedTagChange[],
): Promise<void> {
  clients.set(key, client);
  accountIds.set(key, accountId);
  startWatching();
  await writeChanges(key, accountId, client, changes);
}

/** For tests: forget every account. */
export function resetSharedTags(): void {
  clients.clear();
  inflight.clear();
  accountIds.clear();
  groupConfirmed.clear();
  ownStates.clear();
  for (const timer of pushTimers.values()) clearTimeout(timer);
  pushTimers.clear();
  for (const { timer } of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  unsubscribePush?.();
  unsubscribePush = null;
  if (visibilityHandler && typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
  useSharedTagsStore.setState({ entries: {} });
}
