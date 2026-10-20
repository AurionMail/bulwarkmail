'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpCircle,
  Activity,
  BookUser,
  Calendar,
  ChevronRight,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Palette,
  Puzzle,
  Scale,
  ScrollText,
  Search,
  Server,
  Settings,
  Shield,
  Store,
  SwatchBook,
  X,
  type AppIcon,
} from '@/components/icons';
import { Input } from '@/components/ui/input';
import { scrollToSettingsSection } from '@/components/settings/settings-section';
import { useConfig } from '@/hooks/use-config';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useAdminLocation, navigateAdmin } from '@/hooks/use-admin-navigation';
import { usePolicyStore } from '@/stores/policy-store';
import { useThemeStore } from '@/stores/theme-store';
import { useUpdateStore, selectHasUpdate } from '@/stores/update-store';
import { useAdminUnsavedStore } from '@/stores/admin-unsaved-store';
import { apiFetch, getPathPrefix, withBasePath } from '@/lib/browser-navigation';
import { ADMIN_PAGES, adminPath, type AdminPageDef, type AdminPageId, type AdminSectionDef } from '@/lib/admin/admin-nav';
import { cn } from '@/lib/utils';
import { AdminLink } from './admin-link';
import { AdminShellContext } from './shell-context';

const PAGE_ICONS: Record<AdminPageId, AppIcon> = {
  dashboard: LayoutDashboard,
  settings: Server,
  auth: Shield,
  branding: Palette,
  policy: Scale,
  plugins: Puzzle,
  themes: SwatchBook,
  marketplace: Store,
  version: ArrowUpCircle,
  telemetry: Activity,
  logs: ScrollText,
};

const GROUP_LABELS: Record<AdminPageDef['group'], string | null> = {
  top: null,
  extensions: 'Extensions',
  system: 'System',
};

interface AdminShellProps {
  /** Whether the admin session is in place; the sidebar counts load then. */
  authenticated: boolean;
  /** Stalwart admins signed in automatically have no password to change. */
  isStalwartAutoLogin: boolean;
  configReadOnly: boolean;
  onLogout: () => void;
  children: ReactNode;
}

interface Match {
  page: AdminPageDef;
  sections: AdminSectionDef[];
}

/**
 * The admin panel's frame: the app rail, the page list with search, the
 * content column and (on phones) the list-then-page flow of the settings.
 */
export function AdminShell({ authenticated, isStalwartAutoLogin, configReadOnly, onLogout, children }: AdminShellProps) {
  const pathname = usePathname();
  const location = useAdminLocation();
  const isDesktop = useIsDesktop();
  const requestLeave = useAdminUnsavedStore((s) => s.requestLeave);
  const [query, setQuery] = useState('');
  const [saveBarHost, setSaveBarHost] = useState<HTMLElement | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [pendingSection, setPendingSection] = useState<{ page: AdminPageId; id: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onChangePassword = pathname === '/admin/change-password';
  const activePage: AdminPageId | null = location.page ?? (isDesktop && !onChangePassword ? 'dashboard' : null);
  const activeDef = location.page ? ADMIN_PAGES.find((p) => p.id === location.page) ?? null : null;

  const { appLogoLightUrl, appLogoDarkUrl, loginLogoLightUrl, loginLogoDarkUrl } = useConfig();
  const filesEnabled = usePolicyStore((s) => s.isFeatureEnabled('filesEnabled'));
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const logoUrl = withBasePath(resolvedTheme === 'dark'
    ? (appLogoDarkUrl || appLogoLightUrl || loginLogoDarkUrl)
    : (appLogoLightUrl || appLogoDarkUrl || loginLogoLightUrl));

  // Match the navigation rail: red for security/deprecated, amber for normal.
  const hasUpdate = useUpdateStore(selectHasUpdate);
  const updateSeverity = useUpdateStore((s) => s.status?.severity);
  const startUpdatePolling = useUpdateStore((s) => s.startPolling);
  useEffect(() => { startUpdatePolling(); }, [startUpdatePolling]);
  const updateImportant = updateSeverity === 'security' || updateSeverity === 'deprecated';

  const refreshBadges = useCallback(() => {
    if (!authenticated) return;
    apiFetch('/api/admin/plugin-approvals')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { entries?: Array<{ status: string }> } | null) => {
        setPendingApprovals(data?.entries?.filter((e) => e.status === 'pending').length ?? 0);
      })
      .catch(() => {});
  }, [authenticated]);
  useEffect(() => { refreshBadges(); }, [refreshBadges]);

  // A new page starts at the top; the back button restores nothing finer.
  const scrollKey = `${location.page ?? ''}/${location.detail ?? ''}`;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

  // A section picked from the search scrolls into view once its page has
  // rendered it; pages fetch first, so retry for a moment.
  useEffect(() => {
    if (!pendingSection || pendingSection.page !== location.page) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 2000;
    const attempt = () => {
      if (cancelled) return;
      if (scrollToSettingsSection(pendingSection.id)) { setPendingSection(null); return; }
      if (Date.now() < deadline) timer = setTimeout(attempt, 80);
      else setPendingSection(null);
    };
    const raf = window.requestAnimationFrame(attempt);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [pendingSection, location.page]);

  const trimmed = query.trim().toLowerCase();
  const matches = useMemo<Match[]>(() => {
    if (!trimmed) return ADMIN_PAGES.map((page) => ({ page, sections: [] }));
    const words = trimmed.split(/\s+/);
    const hits = (text: string) => words.every((w) => text.includes(w));
    return ADMIN_PAGES.flatMap((page) => {
      const sections = page.sections.filter((s) => hits(`${s.title} ${s.keywords ?? ''}`.toLowerCase()));
      const pageHit = hits(`${page.label} ${page.description} ${page.keywords}`.toLowerCase());
      if (!pageHit && sections.length === 0) return [];
      return [{ page, sections: sections.slice(0, 5) }];
    });
  }, [trimmed]);

  const groups = useMemo(() => (
    (['top', 'extensions', 'system'] as const)
      .map((group) => ({ group, label: GROUP_LABELS[group], items: matches.filter((m) => m.page.group === group) }))
      .filter((g) => g.items.length > 0)
  ), [matches]);

  const goTo = (page: AdminPageId, section?: string) => {
    requestLeave(() => {
      setPendingSection(section ? { page, id: section } : null);
      navigateAdmin(adminPath(page));
      setQuery('');
    });
  };

  const prefix = getPathPrefix();
  const contextValue = useMemo(() => ({ saveBarHost, refreshBadges }), [saveBarHost, refreshBadges]);

  const badgeFor = (id: AdminPageId): ReactNode => {
    if (id === 'plugins' && pendingApprovals > 0) {
      return (
        <span className="ms-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold leading-[18px] text-white" title={`${pendingApprovals} plugin${pendingApprovals === 1 ? '' : 's'} waiting for approval`}>
          {pendingApprovals}
        </span>
      );
    }
    if (id === 'version' && hasUpdate) {
      return (
        <span
          className={cn('ms-auto h-2 w-2 rounded-full', updateImportant ? 'bg-red-500' : 'bg-amber-500')}
          aria-label={updateImportant ? 'Important update available' : 'Update available'}
        />
      );
    }
    return null;
  };

  const searchBox = (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search admin"
        aria-label="Search admin pages"
        className={cn('h-9 ps-9 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none', query && 'pe-8')}
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery('')}
          className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  const noResults = (
    <div className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches</div>
  );

  const footerLinks = (mobile: boolean) => (
    <>
      {!isStalwartAutoLogin && (
        <AdminLink
          href="/admin/change-password"
          aria-current={onChangePassword ? 'page' : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md text-sm transition-colors duration-150',
            mobile ? 'px-3 py-2.5' : 'px-3 py-2',
            onChangePassword ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground hover:bg-muted',
          )}
        >
          <KeyRound className={cn('h-4 w-4 shrink-0', onChangePassword ? 'text-accent-foreground' : 'text-muted-foreground')} />
          Change password
        </AdminLink>
      )}
      <button
        type="button"
        onClick={onLogout}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md text-sm text-foreground transition-colors duration-150 hover:bg-muted',
          mobile ? 'px-3 py-2.5' : 'px-3 py-2',
        )}
      >
        <LogOut className="h-4 w-4 shrink-0 text-muted-foreground" />
        Sign out
      </button>
    </>
  );

  const readOnlyBanner = configReadOnly && authenticated && (
    <div role="status" className="mb-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
      <p className="font-medium text-foreground">The configuration is read-only</p>
      <p className="mt-1 text-muted-foreground">
        ADMIN_CONFIG_READONLY is set, so you can look at the settings here but not save changes.
        Change them in the mounted config files or environment instead.
      </p>
    </div>
  );

  const appLinks = [
    { href: `${prefix}/`, label: 'Mail', icon: Mail },
    { href: `${prefix}/calendar`, label: 'Calendar', icon: Calendar },
    { href: `${prefix}/contacts`, label: 'Contacts', icon: BookUser },
    ...(filesEnabled ? [{ href: `${prefix}/files`, label: 'Files', icon: HardDrive }] : []),
  ];

  if (!isDesktop) {
    const showIndex = location.page === null && !onChangePassword;
    const title = onChangePassword ? 'Change password' : activeDef?.label ?? 'Admin';
    const backHref = location.detail ? adminPath(location.page) : '/admin';
    return (
      <AdminShellContext.Provider value={contextValue}>
        <div className="flex h-dvh flex-col bg-background pt-[env(safe-area-inset-top)]">
          <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
            {showIndex ? (
              <a
                href={`${prefix}/`}
                className="flex h-10 w-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
                aria-label="Back to mail"
              >
                <ArrowLeft className="h-5 w-5" />
              </a>
            ) : (
              <AdminLink
                href={backHref}
                className="flex h-10 w-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
                aria-label="Back"
              >
                <ArrowLeft className="h-5 w-5" />
              </AdminLink>
            )}
            <div className="flex min-w-0 items-center gap-2">
              {showIndex && <Shield className="h-5 w-5 text-muted-foreground" />}
              <h1 className="truncate text-lg font-semibold">{title}</h1>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {showIndex ? (
              <>
                <div className="px-4 pb-1 pt-3">{searchBox}</div>
                <div className="py-2">
                  {groups.length === 0 && noResults}
                  {groups.map((group, groupIndex) => (
                    <div key={group.group}>
                      {groupIndex > 0 && <div className="mx-5 my-2 border-t border-border" />}
                      {group.label && (
                        <div className="px-5 pb-1.5 pt-3">
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</span>
                        </div>
                      )}
                      {group.items.map(({ page, sections }) => {
                        const Icon = PAGE_ICONS[page.id];
                        return (
                          <div key={page.id}>
                            <AdminLink
                              href={adminPath(page.id)}
                              onClick={(e) => { e.preventDefault(); goTo(page.id); }}
                              data-testid={`admin-page-${page.id}`}
                              className="flex w-full items-center justify-between py-3.5 pe-5 ps-5 text-sm text-foreground transition-colors duration-150 hover:bg-muted"
                            >
                              <span className="flex items-center gap-3">
                                <Icon className="h-4 w-4 text-muted-foreground" />
                                {page.label}
                                {badgeFor(page.id)}
                              </span>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </AdminLink>
                            {sections.map((section) => (
                              <button
                                key={section.id}
                                type="button"
                                onClick={() => goTo(page.id, section.id)}
                                className="flex w-full items-center pe-5 ps-12 py-2 text-start text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                              >
                                <span className="truncate">{section.title}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="border-t border-border px-2 py-2">{footerLinks(true)}</div>
              </>
            ) : (
              <div className="p-4 pb-6">
                {readOnlyBanner}
                {children}
              </div>
            )}
          </div>

          <div ref={setSaveBarHost} className="shrink-0" />

          <nav
            className="flex shrink-0 items-center border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
            aria-label="Main navigation"
          >
            {appLinks.map(({ href, label, icon: Icon }) => (
              <a
                key={label}
                href={href}
                className="flex min-h-[44px] grow shrink-0 basis-[64px] flex-col items-center justify-center gap-1 px-1 py-2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
                title={label}
              >
                <Icon className="h-5 w-5" />
                <span className="max-w-full truncate text-[10px] font-medium leading-tight">{label}</span>
              </a>
            ))}
            <div
              className="flex min-h-[44px] grow shrink-0 basis-[64px] flex-col items-center justify-center gap-1 px-1 py-2 text-primary"
              title="Admin"
              aria-current="page"
            >
              <div className="relative">
                <Shield className="h-5 w-5" />
                <span className="absolute -bottom-1 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-primary" />
              </div>
              <span className="max-w-full truncate text-[10px] font-medium leading-tight">Admin</span>
            </div>
            <a
              href={`${prefix}/settings`}
              className="flex min-h-[44px] grow shrink-0 basis-[64px] flex-col items-center justify-center gap-1 px-1 py-2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
              title="Settings"
            >
              <Settings className="h-5 w-5" />
              <span className="max-w-full truncate text-[10px] font-medium leading-tight">Settings</span>
            </a>
          </nav>
        </div>
      </AdminShellContext.Provider>
    );
  }

  return (
    <AdminShellContext.Provider value={contextValue}>
      <div className="flex h-dvh bg-background pt-[env(safe-area-inset-top)]">
        {/* The app rail, as the mail and settings screens draw it. */}
        <div className="flex w-14 shrink-0 flex-col items-center bg-secondary" style={{ borderRight: '1px solid rgba(128, 128, 128, 0.3)' }}>
          {logoUrl && (
            <div className="flex items-center justify-center px-1 py-3">
              <img src={logoUrl} alt="" className="h-8 w-8 object-contain" />
            </div>
          )}
          <nav className="flex flex-1 flex-col items-center gap-1 px-1 py-3" aria-label="Apps">
            {appLinks.map(({ href, label, icon: Icon }) => (
              <a
                key={label}
                href={href}
                className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                title={label}
              >
                <Icon className="h-[18px] w-[18px]" />
              </a>
            ))}
          </nav>
          <div className="mt-auto flex flex-col items-center gap-2 px-1 pb-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary" title="Admin" aria-current="page">
              <Shield className="h-[18px] w-[18px]" />
            </div>
            <a
              href={`${prefix}/settings`}
              className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Settings"
            >
              <Settings className="h-[18px] w-[18px]" />
            </a>
          </div>
        </div>

        {/* The page list, laid out like the settings sidebar. */}
        <aside className="flex w-64 shrink-0 flex-col border-e border-border bg-secondary">
          <div className="border-b border-border">
            <div className="flex h-14 items-center px-2">
              <a
                href={`${prefix}/`}
                className="flex h-9 w-full items-center rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <ArrowLeft className="me-2 h-4 w-4" />
                Back to mail
              </a>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            <div className="px-3 pb-1 pt-1">{searchBox}</div>
            <nav className="space-y-0.5 px-2" aria-label="Admin pages">
              {groups.length === 0 && noResults}
              {groups.map((group, groupIndex) => (
                <div key={group.group}>
                  {groupIndex > 0 && <div className="mx-1 my-2 border-t border-border" />}
                  {group.label && (
                    <div className="px-3 pb-1 pt-2.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</span>
                    </div>
                  )}
                  {group.items.map(({ page, sections }) => {
                    const Icon = PAGE_ICONS[page.id];
                    const active = activePage === page.id;
                    return (
                      <div key={page.id}>
                        <AdminLink
                          href={adminPath(page.id)}
                          onClick={(e) => { e.preventDefault(); if (!active || location.detail) goTo(page.id); }}
                          aria-current={active ? 'page' : undefined}
                          data-testid={`admin-page-${page.id}`}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md py-2 pe-3 ps-3 text-start text-sm transition-colors duration-150',
                            active ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground hover:bg-muted',
                          )}
                        >
                          <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-accent-foreground' : 'text-muted-foreground')} />
                          <span className="truncate">{page.label}</span>
                          {badgeFor(page.id)}
                        </AdminLink>
                        {sections.map((section) => (
                          <button
                            key={section.id}
                            type="button"
                            onClick={() => goTo(page.id, section.id)}
                            className="w-full rounded-md py-1.5 pe-3 ps-9 text-start text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                          >
                            <span className="block truncate">{section.title}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </nav>
          </div>

          <div className="space-y-0.5 border-t border-border px-2 py-2">{footerLinks(false)}</div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-6 py-6">
              {readOnlyBanner}
              {children}
            </div>
          </div>
          <div ref={setSaveBarHost} className="shrink-0" />
        </main>
      </div>
    </AdminShellContext.Provider>
  );
}
