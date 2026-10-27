// Finds text the sender meant to replace before sending: template
// placeholders, bracketed fill-ins that AI drafts and copied templates leave
// behind, and markers like TODO.

// Template syntax, as in template-utils. Spaces inside the braces are allowed
// because templates pasted from other tools often have them.
const TEMPLATE_PLACEHOLDER = /\{\{\s*[\w.-]+\s*\}\}/g;

// [TIME], [PRICE], [YOUR NAME]. Not followed by "(", which would make it a
// Markdown link.
const CAPS_BRACKET = /\[[\p{Lu}\d][\p{Lu}\d _./-]{0,28}[\p{Lu}\d]\](?!\()/gu;

// [Your Name], [Insert date], [Ihr Name], [Datum einfügen].
const PROMPT_BRACKET = /\[(?:(?:your|insert|enter|add|ihr|ihre|ihren|dein|deine|deinen)\s[^[\]\n]{1,40}|[^[\]\n]{1,40}\seinfügen)\](?!\()/giu;

// Upper case only: "todo" or "tba" in a sentence is usually meant.
const UNFINISHED_WORD = /(?<![\p{L}\d_])(?:TODO|TBD|TBA|TBC|FIXME|XXX)(?![\p{L}\d_])/gu;

const SIGNATURE_START_SELECTOR = '[data-signature-block="separator"], [data-signature-block="start"]';
const SIGNATURE_END_SELECTOR = '[data-signature-block="end"]';

interface Match {
  start: number;
  end: number;
  text: string;
}

function collect(text: string, patterns: RegExp[]): Match[] {
  const matches: Match[] = [];
  for (const pattern of patterns) {
    for (const m of text.matchAll(pattern)) {
      if (pattern === CAPS_BRACKET && (m[0].match(/\p{Lu}/gu)?.length ?? 0) < 2) continue;
      matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }
  }
  // "[TODO]" is a bracket and a word; keep the outer match only.
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Match[] = [];
  for (const match of matches) {
    const last = kept[kept.length - 1];
    if (last && match.start < last.end) continue;
    kept.push(match);
  }
  return kept;
}

/**
 * The unfilled placeholders in a message, each once, subject first. The
 * subject is only checked for template placeholders: it often carries tags
 * like [EXTERNAL] or words from the original message, which the sender did
 * not write. `bodyText` should be the text the sender wrote, without quoted
 * replies and the signature.
 */
export function findUnfilledPlaceholders(subject: string, bodyText: string): string[] {
  const found = [
    ...collect(subject, [TEMPLATE_PLACEHOLDER]),
    ...collect(bodyText, [TEMPLATE_PLACEHOLDER, CAPS_BRACKET, PROMPT_BRACKET, UNFINISHED_WORD]),
  ].map((m) => m.text);
  return Array.from(new Set(found));
}

/**
 * A compose body without its embedded signature. A signature is the same in
 * every message, so a placeholder in it would stop every send.
 */
export function stripEmbeddedSignatureHtml(html: string): string {
  if (!html.includes('data-signature-block')) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const startEl = doc.querySelector(SIGNATURE_START_SELECTOR);
  if (startEl) {
    const endEl = doc.querySelector(SIGNATURE_END_SELECTOR);
    let cursor: Node | null = startEl;
    while (cursor) {
      const next: Node | null = cursor.nextSibling;
      const isEnd = cursor === endEl;
      cursor.parentNode?.removeChild(cursor);
      if (isEnd) break;
      cursor = next;
    }
  }
  doc.querySelectorAll('[data-signature-block-node]').forEach((el) => el.remove());
  return doc.body.innerHTML;
}
