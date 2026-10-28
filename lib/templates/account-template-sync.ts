/**
 * Keeps each signed-in account's personal templates in its own Inbox
 * metadata, and reads the team templates of its group mailboxes
 * (Stalwart v1.0.0 and later; lib/templates/metadata-templates.ts).
 *
 * Personal templates: the first time an account's metadata answers in this
 * browser and the server holds no templates for it yet, the browser's own
 * list (template-store, which settings sync also fills) is uploaded once,
 * and a marker entry says the account has been set up, so a later empty
 * server copy means "all deleted", not "never uploaded". After that, this
 * browser's copy (account-templates-store) and the server copy are merged
 * on every sync. A template the server refuses for its size stays here.
 *
 * Servers without metadata, and the pre-release 1.0 build that drops the
 * connection on metadata requests, never answer: their accounts keep using
 * the browser's list, and none of this touches the connection state
 * (client.getBulwarkMetadata catches every failure, and pauses the account
 * for ten minutes).
 */

import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { MetadataTooLargeError } from '@/lib/jmap/bulwark-metadata';
import type { EmailTemplate } from '@/lib/template-types';
import { debug } from '@/lib/debug';
import {
  isTooLargeForMetadata,
  planPersonalSync,
  templateKey,
  templateValue,
  templatesFromMetadata,
  withStorableId,
} from './metadata-templates';
import {
  emptyPartition,
  useAccountTemplatesStore,
  type LocalOnlyReason,
  type PersonalPartition,
} from '@/stores/account-templates-store';

/** The entry that says an account's personal templates were set up on the server. */
export const PERSONAL_MARKER_KEY = 'templates';

export type MetadataClient = Pick<IJMAPClient, 'getAccountId'> & Partial<Pick<IJMAPClient,
  'supportsBulwarkMetadata' | 'getBulwarkMetadata' | 'setBulwarkMetadata'>>;

export type SyncOutcome = 'synced' | 'unsupported' | 'busy';

/**
 * The browser's own list, for the one-time upload; null while it isn't
 * this account's (another account's settings are still loaded), and then
 * a server that was never set up waits for a later round.
 */
type LegacySource = () => EmailTemplate[] | null;

const running = new Map<string, Promise<SyncOutcome>>();
const again = new Set<string>();

export function hasMetadata(client: MetadataClient | null | undefined, accountId: string): client is MetadataClient & Required<Pick<MetadataClient, 'getBulwarkMetadata' | 'setBulwarkMetadata'>> {
  return !!client
    && typeof client.getBulwarkMetadata === 'function'
    && typeof client.setBulwarkMetadata === 'function'
    && client.supportsBulwarkMetadata?.(accountId) === true;
}

/**
 * One round for the signed-in account `localAccountId`: read its Inbox
 * metadata, merge, write what changed. Rounds for the same account don't
 * overlap; asking during one runs another afterwards.
 */
export function syncPersonalTemplates(localAccountId: string, client: MetadataClient, legacy: LegacySource): Promise<SyncOutcome> {
  const current = running.get(localAccountId);
  if (current) {
    again.add(localAccountId);
    return current;
  }
  const round = (async (): Promise<SyncOutcome> => {
    try {
      let outcome = await syncRound(localAccountId, client, legacy);
      while (again.delete(localAccountId) && outcome === 'synced') {
        outcome = await syncRound(localAccountId, client, legacy);
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

async function syncRound(localAccountId: string, client: MetadataClient, legacy: LegacySource): Promise<SyncOutcome> {
  const accountId = client.getAccountId();
  if (!accountId || !hasMetadata(client, accountId)) return 'unsupported';
  const entries = await client.getBulwarkMetadata(accountId);
  if (!entries) return 'unsupported';

  const store = useAccountTemplatesStore.getState();
  const server = templatesFromMetadata(entries);
  const setUp = PERSONAL_MARKER_KEY in entries || Object.keys(server).length > 0;
  let partition = store.personal[localAccountId];
  if (!partition) {
    // First answer in this browser. A server that has never held this
    // account's templates gets the browser's own list once.
    partition = emptyPartition();
    if (!setUp) {
      const own = legacy();
      if (!own) return 'unsupported';
      partition.templates = own.map(withStorableId);
    }
    store.setPersonal(localAccountId, partition);
  }

  // Every id has to fit a metadata key; give the odd old one a new id.
  if (partition.templates.some((t) => withStorableId(t) !== t)) {
    partition = { ...partition, templates: partition.templates.map(withStorableId) };
    store.setPersonal(localAccountId, partition);
  }

  const plan = planPersonalSync(partition, server);
  const serverVersions: Record<string, string> = {};
  for (const [id, template] of Object.entries(server)) serverVersions[id] = template.updatedAt;
  const localOnly: Record<string, LocalOnlyReason> = {};
  const failedDeletes = new Set<string>();
  let reachable = true;

  for (const template of plan.uploads) {
    if (isTooLargeForMetadata(template)) {
      localOnly[template.id] = 'too-large';
      continue;
    }
    if (!reachable) continue;
    try {
      await client.setBulwarkMetadata(accountId, templateKey(template.id), templateValue(template));
      serverVersions[template.id] = template.updatedAt;
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
  for (const id of plan.deletes) {
    if (!reachable) {
      failedDeletes.add(id);
      continue;
    }
    try {
      await client.setBulwarkMetadata(accountId, templateKey(id), null);
      delete serverVersions[id];
    } catch (error) {
      debug.warn('templates', 'Could not remove a template from the account:', error);
      failedDeletes.add(id);
      reachable = false;
    }
  }
  if (!setUp && reachable) {
    try {
      await client.setBulwarkMetadata(accountId, PERSONAL_MARKER_KEY, { v: 1 });
    } catch (error) {
      debug.warn('templates', 'Could not mark the account as set up:', error);
    }
  }

  // Changes made here while the round ran are newer than the plan: keep
  // them and go round again.
  const latest = useAccountTemplatesStore.getState().personal[localAccountId] ?? partition;
  const changedMeanwhile = latest !== partition;
  const deletedTemplateIds: Record<string, string> = {};
  for (const [id, at] of Object.entries(plan.deletedTemplateIds)) {
    if (failedDeletes.has(id)) deletedTemplateIds[id] = at;
  }
  const next: PersonalPartition = changedMeanwhile
    ? mergeLater(latest, plan.templates, serverVersions, localOnly)
    : { templates: plan.templates, deletedTemplateIds, serverVersions, localOnly };
  useAccountTemplatesStore.getState().setPersonal(localAccountId, next);
  if (changedMeanwhile) again.add(localAccountId);
  return 'synced';
}

/** The round's result under edits made while it ran: those win. */
function mergeLater(
  latest: PersonalPartition,
  synced: EmailTemplate[],
  serverVersions: Record<string, string>,
  localOnly: Record<string, LocalOnlyReason>,
): PersonalPartition {
  const byId = new Map(synced.map((t) => [t.id, t]));
  for (const template of latest.templates) {
    const known = byId.get(template.id);
    if (!known || Date.parse(template.updatedAt) >= Date.parse(known.updatedAt)) byId.set(template.id, template);
  }
  for (const id of Object.keys(latest.deletedTemplateIds)) byId.delete(id);
  return {
    templates: [...byId.values()],
    deletedTemplateIds: latest.deletedTemplateIds,
    serverVersions,
    localOnly: { ...latest.localOnly, ...localOnly },
  };
}
