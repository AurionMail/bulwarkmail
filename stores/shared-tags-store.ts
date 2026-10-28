/**
 * The shared tags of each group account a signed-in login reaches
 * (lib/shared-tags.ts): loaded the first time something on screen shows a
 * message or the sidebar of that account, kept per login and account, and
 * read again when the group's mailboxes change (push) or the tab comes back
 * after a while.
 *
 * Why push and not polling: Stalwart bumps the Mailbox state of the group
 * account when its Inbox metadata changes, and every member's push channel
 * reports state changes of the accounts it can reach. So another member's
 * edit arrives as a Mailbox change for the group account, which costs
 * nothing extra to watch. Push can be off or broken (no EventSource, a
 * proxy that buffers it), so a tab that comes back to the foreground also
 * reads definitions older than two minutes again.
 *
 * Status per account:
 * - `personal`: not a group principal (a mailbox a person shared); it keeps
 *   the user's own tags.
 * - `unsupported`: a group, but the server keeps no metadata (0.16) or the
 *   request failed (the 1.0 test build drops it); the group keeps the user's
 *   own tags, as before, and the shared definitions can't be edited.
 * - `ready`: the shared definitions, plus the tags found on recent messages.
 */

import { create } from 'zustand';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { MetadataUnsupportedError } from '@/lib/jmap/bulwark-metadata';
import { tagIdFromKeyword } from '@/lib/keyword-discovery';
import { SHARED_TAGS_KEY, parseSharedTags, sharedTagsValue } from '@/lib/shared-tags';
import { subscribePushStateChanges } from '@/lib/push-events';
import type { KeywordDefinition } from '@/stores/settings-store';

export type SharedTagsStatus = 'loading' | 'personal' | 'unsupported' | 'ready';

export interface SharedTagsEntry {
  status: SharedTagsStatus;
  /** The shared definitions (status `ready` only). */
  tags: KeywordDefinition[];
  /** Tag keywords found on the account's recent messages, with counts. */
  discovered: Record<string, number>;
  loadedAt: number;
}

export type SharedTagsClient = Pick<IJMAPClient, 'getAccountInfo' | 'discoverKeywords'>
  & Partial<Pick<IJMAPClient, 'getPrincipalTypes' | 'supportsBulwarkMetadata' | 'getBulwarkMetadata' | 'setBulwarkMetadata'>>;

/** Messages scanned for tags nobody defined: one request's worth. */
export const DISCOVERY_SCAN_LIMIT = 500;
/** A tab that comes back reads definitions older than this again. */
export const STALE_AFTER_MS = 2 * 60_000;

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
let unsubscribePush: (() => void) | null = null;
let visibilityBound = false;

function setEntry(key: string, patch: Partial<SharedTagsEntry>): void {
  useSharedTagsStore.setState((state) => {
    const previous = state.entries[key] ?? { status: 'loading' as const, tags: [], discovered: {}, loadedAt: 0 };
    return { entries: { ...state.entries, [key]: { ...previous, ...patch } } };
  });
}

/** Whether the account is a group principal (policySubjectForClient's rule). */
async function isGroupAccount(client: SharedTagsClient, accountId: string): Promise<boolean> {
  const types = typeof client.getPrincipalTypes === 'function'
    ? await client.getPrincipalTypes([accountId]).catch(() => null)
    : null;
  if (types) return types[accountId] === 'group';
  // The server won't say: every non-personal account counts.
  return client.getAccountInfo?.(accountId)?.isPersonal === false;
}

async function discover(key: string, client: SharedTagsClient, accountId: string): Promise<void> {
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

async function read(key: string, client: SharedTagsClient, accountId: string, withDiscovery: boolean): Promise<void> {
  const known = useSharedTagsStore.getState().entries[key];
  const isGroup = known && known.status !== 'loading' && known.status !== 'personal'
    ? true
    : known?.status === 'personal'
      ? false
      : await isGroupAccount(client, accountId);
  if (clients.get(key) !== client) return;
  if (!isGroup) {
    setEntry(key, { status: 'personal', tags: [], loadedAt: Date.now() });
    return;
  }
  // Checked first: 0.16 has no metadata and gets no request at all.
  if (typeof client.supportsBulwarkMetadata !== 'function' || !client.supportsBulwarkMetadata(accountId) || typeof client.getBulwarkMetadata !== 'function') {
    setEntry(key, { status: 'unsupported', tags: [], loadedAt: Date.now() });
    return;
  }
  // getBulwarkMetadata sends its request on its own and answers null on any
  // failure, a dropped connection included, so nothing here can mark the
  // login offline or take other calls down with it.
  const metadata = await client.getBulwarkMetadata(accountId);
  if (clients.get(key) !== client) return;
  if (!metadata) {
    setEntry(key, { status: 'unsupported', tags: [], loadedAt: Date.now() });
    return;
  }
  setEntry(key, { status: 'ready', tags: parseSharedTags(metadata[SHARED_TAGS_KEY]), loadedAt: Date.now() });
  if (withDiscovery) await discover(key, client, accountId);
}

function startWatching(): void {
  if (!unsubscribePush) {
    unsubscribePush = subscribePushStateChanges((change, client) => {
      for (const [key, known] of clients) {
        if (known !== (client as unknown as SharedTagsClient)) continue;
        const accountId = accountIds.get(key);
        if (!accountId || !change.changed[accountId]?.Mailbox) continue;
        if (useSharedTagsStore.getState().entries[key]?.status !== 'ready') continue;
        void loadSharedTags(key, accountId, known, { force: true });
      }
    });
  }
  if (!visibilityBound && typeof document !== 'undefined') {
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      for (const [key, entry] of Object.entries(useSharedTagsStore.getState().entries)) {
        const client = clients.get(key);
        const accountId = accountIds.get(key);
        if (!client || !accountId || entry.status !== 'ready' || now - entry.loadedAt < STALE_AFTER_MS) continue;
        void loadSharedTags(key, accountId, client, { force: true, discover: true });
      }
    });
  }
}

/**
 * Loads an account's shared tags once per client; `force` reads them again
 * (and `discover` scans the recent messages again too).
 */
export function loadSharedTags(
  key: string,
  accountId: string,
  client: SharedTagsClient,
  options: { force?: boolean; discover?: boolean } = {},
): Promise<void> {
  const running = inflight.get(key);
  if (running && clients.get(key) === client) return running;
  const sameClient = clients.get(key) === client;
  if (sameClient && !options.force && useSharedTagsStore.getState().entries[key]) return Promise.resolve();
  if (!sameClient) {
    // Another sign-in of this login: nothing of the old one carries over.
    useSharedTagsStore.setState((state) => {
      const entries = { ...state.entries };
      delete entries[key];
      return { entries };
    });
  }
  clients.set(key, client);
  accountIds.set(key, accountId);
  startWatching();
  if (!useSharedTagsStore.getState().entries[key]) setEntry(key, { status: 'loading' });
  const run = read(key, client, accountId, !sameClient || !!options.discover)
    .catch(() => {
      if (clients.get(key) === client && useSharedTagsStore.getState().entries[key]?.status === 'loading') {
        setEntry(key, { status: 'unsupported', loadedAt: Date.now() });
      }
    })
    .finally(() => {
      if (inflight.get(key) === run) inflight.delete(key);
    });
  inflight.set(key, run);
  return run;
}

/**
 * Changes the shared definitions of an account: reads the newest ones from
 * the server first, so two members editing at once don't undo each other's
 * other tags, applies `change`, and writes the result back. Throws
 * MetadataTooLargeError when the list no longer fits, MetadataUnsupportedError
 * when the account has no metadata.
 */
export async function saveSharedTags(
  key: string,
  accountId: string,
  client: SharedTagsClient,
  change: (current: KeywordDefinition[]) => KeywordDefinition[],
): Promise<KeywordDefinition[]> {
  if (typeof client.getBulwarkMetadata !== 'function' || typeof client.setBulwarkMetadata !== 'function') {
    throw new MetadataUnsupportedError();
  }
  const metadata = await client.getBulwarkMetadata(accountId);
  if (!metadata) throw new MetadataUnsupportedError();
  const value = sharedTagsValue(change(parseSharedTags(metadata[SHARED_TAGS_KEY])));
  await client.setBulwarkMetadata(accountId, SHARED_TAGS_KEY, value);
  clients.set(key, client);
  accountIds.set(key, accountId);
  setEntry(key, { status: 'ready', tags: value.list, loadedAt: Date.now() });
  return value.list;
}

/** For tests: forget every account. */
export function resetSharedTags(): void {
  clients.clear();
  inflight.clear();
  accountIds.clear();
  unsubscribePush?.();
  unsubscribePush = null;
  useSharedTagsStore.setState({ entries: {} });
}
