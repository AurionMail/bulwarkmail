/**
 * Helpers that keep the mail fixtures short: one `mail()` call per message,
 * with the body parts, preview, size and message id derived from a few
 * fields. Headers are written the way Stalwart writes them, so the viewer's
 * banners (sender authentication, unsubscribe, read receipt) have the same
 * input as on a real server.
 */
import type { Email, EmailAddress, Attachment } from '@/lib/jmap/types';
import { demoDate } from '../demo-utils';
import { NORA, WORK_DOMAIN } from './people';

export const MX = `mx.${WORK_DOMAIN}`;

// ── Time ─────────────────────────────────────────────────────
/** Hours and minutes before now, for today's mail. */
export const ago = (hours: number, minutes = 0): string => demoDate(0, -hours, -minutes);

/** A wall-clock time on a day in the past (1 = yesterday) or future (negative). */
export function at(daysAgo: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Weekday name of a day relative to today, for body text ("see you Thursday"). */
export function dayName(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

/** Short date of a day relative to today ("Oct 21"). */
export function dayLabel(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Body parts ───────────────────────────────────────────────
let partCounter = 0;

function part(value: string, type: 'text/plain' | 'text/html') {
  const partId = String(++partCounter);
  return {
    part: { partId, blobId: `blob-${partId}`, size: value.length, type },
    values: { [partId]: { value } },
  };
}

function bodyParts(text: string, html?: string): Pick<Email, 'textBody' | 'htmlBody' | 'bodyValues'> {
  const t = part(text, 'text/plain');
  if (!html) return { textBody: [t.part], bodyValues: t.values };
  const h = part(html, 'text/html');
  return { textBody: [t.part], htmlBody: [h.part], bodyValues: { ...t.values, ...h.values } };
}

/** Paragraphs separated by blank lines become <p>; single newlines become <br>. */
export function htmlFromText(text: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p>${escape(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ── Headers ──────────────────────────────────────────────────
/** The receiving server's results for mail that checks out. */
export function authPass(domain: string, opts: { spam?: number } = {}): Record<string, string> {
  return {
    'Authentication-Results': `${MX}; dkim=pass header.d=${domain} header.s=mail; spf=pass smtp.mailfrom=${domain}; dmarc=pass header.from=${domain}; iprev=pass`,
    'X-Spam-Score': `ham, score=${(opts.spam ?? -1.4).toFixed(2)}`,
  };
}

/** A forged sender: SPF and DKIM for the envelope domain, DMARC fails for the From domain. */
export function authFail(fromDomain: string, envelopeDomain: string, opts: { spam?: number; llm?: string } = {}): Record<string, string> {
  return {
    'Authentication-Results': `${MX}; dkim=fail header.d=${fromDomain}; spf=fail smtp.mailfrom=${envelopeDomain}; dmarc=fail header.from=${fromDomain} policy.dmarc=reject; iprev=fail`,
    'X-Spam-Score': `spam, score=${(opts.spam ?? 9.1).toFixed(2)}`,
    ...(opts.llm ? { 'X-Spam-LLM': opts.llm } : {}),
  };
}

/** Mailing-list headers of a newsletter, with a one-click unsubscribe. */
export function listHeaders(listName: string, domain: string): Record<string, string> {
  const slug = listName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    'List-Id': `${listName} <${slug}.${domain}>`,
    'List-Unsubscribe': `<https://${domain}/unsubscribe?u=4f2a9c>, <mailto:unsubscribe@${domain}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'Precedence': 'bulk',
  };
}

// ── The message builder ──────────────────────────────────────
export interface MailSpec {
  id: string;
  /** Thread id; defaults to the message's own id. */
  thread?: string;
  /** Mailbox id, or several for a message filed in more than one folder. */
  mailbox: string | string[];
  from: EmailAddress;
  /** Defaults to the persona's work address. */
  to?: EmailAddress[];
  cc?: EmailAddress[];
  replyTo?: EmailAddress[];
  subject: string;
  /** receivedAt (and sentAt unless given). */
  date: string;
  sentAt?: string;
  text: string;
  /** HTML body; `true` renders the text as simple HTML. */
  html?: string | true;
  attachments?: Attachment[];
  /** Keywords that are set, e.g. ['$seen', '$label:work']. */
  keywords?: string[];
  headers?: Record<string, string | string[]>;
  messageId?: string;
  inReplyTo?: string[];
  references?: string[];
  preview?: string;
}

export function mail(spec: MailSpec): Email {
  const mailboxIds = Object.fromEntries((Array.isArray(spec.mailbox) ? spec.mailbox : [spec.mailbox]).map((m) => [m, true]));
  const keywords = Object.fromEntries((spec.keywords ?? []).map((k) => [k, true]));
  const html = spec.html === true ? htmlFromText(spec.text) : spec.html;
  const parts = bodyParts(spec.text, html);
  const attachmentBytes = (spec.attachments ?? []).reduce((sum, a) => sum + a.size, 0);
  const domain = spec.from.email.slice(spec.from.email.indexOf('@') + 1);
  const preview = spec.preview ?? spec.text.replace(/\s+/g, ' ').trim().slice(0, 140);
  return {
    id: spec.id,
    threadId: spec.thread ?? spec.id,
    mailboxIds,
    keywords,
    size: 1200 + spec.text.length + (html?.length ?? 0) + Math.round(attachmentBytes * 1.37),
    receivedAt: spec.date,
    sentAt: spec.sentAt ?? spec.date,
    from: [spec.from],
    to: spec.to ?? [{ name: NORA.name, email: NORA.email }],
    ...(spec.cc ? { cc: spec.cc } : {}),
    ...(spec.replyTo ? { replyTo: spec.replyTo } : {}),
    subject: spec.subject,
    preview,
    hasAttachment: (spec.attachments?.length ?? 0) > 0,
    ...(spec.attachments ? { attachments: spec.attachments } : {}),
    ...parts,
    messageId: spec.messageId ?? `<${spec.id}@${domain}>`,
    ...(spec.inReplyTo ? { inReplyTo: spec.inReplyTo } : {}),
    ...(spec.references ? { references: spec.references } : {}),
    ...(spec.headers ? { headers: spec.headers } : {}),
  };
}

/** Message id of a fixture, for In-Reply-To / References chains. */
export const mid = (id: string, domain = WORK_DOMAIN): string => `<${id}@${domain}>`;
