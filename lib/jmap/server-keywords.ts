/**
 * Keywords the server sets on its own.
 *
 * Stalwart 1.0 puts `$hasattachment` or `$hasnoattachment` on every message it
 * stores and derives Email `hasAttachment` (the property and the filter) from
 * them alone. A patch can still add or remove them, which flips
 * `hasAttachment`. So they are not tags: they are hidden wherever keywords are
 * listed, and no plugin or category tab may add or remove them. A copy must
 * carry them over, though: Email/copy takes a message's keywords only from the
 * request, and a copy sent without them loses its attachment flag. Stalwart
 * 0.16 never sets them.
 */
export const SERVER_SET_KEYWORDS: ReadonlySet<string> = new Set(['$hasattachment', '$hasnoattachment']);

/** True for a keyword the server sets itself (keywords are case-insensitive). */
export function isServerSetKeyword(keyword: string): boolean {
  return SERVER_SET_KEYWORDS.has(keyword.toLowerCase());
}
