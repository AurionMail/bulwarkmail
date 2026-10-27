'use client';

import { SettingsSection } from '@/components/settings/settings-section';
import type { OrgPolicyDraft } from '../use-org-policy-draft';

/** Organisation feature 6; filled in by its own step (local-data/org-features-plan.md). */
export function SharedTagsSection({ draft }: { draft: OrgPolicyDraft }) {
  void draft;
  return (
    <SettingsSection id="shared-tags" title="Shared tags" description="Tag names and colours that every member of a shared mailbox sees.">
      <p className="text-sm text-muted-foreground">Nothing to set here yet.</p>
    </SettingsSection>
  );
}
