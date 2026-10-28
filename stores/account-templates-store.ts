/**
 * Templates kept in a mail account rather than only in this browser
 * (Stalwart v1.0.0 and later, JMAP metadata; lib/templates/metadata-templates.ts):
 *
 * - `personal`: this browser's copy of each signed-in account's own
 *   templates, by local account id. An account gets one the first time
 *   its Inbox metadata answers (lib/templates/account-template-sync.ts);
 *   until then, and on servers without metadata, its templates are the
 *   browser's own list in template-store, as they always were.
 * - `teams`: the templates of the group mailboxes each signed-in account
 *   is a member of, as last read. Not kept across reloads: the server
 *   copy is the only one.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EmailTemplate } from '@/lib/template-types';
import type { PersonalCopy } from '@/lib/templates/metadata-templates';

/** Why a personal template could not go to the server and stays in this browser. */
export type LocalOnlyReason = 'too-large' | 'no-room';

export interface PersonalPartition extends PersonalCopy {
  /** Templates the server refused, with why. */
  localOnly: Record<string, LocalOnlyReason>;
}

export interface TeamTemplates {
  /** The group's JMAP account id in the session of the signed-in account. */
  accountId: string;
  /** The group's address, as Stalwart names the account. */
  name: string;
  templates: EmailTemplate[];
  /** The member may change the group Inbox's metadata (myRights.maySetMetadata). */
  mayWrite: boolean;
}

interface AccountTemplatesState {
  personal: Record<string, PersonalPartition>;
  /** The active signed-in account, kept here by the sync driver for the settings bridge. */
  active: string | null;
  teams: Record<string, TeamTemplates[]>;
  setPersonal: (accountId: string, partition: PersonalPartition) => void;
  updatePersonal: (accountId: string, change: (partition: PersonalPartition) => PersonalPartition) => void;
  setTeams: (accountId: string, teams: TeamTemplates[]) => void;
  /** At a full sign-out: keep only what exists nowhere else (templates the server never took). */
  forgetServerCopies: () => void;
}

export const emptyPartition = (): PersonalPartition => ({
  templates: [],
  deletedTemplateIds: {},
  serverVersions: {},
  localOnly: {},
});

export const useAccountTemplatesStore = create<AccountTemplatesState>()(
  persist(
    (set) => ({
      personal: {},
      active: null,
      teams: {},
      setPersonal: (accountId, partition) => set((state) => ({ personal: { ...state.personal, [accountId]: partition } })),
      updatePersonal: (accountId, change) => set((state) => {
        const current = state.personal[accountId];
        if (!current) return state;
        return { personal: { ...state.personal, [accountId]: change(current) } };
      }),
      setTeams: (accountId, teams) => set((state) => ({ teams: { ...state.teams, [accountId]: teams } })),
      forgetServerCopies: () => set((state) => {
        const personal: Record<string, PersonalPartition> = {};
        for (const [accountId, partition] of Object.entries(state.personal)) {
          const unsent = partition.templates.filter((t) => partition.serverVersions[t.id] !== t.updatedAt);
          if (unsent.length === 0) continue;
          personal[accountId] = { ...emptyPartition(), templates: unsent, localOnly: partition.localOnly };
        }
        return { personal, teams: {} };
      }),
    }),
    {
      name: 'account-templates',
      version: 1,
      partialize: (state) => ({ personal: state.personal }),
    },
  ),
);

// A change made here (not one a sync wrote) asks for a sync. The sync
// module registers the listener, so this store doesn't import it.
const changeListeners = new Set<(accountId: string) => void>();

export function onPersonalChange(listener: (accountId: string) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function notifyPersonalChange(accountId: string): void {
  for (const listener of changeListeners) listener(accountId);
}

// Every tab writes the whole state back on a change; pick up another tab's.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== 'account-templates' || event.storageArea !== window.localStorage) return;
    void useAccountTemplatesStore.persist.rehydrate();
  });
}
