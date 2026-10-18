'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpCircle,
  Download,
  Loader2,
  Puzzle,
  SwatchBook,
  Star,
  Trash2,
  Check,
  Settings as SettingsIcon,
  ExternalLink,
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  FileCode,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Ban,
  Info,
  Eye,
} from '@/components/icons';
import { apiFetch } from '@/lib/browser-navigation';
import { compareVersions, isVersionSatisfied } from '@/lib/version-compare';
import type { MarketplaceListing } from '@/lib/admin/marketplace-directory';
import { installVersion } from '../../_tabs/marketplace';

const CURRENT_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

interface VersionRow {
  version: string;
  channel: 'stable' | 'beta';
  publishedAt: string | null;
  minAppVersion: string | null;
  maxAppVersion: string | null;
  permissions: string[];
  size: number;
  sha256: string;
  yanked: { at: string; reason: string | null } | null;
  changelog: string | null;
  downloads: number;
  signed: boolean;
  commit: string | null;
}

interface Advisory {
  id: string;
  affected: string;
  fixedIn: string | null;
  severity: string;
  summary: string;
  details: string | null;
  withdrawn: boolean;
}

interface HistoryEntry {
  version: string;
  savedAt: string;
  contentHash: string;
}

interface PreviewData {
  extension: MarketplaceListing & {
    longDescription: string | null;
    newestVersion: string | null;
    newestMinAppVersion: string | null;
    versions: VersionRow[];
    screenshots: Array<{ url: string; altText: string | null }>;
    themePreviews: Array<{ variant: 'light' | 'dark'; url: string | null; colors: Record<string, string> | null }>;
    advisories: Advisory[];
    permissionDetails: Array<{ id: string; title: string; body: string; highRisk: boolean }>;
    source: { host: string; repo: string | null; subpath: string | null };
    createdAt: string | null;
    updatedAt: string | null;
  };
  preview: { version: string; channel: 'stable' | 'beta'; yanked: VersionRow['yanked']; minAppVersion: string | null; maxAppVersion: string | null } | null;
  requestedVersionMissing: string | null;
  bundle: {
    manifest: Record<string, unknown> | null;
    source: { name: string; content: string; truncated: boolean } | null;
    size: number;
    error: string | null;
    signature: { status: 'verified' | 'unsigned' | 'invalid'; keyId?: string; reason?: string } | null;
  };
  installed: boolean;
  installedVersion: string | null;
  installedSource: { kind: 'marketplace' | 'upload' } | null;
  history: HistoryEntry[];
  channel: 'stable' | 'beta';
  appVersion: string | null;
  directoryUrl: string;
}

const RISKY_PERMISSIONS = new Set([
  'mail:write',
  'mail:delete',
  'storage:write',
  'network',
  'admin',
]);

/** Whether this Bulwark can run a version, given what the directory says it needs. */
function fits(v: { minAppVersion: string | null; maxAppVersion: string | null }): boolean {
  if (!isVersionSatisfied(CURRENT_APP_VERSION, v.minAppVersion)) return false;
  if (v.maxAppVersion && compareVersions(CURRENT_APP_VERSION, v.maxAppVersion) > 0) return false;
  return true;
}

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');
const fmtSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`);

export default function MarketplacePreviewPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [showManifest, setShowManifest] = useState(false);
  // The version being previewed, from the install link (?version=) or a row
  // the admin picked. Read from the address bar, like the connector does.
  const [selected, setSelected] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setSelected(new URLSearchParams(window.location.search).get('version'));
  }, []);

  const fetchPreview = useCallback(async (version: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const query = version ? `?version=${encodeURIComponent(version)}` : '';
      const res = await apiFetch(`/api/admin/marketplace/${encodeURIComponent(slug)}${query}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to load preview');
        return;
      }
      setData(await res.json());
    } catch {
      setError('Failed to connect to extension directory');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (selected === undefined) return;
    fetchPreview(selected);
  }, [fetchPreview, selected]);

  function pick(version: string | null) {
    const url = new URL(window.location.href);
    if (version) url.searchParams.set('version', version);
    else url.searchParams.delete('version');
    window.history.replaceState(null, '', url.toString());
    setSelected(version);
    setMessage(null);
  }

  async function handleInstall(version: string) {
    if (!data) return;
    const isUpdate = data.installed;
    setBusy(`install:${version}`);
    setMessage(null);
    const result = await installVersion({ slug: data.extension.slug, version, type: data.extension.type });
    setBusy(null);
    if (!result.ok) {
      setMessage({ type: 'error', text: result.error });
      return;
    }
    const warnings = result.warnings.length ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})` : '';
    const signed = result.signature === 'verified' ? ', signed by the directory' : '';
    setMessage({
      type: 'success',
      text: isUpdate
        ? `"${data.extension.name}" is now v${version}${signed}${warnings}`
        : `"${data.extension.name}" installed (v${version})${signed}${warnings}`,
    });
    fetchPreview(selected ?? null);
  }

  async function handleRollback(version: string) {
    if (!data) return;
    if (!confirm(`Put v${version} of "${data.extension.name}" back in place of v${data.installedVersion}? The copy kept on this server is used; the directory is not asked.`)) return;
    setBusy(`rollback:${version}`);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/admin/extensions/${data.extension.type}/${encodeURIComponent(data.extension.slug)}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({ type: 'success', text: `"${data.extension.name}" rolled back to v${version}` });
        fetchPreview(selected ?? null);
      } else {
        setMessage({ type: 'error', text: body.error || 'Rollback failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Rollback failed - network error' });
    } finally {
      setBusy(null);
    }
  }

  async function handleUninstall() {
    if (!data) return;
    if (!confirm(`Remove "${data.extension.name}"? Its kept versions are removed too; this cannot be undone.`)) return;

    setUninstalling(true);
    setMessage(null);
    try {
      const endpoint = data.extension.type === 'theme'
        ? '/api/admin/themes'
        : '/api/admin/plugins';
      const res = await apiFetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.extension.slug }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({ type: 'success', text: `"${data.extension.name}" removed` });
        fetchPreview(selected ?? null);
      } else {
        setMessage({ type: 'error', text: body.error || 'Uninstall failed' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Uninstall failed - network error' });
    } finally {
      setUninstalling(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin me-2" />
        Loading...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/marketplace"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Marketplace
        </Link>
        <p className="text-sm text-destructive">{error || 'Extension not found'}</p>
      </div>
    );
  }

  const ext = data.extension;
  const bundle = data.bundle;
  const preview = data.preview;
  const isPlugin = ext.type === 'plugin';
  const manifestPerms = (bundle.manifest?.permissions as string[] | undefined) || preview && ext.versions.find((v) => v.version === preview.version)?.permissions || ext.permissions || [];
  const permissionText = new Map(ext.permissionDetails.map((p) => [p.id, p]));
  const frameOrigins = (bundle.manifest?.frameOrigins as string[] | undefined) || [];
  const settingsSchema = bundle.manifest?.settingsSchema as Record<string, { type: string; label: string; description?: string; default?: unknown }> | undefined;

  const previewFits = preview ? fits(preview) : false;
  const previewIsInstalled = !!preview && data.installed && data.installedVersion === preview.version;
  const previewDirection = preview && data.installed && data.installedVersion
    ? compareVersions(preview.version, data.installedVersion)
    : 0;
  const installedRow = data.installedVersion ? ext.versions.find((v) => v.version === data.installedVersion) ?? null : null;
  const suspended = ext.status === 'suspended';
  const historyVersions = new Set(data.history.map((h) => h.version));
  const canInstallPreview = !!preview && !bundle.error && previewFits && !suspended && bundle.signature?.status !== 'invalid';

  // Versions no longer in the directory's list but still kept here.
  const extraHistory = data.history.filter((h) => !ext.versions.some((v) => v.version === h.version));

  const installLabel = !preview
    ? 'Install'
    : previewIsInstalled
      ? `Reinstall v${preview.version}`
      : !data.installed
        ? `Install v${preview.version}`
        : previewDirection > 0
          ? `Update to v${preview.version}`
          : `Install v${preview.version} (older)`;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back link */}
      <Link
        href="/admin/marketplace"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Marketplace
      </Link>

      {/* Banner / hero */}
      {ext.bannerUrl && (
        <div className="mb-6 overflow-hidden rounded-lg border border-border bg-muted">
          <img
            src={ext.bannerUrl}
            alt=""
            className="block w-full max-h-64 object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
            {ext.iconUrl ? (
              <img
                src={ext.iconUrl}
                alt=""
                className="w-14 h-14 object-cover"
                loading="lazy"
              />
            ) : isPlugin ? (
              <Puzzle className="w-7 h-7 text-muted-foreground" />
            ) : (
              <SwatchBook className="w-7 h-7 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="text-2xl font-semibold text-foreground break-words min-w-0">{ext.name}</h1>
              {ext.featured && <Star className="w-4 h-4 text-warning fill-warning shrink-0" />}
              {data.installed && (
                <span
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 font-medium"
                >
                  <Check className="w-3 h-3" /> Installed v{data.installedVersion}
                </span>
              )}
              {data.installed && ext.latest && data.installedVersion && compareVersions(ext.latest.version, data.installedVersion) > 0 && (
                <button
                  onClick={() => pick(ext.latest!.version)}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 font-medium hover:underline"
                  title={`Preview v${ext.latest.version}`}
                >
                  <ArrowUpCircle className="w-3 h-3" /> v{ext.latest.version} available
                </button>
              )}
              {ext.deprecated && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">Deprecated</span>
              )}
              {suspended && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-destructive/10 text-destructive font-medium"><Ban className="w-3 h-3" /> Suspended</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground flex-wrap">
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                isPlugin
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                  : 'bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400'
              }`}>
                {isPlugin ? (ext.pluginType || 'plugin') : 'theme'}
              </span>
              {ext.author && (
                <span className="inline-flex items-center gap-1">
                  by {ext.author.displayName}
                  {ext.author.verified && <ShieldCheck className="w-3.5 h-3.5" aria-label="verified author" />}
                </span>
              )}
              {ext.license && <span>{ext.license}</span>}
              <span className="inline-flex items-center gap-1">
                <Download className="w-3 h-3" />
                {ext.totalDownloads.toLocaleString()}
              </span>
              {ext.rating.count > 0 && (
                <span className="inline-flex items-center gap-1" title={`${ext.rating.average} out of 5 from ${ext.rating.count} rating${ext.rating.count === 1 ? '' : 's'}`}>
                  <Star className="w-3 h-3 fill-current" />
                  {ext.rating.average.toFixed(1)} ({ext.rating.count})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {preview && (
            <button
              onClick={() => handleInstall(preview.version)}
              disabled={!!busy || !canInstallPreview}
              title={!previewFits
                ? `v${preview.version} needs Bulwark ${preview.minAppVersion ?? 'any'}${preview.maxAppVersion ? ` to ${preview.maxAppVersion}` : ' or later'}. You are running v${CURRENT_APP_VERSION}.`
                : preview.yanked ? 'This version was withdrawn by its publisher; you will be asked to confirm.' : undefined}
              className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                previewIsInstalled
                  ? 'border border-border text-foreground hover:bg-muted'
                  : previewDirection > 0
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
            >
              {busy === `install:${preview.version}` ? <Loader2 className="w-4 h-4 animate-spin" /> : previewDirection > 0 ? <ArrowUpCircle className="w-4 h-4" /> : <Download className="w-4 h-4" />}
              {installLabel}
            </button>
          )}
          {data.installed && (
            <>
              <Link
                href={isPlugin ? `/admin/plugins/${ext.slug}` : '/admin/themes'}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                <SettingsIcon className="w-4 h-4" />
                Manage
              </Link>
              <button
                onClick={handleUninstall}
                disabled={uninstalling}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                {uninstalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Uninstall
              </button>
            </>
          )}
          <a
            href={ext.directoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors"
            title="Open this extension's page in the directory"
          >
            <ExternalLink className="w-4 h-4" />
            Directory
          </a>
        </div>
      </div>

      {message && (
        <div className={`text-sm rounded-md px-3 py-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-destructive/10 text-destructive'}`}>
          {message.text}
        </div>
      )}

      {/* Notices */}
      {data.requestedVersionMissing && (
        <Notice tone="warning" title={`The link asked for v${data.requestedVersionMissing}, which the directory no longer offers`}>
          Showing v{preview?.version} instead.
        </Notice>
      )}
      {suspended && (
        <Notice tone="danger" title="This extension was suspended by the directory">
          It cannot be installed. {data.installed ? 'Consider removing it.' : ''}
        </Notice>
      )}
      {ext.deprecated && (
        <Notice tone="info" title="This extension is deprecated">
          {ext.deprecated.message || 'Its publisher no longer maintains it.'}
          {ext.deprecated.replacement && <> Use <Link href={`/admin/marketplace/${encodeURIComponent(ext.deprecated.replacement)}`} className="underline">{ext.deprecated.replacement}</Link> instead.</>}
        </Notice>
      )}
      {ext.advisories.filter((a) => !a.withdrawn).map((a) => (
        <Notice key={a.id} tone="danger" title={`Security advisory ${a.id} (${a.severity})`}>
          {a.summary} Affects {a.affected}{a.fixedIn ? `; fixed in v${a.fixedIn}` : '; no fixed version yet'}.
          {installedRow && data.installedVersion && a.fixedIn && compareVersions(data.installedVersion, a.fixedIn) < 0 && (
            <> <b>Your installed v{data.installedVersion} is affected.</b></>
          )}
        </Notice>
      ))}
      {installedRow?.yanked && (
        <Notice tone="warning" title={`The installed v${installedRow.version} was withdrawn by its publisher`}>
          {installedRow.yanked.reason || 'No reason was given.'} Pick another version below.
        </Notice>
      )}
      {preview?.yanked && !previewIsInstalled && (
        <Notice tone="warning" title={`v${preview.version} was withdrawn by its publisher`}>
          {preview.yanked.reason || 'No reason was given.'} It can still be installed, but you will be asked to confirm.
        </Notice>
      )}
      {preview && !previewFits && (
        <Notice tone="warning" title={preview.maxAppVersion && compareVersions(CURRENT_APP_VERSION, preview.maxAppVersion) > 0 ? 'This version is for an older Bulwark' : 'Update Bulwark to install this version'}>
          v{preview.version} needs Bulwark {preview.minAppVersion ?? 'any version'}{preview.maxAppVersion ? ` up to ${preview.maxAppVersion}` : ' or later'}. You are running v{CURRENT_APP_VERSION}.
          {!preview.yanked && ext.latest && ext.latest.version !== preview.version && (
            <> <button className="underline" onClick={() => pick(ext.latest!.version)}>v{ext.latest.version}</button> runs here.</>
          )}
        </Notice>
      )}
      {!ext.latest && !preview && (
        <Notice tone="warning" title="No version runs on this Bulwark">
          {ext.newestVersion ? `The newest, v${ext.newestVersion}, needs Bulwark ${ext.newestMinAppVersion ?? 'a newer version'}.` : 'Nothing has been published yet.'}
        </Notice>
      )}
      {bundle.error && (
        <Notice tone="warning" title="Could not preview bundle">{bundle.error}</Notice>
      )}
      {bundle.signature?.status === 'invalid' && (
        <Notice tone="danger" title="The directory's signature on this bundle does not check out">
          {bundle.signature.reason}. It will not be installed.
        </Notice>
      )}

      {/* Description */}
      <section className="border border-border rounded-lg p-4">
        <h2 className="text-sm font-medium text-foreground">About</h2>
        <p className="text-sm text-muted-foreground mt-2">{ext.description}</p>
        {ext.longDescription && ext.longDescription !== ext.description && (
          <p className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">{ext.longDescription}</p>
        )}
        {ext.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {ext.tags.map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-4 pt-3 border-t border-border flex-wrap">
          {preview && <span>Previewing v{preview.version}{preview.channel === 'beta' ? ' (beta)' : ''}</span>}
          {bundle.size > 0 && <span>Bundle: {fmtSize(bundle.size)}</span>}
          {bundle.signature?.status === 'verified' && (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400" title={`Signed by the directory, key ${bundle.signature.keyId}`}>
              <ShieldCheck className="w-3 h-3" /> Signed by the directory
            </span>
          )}
          {bundle.signature?.status === 'unsigned' && (
            <span className="inline-flex items-center gap-1" title="No directory root key is configured, so the signature is not checked">
              <Info className="w-3 h-3" /> Signature not checked
            </span>
          )}
          {ext.source.repo && (
            <a
              href={`https://${ext.source.host}/${ext.source.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <ExternalLink className="w-3 h-3" />
              {ext.source.host === 'github.com' ? '' : `${ext.source.host}/`}{ext.source.repo}
            </a>
          )}
        </div>
      </section>

      {/* Versions */}
      <section className="border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">Versions</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every published version. Versions this server still has a copy of can be put back without the directory.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-start font-medium px-4 py-2">Version</th>
                <th className="text-start font-medium px-4 py-2">Released</th>
                <th className="text-start font-medium px-4 py-2">Needs Bulwark</th>
                <th className="text-start font-medium px-4 py-2">Size</th>
                <th className="text-start font-medium px-4 py-2">Status</th>
                <th className="text-end font-medium px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ext.versions.map((v) => {
                const isInstalled = data.installed && data.installedVersion === v.version;
                const isPreview = preview?.version === v.version;
                const kept = historyVersions.has(v.version);
                const runs = fits(v);
                const key = `install:${v.version}`;
                return (
                  <tr key={v.version} className={isPreview ? 'bg-muted/40' : undefined}>
                    <td className="px-4 py-2 align-top">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <code className="text-xs font-mono text-foreground">v{v.version}</code>
                        {v.channel === 'beta' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400">beta</span>}
                        {v.signed && <ShieldCheck className="w-3 h-3 text-muted-foreground" aria-label="signed" />}
                      </div>
                      {v.changelog && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-wrap max-w-xs">{v.changelog}</p>}
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">{fmtDate(v.publishedAt)}</td>
                    <td className="px-4 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">
                      {v.minAppVersion ?? 'any'}{v.maxAppVersion ? ` to ${v.maxAppVersion}` : v.minAppVersion ? '+' : ''}
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">{fmtSize(v.size)}</td>
                    <td className="px-4 py-2 align-top text-xs">
                      <div className="flex flex-col gap-1 items-start">
                        {isInstalled && <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Check className="w-3 h-3" /> Installed</span>}
                        {v.yanked && <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300" title={v.yanked.reason ?? undefined}><AlertTriangle className="w-3 h-3" /> Withdrawn</span>}
                        {!runs && <span className="text-muted-foreground">Not for v{CURRENT_APP_VERSION}</span>}
                        {kept && !isInstalled && <span className="inline-flex items-center gap-1 text-muted-foreground"><RotateCcw className="w-3 h-3" /> Kept here</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {!isPreview && (
                          <button
                            onClick={() => pick(v.version)}
                            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                            title="Preview this version"
                          >
                            <Eye className="w-3 h-3" /> Preview
                          </button>
                        )}
                        {kept && !isInstalled && data.installed && (
                          <button
                            onClick={() => handleRollback(v.version)}
                            disabled={!!busy}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                          >
                            {busy === `rollback:${v.version}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                            Roll back
                          </button>
                        )}
                        {!isInstalled && !kept && runs && !suspended && (
                          <button
                            onClick={() => handleInstall(v.version)}
                            disabled={!!busy}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                            title={v.yanked ? 'Withdrawn; you will be asked to confirm' : undefined}
                          >
                            {busy === key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                            {v.yanked ? 'Install anyway' : 'Install'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {extraHistory.map((h) => (
                <tr key={`kept-${h.version}`}>
                  <td className="px-4 py-2 align-top">
                    <code className="text-xs font-mono text-foreground">v{h.version}</code>
                    <p className="text-xs text-muted-foreground mt-0.5">No longer in the directory</p>
                  </td>
                  <td className="px-4 py-2 align-top text-xs text-muted-foreground whitespace-nowrap">replaced {fmtDate(h.savedAt)}</td>
                  <td className="px-4 py-2 align-top text-xs text-muted-foreground">–</td>
                  <td className="px-4 py-2 align-top text-xs text-muted-foreground">–</td>
                  <td className="px-4 py-2 align-top text-xs">
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><RotateCcw className="w-3 h-3" /> Kept here</span>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <div className="flex justify-end">
                      {data.installed && (
                        <button
                          onClick={() => handleRollback(h.version)}
                          disabled={!!busy}
                          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          {busy === `rollback:${h.version}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          Roll back
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {ext.versions.length === 0 && extraHistory.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">No versions published.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Screenshots */}
      {ext.screenshots.length > 0 && (
        <section className="border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-foreground">Screenshots</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            {ext.screenshots.map((s, i) => (
              <img
                key={i}
                src={s.url}
                alt={s.altText || `Screenshot ${i + 1}`}
                className="w-full rounded-md border border-border bg-muted"
                loading="lazy"
              />
            ))}
          </div>
        </section>
      )}

      {/* Theme preview */}
      {!isPlugin && ext.themePreviews.length > 0 && (
        <section className="border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-foreground">Theme preview</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            {ext.themePreviews.map(preview => (
              preview.url
                ? (
                  <figure key={preview.variant} className="rounded-md border border-border overflow-hidden">
                    <img src={preview.url} alt={`${ext.name} in ${preview.variant} mode`} className="block w-full bg-muted" loading="lazy" />
                    <figcaption className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30 border-t border-border capitalize">{preview.variant}</figcaption>
                  </figure>
                )
                : <ThemeColorSwatch key={preview.variant} preview={preview} />
            ))}
          </div>
        </section>
      )}

      {/* Permissions */}
      {isPlugin && (
        <section className="border border-border rounded-lg p-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-foreground">Permissions</h2>
            {preview && <span className="text-xs text-muted-foreground">of v{preview.version}</span>}
          </div>
          {manifestPerms.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2">This plugin requests no permissions.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {manifestPerms.map(perm => {
                const text = permissionText.get(perm);
                const risky = text?.highRisk || RISKY_PERMISSIONS.has(perm);
                return (
                  <li
                    key={perm}
                    className={`flex items-start gap-2 text-sm rounded-md px-2 py-1.5 ${
                      risky
                        ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                        : 'bg-muted/50 text-foreground'
                    }`}
                  >
                    {risky ? <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <Shield className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-50" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {text && <span className="font-medium">{text.title}</span>}
                        <code className="font-mono text-xs opacity-80">{perm}</code>
                      </div>
                      {text?.body && <p className="text-xs mt-0.5 opacity-90">{text.body}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {frameOrigins.length > 0 && (
            <div className="mt-4 pt-3 border-t border-border">
              <h3 className="text-xs font-medium text-foreground">Iframe origins</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                The plugin will be allowed to embed content from these origins.
              </p>
              <ul className="mt-2 space-y-1">
                {frameOrigins.map(origin => (
                  <li key={origin} className="text-xs font-mono text-foreground bg-muted/50 px-2 py-1 rounded">
                    {origin}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Settings schema preview */}
      {isPlugin && settingsSchema && Object.keys(settingsSchema).length > 0 && (
        <section className="border border-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-foreground">User settings</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Settings users will be able to configure after install.</p>
          <ul className="mt-3 divide-y divide-border">
            {Object.entries(settingsSchema).map(([key, field]) => (
              <li key={key} className="py-2">
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-foreground">{key}</code>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{field.type}</span>
                </div>
                <div className="text-sm text-foreground mt-0.5">{field.label}</div>
                {field.description && (
                  <div className="text-xs text-muted-foreground mt-0.5">{field.description}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Source / manifest disclosure */}
      {bundle.manifest && (
        <section className="border border-border rounded-lg">
          <button
            onClick={() => setShowManifest(v => !v)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 text-start hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">manifest.json</h2>
            </div>
            {showManifest ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showManifest && (
            <pre className="px-4 pb-4 text-xs font-mono overflow-x-auto text-foreground whitespace-pre">
              {JSON.stringify(bundle.manifest, null, 2)}
            </pre>
          )}
        </section>
      )}

      {bundle.source && (
        <section className="border border-border rounded-lg">
          <button
            onClick={() => setShowSource(v => !v)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 text-start hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-medium text-foreground">{bundle.source.name}</h2>
              {bundle.source.truncated && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">truncated</span>
              )}
            </div>
            {showSource ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showSource && (
            <pre className="px-4 pb-4 text-xs font-mono overflow-x-auto text-foreground whitespace-pre max-h-[600px] overflow-y-auto">
              {bundle.source.content}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}

function Notice({ tone, title, children }: { tone: 'info' | 'warning' | 'danger'; title: string; children?: React.ReactNode }) {
  const styles = tone === 'danger'
    ? 'bg-destructive/10 text-destructive'
    : tone === 'warning'
      ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
      : 'bg-muted text-foreground';
  const Icon = tone === 'danger' ? ShieldAlert : tone === 'warning' ? AlertTriangle : Info;
  return (
    <div className={`flex items-start gap-2 text-sm rounded-md px-3 py-2 ${styles}`}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <div>
        <p className="font-medium">{title}</p>
        {children && <p className="text-xs mt-0.5 opacity-90">{children}</p>}
      </div>
    </div>
  );
}

function ThemeColorSwatch({ preview }: { preview: { variant: 'light' | 'dark'; colors: Record<string, string> | null } }) {
  const colors = preview.colors || {};
  const bg = colors.background || (preview.variant === 'dark' ? '#0f0f10' : '#ffffff');
  const fg = colors.foreground || (preview.variant === 'dark' ? '#fafafa' : '#0a0a0a');
  const accent = colors.primary || colors.accent || '#7c5cff';
  const muted = colors.muted || (preview.variant === 'dark' ? '#1a1a1c' : '#f5f5f5');
  const border = colors.border || (preview.variant === 'dark' ? '#27272a' : '#e5e5e5');

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30 border-b border-border capitalize">
        {preview.variant}
      </div>
      <div className="p-3 space-y-2" style={{ background: bg, color: fg }}>
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-6 rounded" style={{ background: accent }} />
          <span className="text-sm font-medium" style={{ color: fg }}>Sample text</span>
        </div>
        <div className="rounded p-2 text-xs" style={{ background: muted, border: `1px solid ${border}` }}>
          <span style={{ color: fg }}>Card surface</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(colors).slice(0, 6).map(([key, value]) => (
            <span
              key={key}
              title={`${key}: ${value}`}
              className="inline-block w-4 h-4 rounded border"
              style={{ background: value, borderColor: border }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
