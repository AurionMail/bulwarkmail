'use client';

import { useEffect, useState } from 'react';
import { Download, Info } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { SettingItem, SettingsSection, ToggleSwitch } from '@/components/settings/settings-section';
import { AdminLink } from '@/components/admin/admin-link';
import { parseDomainList } from '@/lib/admin/organisation-policy';
import { toUnicodeDomain } from '@/lib/idn';
import { apiFetch } from '@/lib/browser-navigation';
import { EXTERNAL_MAIL_WARNING_PLUGIN_ID } from '@/lib/plugin-sandbox/host-features';
import { InheritNote } from '../org-page';
import type { OrgPolicyDraft } from '../use-org-policy-draft';

/** The first release of the plugin core took over from that steps back on its own. */
export const PLUGIN_STEPS_BACK_FROM = '1.6.0';

function older(version: string, than: string): boolean {
  const a = version.split(/[-+]/)[0].split('.').map(Number);
  const b = than.split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return false;
}

type InstalledPlugin = { version: string };

/** The External Mail Warning plugin when the admin installed it, else null. */
function useInstalledPlugin(): InstalledPlugin | null {
  const [plugin, setPlugin] = useState<InstalledPlugin | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch('/api/admin/plugins');
        const list = res.ok ? ((await res.json()) as Array<{ id: string; version?: string }>) : [];
        const found = Array.isArray(list) ? list.find((p) => p.id === EXTERNAL_MAIL_WARNING_PLUGIN_ID) : undefined;
        if (!cancelled) setPlugin(found ? { version: found.version ?? '' } : null);
      } catch {
        if (!cancelled) setPlugin(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return plugin;
}

const onOff = (v: boolean) => (v ? 'on' : 'off');

/**
 * Organisation > Security > External mail: the "External" sender label,
 * the confirm before sending outside, which domains are internal, and the
 * hand-over from the External Mail Warning plugin.
 */
export function ExternalMailSection({ draft }: { draft: OrgPolicyDraft }) {
  const senderLabel = draft.orgValue('externalMail', 'senderLabel');
  const recipientWarning = draft.orgValue('externalMail', 'recipientWarning');
  const domains = draft.orgValue('externalMail', 'domains');
  const trustContacts = draft.orgValue('externalMail', 'trustContacts');
  const plugin = useInstalledPlugin();
  const anyOn = senderLabel.value || recipientWarning.value;

  // The list is typed as text and taken apart when the field is left, so a
  // half-typed domain isn't thrown away on every key. It is stored in ASCII
  // (xn--) form and shown in Unicode; entries that aren't domains are named.
  const stored = domains.value.join('\n');
  const joined = domains.value.map(toUnicodeDomain).join('\n');
  const [text, setText] = useState(joined);
  const [rejected, setRejected] = useState<string[]>([]);
  useEffect(() => { setText(joined); }, [joined]);
  const commitDomains = (raw: string) => {
    const parsed = parseDomainList(raw) ?? { domains: [], rejected: [] };
    setRejected(parsed.rejected);
    if (parsed.domains.join('\n') !== stored) draft.setOrgValue('externalMail', 'domains', parsed.domains);
    else setText(joined);
  };

  const [importing, setImporting] = useState(false);
  const importFromPlugin = async () => {
    setImporting(true);
    try {
      const res = await apiFetch(`/api/admin/plugins/${EXTERNAL_MAIL_WARNING_PLUGIN_ID}/config`);
      if (!res.ok) throw new Error(String(res.status));
      const config = (await res.json()) as Record<string, unknown>;
      const parsed = parseDomainList(config.safeDomains) ?? { domains: [], rejected: [] };
      const fromPlugin = parsed.domains;
      setRejected(parsed.rejected);
      const added = fromPlugin.filter((d) => !domains.value.includes(d));
      if (added.length > 0) draft.setOrgValue('externalMail', 'domains', [...domains.value, ...added]);
      draft.setMessage({
        type: 'success',
        text: added.length > 0
          ? `Added ${added.length} ${added.length === 1 ? 'domain' : 'domains'} from the plugin. Save to apply them.`
          : fromPlugin.length > 0 ? 'The list already has every domain the plugin had.' : 'The plugin has no safe domains set.',
      });
    } catch {
      draft.setMessage({ type: 'error', text: 'Could not read the plugin settings' });
    } finally {
      setImporting(false);
    }
  };

  const outdated = !!plugin && older(plugin.version, PLUGIN_STEPS_BACK_FROM);

  return (
    <SettingsSection
      id="external"
      title="External mail"
      description="Label mail from senders outside the organisation and confirm before sending outside it. Both are off until you turn them on."
    >
      <SettingItem label="Label external senders" description="Shows an “External” chip next to the sender of mail from outside the organisation.">
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <ToggleSwitch checked={senderLabel.value} onChange={(v) => draft.setOrgValue('externalMail', 'senderLabel', v)} testId="org-external-sender-label" />
          <InheritNote draft={draft} own={senderLabel.own} everyone={onOff(senderLabel.everyone)} onReset={() => draft.clearOrgValue('externalMail', 'senderLabel')} />
        </div>
      </SettingItem>

      <SettingItem label="Confirm external recipients" description="Before a message goes out, lists the recipients outside the organisation and asks “Send anyway” or “Back”. Quick replies too.">
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <ToggleSwitch checked={recipientWarning.value} onChange={(v) => draft.setOrgValue('externalMail', 'recipientWarning', v)} testId="org-external-recipient-warning" />
          <InheritNote draft={draft} own={recipientWarning.own} everyone={onOff(recipientWarning.everyone)} onReset={() => draft.clearOrgValue('externalMail', 'recipientWarning')} />
        </div>
      </SettingItem>

      <SettingItem label="Trust contacts" description="Recipients in the user's contacts are sent to without asking.">
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <ToggleSwitch checked={trustContacts.value} onChange={(v) => draft.setOrgValue('externalMail', 'trustContacts', v)} testId="org-external-trust-contacts" />
          <InheritNote draft={draft} own={trustContacts.own} everyone={onOff(trustContacts.everyone)} onReset={() => draft.clearOrgValue('externalMail', 'trustContacts')} />
        </div>
      </SettingItem>

      <div className="space-y-2 py-3">
        <label htmlFor="org-external-domains" className="text-sm font-medium text-foreground">More organisation domains</label>
        <p className="text-xs text-muted-foreground">
          Your users&apos; own domains always count as internal. Add partner or sister-company domains here, one per line or separated by commas. A domain covers its subdomains: example.com also covers eu.example.com.
        </p>
        <textarea
          id="org-external-domains"
          data-testid="org-external-domains"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commitDomains(e.target.value)}
          placeholder="partner.com"
          spellCheck={false}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {rejected.length > 0 && (
          <p className="text-xs text-destructive" role="status" data-testid="org-external-domains-rejected">
            Left out, not a domain: {rejected.join(', ')}
          </p>
        )}
        <InheritNote
          draft={draft}
          own={domains.own}
          everyone={domains.everyone.length ? domains.everyone.map(toUnicodeDomain).join(', ') : 'none'}
          onReset={() => draft.clearOrgValue('externalMail', 'domains')}
        />
        {plugin && (
          <Button type="button" variant="outline" size="sm" onClick={() => void importFromPlugin()} disabled={importing} className="gap-1.5" data-testid="org-external-import-plugin">
            <Download className="h-4 w-4" /> Import from the plugin
          </Button>
        )}
      </div>

      {plugin && anyOn && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm" data-testid="org-external-plugin-note">
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-foreground">
              {outdated ? 'Update or remove the External Mail Warning plugin' : 'You can remove the External Mail Warning plugin'}
            </p>
            <p className="text-muted-foreground">
              {outdated
                ? `Version ${plugin.version || 'unknown'} is installed. For each switch that is on, Bulwark skips the matching part of the plugin (its send confirm, or its banner and new-mail toast) so nobody is warned twice; version ${PLUGIN_STEPS_BACK_FROM} and later step back by themselves.`
                : 'It turns off its own send confirm, banner and toast for each switch that is on here.'}{' '}
              &ldquo;Import from the plugin&rdquo; copies its safe domains into the list above.{' '}
              <AdminLink href={`/admin/plugins/${EXTERNAL_MAIL_WARNING_PLUGIN_ID}`} className="underline underline-offset-2 hover:text-foreground">Open the plugin</AdminLink>
            </p>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
