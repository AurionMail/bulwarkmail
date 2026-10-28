/**
 * Templates kept in an account's Inbox metadata (Stalwart v1.0.0 and
 * later): one namespace per template, `org.bulwarkmail.template.<id>`,
 * because Stalwart takes at most 8 KB per namespace and 64 KB of shared
 * metadata per mailbox (local-data/org-features-facts.md §2). Personal
 * templates go in the shared metadata of the user's own Inbox (the private
 * part holds only 16 KB), team templates in the group account's Inbox.
 *
 * Deletions of personal templates are recorded as tombstones in the marker
 * entry `org.bulwarkmail.templates` ({ version, deleted: { id: deletedAt } }),
 * and only tombstones delete: an entry that is simply missing (a request
 * that failed half way, another client) is uploaded again, never taken as
 * a deletion.
 *
 * Pure: reading the entries, and planning how the copy in this browser and
 * the server copy come together. lib/templates/account-template-sync.ts
 * does the requests.
 */

import type { EmailTemplate } from '@/lib/template-types';
import { mergeSyncedTemplates, parseSyncedTemplates, parseTemplateTombstones, TEMPLATE_TOMBSTONE_TTL_MS } from '@/lib/template-utils';
import { MAX_METADATA_ENTRY_BYTES, isValidMetadataKey, metadataValueBytes } from '@/lib/jmap/bulwark-metadata';

const KEY_PREFIX = 'template.';
/** The marker entry: tombstones of deleted personal templates. */
export const MARKER_KEY = 'templates';
export const MARKER_VERSION = 1;

/** The metadata key of a template (`template.<id>`). */
export function templateKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

/** Ids Bulwark generates (UUIDs) fit a metadata key; older or imported ones may not. */
export function isStorableTemplateId(id: string): boolean {
  return isValidMetadataKey(templateKey(id));
}

/** 53-bit string hash (cyrb53), as 14 hex digits. */
function hash53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * An id that fits a metadata key, derived from the old one: the same old
 * id gives the same new id on every device and on every import, so the
 * copies still meet by id.
 */
export function storableId(id: string): string {
  return isStorableTemplateId(id) ? id : `${hash53(id, 1)}${hash53(id, 2)}`;
}

/** The same template with an id that fits a metadata key. */
export function withStorableId(template: EmailTemplate): EmailTemplate {
  const id = storableId(template.id);
  return id === template.id ? template : { ...template, id };
}

/** The value stored for a template: the template itself, which carries its id and `updatedAt`. */
export function templateValue(template: EmailTemplate): EmailTemplate {
  return { ...template };
}

/** Whether a template is larger than one metadata entry may be. */
export function isTooLargeForMetadata(template: EmailTemplate): boolean {
  return metadataValueBytes(templateValue(template)) > MAX_METADATA_ENTRY_BYTES;
}

/**
 * The templates among an Inbox's Bulwark metadata entries (`template.<id>`),
 * by id, validated and sanitised like a synced template. The key decides
 * the id.
 */
export function templatesFromMetadata(entries: Record<string, unknown> | null | undefined): Record<string, EmailTemplate> {
  const out: Record<string, EmailTemplate> = {};
  if (!entries) return out;
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(KEY_PREFIX) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const id = key.slice(KEY_PREFIX.length);
    const [template] = parseSyncedTemplates([{ ...(value as Record<string, unknown>), id }]) ?? [];
    if (template) out[id] = template;
  }
  return out;
}

export interface Marker {
  version: number;
  deleted: Record<string, string>;
}

/** The marker entry, or null when there is none. */
export function markerFromMetadata(entries: Record<string, unknown> | null | undefined): Marker | null {
  const value = entries?.[MARKER_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return { version: typeof raw.version === 'number' ? raw.version : MARKER_VERSION, deleted: parseTemplateTombstones(raw.deleted) };
}

/**
 * Tombstones of the last 90 days, newest first as long as the marker entry
 * stays within 8 KB: the oldest go first.
 */
export function pruneTombstones(deleted: Record<string, string>, now: Date = new Date()): Record<string, string> {
  const cutoff = now.getTime() - TEMPLATE_TOMBSTONE_TTL_MS;
  const fresh = Object.entries(deleted)
    .filter(([, at]) => Date.parse(at) >= cutoff)
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
  const kept: Record<string, string> = {};
  for (const [id, at] of fresh) {
    kept[id] = at;
    if (metadataValueBytes({ version: MARKER_VERSION, deleted: kept }) > MAX_METADATA_ENTRY_BYTES) {
      delete kept[id];
      break;
    }
  }
  return kept;
}

/** The newest tombstone per id of both sets. */
export function unionTombstones(a: Record<string, string>, b: Record<string, string>): Record<string, string> {
  const out = { ...a };
  for (const [id, at] of Object.entries(b)) {
    if (!out[id] || Date.parse(at) > Date.parse(out[id])) out[id] = at;
  }
  return out;
}

export function sameTombstones(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((id) => a[id] === b[id]);
}

/** This browser's copy of an account's personal templates. */
export interface PersonalCopy {
  templates: EmailTemplate[];
  /** Tombstones known here: id -> ISO time it was deleted. */
  deletedTemplateIds: Record<string, string>;
  /** `updatedAt` of each template as the server held it at the last sync. */
  serverVersions: Record<string, string>;
}

export interface PersonalSyncPlan {
  /** What this browser keeps after the merge. */
  templates: EmailTemplate[];
  /** All tombstones, pruned: what the marker should hold. */
  deletedTemplateIds: Record<string, string>;
  /** Templates the server lacks or holds an older version of. */
  uploads: EmailTemplate[];
  /** Ids to remove from the server, each covered by a tombstone. */
  deletes: string[];
}

/**
 * Brings this browser's copy and the server copy together, per id with
 * the newer `updatedAt` winning (mergeSyncedTemplates), with the
 * tombstones of both. A tombstone deletes a template it is newer than; an
 * edit newer than the tombstone brings the template back.
 */
export function planPersonalSync(
  local: Pick<PersonalCopy, 'templates' | 'deletedTemplateIds'>,
  server: Record<string, EmailTemplate>,
  serverTombstones: Record<string, string>,
  now: Date = new Date(),
): PersonalSyncPlan {
  const tombstones = unionTombstones(local.deletedTemplateIds, serverTombstones);
  const merged = mergeSyncedTemplates(
    { templates: local.templates, deletedTemplateIds: tombstones },
    { templates: Object.values(server), deletedTemplateIds: {} },
    now,
  );
  const keptIds = new Set(merged.templates.map((t) => t.id));
  const uploads = merged.templates.filter((template) => {
    const there = server[template.id];
    return !there || Date.parse(template.updatedAt) > Date.parse(there.updatedAt);
  });
  const deletes = Object.keys(server).filter((id) => !keptIds.has(id) && merged.deletedTemplateIds[id] !== undefined);
  return { templates: merged.templates, deletedTemplateIds: pruneTombstones(merged.deletedTemplateIds, now), uploads, deletes };
}
