import { sanitizeSignatureHtml } from '@/lib/email-sanitization';
import { htmlToPlainText } from '@/lib/html-to-text';

type SignatureSource = {
  textSignature?: string;
  htmlSignature?: string;
};

/**
 * Whether the signature starts with its own "-- " delimiter line. Many do
 * (imported from other clients, or set on the server), and the composer's own
 * separator on top of it showed two delimiter lines.
 */
export function signatureHasOwnDelimiter(signature?: SignatureSource | null): boolean {
  const text = signature?.textSignature?.trim()
    ? signature.textSignature
    : signature?.htmlSignature?.trim()
      ? htmlToPlainText(sanitizeSignatureHtml(signature.htmlSignature))
      : '';
  const firstLine = text.replace(/\r\n?/g, '\n').replace(/^\s*\n/, '').split('\n')[0];
  return /^--[ \t\u00a0]*$/.test(firstLine);
}

/** Whether to add the "-- " separator line in front of this signature. */
export function wantsSignatureSeparator(enabled: boolean | undefined, signature?: SignatureSource | null): boolean {
  return enabled !== false && !signatureHasOwnDelimiter(signature);
}
