import { Email } from '@/lib/jmap/types';
import { hasMeaningfulHtmlBody } from '@/lib/signature-utils';

/**
 * Pick the HTML body an email should be rendered from, or null when it should be
 * rendered as plain text instead. Shared by the desktop viewer and the mobile
 * thread view so the two cannot drift apart again (#489: the thread view was
 * missing the part-type guard and rendered plain-text-only mail as HTML,
 * collapsing every line break).
 */
export function getRenderableHtmlBody(
  email: Pick<Email, 'htmlBody' | 'textBody' | 'bodyValues'>
): string | null {
  const htmlPart = email.htmlBody?.[0];
  if (!htmlPart?.partId || !email.bodyValues?.[htmlPart.partId]) return null;

  const htmlContent = email.bodyValues[htmlPart.partId].value;
  if (!htmlContent) return null;

  // Per RFC 8621, a single-part email exposes the same part in both htmlBody and
  // textBody. That shared part may actually be text/plain (plain-text-only mail);
  // rendering it as HTML collapses newlines and skips linkification, so route by
  // the part's media type rather than by which list it appears in.
  if (htmlPart.type && htmlPart.type.toLowerCase() !== 'text/html') return null;

  // Prefer textBody when the HTML is an auto-generated minimal wrapper (no rich
  // formatting). Server-generated HTML from text/plain emails often lacks <br>
  // tags, which would collapse newlines just the same.
  const textPartId = email.textBody?.[0]?.partId;
  const hasDistinctTextBody =
    !!textPartId && textPartId !== htmlPart.partId && !!email.bodyValues[textPartId];
  if (hasDistinctTextBody && !hasMeaningfulHtmlBody(htmlContent)) return null;

  return htmlContent;
}

/**
 * The plain-text body of a draft being re-opened, taken from the parts the
 * server lists as the body and from nothing else.
 *
 * `bodyValues` is keyed by part id, and `getEmail` asks for
 * `fetchAllBodyValues`, which per RFC 8621 § 4.1.4 covers every `text/*`
 * part of the message - attachments included. Joining all of them put the
 * contents of an attached .csv or .txt into the composer as the message
 * text: a draft carrying only attachments and no body re-opened showing an
 * attachment's contents as what you had written, and saving or sending it
 * then made that the actual message.
 */
export function getDraftTextBody(
  email: Pick<Email, 'textBody' | 'bodyValues'>
): string {
  return (email.textBody ?? [])
    .map(part => (part.partId ? email.bodyValues?.[part.partId]?.value : undefined))
    .filter((value): value is string => !!value)
    .join('\n');
}
