'use client';

import { OrgPage } from '@/components/admin/org/org-page';
import { useOrgPolicyDraft } from '@/components/admin/org/use-org-policy-draft';
import { TemplatesSection } from '@/components/admin/org/sections/templates-section';

export function OrgTemplatesPage() {
  const draft = useOrgPolicyDraft('org-templates');
  return (
    <OrgPage pageId="org-templates" draft={draft}>
      <TemplatesSection draft={draft} />
    </OrgPage>
  );
}
