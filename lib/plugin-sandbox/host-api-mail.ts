// Host side of reading mail for plugins: api.email.get / list,
// api.mailboxes.list, and the bytes of an attachment or a whole message
// (api.email.getAttachment / getRaw). Reads go to the server through the
// JMAP client and never change what the user has open.
//
// api.email.get also reads a message of a shared account when it is in the
// loaded list, from the account that owns it, always through the signed-in
// login. The bytes of attachments and sources are read from the signed-in
// account only.

import type { EmailReadView, EmailSummary, MailboxView } from '../plugin-types';
import type { Email, Mailbox } from '../jmap/types';
import type { IJMAPClient } from '../jmap/client-interface';
import { resolveEmailBlobContext, useEmailStore } from '@/stores/email-store';
import { emailSummary, emailToReadView } from '../plugin-projection';
import { MAX_PLUGIN_FETCH_BYTES, readBoolean, readId, readInteger, readObject, readString, sessionClient, withinRate } from './host-api-input';

/** Most messages one api.email.list call returns. */
export const MAX_PLUGIN_EMAIL_PAGE = 100;

/** The open message when it is this one and its body is loaded, else the server's copy. */
async function loadEmail(client: IJMAPClient, emailId: string): Promise<Email | null> {
  const { selectedEmail } = useEmailStore.getState();
  if (selectedEmail?.id === emailId && selectedEmail.bodyValues && !selectedEmail.accountId) {
    return selectedEmail;
  }
  return client.getEmail(emailId);
}

export async function doEmailGet(id: unknown): Promise<EmailReadView | null> {
  const method = 'email.get';
  const emailId = readId(id, method, 'emailId');
  const client = sessionClient(method);
  // A listed message of a shared account is asked of the account that owns
  // it; the signed-in account doesn't know its id.
  const listed = useEmailStore.getState().emails.find((e) => e.id === emailId);
  const owner = listed ? resolveEmailBlobContext(listed, client) : null;
  // Only through the signed-in login. A row of another connected login is
  // not read here, nor asked of this login under an id that isn't its own.
  // The rows can come from a plugin (onEmailsFetched), so their stamps must
  // not pick which login is asked.
  if (owner && owner.client !== client) return null;
  const email = owner?.accountId
    ? await client.getEmail(emailId, owner.accountId)
    : await loadEmail(client, emailId);
  return email ? emailToReadView(email) : null;
}

function mailboxToView(mailbox: Mailbox): MailboxView {
  return {
    id: mailbox.id,
    name: mailbox.name,
    role: mailbox.role ?? null,
    parentId: mailbox.parentId ?? null,
    totalEmails: mailbox.totalEmails ?? 0,
    unreadEmails: mailbox.unreadEmails ?? 0,
  };
}

async function knownMailboxes(client: IJMAPClient): Promise<Mailbox[]> {
  const { mailboxes } = useEmailStore.getState();
  return mailboxes.length > 0 ? mailboxes : client.getMailboxes();
}

export async function doMailboxesList(): Promise<MailboxView[]> {
  return (await knownMailboxes(sessionClient('mailboxes.list'))).map(mailboxToView);
}

/**
 * One page of a folder, newest first in the user's list order, as message
 * summaries (no body). Without mailboxId it pages through all mail.
 */
export async function doEmailList(options: unknown): Promise<EmailSummary[]> {
  const method = 'email.list';
  const opts = readObject(options, method, 'options', ['mailboxId', 'limit', 'position'], true);
  const limit = opts.limit === undefined ? 50 : readInteger(opts.limit, method, 'limit', 1, MAX_PLUGIN_EMAIL_PAGE);
  const position = opts.position === undefined ? 0 : readInteger(opts.position, method, 'position', 0, 1_000_000);
  const client = sessionClient(method);
  let jmapMailboxId: string | undefined;
  let accountId: string | undefined;
  if (opts.mailboxId !== undefined) {
    const id = readId(opts.mailboxId, method, 'mailboxId');
    const mailbox = (await knownMailboxes(client)).find((m) => m.id === id);
    if (!mailbox) throw new Error(`${method}: no mailbox with id "${id}"`);
    // Shared folders carry a namespaced id in the app; the server knows the original.
    jmapMailboxId = mailbox.originalId || mailbox.id;
    accountId = mailbox.isShared ? mailbox.accountId : undefined;
  }
  const { emails } = await client.getEmails(jmapMailboxId, accountId, limit, position);
  return emails.map(emailSummary);
}

/** Most messages one search returns. */
export const MAX_PLUGIN_SEARCH_RESULTS = 50;
const SEARCH_TEXT_FIELDS = ['text', 'from', 'to', 'subject'] as const;
const SEARCH_DATE_FIELDS = ['after', 'before'] as const;

/**
 * Messages matching a JMAP filter, newest first: `text` (sender, recipients,
 * subject and body, whole words), `from`, `to`, `subject`, `after` and
 * `before` (dates), `hasAttachment`, in one folder with `mailboxId`. At
 * least one condition; summaries without the body (api.email.get reads one).
 */
export async function doEmailSearch(options: unknown): Promise<EmailSummary[]> {
  const method = 'email.search';
  const opts = readObject(options, method, 'query', [...SEARCH_TEXT_FIELDS, ...SEARCH_DATE_FIELDS, 'hasAttachment', 'mailboxId', 'limit']);
  const limit = opts.limit === undefined ? 20 : readInteger(opts.limit, method, 'limit', 1, MAX_PLUGIN_SEARCH_RESULTS);
  const filter: Record<string, unknown> = {};
  for (const key of SEARCH_TEXT_FIELDS) {
    if (opts[key] === undefined) continue;
    const value = readString(opts[key], method, key, 500).trim();
    if (value) filter[key] = value;
  }
  for (const key of SEARCH_DATE_FIELDS) {
    if (opts[key] === undefined) continue;
    const value = readString(opts[key], method, key, 40).trim();
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) throw new Error(`${method}: ${key} must be a date like 2026-05-01`);
    filter[key] = date.toISOString();
  }
  if (opts.hasAttachment !== undefined) filter.hasAttachment = readBoolean(opts.hasAttachment, method, 'hasAttachment');
  if (Object.keys(filter).length === 0) throw new Error(`${method}: give at least one of text, from, to, subject, after, before or hasAttachment`);
  const client = sessionClient(method);
  let jmapMailboxId: string | undefined;
  let accountId: string | undefined;
  if (opts.mailboxId !== undefined) {
    const id = readId(opts.mailboxId, method, 'mailboxId');
    const mailbox = (await knownMailboxes(client)).find((m) => m.id === id);
    if (!mailbox) throw new Error(`${method}: no mailbox with id "${id}"`);
    jmapMailboxId = mailbox.originalId || mailbox.id;
    accountId = mailbox.isShared ? mailbox.accountId : undefined;
  }
  const { emails } = await client.getEmails(jmapMailboxId, accountId, limit, 0, undefined, false, filter);
  return emails.map(emailSummary);
}

// ─── Bytes ────────────────────────────────────────────────────

/** Every attachment part of a message, nested ones included. */
function attachmentParts(email: Email): NonNullable<Email['attachments']> {
  return email.attachments ?? [];
}

function tooBig(method: string): Error {
  return new Error(`${method}: it is larger than ${MAX_PLUGIN_FETCH_BYTES} bytes`);
}

export interface PluginAttachmentData {
  name: string;
  type: string;
  size: number;
  data: ArrayBuffer;
}

/**
 * The bytes of one attachment of one message. The blob has to be an
 * attachment of that message: a plugin can't use this to read arbitrary
 * blobs (that stays jmap.fetchBlob, privileged tier only).
 */
export async function doEmailGetAttachment(emailIdArg: unknown, blobIdArg: unknown): Promise<PluginAttachmentData> {
  const method = 'email.getAttachment';
  const emailId = readId(emailIdArg, method, 'emailId');
  const blobId = readId(blobIdArg, method, 'blobId');
  const client = sessionClient(method);
  const email = await loadEmail(client, emailId);
  if (!email) throw new Error(`${method}: no message with id "${emailId}"`);
  const part = attachmentParts(email).find((a) => a.blobId === blobId);
  if (!part) throw new Error(`${method}: that blob is not an attachment of this message`);
  if (part.size > MAX_PLUGIN_FETCH_BYTES) throw tooBig(method);
  const data = await client.fetchBlobArrayBuffer(blobId, part.name || undefined, part.type || undefined);
  if (data.byteLength > MAX_PLUGIN_FETCH_BYTES) throw tooBig(method);
  return {
    name: part.name || 'attachment',
    type: part.type || 'application/octet-stream',
    size: data.byteLength,
    data,
  };
}

/** The message as the server stores it (RFC 5322), e.g. to save it as a .eml file. */
export async function doEmailGetRaw(emailIdArg: unknown): Promise<ArrayBuffer> {
  const method = 'email.getRaw';
  const emailId = readId(emailIdArg, method, 'emailId');
  const client = sessionClient(method);
  const email = await loadEmail(client, emailId);
  if (!email) throw new Error(`${method}: no message with id "${emailId}"`);
  if (!email.blobId) throw new Error(`${method}: the server did not say where the message source is`);
  if (email.size > MAX_PLUGIN_FETCH_BYTES) throw tooBig(method);
  const data = await client.fetchBlobArrayBuffer(email.blobId, 'message.eml', 'message/rfc822');
  if (data.byteLength > MAX_PLUGIN_FETCH_BYTES) throw tooBig(method);
  return data;
}

// ─── Moving ───────────────────────────────────────────────────

/** Most messages one api.email.move / archive call moves. */
export const MAX_PLUGIN_MOVE = 100;
/** Moves a plugin may make per minute. */
export const MAX_PLUGIN_MOVES_PER_MINUTE = 20;

function readIdList(value: unknown, method: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${method}: emailIds must be a non-empty array`);
  if (value.length > MAX_PLUGIN_MOVE) throw new Error(`${method}: at most ${MAX_PLUGIN_MOVE} messages at once`);
  return [...new Set(value.map((id, i) => readId(id, method, `emailIds[${i}]`)))];
}

/**
 * Move messages of the signed-in account into one of its folders, through
 * the store, so the list updates and onBeforeEmailMove / onEmailMove (and the
 * archive hooks for the archive folder) run like for a move the user made.
 */
export async function doEmailMove(pluginId: string, emailIdsArg: unknown, mailboxIdArg: unknown): Promise<void> {
  const method = 'email.move';
  const emailIds = readIdList(emailIdsArg, method);
  const mailboxId = readId(mailboxIdArg, method, 'mailboxId');
  const store = useEmailStore.getState();
  if (!store.mailboxes.some((m) => m.id === mailboxId && !m.isShared)) {
    throw new Error(`${method}: no folder with id "${mailboxId}" in this account`);
  }
  if (!withinRate('email.move', pluginId, MAX_PLUGIN_MOVES_PER_MINUTE)) throw new Error(`${method}: too many moves, try again in a minute`);
  await store.moveEmailsToMailbox(sessionClient(method), emailIds, mailboxId);
}

/** Move messages into the account's Archive folder. */
export async function doEmailArchive(pluginId: string, emailIdsArg: unknown): Promise<void> {
  const method = 'email.archive';
  const emailIds = readIdList(emailIdsArg, method);
  const archive = useEmailStore.getState().mailboxes.find((m) => m.role === 'archive' && !m.isShared);
  if (!archive) throw new Error(`${method}: this account has no Archive folder`);
  if (!withinRate('email.move', pluginId, MAX_PLUGIN_MOVES_PER_MINUTE)) throw new Error(`${method}: too many moves, try again in a minute`);
  await useEmailStore.getState().moveEmailsToMailbox(sessionClient(method), emailIds, archive.id);
}
