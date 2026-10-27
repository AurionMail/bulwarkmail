'use client';

import { OrgPage } from '@/components/admin/org/org-page';
import { useOrgPolicyDraft } from '@/components/admin/org/use-org-policy-draft';
import { SharedTagsSection } from '@/components/admin/org/sections/shared-tags-section';
import { DelegatesSection } from '@/components/admin/org/sections/delegates-section';
import { RecoverySection } from '@/components/admin/org/sections/recovery-section';

export function OrgSharingPage() {
  const draft = useOrgPolicyDraft('org-sharing');
  return (
    <OrgPage pageId="org-sharing" draft={draft}>
      <SharedTagsSection draft={draft} />
      <DelegatesSection draft={draft} />
      <RecoverySection draft={draft} />
    </OrgPage>
  );
}
