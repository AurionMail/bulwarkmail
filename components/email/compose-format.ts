import { sanitizeSignatureHtml } from "@/lib/email-sanitization";
import { htmlToPlainText } from "@/lib/html-to-text";
import { plainTextToComposerBody } from "@/lib/email-composer-utils";
import {
  appendPlainTextSignature,
  plainTextBodyHasSignature,
  plainTextBodyWithoutSignature,
} from "@/lib/signature-utils";
import { buildSignatureBlock, SIGNATURE_RANGE_MARKER } from "@/components/email/signature-block";

/**
 * Helpers for the composer's per-message HTML <-> plain-text switch (#1022).
 *
 * Both directions preserve the one invariant the send and draft-save paths
 * rely on: whether the body *carries* the signature. An HTML body carries it
 * as a marker-bracketed range (`containsEmbeddedSignature`), a plain-text
 * body by ending with the signature text (`plainTextBodyHasSignature`). The
 * converters strip the signature in the source format and re-append it in
 * the target format, so a switch never produces a doubled or lost signature.
 */

export type SignatureIdentityLike = {
  htmlSignature?: string;
  textSignature?: string;
} | null | undefined;

// Render the embedded signature. Bracketed with `data-signature-block` marker
// paragraphs so we can swap the inner content when the user switches identity
// without losing the surrounding draft or quoted message. The markers are
// preserved through TipTap by the StyledParagraph extension. The HTML
// signature itself is wrapped in a SignatureBlock atom node so its inline
// styling survives the editor (see signature-block.ts) instead of being
// flattened by the schema.
export function buildEmbeddedSignatureHtml(
  identity: SignatureIdentityLike,
  options: { embed: boolean; separator: boolean }
): string {
  if (!options.embed) return '';
  const startMarker = options.separator
    ? `<p ${SIGNATURE_RANGE_MARKER}="separator">-- </p>`
    : `<p ${SIGNATURE_RANGE_MARKER}="start"></p>`;
  const endMarker = `<p ${SIGNATURE_RANGE_MARKER}="end"></p>`;
  if (identity?.htmlSignature) {
    return `${startMarker}${buildSignatureBlock(sanitizeSignatureHtml(identity.htmlSignature))}${endMarker}`;
  }
  if (identity?.textSignature) {
    const escaped = identity.textSignature
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return `${startMarker}<p>${escaped}</p>${endMarker}`;
  }
  return '';
}

function isQuoteBoundary(node: Node | null): boolean {
  if (!node || node.nodeType !== 1) return false;
  const el = node as Element;
  return el.tagName === 'BLOCKQUOTE' || el.hasAttribute('data-quoted-html');
}

/**
 * Remove the embedded signature range [start/separator marker … end marker]
 * from a parsed body. Without an end marker the removal stops before the next
 * quote boundary (a legacy <blockquote> or the QuotedHtml island) so it never
 * eats into the quoted message. Returns the removed nodes' former position so
 * a caller can splice a replacement in, or null when the body has no range.
 */
export function removeSignatureRange(
  doc: Document,
): { parent: Node; insertBefore: Node | null } | null {
  const startEl = doc.querySelector(
    `[${SIGNATURE_RANGE_MARKER}="separator"], [${SIGNATURE_RANGE_MARKER}="start"]`
  );
  if (!startEl) return null;
  const parent = startEl.parentNode;
  if (!parent) return null;
  const endEl = doc.querySelector(`[${SIGNATURE_RANGE_MARKER}="end"]`);
  const removeUntil = endEl && endEl.parentNode === parent ? endEl : null;

  const toRemove: Node[] = [];
  let cursor: Node | null = startEl;
  while (cursor) {
    toRemove.push(cursor);
    if (cursor === removeUntil) break;
    const next: Node | null = cursor.nextSibling;
    if (!removeUntil && isQuoteBoundary(next)) break;
    cursor = next;
  }
  const insertBefore = toRemove[toRemove.length - 1]?.nextSibling ?? null;
  toRemove.forEach((node) => parent.removeChild(node));
  return { parent, insertBefore };
}

/**
 * The HTML body with its embedded signature range removed, plus whether one
 * was there. A bare signature atom without range markers (a body whose marker
 * paragraphs were dropped) is left in place - it has no defined extent.
 */
export function stripEmbeddedSignature(html: string): { html: string; hadSignature: boolean } {
  if (!html.includes(SIGNATURE_RANGE_MARKER)) return { html, hadSignature: false };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const removed = removeSignatureRange(doc);
  if (!removed) return { html, hadSignature: false };
  return { html: doc.body.innerHTML, hadSignature: true };
}

/**
 * Convert the rich-text editor's body to a plain-text body. Formatting is
 * dropped (that is the point of plain text); an embedded signature comes back
 * as the identity's plain-text signature so the body still "carries" it.
 */
export function htmlComposeBodyToPlainText(
  html: string,
  identity: SignatureIdentityLike,
  options: { separator: boolean },
): string {
  const stripped = stripEmbeddedSignature(html);
  const text = htmlToPlainText(stripped.html, { paragraphSpacing: true });
  if (!stripped.hadSignature) return text;
  return appendPlainTextSignature(text, identity, { separator: options.separator });
}

/**
 * Convert a plain-text body to editor HTML: paragraphs per blank line, <br>
 * per newline. A trailing plain-text signature is swapped for the embedded
 * (marker-bracketed) HTML signature so identity switches and the send path
 * keep working as in a body that started out as HTML.
 */
export function plainComposeBodyToHtml(
  text: string,
  identity: SignatureIdentityLike,
  options: { separator: boolean },
): string {
  const hadSignature = plainTextBodyHasSignature(text, identity);
  const userText = hadSignature ? plainTextBodyWithoutSignature(text, identity) : text;
  const html = plainTextToComposerBody(userText);
  if (!hadSignature) return html;
  const embedded = buildEmbeddedSignatureHtml(identity, { embed: true, separator: options.separator });
  return `${html || '<p></p>'}${embedded}`;
}
