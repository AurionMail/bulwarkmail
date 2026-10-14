// onBeforeCompose: asked before the composer opens, from any entry point
// (new message, keyboard, mailto, reply / forward, re-opened draft). A plugin
// returns false to stop it, or a ComposeOptions to prefill the fields. Only
// the fields a plugin actually changed come back as a prefill, so a reply's
// own recipients and quote stay as the host builds them unless one is touched.

import type { ComposeOptions } from './plugin-types';
import { emailHooks } from './plugin-hooks';
import { interceptWithResult } from './plugin-hook-result';
import { buildReplyRecipients, type ReplySource } from './reply-recipients';
import { buildForwardSubject, buildReplySubject } from './subject-prefix';
import { formatRecipient } from './email-composer-utils';

export type ComposerOpenMode = 'compose' | 'reply' | 'replyAll' | 'forward';

/** Fields a plugin changed in onBeforeCompose. Body is plain text. */
export interface ComposePrefill {
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
}

const MAX_RECIPIENTS = 200;
const MAX_ADDRESS_LENGTH = 998;
const MAX_SUBJECT_LENGTH = 998;
const MAX_BODY_LENGTH = 64 * 1024;
// eslint-disable-next-line no-control-regex -- removing control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex -- removing control characters is the point
const CONTROL_CHARS_EXCEPT_LINE_BREAKS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function cleanAddresses(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.replace(CONTROL_CHARS, '').trim().slice(0, MAX_ADDRESS_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_RECIPIENTS);
}

/** `accept` for onBeforeCompose: take the well-formed fields of a returned ComposeOptions. */
export function acceptComposeOptions(result: unknown, current: ComposeOptions): ComposeOptions | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  const r = result as Record<string, unknown>;
  const next: ComposeOptions = { ...current };
  const to = cleanAddresses(r.to);
  if (to) next.to = to;
  const cc = cleanAddresses(r.cc);
  if (cc) next.cc = cc;
  if (typeof r.subject === 'string') next.subject = r.subject.replace(CONTROL_CHARS, '').slice(0, MAX_SUBJECT_LENGTH);
  if (typeof r.body === 'string') {
    next.body = r.body.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS_EXCEPT_LINE_BREAKS, '').slice(0, MAX_BODY_LENGTH);
  }
  return next;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Run onBeforeCompose. Resolves to null when a plugin stopped the composer,
 * otherwise to the fields it changed (empty when none).
 */
export async function runBeforeCompose(options: ComposeOptions): Promise<ComposePrefill | null> {
  const outcome = await interceptWithResult(emailHooks.onBeforeCompose, options, acceptComposeOptions, (o) => emailHooks.onBeforeCompose.intercept(o));
  if (!outcome.allowed) return null;
  const changed = outcome.value;
  const prefill: ComposePrefill = {};
  if (!sameList(changed.to, options.to)) prefill.to = changed.to;
  if (!sameList(changed.cc, options.cc)) prefill.cc = changed.cc;
  if (changed.subject !== options.subject) prefill.subject = changed.subject;
  if (changed.body !== options.body) prefill.body = changed.body;
  return prefill;
}

const PLUGIN_MODE: Record<ComposerOpenMode, ComposeOptions['mode']> = {
  compose: 'new',
  reply: 'reply',
  replyAll: 'reply-all',
  forward: 'forward',
};

/**
 * The ComposeOptions for a composer about to open: what the host will fill in
 * itself. A reply's recipients and subject are worked out the way the
 * composer does it.
 */
export function composeOptionsFor(
  mode: ComposerOpenMode,
  opts: {
    source?: (ReplySource & { subject?: string }) | null;
    ownEmails?: string[];
    to?: string[];
    cc?: string[];
    subject?: string;
    body?: string;
    replyPrefix?: string;
    forwardPrefix?: string;
  } = {},
): ComposeOptions {
  let to = opts.to ?? [];
  let cc = opts.cc ?? [];
  let subject = opts.subject ?? '';
  if (opts.source && (mode === 'reply' || mode === 'replyAll')) {
    const recipients = buildReplyRecipients(opts.source, mode, opts.ownEmails ?? []);
    if (!opts.to) to = recipients.to.map((r) => formatRecipient(r.name, r.email ?? ''));
    if (!opts.cc) cc = recipients.cc.map((r) => formatRecipient(r.name, r.email ?? ''));
    if (opts.subject === undefined && opts.source.subject) subject = buildReplySubject(opts.source.subject, opts.replyPrefix ?? 'Re:');
  } else if (opts.source && mode === 'forward' && opts.subject === undefined && opts.source.subject) {
    subject = buildForwardSubject(opts.source.subject, opts.forwardPrefix ?? 'Fwd:');
  }
  return { mode: PLUGIN_MODE[mode], to, cc, subject, body: opts.body ?? '' };
}
