'use client';

import { SettingsSection } from '@/components/settings/settings-section';
import type { OrgPolicyDraft } from '../use-org-policy-draft';

/** Organisation feature 9; filled in by its own step (local-data/org-features-plan.md). */
export function RecoverySection({ draft }: { draft: OrgPolicyDraft }) {
  void draft;
  return (
    <SettingsSection id="recovery" title="Deleted items" description="Let users recover deleted mail from the server's archive.">
      <p className="text-sm text-muted-foreground">Nothing to set here yet.</p>
    </SettingsSection>
  );
}
