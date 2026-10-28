/**
 * The pre-send check behind "Send outside your organisation?": when the
 * admin turned the recipient warning on, recipients outside the
 * organisation (and, with trustContacts, not in the user's contacts) are
 * listed in one confirm. Runs for every surface that sends through the
 * pipeline: the composer and quick reply.
 */

import {
  addressDomain,
  contactAddresses,
  contextInternalDomains,
  externalMailContextFor,
  externalRecipients,
  type ExternalRecipient,
} from '@/lib/external-mail';
import { useAuthStore } from '@/stores/auth-store';
import { useContactStore } from '@/stores/contact-store';
import { useExternalRecipientConfirmStore } from '@/stores/external-recipient-confirm-store';
import { registerPreSendCheck, type OutgoingContext } from './send-pipeline';
import { debug } from '@/lib/debug';

export const EXTERNAL_RECIPIENT_CHECK_ID = 'external-recipients';
/** After the composer's own checks (attachment, subject, placeholders), before anything later. */
const ORDER = 40;
/** Longest the send waits for the contacts to load the first time. */
const CONTACTS_WAIT_MS = 3000;

/**
 * Waits for the contacts the first time, at most CONTACTS_WAIT_MS: a send
 * right after signing in shouldn't ask about every contact, nor hang on a
 * slow address book.
 */
export async function ensureContactsLoaded(waitMs = CONTACTS_WAIT_MS): Promise<void> {
  const contacts = useContactStore.getState();
  if (contacts.contactsLoaded) return;
  const client = useAuthStore.getState().client;
  if (!client) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      contacts.fetchContacts(client),
      new Promise((resolve) => { timer = setTimeout(resolve, waitMs); }),
    ]);
  } catch (error) {
    debug.error('Could not load contacts for the external-recipient check:', error);
  } finally {
    clearTimeout(timer);
  }
}

/** The recipients the user is asked about; empty when the check doesn't apply. */
export async function recipientsToConfirm(context: OutgoingContext): Promise<ExternalRecipient[]> {
  // The sending account's policy and identities: an identity of another
  // signed-in account sends under that account's domain or group scopes.
  const account = await externalMailContextFor(context.localAccountId);
  const { policy } = account;
  if (!policy.recipientWarning) return [];
  // The chosen identity's own address is internal. A From typed over it in
  // the composer is not: anyone can type any domain there.
  const identityDomain = addressDomain(context.identityEmail);
  const internal = contextInternalDomains(account);
  if (identityDomain && !internal.includes(identityDomain)) internal.push(identityDomain);
  let trusted: ((address: string) => boolean) | undefined;
  if (policy.trustContacts) {
    await ensureContactsLoaded();
    const known = contactAddresses();
    trusted = (address) => known.has(address);
  }
  return externalRecipients(context, internal, trusted);
}

/** True to send: nobody external, or the user chose "Send anyway". */
export async function externalRecipientCheck(
  context: OutgoingContext,
  ask: (recipients: ExternalRecipient[]) => Promise<boolean> = (recipients) => useExternalRecipientConfirmStore.getState().ask(recipients),
): Promise<boolean> {
  const recipients = await recipientsToConfirm(context);
  if (recipients.length === 0) return true;
  return ask(recipients);
}

/** Dialog hosts mounted now; without one nobody could answer, so nothing asks. */
let hosts = 0;

/** Called by the dialog host once it is mounted; returns the unregister function. */
export function registerExternalRecipientCheck(): () => void {
  hosts += 1;
  const unregister = registerPreSendCheck(EXTERNAL_RECIPIENT_CHECK_ID, ORDER, (context) => externalRecipientCheck(context));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    hosts -= 1;
    unregister();
  };
}

/**
 * The same question for calendar invitations, which the server sends when an
 * event is saved: true to save and send, false to go back to the event.
 * Only the newly invited attendees are asked about; people already invited
 * know of the event.
 */
export async function confirmInvitationRecipients(invited: string[]): Promise<boolean> {
  if (hosts === 0 || invited.length === 0) return true;
  return externalRecipientCheck({
    surface: 'calendar-invitation',
    to: invited,
    cc: [],
    bcc: [],
    mode: 'compose',
    plainText: false,
  });
}
