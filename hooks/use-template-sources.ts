import { useMemo } from 'react';
import { useAccountPolicy } from '@/hooks/use-account-policy';
import { orgLibraryTemplates } from '@/lib/templates/org-library';
import {
  ORGANISATION_SOURCE,
  PERSONAL_SOURCE,
  byName,
  teamSourceKey,
  type TemplateSource,
} from '@/lib/templates/template-sources';
import { useTemplateStore } from '@/stores/template-store';
import { useAuthStore } from '@/stores/auth-store';
import { useAccountTemplatesStore } from '@/stores/account-templates-store';

export interface TemplateSources {
  /** Personal first, then teams, then the organisation library; empty sources left out except personal. */
  sources: TemplateSource[];
  /** The admin hid personal templates (`personalTemplates` hidden): only organisation and team templates. */
  personalHidden: boolean;
}

/**
 * The templates a user can pick when writing from the signed-in account
 * `accountId` (the active one when left out): their own, those of the
 * account's group mailboxes, and the admin library of the account's
 * policy, so a composer sending from another account shows that
 * account's templates.
 */
export function useTemplateSources(accountId?: string | null): TemplateSources {
  const policy = useAccountPolicy(accountId);
  const resolvedId = useAuthStore((s) => accountId || s.activeAccountId);
  // The account's own copy once it keeps its templates (Stalwart 1.0),
  // the browser's list before that and on other servers.
  const accountCopy = useAccountTemplatesStore((s) => (resolvedId ? s.personal[resolvedId]?.templates : undefined));
  const browserList = useTemplateStore((s) => s.templates);
  const personal = accountCopy ?? browserList;
  const teams = useAccountTemplatesStore((s) => (resolvedId ? s.teams[resolvedId] : undefined));
  const personalHidden = policy.restrictions?.personalTemplates?.hidden === true;
  // `teamTemplates` locked: members can use them, not change them.
  const teamsLocked = policy.restrictions?.teamTemplates?.locked === true;
  return useMemo(() => {
    const sources: TemplateSource[] = [];
    if (!personalHidden) {
      sources.push({ key: PERSONAL_SOURCE, kind: 'personal', templates: personal, editable: true, locked: false });
    }
    for (const team of teams ?? []) {
      sources.push({
        key: teamSourceKey(team.accountId),
        kind: 'team',
        name: team.name,
        templates: byName(team.templates),
        editable: team.mayWrite && !teamsLocked,
        locked: teamsLocked,
      });
    }
    const organisation = orgLibraryTemplates(policy);
    if (organisation.length > 0) {
      sources.push({ key: ORGANISATION_SOURCE, kind: 'organisation', templates: byName(organisation), editable: false, locked: false });
    }
    return { sources, personalHidden };
  }, [policy, personal, personalHidden, teams, teamsLocked]);
}
