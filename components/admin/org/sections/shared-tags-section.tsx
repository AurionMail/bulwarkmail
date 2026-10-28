'use client';

import { SettingsSection } from '@/components/settings/settings-section';
import { restrictionKeysForPage } from '@/lib/admin/restriction-keys';
import { RestrictionRow } from '../org-page';
import type { OrgPolicyDraft } from '../use-org-policy-draft';

/**
 * Organisation feature 6: shared tags in group mailboxes. The tags live in
 * the group's Inbox on the mail server (Stalwart 1.0 metadata), so the only
 * thing to set here is who may change them.
 */
export function SharedTagsSection({ draft }: { draft: OrgPolicyDraft }) {
  return (
    <SettingsSection
      id="shared-tags"
      title="Shared tags"
      description="Members of a group mailbox see the same tag names and colours on its mail; members who may change the mailbox can edit them (Stalwart 1.0 or later)."
    >
      <div data-testid="org-shared-tags-section">
        {restrictionKeysForPage('org-sharing')
          .filter((def) => def.key === 'sharedTags')
          .map((def) => <RestrictionRow key={def.key} draft={draft} def={def} />)}
      </div>
    </SettingsSection>
  );
}
