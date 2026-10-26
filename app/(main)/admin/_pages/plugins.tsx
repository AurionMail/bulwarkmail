'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Loader2, Puzzle, Lock, Store, Power, PowerOff, ShieldAlert } from '@/components/icons';
import type { SettingsPolicy } from '@/lib/admin/types';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { apiFetch } from '@/lib/browser-navigation';
import { adminPath } from '@/lib/admin/admin-nav';
import { HIGH_RISK_PERMISSIONS } from '@/lib/plugin-sandbox/permission-text';
import { useAdminUnsavedChanges } from '@/stores/admin-unsaved-store';
import { SettingsSection, SettingItem, ToggleSwitch } from '@/components/settings/settings-section';
import { Button } from '@/components/ui/button';
import { AdminPageHeader } from '@/components/admin/page-header';
import { AdminButtonLink } from '@/components/admin/button-link';
import { AdminList, AdminListRow } from '@/components/admin/list';
import { AdminSaveBar } from '@/components/admin/save-bar';
import { Badge } from '@/components/admin/badge';
import { EmptyState } from '@/components/admin/empty-state';
import { Flash, useFlash } from '@/components/admin/flash-message';
import { ExtensionIcon } from '@/components/admin/extension-icon';
import { PluginApprovalsPanel } from './plugin-approvals-panel';
import { useExtensionIcons } from './use-extension-icons';
import type { ExtensionEntry } from './extension-detail';

export function PluginsPage() {
  const [plugins, setPlugins] = useState<ExtensionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useFlash();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [policy, setPolicy] = useState<SettingsPolicy>({ ...DEFAULT_POLICY });
  const [savedPolicy, setSavedPolicy] = useState<SettingsPolicy>({ ...DEFAULT_POLICY });
  const [savingPolicy, setSavingPolicy] = useState(false);
  const iconFor = useExtensionIcons();

  const fetchPlugins = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/plugins');
      if (res.ok) setPlugins(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPolicy = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/policy');
      if (res.ok) {
        const data = await res.json();
        setPolicy(data);
        setSavedPolicy(data);
      }
    } catch { /* the defaults stay */ }
  }, []);

  useEffect(() => { fetchPlugins(); fetchPolicy(); }, [fetchPlugins, fetchPolicy]);

  const features = policy.features;
  const pluginsEnabled = features.pluginsEnabled ?? true;
  const pluginsUploadEnabled = features.pluginsUploadEnabled ?? true;
  const requirePluginApproval = features.requirePluginApproval ?? true;
  const policyDirty = JSON.stringify(policy.features) !== JSON.stringify(savedPolicy.features);
  useAdminUnsavedChanges('plugins', policyDirty);

  function setFeature(key: 'pluginsEnabled' | 'pluginsUploadEnabled' | 'requirePluginApproval', value: boolean) {
    setPolicy((prev) => ({ ...prev, features: { ...prev.features, [key]: value } }));
    setMessage(null);
  }

  async function savePolicy() {
    setSavingPolicy(true);
    setMessage(null);
    try {
      const res = await apiFetch('/api/admin/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });
      if (res.ok) {
        setSavedPolicy(policy);
        setMessage({ type: 'success', text: 'Plugin policy saved. Users see the change on their next login.' });
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: data.error || 'Could not save the plugin policy' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Could not save the plugin policy' });
    } finally {
      setSavingPolicy(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch('/api/admin/plugins', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        const warnings = data.warnings?.length ? ` (${data.warnings.length} warning${data.warnings.length === 1 ? '' : 's'})` : '';
        setMessage({ type: 'success', text: `"${data.plugin.name}" installed${warnings}` });
        await fetchPlugins();
      } else {
        setMessage({ type: 'error', text: data.error || 'Upload failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Upload failed' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const res = await apiFetch('/api/admin/plugins', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    });
    if (res.ok) {
      setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)));
      return true;
    }
    const data = await res.json().catch(() => ({}));
    setMessage({ type: 'error', text: data.error || 'Could not change the plugin' });
    return false;
  }

  async function setAll(enabled: boolean) {
    const targets = plugins.filter((p) => p.enabled !== enabled);
    if (targets.length === 0) return;
    setBulkBusy(true);
    setMessage(null);
    let failed = 0;
    for (const p of targets) {
      if (!(await setEnabled(p.id, enabled))) failed++;
    }
    await fetchPlugins();
    setBulkBusy(false);
    setMessage(failed === 0
      ? { type: 'success', text: `${targets.length} plugin${targets.length === 1 ? '' : 's'} ${enabled ? 'enabled' : 'disabled'}` }
      : { type: 'error', text: `${failed} plugin${failed === 1 ? '' : 's'} could not be ${enabled ? 'enabled' : 'disabled'}` });
  }

  const enabledCount = plugins.filter((p) => p.enabled).length;

  return (
    <div>
      <AdminPageHeader
        title="Plugins"
        description="Plugins installed for every user of this Bulwark. Open one to configure it."
        actions={(
          <>
            <AdminButtonLink href={adminPath('marketplace')}>
              <Store className="h-4 w-4" />
              Marketplace
            </AdminButtonLink>
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload plugin
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleUpload}
                disabled={uploading}
                className="sr-only"
              />
            </label>
          </>
        )}
      />

      <Flash message={message} onDismiss={() => setMessage(null)} />

      <div className="space-y-10">
        <PluginApprovalsPanel />

        <SettingsSection
          id="installed"
          title="Installed plugins"
          description={loading || plugins.length === 0 ? undefined : `${enabledCount} of ${plugins.length} enabled. The switch turns a plugin on or off for everyone.`}
        >
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="me-2 h-4 w-4 animate-spin" /> Loading
            </div>
          ) : plugins.length === 0 ? (
            <EmptyState
              icon={Puzzle}
              title="No plugins installed"
              hint="Install one from the marketplace or upload a plugin ZIP."
              action={<AdminButtonLink href={adminPath('marketplace')}><Store className="h-4 w-4" /> Browse the marketplace</AdminButtonLink>}
            />
          ) : (
            <>
              {plugins.length > 1 && (
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" disabled={bulkBusy || enabledCount === plugins.length} onClick={() => setAll(true)}>
                    <Power className="h-3.5 w-3.5" /> Enable all
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" disabled={bulkBusy || enabledCount === 0} onClick={() => setAll(false)}>
                    <PowerOff className="h-3.5 w-3.5" /> Disable all
                  </Button>
                </div>
              )}
              <AdminList>
                {plugins.map((plugin) => {
                  const perms = plugin.permissions ?? [];
                  const risky = perms.filter((p) => HIGH_RISK_PERMISSIONS.has(p));
                  return (
                    <AdminListRow
                      key={plugin.id}
                      data-testid={`admin-plugin-${plugin.id}`}
                      href={adminPath('plugins', plugin.id)}
                      icon={<ExtensionIcon url={iconFor(plugin)} fallback={Puzzle} />}
                      title={plugin.name}
                      titleExtra={(
                        <>
                          <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                          {!plugin.enabled && <Badge>Off</Badge>}
                          {plugin.forceEnabled && <Badge tone="warning" icon={<Lock className="h-3 w-3" />}>Forced on</Badge>}
                          {plugin.dev && <Badge tone="info" title="Loaded from the dev plugins directory">Dev</Badge>}
                          {risky.length > 0 && (
                            <Badge tone="warning" icon={<ShieldAlert className="h-3 w-3" />} title={risky.join(', ')}>
                              {risky.length} high-risk permission{risky.length === 1 ? '' : 's'}
                            </Badge>
                          )}
                        </>
                      )}
                      description={plugin.description}
                      meta={(
                        <>
                          by {plugin.author || 'unknown'}
                          {plugin.type && <> &middot; {plugin.type}</>}
                          {perms.length > 0 && <> &middot; {perms.length} permission{perms.length === 1 ? '' : 's'}</>}
                          {plugin.source?.kind === 'marketplace' && <> &middot; Marketplace</>}
                        </>
                      )}
                      control={(
                        <ToggleSwitch
                          checked={plugin.enabled}
                          onChange={(checked) => { setMessage(null); void setEnabled(plugin.id, checked); }}
                          ariaLabel={`${plugin.name} enabled`}
                        />
                      )}
                    />
                  );
                })}
              </AdminList>
            </>
          )}
        </SettingsSection>

        <SettingsSection id="policy" title="Plugin policy" description="What users may do with plugins on their own.">
          <SettingItem label="Plugins" description="Load and run plugins for users at all. Off hides the plugin system everywhere.">
            <ToggleSwitch checked={pluginsEnabled} onChange={(v) => setFeature('pluginsEnabled', v)} />
          </SettingItem>
          <SettingItem label="Users may upload plugins" description="Let users install plugin ZIPs for their own account from their settings.">
            <ToggleSwitch checked={pluginsUploadEnabled} disabled={!pluginsEnabled} onChange={(v) => setFeature('pluginsUploadEnabled', v)} />
          </SettingItem>
          <SettingItem
            label="Require approval"
            description="A plugin a user uploads stays off until an admin has approved that exact package here."
          >
            <ToggleSwitch checked={requirePluginApproval} disabled={!pluginsEnabled || !pluginsUploadEnabled} onChange={(v) => setFeature('requirePluginApproval', v)} />
          </SettingItem>
        </SettingsSection>
      </div>

      <AdminSaveBar
        dirty={policyDirty}
        saving={savingPolicy}
        onSave={savePolicy}
        onDiscard={() => setPolicy(savedPolicy)}
        saveLabel="Save policy"
        note="Users see the change on their next login"
      />
    </div>
  );
}
