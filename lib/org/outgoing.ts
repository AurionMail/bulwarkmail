/**
 * The organisation's changes to outgoing mail, as send finalisers
 * (lib/outgoing/send-pipeline.ts): they run for the composer and quick
 * reply, on sends only, never on drafts. Registered when this module is
 * first imported (the composer and lib/outgoing/quick-reply.ts import it);
 * each reads the effective policy at send time.
 *
 * - org-signature: a locked (or hidden) organisation signature the user
 *   deleted or changed in the editor is appended again once, at the end of
 *   the message (below the quote, where a reply's signature goes by
 *   default). Each part is checked and fixed on its own.
 * - org-disclaimer (stage `last`): the admin's disclaimer below
 *   everything, quote and plugin footers included, before a plugin signs or
 *   encrypts: `<hr>` and the HTML in the HTML part, a blank line and the
 *   text in the text part (text from the HTML when the admin wrote none).
 *   A part that already ends with it keeps the one it has.
 */

import type { Identity } from '@/lib/jmap/types';
import { registerOutgoingFinalizer, type OutgoingBodies, type OutgoingContext } from '@/lib/outgoing/send-pipeline';
import { isSignatureEnforced, type FilledSignature } from '@/lib/org-signature';
import { currentOrgSignatureSetup } from '@/lib/org/signature-state';
import {
  DISCLAIMER_MARKER,
  htmlCarriesDisclaimer,
  htmlCarriesSignature,
  textCarriesDisclaimer,
  textCarriesSignature,
} from '@/lib/org/body-match';
import { appendHtmlSignature, appendPlainTextSignature, getPlainTextSignature, signatureAsHtml } from '@/lib/signature-utils';
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

const asSignature = (filled: FilledSignature) => ({ htmlSignature: filled.html, textSignature: filled.text });

/**
 * Puts a locked organisation signature back when the user deleted or
 * changed it. The composer and quick reply insert it, so this does nothing
 * unless it is missing, and then adds it once to the part that lacks it.
 */
export function orgSignatureFinalizer(bodies: OutgoingBodies, context: OutgoingContext): OutgoingBodies {
  const setup = currentOrgSignatureSetup(senderOf(context));
  if (!setup.signature || !isSignatureEnforced(setup.restriction)) return bodies;
  const signature = setup.signature;
  const separator = { separator: useSettingsStore.getState().signatureSeparatorEnabled };
  const htmlMissing = bodies.html !== undefined && !htmlCarriesSignature(bodies.html, signature, context.forwardedSeparator);
  // The text part of an HTML message is made from the HTML: what the HTML
  // lacks, it lacks too.
  const textMissing = htmlMissing || !textCarriesSignature(bodies.text, signature, context.forwardedSeparator);
  if (!htmlMissing && !textMissing) return bodies;
  return {
    html: htmlMissing ? appendHtmlSignature(bodies.html!, asSignature(signature), separator) : bodies.html,
    text: textMissing ? appendPlainTextSignature(bodies.text, asSignature(signature), separator) : bodies.text,
  };
}

/** The disclaimer as it goes into the HTML part. */
export function disclaimerHtml(disclaimer: FilledSignature): string {
  return `<hr><div ${DISCLAIMER_MARKER}="">${signatureAsHtml(asSignature(disclaimer))}</div>`;
}

/**
 * Adds the disclaimer below everything, quote included. A part that already
 * ends with it (a message sent again after Undo, where the first send's copy
 * came back into the draft) keeps the one it has; a quoted copy doesn't count.
 */
export function orgDisclaimerFinalizer(bodies: OutgoingBodies, context: OutgoingContext): OutgoingBodies {
  const disclaimer = currentOrgSignatureSetup(senderOf(context)).disclaimer;
  if (!disclaimer) return bodies;
  const text = getPlainTextSignature(asSignature(disclaimer));
  if (!text) return bodies;
  const htmlMissing = bodies.html !== undefined && !htmlCarriesDisclaimer(bodies.html, disclaimer);
  const textMissing = htmlMissing || !textCarriesDisclaimer(bodies.text, disclaimer);
  if (!htmlMissing && !textMissing) return bodies;
  return {
    html: htmlMissing ? `${bodies.html}${disclaimerHtml(disclaimer)}` : bodies.html,
    text: textMissing ? `${bodies.text.replace(/\s+$/, '')}\n\n${text}` : bodies.text,
  };
}

/** Registers both finalisers; registering again replaces them. */
export function registerOrgOutgoing(): void {
  registerOutgoingFinalizer(ORG_SIGNATURE_FINALIZER, SIGNATURE_ORDER, orgSignatureFinalizer);
  // After the plugins' own footers, before a plugin signs or encrypts.
  registerOutgoingFinalizer(ORG_DISCLAIMER_FINALIZER, DISCLAIMER_ORDER, orgDisclaimerFinalizer, 'last');
}

registerOrgOutgoing();
