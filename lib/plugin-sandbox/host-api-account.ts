// Host side of what a plugin may know about the signed-in user and the mail
// accounts they reach (permission account:read): their own account and
// address, which accounts are team (group) mailboxes, and people from the
// server's directory. And a small piece of shared data a plugin may keep in a
// mail account (api.accountData, Stalwart 1.0 metadata).
//
// Stalwart uses the account id as the principal id, so the user's own
// account id names them in the directory and in keywords other members see.

import type { IJMAPClient } from '../jmap/client-interface';
import type { InstalledPlugin } from '../plugin-types';
import { useAccountStore } from '@/stores/account-store';
import { useIdentityStore } from '@/stores/identity-store';
import { resolveEmailBlobContext } from '@/stores/email-store';
import { isValidMetadataKey, MAX_METADATA_ENTRY_BYTES, MetadataTooLargeError, metadataValueBytes } from '../jmap/bulwark-metadata';
import { mailAccountKind, type MailAccountKind } from './account-kind';
import { readObject, readString, sessionClient, withinRate } from './host-api-input';

export interface PluginSelfView {
  /** The user's own JMAP account id, which Stalwart also uses as their principal id. */
  accountId: string;
  /** The address the user signed in with. */
  email: string;
  /** Their name: the account's display name, else their first identity's, else the address. */
  name: string;
}

export interface PluginMailAccountView {
  accountId: string;
  /** The account's name; for a group account the group's address. */
  name: string;
  kind: MailAccountKind;
  isReadOnly: boolean;
  /** The open folder belongs to this account. */
  isOpen: boolean;
}

export interface PluginPersonView {
  id: string;
  /** "individual", "group", or what else the server says. */
  type: string;
  name: string;
  email: string;
}

export function doUserGetSelf(): PluginSelfView {
  const client = sessionClient('user.getSelf');
  const email = client.getUsername?.() ?? '';
  const accountId = client.getAccountId();
  const { accounts, activeAccountId } = useAccountStore.getState();
  const active = accounts.find((a) => a.id === activeAccountId);
  const identity = useIdentityStore.getState().identities.find((i) => i.name);
  return {
    accountId,
    email,
    name: active?.displayName?.trim() || identity?.name?.trim() || email,
  };
}

export function doUserGetMailAccounts(): PluginMailAccountView[] {
  const client = sessionClient('user.getMailAccounts');
  const own = client.getAccountId();
  const open = resolveEmailBlobContext({}, client);
  const openId = open.client === client ? open.accountId || own : null;
  const shared = typeof client.getSharedAccounts === 'function' ? client.getSharedAccounts() : [];
  const ids = shared.length > 0 ? shared.filter((a) => a.isPrimary || a.capabilities.mail).map((a) => a.id) : [own];
  if (!ids.includes(own)) ids.unshift(own);
  return ids.map((accountId) => {
    const info = client.getAccountInfo?.(accountId);
    return {
      accountId,
      name: info?.name || (accountId === own ? client.getUsername?.() ?? '' : accountId),
      kind: mailAccountKind(client, accountId),
      isReadOnly: info?.isReadOnly === true,
      isOpen: accountId === openId,
    };
  });
}

// ─── Directory ────────────────────────────────────────────────

/** Most people one user.findPeople call returns. */
export const MAX_PLUGIN_PEOPLE = 20;
const DIRECTORY_TTL_MS = 5 * 60_000;

interface DirectoryCache {
  client: IJMAPClient;
  at: number;
  complete: boolean;
  people: PluginPersonView[];
}

let directory: DirectoryCache | null = null;
let directoryLoad: Promise<DirectoryCache> | null = null;

async function loadDirectory(client: IJMAPClient): Promise<DirectoryCache> {
  if (directory && directory.client === client && Date.now() - directory.at < DIRECTORY_TTL_MS) return directory;
  if (directoryLoad) return directoryLoad;
  directoryLoad = (async () => {
    let complete = false;
    let principals: Array<{ id: string; type?: string; name?: string; description?: string | null; email?: string | null }> = [];
    if (client.supportsPrincipals()) {
      if (typeof client.listPrincipals === 'function') {
        const listing = await client.listPrincipals();
        complete = listing.status === 'ok';
        principals = listing.principals;
      } else {
        principals = await client.getPrincipals();
        complete = true;
      }
    }
    const people = principals.map((p) => ({
      id: p.id,
      type: typeof p.type === 'string' ? p.type : 'individual',
      name: (p.description || p.name || p.email || p.id).trim(),
      email: (p.email || (p.name?.includes('@') ? p.name : '') || '').trim().toLowerCase(),
    }));
    directory = { client, at: Date.now(), complete, people };
    return directory;
  })().finally(() => { directoryLoad = null; });
  return directoryLoad;
}

/**
 * People from the server's directory: by principal id (`ids`), or whose
 * name or address contains `text`. `complete` is false when the
 * administrator turned directory lookups off: then only the people the user
 * already shares an account with (their own and their groups) are known.
 */
export async function doUserFindPeople(plugin: InstalledPlugin, query: unknown): Promise<{ people: PluginPersonView[]; complete: boolean }> {
  const method = 'user.findPeople';
  const opts = readObject(query, method, 'query', ['text', 'ids']);
  const client = sessionClient(method);
  if (!withinRate('directory', plugin.id, 30)) throw new Error(`${method}: too many lookups, try again in a minute`);
  let ids: Set<string> | null = null;
  if (opts.ids !== undefined) {
    if (!Array.isArray(opts.ids) || opts.ids.length > 100 || !opts.ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256)) {
      throw new Error(`${method}: ids must be a list of up to 100 ids`);
    }
    ids = new Set(opts.ids as string[]);
  }
  const text = opts.text === undefined ? '' : readString(opts.text, method, 'text', 200, { trim: true }).toLowerCase();
  if (!ids && !text) throw new Error(`${method}: give text or ids`);
  const { people, complete } = await loadDirectory(client);
  const found = people.filter((p) => (!ids || ids.has(p.id))
    && (!text || p.name.toLowerCase().includes(text) || p.email.includes(text)));
  return { people: found.slice(0, MAX_PLUGIN_PEOPLE), complete };
}

/** Test helper. */
export function resetPluginDirectory(): void {
  directory = null;
  directoryLoad = null;
}

// ─── Shared data in a mail account ────────────────────────────

/** The metadata key a plugin's data lives under: org.bulwarkmail.plugin.<id>. */
export function pluginDataKey(pluginId: string): string | null {
  const key = `plugin.${pluginId.toLowerCase()}`;
  return isValidMetadataKey(key) ? key : null;
}

function dataAccount(method: string, accountArg: unknown): { client: IJMAPClient; accountId: string } {
  const client = sessionClient(method);
  if (accountArg === undefined) return { client, accountId: client.getAccountId() };
  const accountId = readString(accountArg, method, 'accountId', 256, { min: 1 });
  const known = doUserGetMailAccounts().some((a) => a.accountId === accountId);
  if (!known) throw new Error(`${method}: no mail account "${accountId}"`);
  return { client, accountId };
}

/**
 * The plugin's value in the account's shared Inbox metadata. `supported` is
 * false on servers without metadata (Stalwart before 1.0); the value is then
 * null.
 */
export async function doAccountDataGet(plugin: InstalledPlugin, accountArg: unknown): Promise<{ supported: boolean; value: unknown }> {
  const method = 'accountData.get';
  const { client, accountId } = dataAccount(method, accountArg);
  const key = pluginDataKey(plugin.id);
  if (!key || typeof client.getBulwarkMetadata !== 'function' || !client.supportsBulwarkMetadata?.(accountId)) {
    return { supported: false, value: null };
  }
  const entries = await client.getBulwarkMetadata(accountId);
  if (!entries) return { supported: false, value: null };
  return { supported: true, value: entries[key] ?? null };
}

/** Replace (or with null remove) the plugin's value in the account's shared Inbox metadata. */
export async function doAccountDataSet(plugin: InstalledPlugin, accountArg: unknown, value: unknown): Promise<void> {
  const method = 'accountData.set';
  const { client, accountId } = dataAccount(method, accountArg);
  const key = pluginDataKey(plugin.id);
  if (!key || typeof client.setBulwarkMetadata !== 'function' || !client.supportsBulwarkMetadata?.(accountId)) {
    throw new Error(`${method}: this server keeps no shared data for plugins`);
  }
  if (value === undefined) throw new Error(`${method}: value is required (null removes it)`);
  let size: number;
  try { size = metadataValueBytes(value); } catch { throw new Error(`${method}: value must be JSON`); }
  if (value !== null && size > MAX_METADATA_ENTRY_BYTES) {
    throw new Error(`${method}: the value is ${size} bytes; at most ${MAX_METADATA_ENTRY_BYTES} fit`);
  }
  if (!withinRate('account-data', plugin.id, 20)) throw new Error(`${method}: too many changes, try again in a minute`);
  try {
    await client.setBulwarkMetadata(accountId, key, value);
  } catch (error) {
    if (error instanceof MetadataTooLargeError) throw new Error(`${method}: the server has no room for the value (${error.message})`);
    throw new Error(`${method}: ${error instanceof Error ? error.message : 'could not save'}`);
  }
}
