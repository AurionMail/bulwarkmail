import { useMemo } from 'react';
import { useAccountPolicy } from '@/hooks/use-account-policy';
import { orgLibraryTemplates } from '@/lib/templates/org-library';
import {
  ORGANISATION_SOURCE,
  PERSONAL_SOURCE,
  byName,
  type TemplateSource,
} from '@/lib/templates/template-sources';
import { useTemplateStore } from '@/stores/template-store';

export interface TemplateSources {
  /** Personal first, then teams, then the organisation library; empty sources left out except personal. */
  sources: TemplateSource[];
  /** The admin hid personal templates (`personalTemplates` hidden): only organisation and team templates. */
  personalHidden: boolean;
}

/**
 * The templates a user can pick when writing from the signed-in account
 * `accountId` (the active one when left out): their own, and the admin
 * library of that account's policy, so a composer sending from another
 * account shows that account's organisation templates.
 */
export function useTemplateSources(accountId?: string | null): TemplateSources {
  const policy = useAccountPolicy(accountId);
  const personal = useTemplateStore((s) => s.templates);
  const personalHidden = policy.restrictions?.personalTemplates?.hidden === true;
  return useMemo(() => {
    const sources: TemplateSource[] = [];
    if (!personalHidden) {
      sources.push({ key: PERSONAL_SOURCE, kind: 'personal', templates: personal, editable: true, locked: false });
    }
    const organisation = orgLibraryTemplates(policy);
    if (organisation.length > 0) {
      sources.push({ key: ORGANISATION_SOURCE, kind: 'organisation', templates: byName(organisation), editable: false, locked: false });
    }
    return { sources, personalHidden };
  }, [policy, personal, personalHidden]);
}
