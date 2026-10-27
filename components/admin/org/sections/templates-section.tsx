'use client';

import { SettingsSection } from '@/components/settings/settings-section';
import type { OrgPolicyDraft } from '../use-org-policy-draft';

/** Organisation feature 3; filled in by its own step (local-data/org-features-plan.md). */
export function TemplatesSection({ draft }: { draft: OrgPolicyDraft }) {
  void draft;
  return (
    <SettingsSection id="library" title="Organisation library" description="Templates every user can pick in the composer.">
      <p className="text-sm text-muted-foreground">Nothing to set here yet.</p>
    </SettingsSection>
  );
}
