import type { Identity } from '@/lib/jmap/types';
import { appendHtmlSignature, appendPlainTextSignature } from '@/lib/signature-utils';
import { currentSignatureIdentity } from '@/lib/org/signature-state';
import { finalizeOutgoing, runPreSendChecks, type OutgoingBodies } from './send-pipeline';
// Registers the organisation signature check and the disclaimer.
import '@/lib/org/outgoing';

/**
 * The bodies a quick reply sends: the typed text with the signature, as
 * HTML too when the signature is HTML, after the same pre-send checks and
 * finalisers as the composer's send. Null when a check stopped the send.
 * The organisation signature applies as in the composer
 * (`signatureIdentity` is what the reply would sign with on its own,
 * `sendingIdentity` the identity it goes out from).
 */
export async function prepareQuickReply(input: {
  body: string;
  signatureIdentity: Identity | null | undefined;
  sendingIdentity?: Identity | null;
  separator: boolean;
  to: string[];
  fromEmail?: string;
  identityId?: string;
}): Promise<OutgoingBodies | null> {
  const { body, separator } = input;
  const signatureIdentity = currentSignatureIdentity(input.signatureIdentity, input.sendingIdentity ?? undefined);
  const text = appendPlainTextSignature(body, signatureIdentity, { separator });

  // When the identity has an HTML signature, send a matching HTML body so the
  // signature keeps its formatting; appendPlainTextSignature would otherwise
  // flatten it to plain text. Text-only identities keep the plain-text-only
  // behavior (no HTML part).
  const escapedBody = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  const html = signatureIdentity?.htmlSignature?.trim()
    ? appendHtmlSignature(`<div>${escapedBody}</div>`, signatureIdentity, { separator })
    : undefined;

  const context = {
    surface: 'quick-reply' as const,
    to: input.to,
    cc: [],
    bcc: [],
    fromEmail: input.fromEmail,
    identityId: input.identityId,
    sender: input.sendingIdentity
      ? { name: input.sendingIdentity.name, email: input.sendingIdentity.email }
      : undefined,
    // Quick reply never rewrites From: it is the identity's own address.
    identityEmail: input.fromEmail,
    mode: 'reply' as const,
    plainText: !html,
  };
  if (!(await runPreSendChecks(context))) return null;
  // Quick reply has no plugin step in between: both stages at once.
  return finalizeOutgoing(finalizeOutgoing({ html, text }, context), context, 'last');
}
