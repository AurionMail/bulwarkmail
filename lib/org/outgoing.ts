/**
 * The organisation's changes to outgoing mail, as send finalisers
 * (lib/outgoing/send-pipeline.ts): they run for the composer and quick
 * reply, on sends only, never on drafts. Registered once when this module
 * is imported (components/mail/mail-app.tsx); each reads the effective
 * policy at send time.
 *
 * - org-signature: a locked (or hidden) organisation signature the user
 *   deleted in the editor is put back once, at the end of their part.
 * - org-disclaimer: the admin's disclaimer below everything, quote
 *   included: `<hr>` and the HTML in the HTML part, a blank line and the
 *   text in the text part (text from the HTML when the admin wrote none).
 */

import type { Identity } from '@/lib/jmap/types';
import { registerOutgoingFinalizer, type OutgoingBodies, type OutgoingContext } from '@/lib/outgoing/send-pipeline';
import { isSignatureEnforced, type FilledSignature } from '@/lib/org-signature';
import { currentDisclaimer, currentOrgSignatureSetup } from '@/lib/org/signature-state';
import { appendHtmlSignature, appendPlainTextSignature, getPlainTextSignature } from '@/lib/signature-utils';
import { sanitizeSignatureHtml } from '@/lib/email-sanitization';
import { htmlToPlainText } from '@/lib/html-to-text';
import { useIdentityStore } from '@/stores/identity-store';
import { useSettingsStore } from '@/stores/settings-store';

export const ORG_SIGNATURE_FINALIZER = 'org-signature';
export const ORG_DISCLAIMER_FINALIZER = 'org-disclaimer';
const SIGNATURE_ORDER = 10;
/** The disclaimer goes last, after anything else a finaliser adds. */
const DISCLAIMER_ORDER = 1000;

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

/** The user's part of the message as text: the quoted or forwarded message left out. */
function ownText(bodies: OutgoingBodies): string {
  if (bodies.html !== undefined) {
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${bodies.html}</body></html>`, 'text/html');
    doc.querySelectorAll('[data-quoted-html], blockquote').forEach((el) => el.remove());
    return htmlToPlainText(doc.body.innerHTML);
  }
  return bodies.text.split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join('\n');
}

/** Whether the user's part of the message carries `signatureText`. */
function carriesSignature(bodies: OutgoingBodies, signatureText: string): boolean {
  return squash(ownText(bodies)).includes(squash(signatureText));
}

const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** Whether the user's part of the message ends with `text`, line by line. */
function endsWithText(bodies: OutgoingBodies, text: string): boolean {
  const body = lines(ownText(bodies));
  const tail = lines(text);
  if (tail.length === 0 || tail.length > body.length) return false;
  return tail.every((line, i) => line === body[body.length - tail.length + i]);
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

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

/** The disclaimer as it goes into the HTML part. */
export function disclaimerHtml(disclaimer: FilledSignature): string {
  const inner = disclaimer.html ? sanitizeSignatureHtml(disclaimer.html) : escapeText(disclaimer.text);
  return `<hr><div data-org-disclaimer="">${inner}</div>`;
}

/**
 * Adds the disclaimer below everything. A body whose own part already ends
 * with it (a message sent again after Undo, where the first send's copy came
 * back into the draft) keeps the one it has; a quoted copy doesn't count.
 */
export function orgDisclaimerFinalizer(bodies: OutgoingBodies, context: OutgoingContext): OutgoingBodies {
  const disclaimer = currentDisclaimer(senderOf(context));
  if (!disclaimer) return bodies;
  const text = getPlainTextSignature(asSignature(disclaimer));
  if (!text) return bodies;
  if (endsWithText(bodies, text)) return bodies;
  return {
    html: bodies.html === undefined ? undefined : `${bodies.html}${disclaimerHtml(disclaimer)}`,
    text: `${bodies.text.replace(/\s+$/, '')}\n\n${text}`,
  };
}

/** Registers both finalisers; registering again replaces them. */
export function registerOrgOutgoing(): void {
  registerOutgoingFinalizer(ORG_SIGNATURE_FINALIZER, SIGNATURE_ORDER, orgSignatureFinalizer);
  registerOutgoingFinalizer(ORG_DISCLAIMER_FINALIZER, DISCLAIMER_ORDER, orgDisclaimerFinalizer);
}

registerOrgOutgoing();
