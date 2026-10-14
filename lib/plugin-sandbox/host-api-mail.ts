// Host side of reading mail for plugins: api.email.get / list and
// api.mailboxes.list. Reads go to the server through the JMAP client and
// never change what the user has open.
//
// Messages are read from the signed-in account itself; mail in folders shared
// from other accounts is not reached by id here.

import type { EmailReadView, EmailSummary, MailboxView } from '../plugin-types';
import type { Email, Mailbox } from '../jmap/types';
import type { IJMAPClient } from '../jmap/client-interface';
import { useEmailStore } from '@/stores/email-store';
import { emailSummary, emailToReadView } from '../plugin-projection';
import { readId, readInteger, readObject, sessionClient } from './host-api-input';

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
  const email = await loadEmail(sessionClient(method), emailId);
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
