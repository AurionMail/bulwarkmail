/**
 * Whether a mail paints a full-bleed background canvas: a table, div or body
 * that is 100% wide and carries a background colour. The reader drops its
 * own gutter around such mail, since the gutter would show as a frame around
 * the mail's background.
 *
 * Each start tag is looked at on its own and each condition tested on its
 * attribute text separately. The former single regex ran two unbounded
 * `[^>]*` scans over one tag and backtracked between them, which made a tag
 * with many `width:100%` declarations and no background cost quadratic time:
 * a 1 MB style attribute held the UI thread for well over a minute, on
 * every open of the message.
 */

const START_TAG = /<(?:table|div|body)\b([^<>]{0,8192})/gi;
const FULL_WIDTH = /\bwidth\s*=\s*["']?\s*100%|width\s*:\s*100%/i;
const BACKGROUND = /\bbgcolor\s*=|background(?:-color)?\s*:/i;

export function hasFullBleedCanvas(html: string): boolean {
  START_TAG.lastIndex = 0;
  for (const match of html.matchAll(START_TAG)) {
    const attributes = match[1];
    if (FULL_WIDTH.test(attributes) && BACKGROUND.test(attributes)) return true;
  }
  return false;
}
