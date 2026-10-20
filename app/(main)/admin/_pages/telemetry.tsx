'use client';

import { useEffect, useState } from 'react';
import { Loader2, Send, ExternalLink } from '@/components/icons';
import { SettingsSection, SettingItem, ToggleSwitch } from '@/components/settings/settings-section';
import { Button } from '@/components/ui/button';
import { AdminPageHeader } from '@/components/admin/page-header';
import { AdminSaveBar } from '@/components/admin/save-bar';
import { Flash, useFlash } from '@/components/admin/flash-message';
import { ConfigNote, inputClass } from '@/components/admin/config-items';
import { adminPageDef } from '@/lib/admin/admin-nav';
import { apiFetch } from '@/lib/browser-navigation';
import { useAdminUnsavedChanges } from '@/stores/admin-unsaved-store';
import { cn } from '@/lib/utils';

interface TelemetryStatus {
  consent: 'pending' | 'on' | 'off';
  consentSource: 'env' | 'file';
  endpoint: string;
  defaultEndpoint: string;
  consentedAt: string | null;
  lastSentAt: string | null;
  nextScheduledAt: string | null;
  payloadPreview: Record<string, unknown>;
  accountCounts: { total: number; active7d: number };
}

const PAGE = adminPageDef('telemetry');

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const d = Date.now() - new Date(iso).getTime();
  if (d < 0) return new Date(iso).toLocaleString();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hours ago`;
  const days = Math.floor(h / 24);
  return `${days} days ago`;
}

export function TelemetryPage() {
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [endpointDraft, setEndpointDraft] = useState('');
  const [message, setMessage] = useFlash();

  const endpointDirty = status !== null && endpointDraft !== status.endpoint;
  useAdminUnsavedChanges('telemetry', endpointDirty);

  async function refresh(): Promise<void> {
    setLoading(true);
    try {
      const r = await apiFetch('/api/admin/telemetry');
      if (!r.ok) throw new Error('failed to load');
      const data = (await r.json()) as TelemetryStatus;
      setStatus(data);
      setEndpointDraft(data.endpoint);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function setConsent(consent: 'on' | 'off'): Promise<void> {
    setBusy('consent');
    setMessage(null);
    try {
      const r = await apiFetch('/api/admin/telemetry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set-consent', consent }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setMessage({ type: 'error', text: j.error ?? 'failed' });
      }
      await refresh();
    } finally { setBusy(null); }
  }

  async function saveEndpoint(): Promise<void> {
    setBusy('endpoint');
    setMessage(null);
    try {
      const r = await apiFetch('/api/admin/telemetry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set-endpoint', endpoint: endpointDraft }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setMessage({ type: 'error', text: j.error ?? 'failed' });
      } else {
        setMessage({ type: 'success', text: 'Endpoint saved.' });
      }
      await refresh();
    } finally { setBusy(null); }
  }

  async function sendNow(): Promise<void> {
    setBusy('send');
    setMessage(null);
    try {
      const r = await apiFetch('/api/admin/telemetry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'send-now' }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; status?: number; error?: string };
      setMessage(j.ok
        ? { type: 'success', text: `sent (HTTP ${j.status ?? '?'})` }
        : { type: 'error', text: `failed: ${j.error ?? 'unknown'}` });
      await refresh();
    } finally { setBusy(null); }
  }

  const header = <AdminPageHeader title={PAGE.label} description={PAGE.description} />;

  if (loading || !status) {
    return (
      <div>
        {header}
        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="me-2 h-4 w-4 animate-spin" /> Loading
        </div>
      </div>
    );
  }

  const envOverridden = status.consentSource === 'env';
  const isOn = status.consent === 'on';

  const consentDescription = [
    status.consent === 'pending' && 'Initialising - no heartbeats sent yet.',
    status.consent === 'on' && 'Heartbeats are enabled. Thanks for helping us improve!',
    status.consent === 'off' && 'Heartbeats are off (default).',
    envOverridden && 'Locked by the BULWARK_TELEMETRY env var.',
  ].filter(Boolean).join(' ');

  return (
    <div>
      {header}

      <Flash message={message} onDismiss={() => setMessage(null)} />

      <div className="space-y-10">
        <ConfigNote>
          Bulwark can send one anonymous heartbeat per day so we can see how many instances are
          running, on what platforms, and which features they use. It&apos;s <strong>off by
          default</strong>; one click below enables it and helps us make the product better. No
          email addresses, no hostnames, no IPs are sent.{' '}
          <a
            href="https://bulwarkmail.org/docs/legal/privacy/telemetry"
            target="_blank"
            rel="noreferrer"
            className="underline inline-flex items-center gap-1"
          >
            Full schema and policy <ExternalLink className="h-3 w-3" />
          </a>
        </ConfigNote>

        <SettingsSection id="status" title="Status">
          <SettingItem label="Send anonymous heartbeats" description={consentDescription}>
            <ToggleSwitch
              checked={isOn}
              disabled={busy === 'consent' || envOverridden}
              onChange={(checked) => void setConsent(checked ? 'on' : 'off')}
            />
          </SettingItem>
          <SettingItem label="Last sent">
            <span className="text-sm text-foreground">{timeAgo(status.lastSentAt)}</span>
          </SettingItem>
          <SettingItem label="Next scheduled">
            <span className="text-sm text-foreground">{timeAgo(status.nextScheduledAt)}</span>
          </SettingItem>
          <SettingItem label="Consented at">
            <span className="text-sm text-foreground">{status.consentedAt ? new Date(status.consentedAt).toLocaleString() : '-'}</span>
          </SettingItem>
        </SettingsSection>

        <SettingsSection
          id="accounts"
          title="Account activity"
          description="Unique accounts that have logged in over the last 90 days. Identities are stored as a per-instance HMAC, never as plaintext usernames. These are the numbers reported in the heartbeat as bucketed ranges."
        >
          <SettingItem label="Total (90 days)">
            <span className="text-sm font-mono text-foreground">{status.accountCounts?.total ?? 0}</span>
          </SettingItem>
          <SettingItem label="Active (7 days)">
            <span className="text-sm font-mono text-foreground">{status.accountCounts?.active7d ?? 0}</span>
          </SettingItem>
        </SettingsSection>

        <SettingsSection
          id="endpoint"
          title="Endpoint"
          description="Where heartbeats are sent. Defaults to the project's collector. Point at your own collector (open source at bulwarkmail/dashboard) or clear this field to disable sending."
        >
          <SettingItem label="Collector URL">
            <input
              type="url"
              value={endpointDraft}
              onChange={(e) => { setEndpointDraft(e.target.value); setMessage(null); }}
              placeholder={status.defaultEndpoint}
              aria-label="Collector URL"
              autoComplete="off"
              spellCheck={false}
              className={cn(inputClass, 'w-full sm:w-80')}
            />
          </SettingItem>
        </SettingsSection>

        <SettingsSection
          id="payload"
          title="Payload preview"
          description="Exactly what the next heartbeat would send from this install, right now."
        >
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={busy === 'send' || !isOn}
              onClick={() => void sendNow()}
            >
              {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send now
            </Button>
          </div>
          <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto max-h-96">
            {JSON.stringify(status.payloadPreview, null, 2)}
          </pre>
        </SettingsSection>
      </div>

      <AdminSaveBar
        dirty={endpointDirty}
        saving={busy === 'endpoint'}
        onSave={() => void saveEndpoint()}
        onDiscard={() => setEndpointDraft(status.endpoint)}
        saveLabel="Save endpoint"
      />
    </div>
  );
}
