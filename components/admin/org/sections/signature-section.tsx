'use client';

import { SettingsSection } from '@/components/settings/settings-section';
import type { OrgPolicyDraft } from '../use-org-policy-draft';

/** Organisation feature 1; filled in by its own step (local-data/org-features-plan.md). */
export function SignatureSection({ draft }: { draft: OrgPolicyDraft }) {
  void draft;
  return (
    <SettingsSection id="signature" title="Signature" description="The signature every message starts with, filled in with each user's details.">
      <p className="text-sm text-muted-foreground">Nothing to set here yet.</p>
    </SettingsSection>
  );
}
