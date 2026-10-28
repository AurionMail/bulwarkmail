/**
 * Templates kept in an account's Inbox metadata (Stalwart v1.0.0 and
 * later): one namespace per template, `org.bulwarkmail.template.<id>`,
 * because Stalwart takes at most 8 KB per namespace and 64 KB of shared
 * metadata per mailbox (local-data/org-features-facts.md §2). Personal
 * templates go in the shared metadata of the user's own Inbox (the private
 * part holds only 16 KB), team templates in the group account's Inbox.
 *
 * Pure: reading the entries, and planning how the copy in this browser and
 * the server copy come together. lib/templates/account-template-sync.ts
 * does the requests.
 */

import type { EmailTemplate } from '@/lib/template-types';
import { mergeSyncedTemplates, parseSyncedTemplates } from '@/lib/template-utils';
import { MAX_METADATA_ENTRY_BYTES, isValidMetadataKey, metadataValueBytes } from '@/lib/jmap/bulwark-metadata';
import { generateUUID } from '@/lib/utils';

const KEY_PREFIX = 'template.';

/** The metadata key of a template (`template.<id>`). */
export function templateKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

/** Ids Bulwark generates (UUIDs) fit a metadata key; older or imported ones may not. */
export function isStorableTemplateId(id: string): boolean {
  return isValidMetadataKey(templateKey(id));
}

/** The same template with an id that fits a metadata key. */
export function withStorableId(template: EmailTemplate): EmailTemplate {
  return isStorableTemplateId(template.id) ? template : { ...template, id: generateUUID() };
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

/** This browser's copy of an account's personal templates. */
export interface PersonalCopy {
  templates: EmailTemplate[];
  /** Deleted here, waiting to be removed from the server: id -> ISO time. */
  deletedTemplateIds: Record<string, string>;
  /** `updatedAt` of each template as the server held it at the last sync. */
  serverVersions: Record<string, string>;
}

export interface PersonalSyncPlan {
  /** What this browser keeps after the merge. */
  templates: EmailTemplate[];
  deletedTemplateIds: Record<string, string>;
  /** Templates the server lacks or holds an older version of. */
  uploads: EmailTemplate[];
  /** Ids to remove from the server. */
  deletes: string[];
}

/**
 * Brings this browser's copy and the server copy together, per id with
 * the newer `updatedAt` winning (mergeSyncedTemplates):
 * - a template the server had at the last sync and no longer has was
 *   deleted elsewhere and goes here too, unless it was changed here since;
 * - a template deleted here goes from the server, unless it was changed
 *   there since;
 * - everything newer here than on the server is uploaded, which includes
 *   templates the server never had (new, or kept here for lack of room).
 */
export function planPersonalSync(
  local: PersonalCopy,
  server: Record<string, EmailTemplate>,
  now: Date = new Date(),
): PersonalSyncPlan {
  const kept = local.templates.filter((template) => {
    const seen = local.serverVersions[template.id];
    if (seen === undefined || server[template.id]) return true;
    return Date.parse(template.updatedAt) > Date.parse(seen);
  });
  const merged = mergeSyncedTemplates(
    { templates: kept, deletedTemplateIds: local.deletedTemplateIds },
    { templates: Object.values(server), deletedTemplateIds: {} },
    now,
  );
  const keptIds = new Set(merged.templates.map((t) => t.id));
  const uploads = merged.templates.filter((template) => {
    const there = server[template.id];
    return !there || Date.parse(template.updatedAt) > Date.parse(there.updatedAt);
  });
  const deletes = Object.keys(server).filter((id) => !keptIds.has(id));
  return { templates: merged.templates, deletedTemplateIds: merged.deletedTemplateIds, uploads, deletes };
}
