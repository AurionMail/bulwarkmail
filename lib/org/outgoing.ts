/**
 * The organisation's changes to outgoing mail, as send finalisers
 * (lib/outgoing/send-pipeline.ts): they run for the composer and quick
 * reply, on sends only, never on drafts. Registered once when this module
 * is imported (components/mail/mail-app.tsx); each reads the effective
 * policy at send time.
 *
 * - org-signature: a locked (or hidden) organisation signature the user
 *   deleted in the editor is put back once, at the end of their part.
 */

import type { Identity } from '@/lib/jmap/types';
import { registerOutgoingFinalizer, type OutgoingBodies, type OutgoingContext } from '@/lib/outgoing/send-pipeline';
import { isSignatureEnforced, type FilledSignature } from '@/lib/org-signature';
import { currentOrgSignatureSetup } from '@/lib/org/signature-state';
import { appendHtmlSignature, appendPlainTextSignature, getPlainTextSignature } from '@/lib/signature-utils';
import { htmlToPlainText } from '@/lib/html-to-text';
import { useIdentityStore } from '@/stores/identity-store';
import { useSettingsStore } from '@/stores/settings-store';

export const ORG_SIGNATURE_FINALIZER = 'org-signature';
const SIGNATURE_ORDER = 10;

/** The identity the message goes out from, for the placeholders. */
function senderOf(context: OutgoingContext): Pick<Identity, 'name' | 'email'> | null {
  const identities = useIdentityStore.getState().identities;
  const byId = context.identityId ? identities.find((identity) => identity.id === context.identityId) : undefined;
  if (byId) return byId;
  const email = context.fromEmail?.toLowerCase();
  const byEmail = email ? identities.find((identity) => identity.email.toLowerCase() === email) : undefined;
  return byEmail ?? (context.fromEmail ? { name: '', email: context.fromEmail } : null);
}

/** Text without any whitespace, for "does it contain" checks that survive reflowing. */
const squash = (value: string) => value.replace(/\s+/g, '');

const asSignature = (filled: FilledSignature) => ({ htmlSignature: filled.html, textSignature: filled.text });

/** Whether the user's part of the message (the quote left out) carries `signatureText`. */
function carriesSignature(bodies: OutgoingBodies, signatureText: string): boolean {
  let own: string;
  if (bodies.html !== undefined) {
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${bodies.html}</body></html>`, 'text/html');
    doc.querySelectorAll('[data-quoted-html], blockquote').forEach((el) => el.remove());
    own = htmlToPlainText(doc.body.innerHTML);
  } else {
    own = bodies.text.split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join('\n');
  }
  return squash(own).includes(squash(signatureText));
}

/**
 * Puts a locked organisation signature back when the user deleted it in
 * the editor. The composer and quick reply insert it, so this does nothing
 * unless it is missing, and then adds it once.
 */
export function orgSignatureFinalizer(bodies: OutgoingBodies, context: OutgoingContext): OutgoingBodies {
  const setup = currentOrgSignatureSetup(senderOf(context));
  if (!setup.signature || !isSignatureEnforced(setup.restriction)) return bodies;
  const signature = asSignature(setup.signature);
  const signatureText = getPlainTextSignature(signature);
  if (!signatureText || carriesSignature(bodies, signatureText)) return bodies;
  const separator = useSettingsStore.getState().signatureSeparatorEnabled;
  return {
    html: bodies.html === undefined ? undefined : appendHtmlSignature(bodies.html, signature, { separator }),
    text: appendPlainTextSignature(bodies.text, signature, { separator }),
  };
}

/** Registers the finalisers; registering again replaces them. */
export function registerOrgOutgoing(): void {
  registerOutgoingFinalizer(ORG_SIGNATURE_FINALIZER, SIGNATURE_ORDER, orgSignatureFinalizer);
}

registerOrgOutgoing();
