'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Code, Loader2, ShieldCheck, X } from '@/components/icons';
import { apiFetch } from '@/lib/browser-navigation';
import { HIGH_RISK_PERMISSIONS } from '@/lib/plugin-sandbox/permission-text';

interface ApprovalEntry {
  pluginId: string;
  bundleHash: string;
  status: 'pending' | 'approved' | 'denied';
  manifest: {
    name?: string;
    version?: string;
    author?: string;
    description?: string;
    permissions?: string[];
    httpOrigins?: string[];
    apiPostPaths?: string[];
  };
  requestedBy: string;
  requestedAt: string;
  decidedAt?: string;
}

interface SourceView {
  entry: ApprovalEntry;
  code?: string;
  warnings?: string[];
  error?: string;
}

const STATUS_STYLE: Record<ApprovalEntry['status'], string> = {
  pending: 'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
  denied: 'bg-muted text-muted-foreground',
};

/**
 * Plugins users installed themselves and asked to have approved. The admin
 * decides on the package the user uploaded: its manifest and code are read
 * on the server, and the approval is pinned to that exact package.
 */
export function PluginApprovalsPanel() {
  const [entries, setEntries] = useState<ApprovalEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [source, setSource] = useState<SourceView | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/plugin-approvals');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { entries: ApprovalEntry[] };
      setEntries([...data.entries].sort((a, b) =>
        Number(b.status === 'pending') - Number(a.status === 'pending') || b.requestedAt.localeCompare(a.requestedAt)));
      setError(null);
    } catch (e) {
      setError(`Could not load approval requests (${(e as Error).message})`);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function decide(entry: ApprovalEntry, decision: 'approved' | 'denied' | 'revoke') {
    const key = `${entry.pluginId}:${entry.bundleHash}`;
    setBusy(key);
    try {
      const res = decision === 'revoke'
        ? await apiFetch(`/api/admin/plugin-approvals?pluginId=${encodeURIComponent(entry.pluginId)}&bundleHash=${encodeURIComponent(entry.bundleHash)}`, { method: 'DELETE' })
        : await apiFetch('/api/admin/plugin-approvals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pluginId: entry.pluginId, bundleHash: entry.bundleHash, decision }),
          });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(`Could not save the decision (${(e as Error).message})`);
    } finally {
      setBusy(null);
    }
  }

  async function viewSource(entry: ApprovalEntry) {
    setSource({ entry });
    try {
      const res = await apiFetch(`/api/admin/plugin-approvals/source?pluginId=${encodeURIComponent(entry.pluginId)}&bundleHash=${encodeURIComponent(entry.bundleHash)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSource({ entry, code: data.code, warnings: data.warnings });
    } catch (e) {
      setSource({ entry, error: (e as Error).message });
    }
  }

  const pending = entries?.filter((e) => e.status === 'pending').length ?? 0;

  return (
    <div className="border border-border rounded-lg">
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">Approval Requests</h2>
          {pending > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400">{pending} waiting</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Plugins users installed themselves. Read the code before you approve: an approved plugin runs in that user&apos;s mail.</p>
      </div>

      {error && <div className="px-4 py-2 text-sm text-destructive">{error}</div>}

      {entries === null ? (
        <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="inline w-4 h-4 animate-spin" /></div>
      ) : entries.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">No requests yet</div>
      ) : (
        <div className="divide-y divide-border">
          {entries.map((entry) => {
            const key = `${entry.pluginId}:${entry.bundleHash}`;
            const perms = entry.manifest.permissions ?? [];
            return (
              <div key={key} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-foreground">{entry.manifest.name ?? entry.pluginId}</span>
                  <span className="text-xs text-muted-foreground">v{entry.manifest.version}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_STYLE[entry.status]}`}>{entry.status}</span>
                </div>
                {entry.manifest.description && <p className="text-xs text-muted-foreground">{entry.manifest.description}</p>}
                <div className="text-xs text-muted-foreground">
                  {entry.pluginId} · by {entry.manifest.author ?? 'unknown'} · requested by {entry.requestedBy} on {new Date(entry.requestedAt).toLocaleString()}
                </div>
                {perms.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {perms.map((p) => (
                      <span key={p} className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${HIGH_RISK_PERMISSIONS.has(p) ? 'bg-warning/15 text-foreground' : 'bg-muted text-muted-foreground'}`}>{p}</span>
                    ))}
                  </div>
                )}
                {[...(entry.manifest.httpOrigins ?? []), ...(entry.manifest.apiPostPaths ?? [])].length > 0 && (
                  <div className="text-xs text-muted-foreground break-all">
                    Can send data to: {[...(entry.manifest.httpOrigins ?? []), ...(entry.manifest.apiPostPaths ?? [])].join(', ')}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" onClick={() => viewSource(entry)} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-border text-xs hover:bg-accent">
                    <Code className="w-3.5 h-3.5" /> View code
                  </button>
                  {entry.status !== 'approved' && (
                    <button type="button" disabled={busy === key} onClick={() => decide(entry, 'approved')} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                  )}
                  {entry.status !== 'denied' && (
                    <button type="button" disabled={busy === key} onClick={() => decide(entry, 'denied')} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-muted text-foreground text-xs font-medium hover:bg-accent disabled:opacity-50">
                      <X className="w-3.5 h-3.5" /> Deny
                    </button>
                  )}
                  {entry.status !== 'pending' && (
                    <button type="button" disabled={busy === key} onClick={() => decide(entry, 'revoke')} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs text-muted-foreground hover:text-destructive disabled:opacity-50">
                      Forget decision
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {source && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setSource(null); }}>
          <div role="dialog" aria-modal="true" aria-label="Plugin code" className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-medium">{source.entry.manifest.name ?? source.entry.pluginId} v{source.entry.manifest.version}</span>
              <button type="button" onClick={() => setSource(null)} aria-label="Close" className="rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            {source.warnings && source.warnings.length > 0 && (
              <div className="flex items-start gap-2 border-b border-border px-4 py-2 text-xs text-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-warning" /> {source.warnings.join('; ')}
              </div>
            )}
            <pre className="min-h-0 flex-1 overflow-auto p-4 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all">
              {source.error ?? source.code ?? 'Loading…'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
