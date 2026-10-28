/**
 * Team templates: kept in the Inbox metadata of a group account
 * (Stalwart v1.0.0 and later), one namespace per template like personal
 * ones (lib/templates/metadata-templates.ts). Every member sees them; a
 * member whose Inbox rights include setting metadata may change them,
 * unless the admin locked them (`teamTemplates`). There is no copy in the
 * browser: the server copy is read when an account becomes active and
 * when the picker or the template manager opens, and written at once.
 *
 * Only group principals count, not a mailbox another person shared
 * (facts §5); on servers without metadata there are no team templates.
 */

import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { MetadataTooLargeError } from '@/lib/jmap/bulwark-metadata';
import type { EmailTemplate } from '@/lib/template-types';
import { debug } from '@/lib/debug';
import { useAuthStore } from '@/stores/auth-store';
import { useAccountTemplatesStore, type TeamTemplates } from '@/stores/account-templates-store';
import { hasMetadata, type MetadataClient } from './account-template-sync';
import { isTooLargeForMetadata, templateKey, templateValue, templatesFromMetadata } from './metadata-templates';

type TeamClient = MetadataClient & Partial<Pick<IJMAPClient, 'getSharedAccounts' | 'getAccountInfo' | 'getPrincipalTypes' | 'getMailboxes'>>;

/** What a change came to; 'ok' or why it was refused. */
export type TeamSaveResult = 'ok' | 'too-large' | 'no-room' | 'forbidden' | 'failed';

/**
 * The group accounts in a client's session: non-personal accounts whose
 * principal is a group. When the server won't say, none.
 */
export async function groupAccounts(client: TeamClient): Promise<Array<{ id: string; name: string }>> {
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
async function inboxMayWrite(client: TeamClient, accountId: string): Promise<boolean> {
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
export async function loadTeamTemplates(localAccountId: string, client: TeamClient): Promise<TeamTemplates[]> {
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

function clientFor(localAccountId: string): TeamClient | null {
  const auth = useAuthStore.getState();
  const client = auth.getClientForAccount?.(localAccountId) ?? (localAccountId === auth.activeAccountId ? auth.client : null);
  return (client as unknown as TeamClient | null) ?? null;
}

const lastLoad = new Map<string, number>();

/** Read the team templates again when the last read is older than `maxAgeMs`. */
export function refreshTeamTemplates(localAccountId: string, maxAgeMs = 15_000): void {
  const last = lastLoad.get(localAccountId) ?? 0;
  if (Date.now() - last < maxAgeMs) return;
  const client = clientFor(localAccountId);
  if (!client || typeof client.getAccountId !== 'function') return;
  lastLoad.set(localAccountId, Date.now());
  void loadTeamTemplates(localAccountId, client).catch((error) => {
    debug.warn('templates', 'Could not read team templates:', error);
  });
}

function patchTeam(localAccountId: string, groupAccountId: string, change: (templates: EmailTemplate[]) => EmailTemplate[]) {
  const store = useAccountTemplatesStore.getState();
  const teams = store.teams[localAccountId] ?? [];
  store.setTeams(localAccountId, teams.map((team) => (team.accountId === groupAccountId ? { ...team, templates: change(team.templates) } : team)));
}

function refusal(error: unknown, template: EmailTemplate | null): TeamSaveResult {
  if (error instanceof MetadataTooLargeError) return template && isTooLargeForMetadata(template) ? 'too-large' : 'no-room';
  const message = error instanceof Error ? error.message : '';
  if (/forbidden|not allowed|permission/i.test(message)) return 'forbidden';
  debug.warn('templates', 'Could not change a team template:', error);
  return 'failed';
}

/** Saves a team template (new or changed) in the group's Inbox. */
export async function saveTeamTemplate(localAccountId: string, groupAccountId: string, template: EmailTemplate): Promise<TeamSaveResult> {
  const client = clientFor(localAccountId);
  if (!client || !hasMetadata(client, groupAccountId)) return 'failed';
  // Identities are each member's own; a favourite is a personal choice.
  const shared: EmailTemplate = { ...template, identityId: undefined, isFavorite: false };
  if (isTooLargeForMetadata(shared)) return 'too-large';
  try {
    await client.setBulwarkMetadata(groupAccountId, templateKey(shared.id), templateValue(shared));
  } catch (error) {
    return refusal(error, shared);
  }
  patchTeam(localAccountId, groupAccountId, (templates) => [...templates.filter((t) => t.id !== shared.id), shared]);
  return 'ok';
}

/** Removes a team template from the group's Inbox. */
export async function deleteTeamTemplate(localAccountId: string, groupAccountId: string, id: string): Promise<TeamSaveResult> {
  const client = clientFor(localAccountId);
  if (!client || !hasMetadata(client, groupAccountId)) return 'failed';
  try {
    await client.setBulwarkMetadata(groupAccountId, templateKey(id), null);
  } catch (error) {
    return refusal(error, null);
  }
  patchTeam(localAccountId, groupAccountId, (templates) => templates.filter((t) => t.id !== id));
  return 'ok';
}
