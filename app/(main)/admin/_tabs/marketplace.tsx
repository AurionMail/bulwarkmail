'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Search, Download, Check, Loader2, Store, Puzzle, SwatchBook, Star, Eye, AlertTriangle,
  ArrowUpCircle, ExternalLink, RefreshCw, Ban, ShieldAlert, Info, Upload,
} from '@/components/icons';
import { apiFetch } from '@/lib/browser-navigation';
import { compareVersions } from '@/lib/version-compare';
import type { MarketplaceListing } from '@/lib/admin/marketplace-directory';

const CURRENT_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

interface SearchResult {
  data: MarketplaceListing[];
  meta: { page: number; perPage: number; total: number };
  channel: 'stable' | 'beta';
  directoryUrl: string;
}

interface InstalledEntry {
  id: string;
  kind: 'plugin' | 'theme';
  name: string;
  version: string;
  enabled: boolean;
  source: { kind: 'marketplace'; slug: string; directoryUrl: string } | { kind: 'upload' } | null;
}

interface UpdatesResult {
  installed: InstalledEntry[];
  updates: Array<{ slug: string; currentVersion: string; version: string; channel: 'stable' | 'beta'; changelog: string | null }>;
  yanked: Array<{ slug: string; version: string; reason: string | null; at: string }>;
  deprecated: Array<{ slug: string; message: string | null; replacement: string | null }>;
  suspended: string[];
  advisories: Array<{ id: string; extension: string; severity: string; summary: string; fixedIn: string | null; installedVersion?: string }>;
  unknown: string[];
  directoryUrl: string;
  channel: 'stable' | 'beta';
  error: string | null;
}

type TypeFilter = 'all' | 'plugin' | 'theme';
type Sort = 'created' | 'downloads' | 'updated' | 'name';
type View = 'browse' | 'installed';

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'created', label: 'Newest' },
  { value: 'downloads', label: 'Most downloaded' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name' },
];

export const detailHref = (slug: string, version?: string | null) =>
  `/admin/marketplace/${encodeURIComponent(slug)}${version ? `?version=${encodeURIComponent(version)}` : ''}`;

/**
 * Installs one version of an extension. A version the publisher withdrew
 * comes back as 409; the admin is asked, and the install is repeated with
 * `force` if they insist. Returns the error text to show, or null.
 */
export async function installVersion(
  body: { slug: string; version: string; type: 'plugin' | 'theme' },
  confirmYanked: (message: string) => boolean = (m) => window.confirm(m),
): Promise<{ ok: true; warnings: string[]; signature: string | null; updated: boolean } | { ok: false; error: string }> {
  const send = (force: boolean) => apiFetch('/api/admin/marketplace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(force ? { ...body, force: true } : body),
  });
  try {
    let res = await send(false);
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      if (data.yanked) {
        if (!confirmYanked(`${data.error}\n\nInstall it anyway?`)) return { ok: false, error: 'Not installed.' };
        res = await send(true);
      } else {
        return { ok: false, error: data.error || 'Installation failed' };
      }
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || 'Installation failed' };
    return { ok: true, warnings: data.warnings ?? [], signature: data.signature ?? null, updated: !!data.updated };
  } catch {
    return { ok: false, error: 'Installation failed - network error' };
  }
}

export function MarketplaceTab() {
  const [extensions, setExtensions] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sort, setSort] = useState<Sort>('created');
  const [view, setView] = useState<View>('browse');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [perPage] = useState(12);
  const [directoryUrl, setDirectoryUrl] = useState<string | null>(null);
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable');
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updates, setUpdates] = useState<UpdatesResult | null>(null);
  const [updatesLoading, setUpdatesLoading] = useState(true);

  const fetchExtensions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      params.set('page', String(page));
      params.set('perPage', String(perPage));
      params.set('sort', sort);
      params.set('order', sort === 'name' ? 'asc' : 'desc');

      const res = await apiFetch(`/api/admin/marketplace?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to connect to extension directory');
        setExtensions([]);
        return;
      }

      const data: SearchResult = await res.json();
      setExtensions(data.data || []);
      setTotal(data.meta?.total || 0);
      setDirectoryUrl(data.directoryUrl ?? null);
      setChannel(data.channel ?? 'stable');
    } catch {
      setError('Failed to connect to extension directory. Make sure it is running.');
      setExtensions([]);
    } finally {
      setLoading(false);
    }
  }, [query, typeFilter, page, perPage, sort]);

  const fetchUpdates = useCallback(async () => {
    setUpdatesLoading(true);
    try {
      const res = await apiFetch('/api/admin/marketplace/updates');
      if (res.ok) setUpdates(await res.json());
    } catch { /* the strip just stays empty */ } finally {
      setUpdatesLoading(false);
    }
  }, []);

  useEffect(() => { fetchExtensions(); }, [fetchExtensions]);
  useEffect(() => { fetchUpdates(); }, [fetchUpdates]);

  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const markInstalling = (slug: string, on: boolean) => setInstalling((prev) => {
    const next = new Set(prev);
    if (on) next.add(slug); else next.delete(slug);
    return next;
  });

  async function install(ext: { slug: string; name: string; type: 'plugin' | 'theme' }, version: string, isUpdate: boolean) {
    markInstalling(ext.slug, true);
    setMessage(null);
    const result = await installVersion({ slug: ext.slug, version, type: ext.type });
    markInstalling(ext.slug, false);
    if (!result.ok) {
      setMessage({ type: 'error', text: result.error });
      return false;
    }
    const warnings = result.warnings.length ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'})` : '';
    const signed = result.signature === 'verified' ? ', signed by the directory' : '';
    setMessage({
      type: 'success',
      text: isUpdate
        ? `"${ext.name}" updated to v${version}${signed}${warnings}`
        : `"${ext.name}" installed (v${version})${signed}${warnings}`,
    });
    setExtensions((prev) => prev.map((e) => (e.slug === ext.slug
      ? { ...e, installed: true, installedVersion: version, installedSource: { kind: 'marketplace', slug: ext.slug, directoryUrl: directoryUrl ?? '' } }
      : e)));
    fetchUpdates();
    return true;
  }

  async function updateAll() {
    if (!updates) return;
    const byId = new Map(updates.installed.map((e) => [e.id, e]));
    let failed = 0;
    for (const u of updates.updates) {
      const entry = byId.get(u.slug);
      if (!entry) continue;
      const ok = await install({ slug: u.slug, name: entry.name, type: entry.kind }, u.version, true);
      if (!ok) failed++;
    }
    setMessage(failed
      ? { type: 'error', text: `${failed} update${failed === 1 ? '' : 's'} failed; see above` }
      : { type: 'success', text: `All ${updates.updates.length} update${updates.updates.length === 1 ? '' : 's'} installed` });
  }

  const totalPages = Math.ceil(total / perPage);
  const installedCount = updates?.installed.length ?? 0;
  const noticeCount = updates
    ? updates.updates.length + updates.yanked.length + updates.advisories.length + updates.deprecated.length + updates.suspended.length
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Marketplace</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plugins and themes from the extension directory, installed for every user of this Bulwark
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {channel === 'beta' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400" title="Pre-release versions are offered (extensionDirectoryChannel)">
              Beta channel
            </span>
          )}
          {directoryUrl && (
            <a
              href={directoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open directory
            </a>
          )}
        </div>
      </div>

      {message && (
        <div className={`text-sm rounded-md px-3 py-2 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-destructive/10 text-destructive'}`}>
          {message.text}
        </div>
      )}

      {updates && noticeCount > 0 && (
        <UpdatesStrip
          updates={updates}
          installing={installing}
          onUpdate={(u) => {
            const entry = updates.installed.find((e) => e.id === u.slug);
            if (entry) install({ slug: u.slug, name: entry.name, type: entry.kind }, u.version, true);
          }}
          onUpdateAll={updateAll}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 self-start">
          {([['browse', 'Browse'], ['installed', `Installed${installedCount ? ` (${installedCount})` : ''}`]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`h-8 px-3 rounded text-sm font-medium transition-colors ${view === v ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={view === 'browse' ? 'Search extensions...' : 'Filter installed...'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full h-9 ps-9 pe-3 rounded-md border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
          />
        </div>
        {view === 'browse' && (
          <>
            <div className="flex items-center gap-1 rounded-md border border-input bg-background p-0.5 self-start sm:self-auto">
              {(['all', 'plugin', 'theme'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTypeFilter(t); setPage(1); }}
                  className={`h-8 px-3 rounded text-sm font-medium transition-colors ${
                    typeFilter === t
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'all' ? 'All' : t === 'plugin' ? 'Plugins' : 'Themes'}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value as Sort); setPage(1); }}
              aria-label="Sort"
              className="h-9 px-2 rounded-md border border-input bg-background text-sm text-foreground self-start sm:self-auto"
            >
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </>
        )}
      </div>

      {view === 'installed' ? (
        <InstalledView
          updates={updates}
          loading={updatesLoading}
          filter={query}
          installing={installing}
          onUpdate={(entry, version) => install({ slug: entry.id, name: entry.name, type: entry.kind }, version, true)}
        />
      ) : (
        <>
          {error && (
            <div className="border border-border rounded-lg p-12 text-center">
              <Store className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <p className="text-xs text-muted-foreground mt-1">
                The directory needs its v2 API (extensions.bulwarkmail.org has it; a self-hosted one must be from October 2026 or later)
              </p>
              <button
                onClick={fetchExtensions}
                className="mt-4 inline-flex items-center gap-2 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                Retry
              </button>
            </div>
          )}

          {loading && !error && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="ms-2 text-sm text-muted-foreground">Searching extensions...</span>
            </div>
          )}

          {!loading && !error && extensions.length === 0 && (
            <div className="border border-border rounded-lg p-12 text-center">
              <Store className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No extensions found</p>
              {query && (
                <p className="text-xs text-muted-foreground mt-1">
                  Try a different search term
                </p>
              )}
            </div>
          )}

          {!loading && !error && extensions.length > 0 && (
            <>
              <div className="text-xs text-muted-foreground">
                {total} extension{total !== 1 ? 's' : ''} found
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {extensions.map((ext) => (
                  <ExtensionCard
                    key={ext.slug}
                    extension={ext}
                    installing={installing.has(ext.slug)}
                    onInstall={() => ext.latestVersion && install(ext, ext.latestVersion, ext.installed)}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="h-8 px-3 rounded-md border border-border text-sm text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="h-8 px-3 rounded-md border border-border text-sm text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Updates and warnings for what is installed, from one directory request. */
function UpdatesStrip({
  updates,
  installing,
  onUpdate,
  onUpdateAll,
}: {
  updates: UpdatesResult;
  installing: Set<string>;
  onUpdate: (u: UpdatesResult['updates'][number]) => void;
  onUpdateAll: () => void;
}) {
  const names = new Map(updates.installed.map((e) => [e.id, e.name]));
  const name = (slug: string) => names.get(slug) ?? slug;
  const busy = installing.size > 0;

  return (
    <div className="border border-border rounded-lg divide-y divide-border">
      {updates.updates.length > 0 && (
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-medium text-foreground">
                {updates.updates.length} update{updates.updates.length === 1 ? '' : 's'} available
              </h2>
            </div>
            {updates.updates.length > 1 && (
              <button
                onClick={onUpdateAll}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Update all
              </button>
            )}
          </div>
          <ul className="mt-3 space-y-2">
            {updates.updates.map((u) => (
              <li key={u.slug} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  <Link href={detailHref(u.slug, u.version)} className="font-medium text-foreground hover:underline">{name(u.slug)}</Link>
                  <span className="text-muted-foreground"> v{u.currentVersion} → v{u.version}</span>
                  {u.channel === 'beta' && <span className="ms-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400">beta</span>}
                  {u.changelog && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-wrap">{u.changelog}</p>}
                </div>
                <button
                  onClick={() => onUpdate(u)}
                  disabled={installing.has(u.slug)}
                  className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 shrink-0 self-start"
                >
                  {installing.has(u.slug) ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3 h-3" />}
                  Update
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(updates.advisories.length > 0 || updates.yanked.length > 0 || updates.suspended.length > 0 || updates.deprecated.length > 0) && (
        <ul className="p-4 space-y-2 text-sm">
          {updates.advisories.map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-destructive">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <Link href={detailHref(a.extension)} className="font-medium hover:underline">{name(a.extension)}</Link>
                {' '}has a security advisory ({a.severity}): {a.summary}
                {a.fixedIn ? ` Fixed in v${a.fixedIn}.` : ' No fixed version yet.'}
              </span>
            </li>
          ))}
          {updates.suspended.map((slug) => (
            <li key={slug} className="flex items-start gap-2 text-destructive">
              <Ban className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <Link href={detailHref(slug)} className="font-medium hover:underline">{name(slug)}</Link>
                {' '}was suspended by the directory. Consider removing it.
              </span>
            </li>
          ))}
          {updates.yanked.map((y) => (
            <li key={`${y.slug}@${y.version}`} className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                The installed v{y.version} of{' '}
                <Link href={detailHref(y.slug)} className="font-medium hover:underline">{name(y.slug)}</Link>
                {' '}was withdrawn by its publisher{y.reason ? `: ${y.reason}` : '.'}
              </span>
            </li>
          ))}
          {updates.deprecated.map((d) => (
            <li key={d.slug} className="flex items-start gap-2 text-muted-foreground">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <Link href={detailHref(d.slug)} className="font-medium text-foreground hover:underline">{name(d.slug)}</Link>
                {' '}is deprecated{d.message ? `: ${d.message}` : '.'}
                {d.replacement && <> Use <Link href={detailHref(d.replacement)} className="underline">{d.replacement}</Link> instead.</>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Everything installed here, with where it came from and whether it can be updated. */
function InstalledView({
  updates,
  loading,
  filter,
  installing,
  onUpdate,
}: {
  updates: UpdatesResult | null;
  loading: boolean;
  filter: string;
  installing: Set<string>;
  onUpdate: (entry: InstalledEntry, version: string) => void;
}) {
  const rows = useMemo(() => {
    if (!updates) return [];
    const q = filter.trim().toLowerCase();
    const newer = new Map(updates.updates.map((u) => [u.slug, u.version]));
    const yanked = new Set(updates.yanked.map((y) => y.slug));
    const advisories = new Set(updates.advisories.map((a) => a.extension));
    return updates.installed
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
      .map((e) => ({ entry: e, newer: newer.get(e.id) ?? null, yanked: yanked.has(e.id), advisory: advisories.has(e.id) }));
  }, [updates, filter]);

  if (loading && !updates) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="border border-border rounded-lg p-12 text-center">
        <Store className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{filter ? 'Nothing installed matches' : 'Nothing installed yet'}</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg divide-y divide-border">
      {updates?.error && (
        <div className="px-4 py-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30">
          Could not check for updates: {updates.error}
        </div>
      )}
      {rows.map(({ entry, newer, yanked, advisory }) => {
        const fromMarketplace = entry.source?.kind === 'marketplace' || entry.source === null;
        const manageHref = entry.kind === 'plugin' ? `/admin/plugins/${encodeURIComponent(entry.id)}` : '/admin/themes';
        return (
          <div key={`${entry.kind}:${entry.id}`} className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {entry.kind === 'plugin'
                  ? <Puzzle className="w-4 h-4 text-muted-foreground" />
                  : <SwatchBook className="w-4 h-4 text-muted-foreground" />}
                {fromMarketplace ? (
                  <Link href={detailHref(entry.id)} className="text-sm font-medium text-foreground hover:underline">{entry.name}</Link>
                ) : (
                  <span className="text-sm font-medium text-foreground">{entry.name}</span>
                )}
                <span className="text-xs text-muted-foreground">v{entry.version}</span>
                {!entry.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Disabled</span>}
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground inline-flex items-center gap-1">
                  {entry.source?.kind === 'upload' ? <><Upload className="w-3 h-3" /> Uploaded</> : <><Store className="w-3 h-3" /> Marketplace</>}
                </span>
                {advisory && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive inline-flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> Advisory</span>}
                {yanked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Withdrawn</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {newer && (
                <button
                  onClick={() => onUpdate(entry, newer)}
                  disabled={installing.has(entry.id)}
                  className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {installing.has(entry.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3 h-3" />}
                  Update to v{newer}
                </button>
              )}
              <Link
                href={manageHref}
                className="inline-flex items-center h-7 px-2.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted"
              >
                Manage
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Rating({ rating }: { rating: { average: number; count: number } }) {
  if (!rating.count) return null;
  return (
    <span className="inline-flex items-center gap-1" title={`${rating.average} out of 5 from ${rating.count} rating${rating.count === 1 ? '' : 's'}`}>
      <Star className="w-3 h-3 fill-current" />
      {rating.average.toFixed(1)}
      <span className="opacity-70">({rating.count})</span>
    </span>
  );
}

function ExtensionCard({
  extension,
  installing,
  onInstall,
}: {
  extension: MarketplaceListing;
  installing: boolean;
  onInstall: () => void;
}) {
  const isPlugin = extension.type === 'plugin';
  const previewHref = detailHref(extension.slug);
  const offered = extension.latest;
  const updateAvailable = extension.installed
    && !!extension.installedVersion
    && !!offered
    && compareVersions(offered.version, extension.installedVersion) > 0;

  return (
    <div className="group relative border border-border rounded-lg overflow-hidden hover:border-ring/30 transition-colors">
      {extension.bannerUrl && (
        <Link href={previewHref} className="block focus:outline-none">
          <img
            src={extension.bannerUrl}
            alt=""
            className="block h-24 w-full object-cover border-b border-border"
            loading="lazy"
          />
        </Link>
      )}
      <Link href={previewHref} className="block p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-lg">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
            {extension.iconUrl ? (
              <img
                src={extension.iconUrl}
                alt=""
                className="w-10 h-10 object-cover"
                loading="lazy"
              />
            ) : isPlugin ? (
              <Puzzle className="w-5 h-5 text-muted-foreground" />
            ) : (
              <SwatchBook className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-foreground truncate group-hover:underline">
                {extension.name}
              </span>
              {extension.featured && (
                <Star className="w-3.5 h-3.5 text-warning shrink-0 fill-warning" />
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                isPlugin
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                  : 'bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400'
              }`}>
                {isPlugin ? (extension.pluginType || 'plugin') : 'theme'}
              </span>
              {offered?.channel === 'beta' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400">beta</span>
              )}
              {extension.deprecated && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground">deprecated</span>
              )}
              {extension.author && (
                <span className="text-xs text-muted-foreground truncate">
                  by {extension.author.displayName}
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-3 line-clamp-2">
          {extension.description}
        </p>

        {extension.tags && extension.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {extension.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Download className="w-3 h-3" />
              {extension.totalDownloads.toLocaleString()}
            </span>
            <Rating rating={extension.rating} />
            {extension.permissions && extension.permissions.length > 0 && (
              <span title={extension.permissions.join(', ')}>
                {extension.permissions.length} permission{extension.permissions.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
            <Eye className="w-3 h-3" />
            Details
          </span>
        </div>
      </Link>

      <div className="px-4 pb-4 -mt-1 flex items-center gap-2 flex-wrap">
        {extension.installed && updateAvailable && offered ? (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onInstall(); }}
            disabled={installing}
            title={`Update from v${extension.installedVersion} to v${offered.version}`}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {installing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <ArrowUpCircle className="w-3 h-3" />
            )}
            Update to v{offered.version}
          </button>
        ) : extension.installed ? (
          <span
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 text-xs font-medium"
            title={extension.installedVersion ? `Installed: v${extension.installedVersion}` : undefined}
          >
            <Check className="w-3 h-3" />
            Installed{extension.installedVersion ? ` v${extension.installedVersion}` : ''}
          </span>
        ) : !offered ? (
          <span
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 text-xs font-medium"
            title={`No published version runs on Bulwark v${CURRENT_APP_VERSION}. Open the details to see what the newest version needs.`}
          >
            <AlertTriangle className="w-3 h-3" />
            Not for v{CURRENT_APP_VERSION}
          </span>
        ) : (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onInstall(); }}
            disabled={installing}
            title={`Install v${offered.version}`}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {installing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            Quick install
          </button>
        )}
      </div>
    </div>
  );
}
