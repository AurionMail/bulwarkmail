/**
 * Team templates: kept in the Inbox metadata of a group account
 * (Stalwart v1.0.0 and later), one namespace per template like personal
 * ones (lib/templates/metadata-templates.ts). Every member sees them; a
 * member whose Inbox rights include setting metadata may change them,
 * unless the admin locked them (`teamTemplates`). There is no copy in the
 * browser: the server copy is read when an account becomes active and
 * when the picker or the template manager opens, and written at once.
 *
 * Two members may edit the same template. A change is written only if the
 * entry is still the version the edit started from; otherwise it is
 * refused ('conflict') and the list is read again.
 *
 * Only group principals count, not a mailbox another person shared
 * (facts §5); on servers without metadata there are no team templates.
 */

import { MetadataRefusedError, MetadataTooLargeError } from '@/lib/jmap/bulwark-metadata';
import type { EmailTemplate } from '@/lib/template-types';
import { debug } from '@/lib/debug';
import { useAccountTemplatesStore, type TeamTemplates } from '@/stores/account-templates-store';
import { clientFor, hasMetadata, type TemplateClient } from './account-clients';
import { isTooLargeForMetadata, templateKey, templateValue, templatesFromMetadata } from './metadata-templates';
import type { TemplateSaveResult } from './template-sources';

/**
 * The group accounts in a client's session: non-personal accounts whose
 * principal is a group. When the server won't say, none.
 */
export async function groupAccounts(client: TemplateClient): Promise<Array<{ id: string; name: string }>> {
  if (typeof client.getSharedAccounts !== 'function' || typeof client.getPrincipalTypes !== 'function') return [];
  const shared = client.getSharedAccounts()
    .filter((account) => !account.isPrimary && client.getAccountInfo?.(account.id)?.isPersonal === false);
  if (shared.length === 0) return [];
  const types = await client.getPrincipalTypes(shared.map((account) => account.id)).catch(() => null);
  if (!types) return [];
  return shared
    .filter((account) => types[account.id] === 'group')
    .map((account) => ({ id: account.id, name: account.name }));
}

/** Whether the member may change the group Inbox's metadata (myRights.maySetMetadata on v1.0.0). */
async function inboxMayWrite(client: TemplateClient, accountId: string): Promise<boolean> {
  if (client.getAccountInfo?.(accountId)?.isReadOnly) return false;
  if (typeof client.getMailboxes !== 'function') return true;
  try {
    const inbox = (await client.getMailboxes(accountId)).find((mailbox) => mailbox.role === 'inbox');
    const rights = inbox?.myRights as unknown as Record<string, boolean> | undefined;
    // A server that doesn't name the right refuses the write itself.
    return rights?.maySetMetadata !== false;
  } catch {
    return false;
  }
}

/** Reads the team templates of every group mailbox of the signed-in account `localAccountId`. */
export async function loadTeamTemplates(localAccountId: string, client: TemplateClient): Promise<TeamTemplates[]> {
  const teams: TeamTemplates[] = [];
  for (const group of await groupAccounts(client)) {
    if (!hasMetadata(client, group.id)) continue;
    const entries = await client.getBulwarkMetadata(group.id);
    if (!entries) continue;
    teams.push({
      accountId: group.id,
      name: group.name,
      templates: Object.values(templatesFromMetadata(entries)),
      mayWrite: await inboxMayWrite(client, group.id),
    });
  }
  useAccountTemplatesStore.getState().setTeams(localAccountId, teams);
  return teams;
}

const lastLoad = new Map<string, number>();

/** Read the team templates again when the last read is older than `maxAgeMs`. */
export function refreshTeamTemplates(localAccountId: string, maxAgeMs = 15_000): void {
  const last = lastLoad.get(localAccountId) ?? 0;
  if (Date.now() - last < maxAgeMs) return;
  const client = clientFor(localAccountId);
  if (!client) return;
  lastLoad.set(localAccountId, Date.now());
  void loadTeamTemplates(localAccountId, client).catch((error) => {
    debug.warn('templates', 'Could not read team templates:', error);
  });
}

function setTeamTemplates(localAccountId: string, groupAccountId: string, templates: EmailTemplate[]) {
  const store = useAccountTemplatesStore.getState();
  const teams = store.teams[localAccountId] ?? [];
  store.setTeams(localAccountId, teams.map((team) => (team.accountId === groupAccountId ? { ...team, templates } : team)));
}

function refusal(error: unknown, template: EmailTemplate | null): TemplateSaveResult {
  if (error instanceof MetadataTooLargeError) return template && isTooLargeForMetadata(template) ? 'too-large' : 'no-room';
  if (error instanceof MetadataRefusedError && error.type === 'forbidden') return 'forbidden';
  debug.warn('templates', 'Could not change a team template:', error);
  return 'failed';
}

/**
 * Reads the group's templates and checks that the entry `id` is still at
 * `base` (the `updatedAt` the edit started from; null for a new one).
 */
async function checkUnchanged(
  localAccountId: string,
  client: TemplateClient & Required<Pick<TemplateClient, 'getBulwarkMetadata'>>,
  groupAccountId: string,
  id: string,
  base: string | null,
): Promise<Record<string, EmailTemplate> | TemplateSaveResult> {
  const entries = await client.getBulwarkMetadata(groupAccountId);
  if (!entries) return 'failed';
  const current = templatesFromMetadata(entries);
  if ((current[id]?.updatedAt ?? null) !== base) {
    setTeamTemplates(localAccountId, groupAccountId, Object.values(current));
    return 'conflict';
  }
  return current;
}

/**
 * Saves a team template in the group's Inbox. `base` is the `updatedAt`
 * of the version the edit started from, null for a new template.
 */
export async function saveTeamTemplate(
  localAccountId: string,
  groupAccountId: string,
  template: EmailTemplate,
  base: string | null,
): Promise<TemplateSaveResult> {
  const client = clientFor(localAccountId);
  if (!client || !hasMetadata(client, groupAccountId)) return 'failed';
  // Identities are each member's own, a favourite is a personal choice,
  // and blind copies don't belong in something the whole team uses.
  const recipients = template.defaultRecipients
    ? { to: template.defaultRecipients.to, cc: template.defaultRecipients.cc }
    : undefined;
  const shared: EmailTemplate = {
    ...template,
    identityId: undefined,
    isFavorite: false,
    defaultRecipients: recipients && (recipients.to?.length || recipients.cc?.length) ? recipients : undefined,
  };
  if (isTooLargeForMetadata(shared)) return 'too-large';
  const current = await checkUnchanged(localAccountId, client, groupAccountId, shared.id, base);
  if (typeof current === 'string') return current;
  try {
    await client.setBulwarkMetadata(groupAccountId, templateKey(shared.id), templateValue(shared));
  } catch (error) {
    return refusal(error, shared);
  }
  setTeamTemplates(localAccountId, groupAccountId, [...Object.values(current).filter((t) => t.id !== shared.id), shared]);
  return 'ok';
}

/** Removes a team template from the group's Inbox, if it is still the version `base`. */
export async function deleteTeamTemplate(localAccountId: string, groupAccountId: string, id: string, base: string): Promise<TemplateSaveResult> {
  const client = clientFor(localAccountId);
  if (!client || !hasMetadata(client, groupAccountId)) return 'failed';
  const current = await checkUnchanged(localAccountId, client, groupAccountId, id, base);
  if (typeof current === 'string') return current;
  try {
    await client.setBulwarkMetadata(groupAccountId, templateKey(id), null);
  } catch (error) {
    return refusal(error, null);
  }
  setTeamTemplates(localAccountId, groupAccountId, Object.values(current).filter((t) => t.id !== id));
  return 'ok';
}
