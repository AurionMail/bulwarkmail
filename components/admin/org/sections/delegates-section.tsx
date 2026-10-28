'use client';

import { SettingsSection } from '@/components/settings/settings-section';
import { RESTRICTION_KEYS } from '@/lib/admin/restriction-keys';
import { RestrictionRow } from '../org-page';
import type { OrgPolicyDraft } from '../use-org-policy-draft';

const DELEGATION = RESTRICTION_KEYS.find((def) => def.key === 'delegation')!;
const DELEGATION_RIGHTS = RESTRICTION_KEYS.find((def) => def.key === 'delegationRights')!;

/** Organisation > Sharing > Delegates: whether users may delegate, and which rights. */
export function DelegatesSection({ draft }: { draft: OrgPolicyDraft }) {
  const rights = draft.restriction(DELEGATION_RIGHTS.key).value;
  const noneTicked = Array.isArray(rights?.allowedValues) && rights.allowedValues.length === 0;
  return (
    <SettingsSection
      id="delegates"
      title="Delegates"
      description="Users can give a colleague read or read and write access to their mail folders, calendars and address books in one step, under Settings > Sharing. Stalwart doesn't let delegates send as the user; for an address several people send from, set up a shared mailbox."
    >
      <RestrictionRow draft={draft} def={DELEGATION} />
      <RestrictionRow draft={draft} def={DELEGATION_RIGHTS} />
      {noneTicked && (
        <p className="text-xs text-destructive" role="status">
          With neither ticked nothing is limited, so delegates can get both. Tick &quot;read&quot; to allow read access only.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        These apply to the Delegates dialog only. Sharing one folder, calendar or file from its own menu works as before, and Stalwart
        itself enforces neither setting.
      </p>
    </SettingsSection>
  );
}
