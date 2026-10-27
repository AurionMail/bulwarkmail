'use client';

import { OrgPage } from '@/components/admin/org/org-page';
import { useOrgPolicyDraft } from '@/components/admin/org/use-org-policy-draft';
import { SignatureSection } from '@/components/admin/org/sections/signature-section';

export function OrgSignaturesPage() {
  const draft = useOrgPolicyDraft('org-signatures');
  return (
    <OrgPage pageId="org-signatures" draft={draft}>
      <SignatureSection draft={draft} />
    </OrgPage>
  );
}
