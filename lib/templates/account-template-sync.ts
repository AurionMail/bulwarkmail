/**
 * Keeps each signed-in account's personal templates in its own Inbox
 * metadata (Stalwart v1.0.0 and later; lib/templates/metadata-templates.ts).
 *
 * Every round:
 * - reads the account's template entries and the marker entry with the
 *   tombstones of deleted templates;
 * - merges in the browser's own list (template-store, which settings sync
 *   fills) when it is this account's, each version once, minus templates
 *   a newer tombstone deleted;
 * - merges this browser's copy and the server copy by id and `updatedAt`;
 * - uploads what the server lacks, writes the marker (tombstones first),
 *   then removes the entries the tombstones cover.
 * A missing entry is uploaded again, never taken as a deletion. A template
 * the server refuses for its size stays in this browser.
 *
 * While it isn't known whose the browser's list is (settings sync is on
 * and hasn't loaded this account's settings yet), nothing is taken from
 * it and no marker is written, since the marker lets the settings blob
 * drop its copy.
 *
 * Servers without metadata, and the pre-release 1.0 build that drops the
 * connection on metadata requests, never answer: their accounts keep using
 * the browser's list, and none of this touches the connection state
 * (client.getBulwarkMetadata catches every failure, and pauses the account
 * for ten minutes).
 */

import { MetadataTooLargeError } from '@/lib/jmap/bulwark-metadata';
import type { EmailTemplate } from '@/lib/template-types';
import { mergeSyncedTemplates } from '@/lib/template-utils';
import { debug } from '@/lib/debug';
import { hasMetadata, type TemplateClient } from './account-clients';
import {
  MARKER_KEY,
  MARKER_VERSION,
  isTooLargeForMetadata,
  markerFromMetadata,
  planPersonalSync,
  sameTombstones,
  templateKey,
  templateValue,
  templatesFromMetadata,
  unionTombstones,
  withStorableId,
} from './metadata-templates';
import {
  emptyPartition,
  useAccountTemplatesStore,
  type LocalOnlyReason,
  type PersonalPartition,
} from '@/stores/account-templates-store';

/** The browser's own template list, as far as this account is concerned. */
export type BrowserList =
  /** Not known yet whose it is: take nothing, write no marker. */
  | { status: 'unknown' }
  /** It belongs to another account (or to none in particular and was given to another). */
  | { status: 'none' }
  /** It is this account's. `claim` records that it went into this account. */
  | { status: 'list'; templates: EmailTemplate[]; claim?: () => void };

export type SyncOutcome = 'synced' | 'unsupported';

const running = new Map<string, Promise<SyncOutcome>>();
const again = new Set<string>();

/**
 * One round for the signed-in account `localAccountId`. Rounds for the
 * same account don't overlap; asking during one runs another afterwards.
 */
export function syncPersonalTemplates(localAccountId: string, client: TemplateClient, browserList: () => BrowserList): Promise<SyncOutcome> {
  const current = running.get(localAccountId);
  if (current) {
    again.add(localAccountId);
    return current;
  }
  const round = (async (): Promise<SyncOutcome> => {
    try {
      let outcome = await syncRound(localAccountId, client, browserList);
      while (again.delete(localAccountId) && outcome === 'synced') {
        outcome = await syncRound(localAccountId, client, browserList);
      }
      return outcome;
    } finally {
      running.delete(localAccountId);
      again.delete(localAccountId);
    }
  })();
  running.set(localAccountId, round);
  return round;
}

/** Waits for a round of the account that is under way. */
export function pendingRound(localAccountId: string): Promise<SyncOutcome> | undefined {
  return running.get(localAccountId);
}

async function syncRound(localAccountId: string, client: TemplateClient, browserList: () => BrowserList): Promise<SyncOutcome> {
  const accountId = client.getAccountId();
  if (!accountId || !hasMetadata(client, accountId)) return 'unsupported';
  const entries = await client.getBulwarkMetadata(accountId);
  if (!entries) return 'unsupported';

  const server = templatesFromMetadata(entries);
  const marker = markerFromMetadata(entries);
  const serverTombstones = marker?.deleted ?? {};
  const browser = browserList();
  const store = useAccountTemplatesStore.getState();

  let start: PersonalPartition = store.personal[localAccountId] ?? emptyPartition();
  // Every id has to fit a metadata key.
  if (start.templates.some((t) => withStorableId(t) !== t)) {
    start = { ...start, templates: start.templates.map(withStorableId) };
  }
  if (browser.status === 'list') {
    const fresh = browser.templates.map(withStorableId).filter((t) => start.fromBrowser[t.id] !== t.updatedAt);
    if (fresh.length > 0) {
      const merged = mergeSyncedTemplates(
        { templates: start.templates, deletedTemplateIds: unionTombstones(start.deletedTemplateIds, serverTombstones) },
        { templates: fresh, deletedTemplateIds: {} },
      );
      const fromBrowser = { ...start.fromBrowser };
      for (const t of fresh) fromBrowser[t.id] = t.updatedAt;
      start = { ...start, templates: merged.templates, deletedTemplateIds: merged.deletedTemplateIds, fromBrowser };
    }
    browser.claim?.();
  }
  if (start !== store.personal[localAccountId]) store.setPersonal(localAccountId, start);

  const plan = planPersonalSync(start, server, serverTombstones);
  const serverAfter: Record<string, EmailTemplate> = { ...server };
  const localOnly: Record<string, LocalOnlyReason> = {};
  let reachable = true;

  for (const template of plan.uploads) {
    if (isTooLargeForMetadata(template)) {
      localOnly[template.id] = 'too-large';
      continue;
    }
    if (!reachable) continue;
    try {
      await client.setBulwarkMetadata(accountId, templateKey(template.id), templateValue(template));
      serverAfter[template.id] = template;
    } catch (error) {
      if (error instanceof MetadataTooLargeError) {
        localOnly[template.id] = 'no-room';
      } else {
        // Offline or refused: what is left goes up next time.
        debug.warn('templates', 'Could not save a template in the account:', error);
        reachable = false;
      }
    }
  }

  // The tombstones go up before the entries they delete come off.
  let serverDeleted = serverTombstones;
  let markerOnServer = marker !== null;
  const markerAllowed = browser.status !== 'unknown';
  if (reachable && markerAllowed && (!marker || !sameTombstones(marker.deleted, plan.deletedTemplateIds))) {
    try {
      await client.setBulwarkMetadata(accountId, MARKER_KEY, { version: MARKER_VERSION, deleted: plan.deletedTemplateIds });
      serverDeleted = plan.deletedTemplateIds;
      markerOnServer = true;
    } catch (error) {
      debug.warn('templates', 'Could not save the deleted templates in the account:', error);
      reachable = false;
    }
  }
  for (const id of plan.deletes) {
    if (!reachable || serverDeleted[id] === undefined) continue;
    try {
      await client.setBulwarkMetadata(accountId, templateKey(id), null);
      delete serverAfter[id];
    } catch (error) {
      debug.warn('templates', 'Could not remove a template from the account:', error);
      reachable = false;
    }
  }

  // Changes made here while the round ran come after it: plan them again
  // against the server as it is now (nothing is written), and go round
  // again for what that leaves to do.
  const latest = useAccountTemplatesStore.getState().personal[localAccountId] ?? start;
  const final = planPersonalSync(latest, serverAfter, serverDeleted);
  const serverVersions: Record<string, string> = {};
  for (const [id, template] of Object.entries(serverAfter)) serverVersions[id] = template.updatedAt;
  const keptLocalOnly: Record<string, LocalOnlyReason> = {};
  for (const template of final.templates) {
    if (serverVersions[template.id] === template.updatedAt) continue;
    const reason = localOnly[template.id] ?? latest.localOnly[template.id];
    if (reason) keptLocalOnly[template.id] = reason;
  }
  useAccountTemplatesStore.getState().setPersonal(localAccountId, {
    ...latest,
    templates: final.templates,
    deletedTemplateIds: final.deletedTemplateIds,
    serverVersions,
    serverDeleted,
    markerOnServer,
    localOnly: keptLocalOnly,
  });
  if (latest !== start) again.add(localAccountId);
  return 'synced';
}
