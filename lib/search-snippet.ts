/**
 * SearchSnippet/get support (RFC 8621 §5).
 *
 * The server returns, per search hit, the subject and a body excerpt with
 * the matching terms wrapped in `<mark>` and everything else HTML-escaped
 * (`&amp;`, `&lt;`, `&gt;`, `&quot;`). The list renders those instead of the
 * plain subject/preview so the user sees *why* a mail matched. Nothing here
 * ever injects HTML: the snippet is split into text/marked segments and the
 * text is decoded and rendered as React text.
 */

import type { Email } from '@/lib/jmap/types';

export interface SnippetSegment {
  text: string;
  marked: boolean;
}

/** A SearchSnippet object as returned by SearchSnippet/get. */
export interface SearchSnippetResult {
  emailId: string;
  subject?: string | null;
  preview?: string | null;
}

const ENTITY_RE = /&(amp|lt|gt|quot|apos|#39|#x27);/g;
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#x27': "'",
};

function decodeEntities(text: string): string {
  return text.replace(ENTITY_RE, (_m, name: string) => ENTITIES[name] ?? _m);
}

/**
 * Splits a snippet into plain and `<mark>`ed segments. Anything that is not
 * a `<mark>`/`</mark>` token is treated as (escaped) text, so an unexpected
 * tag in the payload is displayed literally rather than interpreted.
 */
export function parseSearchSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  const re = /<\/?mark>/g;
  let marked = false;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(snippet)) !== null) {
    if (match.index > last) {
      segments.push({ text: decodeEntities(snippet.slice(last, match.index)), marked });
    }
    marked = match[0] === '<mark>';
    last = match.index + match[0].length;
  }
  if (last < snippet.length) {
    segments.push({ text: decodeEntities(snippet.slice(last)), marked });
  }
  return segments;
}

/** True when a segment list carries at least one highlighted term. */
export function hasMarkedSegment(segments: SnippetSegment[]): boolean {
  return segments.some((s) => s.marked && s.text.length > 0);
}

const TERM_PROPERTIES = new Set(['text', 'subject', 'body']);

/**
 * Whether a JMAP Email filter contains a term the server can highlight
 * (`text`, `subject` or `body`, RFC 8621 §5.1). Filters made only of
 * structural conditions (mailbox, keywords, dates, addresses) produce empty
 * snippets, so the extra method call is skipped for them.
 */
export function filterHasSnippetTerms(filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return false;
  const conditions = filter.conditions;
  if (Array.isArray(conditions)) {
    return conditions.some((c) => filterHasSnippetTerms(c as Record<string, unknown>));
  }
  return Object.entries(filter).some(
    ([key, value]) => TERM_PROPERTIES.has(key) && typeof value === 'string' && value.trim().length > 0,
  );
}

/**
 * The filter to hand SearchSnippet/get: the query filter with the
 * highlightable terms loosened. As soon as one term is quoted, Stalwart
 * (0.16 and 1.0) marks text only where the words of all terms appear in a
 * row, so a phrase ANDed with other parts of the query would mark nothing.
 * Phrases are therefore unquoted and their words marked wherever they
 * occur. A trailing `*` (a typed prefix) is dropped as well, so the
 * server's tokenizer sees the word itself. Structural conditions are passed
 * through unchanged.
 */
export function snippetFilterFor(filter: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === 'conditions' && Array.isArray(value)) {
      out[key] = value.map((c) => snippetFilterFor(c as Record<string, unknown>));
    } else if (TERM_PROPERTIES.has(key) && typeof value === 'string') {
      const phrase = /^\s*(["'])([\s\S]*)\1\s*$/.exec(value);
      out[key] = phrase
        ? phrase[2]
        : value
          .split(/\s+/)
          .map((word) => (word.length > 1 && word.endsWith('*') ? word.slice(0, -1) : word))
          .join(' ');
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Snippets fetched after their results were listed (see
 * SearchRequestOptions.deferSnippets), with the account they were asked in.
 * Ids repeat across accounts, so a search fanned out over several keeps each
 * account's snippets to its own rows; no `accountId` matches every row.
 */
export interface DeferredSnippetBatch {
  accountId?: string;
  list: SearchSnippetResult[];
}

/**
 * attachSearchSnippets for a list that is already on screen: returns a new
 * list with new objects for the emails that gained a snippet, and the same
 * list when none did, so a store update re-renders only the rows that changed.
 */
export function withSearchSnippets(emails: Email[], batches: DeferredSnippetBatch[]): Email[] {
  const lookups = batches
    .filter((batch) => batch.list.length > 0)
    .map((batch) => ({ accountId: batch.accountId, byId: new Map(batch.list.map((s) => [s.emailId, s])) }));
  if (lookups.length === 0) return emails;
  let changed = false;
  const next = emails.map((email) => {
    for (const { accountId, byId } of lookups) {
      if (accountId !== undefined && email.accountId !== accountId) continue;
      const snippet = byId.get(email.id);
      if (!snippet) continue;
      const [withSnippet] = attachSearchSnippets([{ ...email }], [snippet]);
      if (!withSnippet.searchSnippet) return email;
      changed = true;
      return withSnippet;
    }
    return email;
  });
  return changed ? next : emails;
}

/**
 * Attaches the snippets to the emails they belong to. A snippet without any
 * highlighted term (the server found nothing to mark, or returned the plain
 * subject) is dropped, so the list falls back to the regular subject/preview.
 */
export function attachSearchSnippets(emails: Email[], snippets: SearchSnippetResult[] | undefined): Email[] {
  if (!snippets || snippets.length === 0) return emails;
  const byId = new Map(snippets.map((s) => [s.emailId, s]));
  for (const email of emails) {
    const snippet = byId.get(email.id);
    if (!snippet) continue;
    const subject = snippet.subject && hasMarkedSegment(parseSearchSnippet(snippet.subject)) ? snippet.subject : null;
    const preview = snippet.preview && hasMarkedSegment(parseSearchSnippet(snippet.preview)) ? snippet.preview : null;
    if (subject || preview) {
      email.searchSnippet = { subject, preview };
    }
  }
  return emails;
}
