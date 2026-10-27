'use client';

import { SettingsSection } from '@/components/settings/settings-section';
import type { OrgPolicyDraft } from '../use-org-policy-draft';

/** Organisation feature 2; filled in by its own step (local-data/org-features-plan.md). */
export function ExternalMailSection({ draft }: { draft: OrgPolicyDraft }) {
  void draft;
  return (
    <SettingsSection id="external" title="External mail" description="Label mail from senders outside the organisation and confirm before sending outside it.">
      <p className="text-sm text-muted-foreground">Nothing to set here yet.</p>
    </SettingsSection>
  );
}
