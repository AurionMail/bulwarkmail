import type { Email, EmailAddress } from '@/lib/jmap/types';

/**
 * Demo messages have no raw message on a server. Each gets a blob id with
 * this prefix, and the demo client builds the .eml from the message when the
 * blob is fetched, so Export as .eml, View source and Forward as attachment
 * work in the demo as well.
 */
export const DEMO_EML_BLOB_PREFIX = 'demo-eml-';

export function demoEmlBlobId(emailId: string): string {
  return `${DEMO_EML_BLOB_PREFIX}${emailId}`;
}

/** The email id behind a demo .eml blob id, or null for any other blob. */
export function demoEmlEmailId(blobId: string): string | null {
  return blobId.startsWith(DEMO_EML_BLOB_PREFIX) ? blobId.slice(DEMO_EML_BLOB_PREFIX.length) : null;
}

/** RFC 2047 encoded-word for a header text with non-ASCII characters. */
function encodeWord(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function formatAddress(address: EmailAddress): string {
  if (!address.name) return address.email;
  const name = /^[\x20-\x7e]*$/.test(address.name) && /[",.;:<>@()[\]\\]/.test(address.name)
    ? `"${address.name.replace(/(["\\])/g, '\\$1')}"`
    : encodeWord(address.name);
  return `${name} <${address.email}>`;
}

function addressHeader(name: string, list: EmailAddress[] | undefined): string[] {
  return list?.length ? [`${name}: ${list.map(formatAddress).join(', ')}`] : [];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** RFC 5322 date, in UTC. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

function bodyText(email: Email, parts: Email['textBody']): string | null {
  const part = parts?.[0];
  if (!part?.partId) return null;
  return email.bodyValues?.[part.partId]?.value ?? null;
}

function textPart(type: string, body: string): string {
  return [
    `Content-Type: ${type}; charset=utf-8`,
    'Content-Transfer-Encoding: 8bit',
    '',
    body.replace(/\r?\n/g, '\r\n'),
  ].join('\r\n');
}

/** The message as an RFC 5322 .eml: its headers and its text and HTML bodies. */
export function buildDemoEml(email: Email): string {
  // Raw headers the fixture carries (authentication results, spam score,
  // List-Id...) come first, as a server would keep them.
  const raw = Object.entries(email.headers ?? {}).flatMap(([name, value]) =>
    (Array.isArray(value) ? value : [value]).map((v) => `${name}: ${v}`),
  );
  const headers = [
    ...raw,
    ...addressHeader('From', email.from),
    ...addressHeader('Reply-To', email.replyTo),
    ...addressHeader('To', email.to),
    ...addressHeader('Cc', email.cc),
    `Subject: ${encodeWord(email.subject ?? '')}`,
    `Date: ${formatDate(email.sentAt ?? email.receivedAt)}`,
    `Message-ID: ${email.messageId ?? `<${email.id}@demo.example.com>`}`,
    ...(email.inReplyTo?.length ? [`In-Reply-To: ${email.inReplyTo.join(' ')}`] : []),
    ...(email.references?.length ? [`References: ${email.references.join(' ')}`] : []),
    'MIME-Version: 1.0',
  ];

  const text = bodyText(email, email.textBody);
  const html = bodyText(email, email.htmlBody);
  let body: string;
  if (text !== null && html !== null && text !== html) {
    const boundary = `demo-${email.id}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      textPart('text/plain', text),
      `--${boundary}`,
      textPart('text/html', html),
      `--${boundary}--`,
      '',
    ].join('\r\n');
  } else {
    const [type, value] = html !== null ? ['text/html', html] : ['text/plain', text ?? email.preview ?? ''];
    const part = textPart(type, value);
    const split = part.indexOf('\r\n\r\n');
    headers.push(part.slice(0, split));
    body = part.slice(split + 4);
  }
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}
