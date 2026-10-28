'use client';

import { SettingItem, SettingsSection } from '@/components/settings/settings-section';
import { RESTRICTION_KEYS } from '@/lib/admin/restriction-keys';
import { InheritNote, RestrictionRow } from '../org-page';
import type { OrgPolicyDraft } from '../use-org-policy-draft';

const RECOVERY = RESTRICTION_KEYS.find((def) => def.key === 'deletedItemsRecovery')!;
const MAX_DAYS = 3650;
const DOCS_URL = 'https://bulwarkmail.org/docs/guides/organisation/recover-deleted-items';

function describeDays(days: number): string {
  return days > 0 ? `${days} days` : 'everything the server keeps';
}

/** Organisation > Sharing > Deleted items: how far back users can recover deleted mail, and whether they can. */
export function RecoverySection({ draft }: { draft: OrgPolicyDraft }) {
  const { value, own, everyone } = draft.orgValue('recovery', 'days');
  return (
    <SettingsSection
      id="recovery"
      title="Recover deleted items"
      description="Users can bring back mail they deleted for good (an emptied Trash, for example) under Settings > Recover deleted items, and from a link in Trash."
    >
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" data-testid="org-recovery-requirements">
        This needs a Stalwart Enterprise license and archiving turned on in Stalwart (Data Retention &gt; Archiving, the
        archiveDeletedItemsFor setting). Without both, Bulwark asks the server, gets a refusal, and shows users nothing.{' '}
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
          How to set it up
        </a>
      </div>

      <SettingItem
        label="Show deleted mail of the last"
        description="Limits the list to mail deleted in this many days. Stalwart's own setting decides how long mail is kept; this can only show less."
      >
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <div className="flex items-center gap-2">
            <input
              id="org-recovery-days"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_DAYS}
              step={1}
              aria-label="Show deleted mail of the last (days)"
              placeholder="All"
              value={value > 0 ? value : ''}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const parsed = raw === '' ? 0 : Math.round(Number(raw));
                if (!Number.isFinite(parsed)) return;
                draft.setOrgValue('recovery', 'days', Math.min(MAX_DAYS, Math.max(0, parsed)));
              }}
              className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
          <p className="text-xs text-muted-foreground">Empty shows everything the server keeps.</p>
          <InheritNote draft={draft} own={own} everyone={describeDays(everyone)} onReset={() => draft.clearOrgValue('recovery', 'days')} />
        </div>
      </SettingItem>

      <RestrictionRow draft={draft} def={RECOVERY} />
    </SettingsSection>
  );
}
