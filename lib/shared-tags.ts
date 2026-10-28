/**
 * Shared tags of a group account: the tag names and colours every member of
 * a shared mailbox sees, kept in the metadata of the group's Inbox
 * (namespace `org.bulwarkmail.tags`, lib/jmap/bulwark-metadata.ts).
 *
 * Keywords in a group account are the same for every member
 * (local-data/org-features-facts.md §1), so `$label:urgent` on a team
 * message is the team's tag, not one member's. A personal definition only
 * names it for the member who made it; the shared definitions name it for
 * everyone. Stalwart takes only objects as namespace values, so the list
 * sits under `list`.
 *
 * Pure functions only: reading and checking what the server holds, the
 * value written back, and the list a group account shows (the shared
 * definitions plus the tags found on its messages, which are never hidden).
 */

import {
  FALLBACK_KEYWORD_COLOR,
  KEYWORD_PALETTE,
  type KeywordDefinition,
  type KeywordVisibility,
} from '@/stores/settings-store';
import { findUnrecognizedKeywords } from './keyword-discovery';
import { MAX_KEYWORD_ID_LENGTH } from './keyword-nesting';
import { MAX_METADATA_ENTRY_BYTES, MetadataTooLargeError, metadataValueBytes } from './jmap/bulwark-metadata';

/** The metadata key (namespace `org.bulwarkmail.tags`). */
export const SHARED_TAGS_KEY = 'tags';

/** Longest name a shared tag keeps, as in the personal tag editor. */
export const MAX_SHARED_TAG_LABEL = 30;

const VISIBILITIES: readonly KeywordVisibility[] = ['show', 'hide', 'unread'];

/**
 * Characters RFC 8621 keywords can't hold (and whitespace), so a tag id
 * from the server that could never be on a message is dropped.
 */
const BAD_ID_CHARS = /[\s(){\]%*"\\]/;

/** Whether a tag id from the server can be a keyword (no control characters either). */
function isKeywordSafe(id: string): boolean {
  if (BAD_ID_CHARS.test(id)) return false;
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export interface SharedTagsValue {
  list: KeywordDefinition[];
}

/** One definition from the server, or null when it can't be one. */
function parseDefinition(value: unknown): KeywordDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || id.length > MAX_KEYWORD_ID_LENGTH || !isKeywordSafe(id)) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, MAX_SHARED_TAG_LABEL) : '';
  const color = typeof raw.color === 'string' && KEYWORD_PALETTE[raw.color] ? raw.color : FALLBACK_KEYWORD_COLOR;
  const definition: KeywordDefinition = { id, label: label || id, color };
  if (typeof raw.visibility === 'string' && (VISIBILITIES as readonly string[]).includes(raw.visibility)) {
    definition.visibility = raw.visibility as KeywordVisibility;
  }
  return definition;
}

/**
 * The shared definitions in a metadata value: `{ list: [...] }`, or a bare
 * array from another client. Anything that isn't a definition is dropped,
 * and an id the list already has (in any case) keeps its first entry.
 */
export function parseSharedTags(value: unknown): KeywordDefinition[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { list?: unknown }).list)
      ? (value as { list: unknown[] }).list
      : [];
  const seen = new Set<string>();
  const out: KeywordDefinition[] = [];
  for (const item of items) {
    const definition = parseDefinition(item);
    if (!definition) continue;
    const folded = definition.id.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(definition);
  }
  return out;
}

/**
 * The value written to the server: id, label, colour and visibility only (a
 * plugin's `addedBy` is about one member's settings). Throws
 * MetadataTooLargeError when it would not fit the 8 KB of one namespace.
 */
export function sharedTagsValue(list: KeywordDefinition[]): SharedTagsValue {
  const value: SharedTagsValue = {
    list: parseSharedTags(list).map(({ id, label, color, visibility }) => (visibility ? { id, label, color, visibility } : { id, label, color })),
  };
  if (metadataValueBytes(value) > MAX_METADATA_ENTRY_BYTES) {
    throw new MetadataTooLargeError(`The shared tags take more than ${MAX_METADATA_ENTRY_BYTES} bytes`);
  }
  return value;
}

/** The list with `tag` added, or replacing the definition with its id. */
export function upsertSharedTag(list: KeywordDefinition[], tag: KeywordDefinition): KeywordDefinition[] {
  const folded = tag.id.toLowerCase();
  const index = list.findIndex((item) => item.id.toLowerCase() === folded);
  if (index === -1) return [...list, tag];
  return list.map((item, i) => (i === index ? { ...tag, id: item.id } : item));
}

/** The list without the definition of `id`. The keyword stays on its messages. */
export function removeSharedTag(list: KeywordDefinition[], id: string): KeywordDefinition[] {
  const folded = id.toLowerCase();
  return list.filter((item) => item.id.toLowerCase() !== folded);
}

/**
 * What a group account shows as its tags: the shared definitions, then
 * every tag found on its messages that no definition names, with the name
 * and colour keyword discovery proposes for it. A keyword that is on a
 * message is never hidden because nobody defined it.
 */
export function groupAccountTags(
  shared: KeywordDefinition[],
  discovered: Record<string, number>,
  nested: boolean,
): { definitions: KeywordDefinition[]; discoveredIds: string[] } {
  const found = findUnrecognizedKeywords(discovered, shared, nested);
  return {
    definitions: [...shared, ...found.map(({ id, label, color }) => ({ id, label, color }))],
    discoveredIds: found.map((entry) => entry.id),
  };
}
