/**
 * The admin panel's pages and their URLs.
 *
 * Every page lives at `/admin/<id>`; plugins, themes and the marketplace
 * have a detail page below it (`/admin/plugins/<pluginId>`). The whole tree
 * is one Next route (app/(main)/admin/[[...segments]]) and switching pages
 * goes through history.pushState, so the sidebar never starts a route
 * transition - the same way the user settings keep their permalinks (#733).
 *
 * This module is plain data: the connector registry imports it on the
 * server, so no React in here. Icons live in the shell.
 */

export const ADMIN_PAGE_IDS = [
  'dashboard',
  'settings',
  'auth',
  'branding',
  'policy',
  'plugins',
  'themes',
  'marketplace',
  'version',
  'telemetry',
  'logs',
] as const;

export type AdminPageId = typeof ADMIN_PAGE_IDS[number];

export function isAdminPageId(value: string | null | undefined): value is AdminPageId {
  return typeof value === 'string' && (ADMIN_PAGE_IDS as readonly string[]).includes(value);
}

/** `top` has no heading in the sidebar; the other two do. */
export type AdminPageGroup = 'top' | 'extensions' | 'system';

export interface AdminSectionDef {
  /** The `id` the page gives its SettingsSection, for jump links and search. */
  id: string;
  title: string;
  /** Extra words the sidebar search matches, besides the title. */
  keywords?: string;
}

export interface AdminPageDef {
  id: AdminPageId;
  label: string;
  /** One line under the page title. */
  description: string;
  group: AdminPageGroup;
  /** Words the sidebar search matches, besides the label and the sections. */
  keywords: string;
  sections: readonly AdminSectionDef[];
  /** Whether `/admin/<id>/<detail>` opens a detail page. */
  hasDetail?: boolean;
}

export const ADMIN_PAGES: readonly AdminPageDef[] = [
  {
    id: 'dashboard',
    label: 'Overview',
    description: 'What this Bulwark is running and what needs attention',
    group: 'top',
    keywords: 'dashboard home status warnings accounts activity recent',
    sections: [],
  },
  {
    id: 'settings',
    label: 'Server',
    description: 'How this Bulwark connects and what the login page offers',
    group: 'top',
    keywords: 'settings application name jmap server url demo mode stalwart features search engine indexing',
    sections: [
      { id: 'general', title: 'General', keywords: 'app name jmap url custom endpoint demo mode stalwart indexing' },
      { id: 'login', title: 'Login page', keywords: 'version 2fa totp code access token remember me heading subtitle' },
      { id: 'servers', title: 'JMAP servers', keywords: 'multi server domain auto pick list' },
      { id: 'wopi', title: 'Document editing', keywords: 'wopi collabora onlyoffice office files host url' },
      { id: 'logging', title: 'Logging', keywords: 'log level format json text debug' },
      { id: 'sync', title: 'Settings sync', keywords: 'session secret devices' },
    ],
  },
  {
    id: 'auth',
    label: 'Authentication',
    description: 'OAuth, single sign-on, admin access and session security',
    group: 'top',
    keywords: 'login password oidc openid',
    sections: [
      { id: 'oauth', title: 'OAuth / OpenID Connect', keywords: 'client id secret issuer scopes private endpoints auto configure stalwart' },
      { id: 'sso', title: 'Single sign-on', keywords: 'auto sso redirect end session logout provider post-logout' },
      { id: 'admin-access', title: 'Admin access', keywords: 'stalwart admin dashboard password automatic' },
      { id: 'session', title: 'Session and security', keywords: 'cookie samesite frame ancestors parent origin embed' },
    ],
  },
  {
    id: 'branding',
    label: 'Branding',
    description: 'Logos, colours and company details, per domain if needed',
    group: 'top',
    keywords: 'logo favicon icon company imprint privacy website domain',
    sections: [
      { id: 'scope', title: 'Scope', keywords: 'domain host wildcard default' },
      { id: 'images', title: 'Images and logos', keywords: 'favicon app logo login logo light dark upload' },
      { id: 'pwa', title: 'Progressive web app', keywords: 'pwa icon screenshot short name description theme colour background colour install' },
      { id: 'company', title: 'Company information', keywords: 'company name imprint privacy policy website url' },
    ],
  },
  {
    id: 'policy',
    label: 'User policy',
    description: 'Which features users get and which settings they may change',
    group: 'top',
    keywords: 'features gates restrictions lock hide users',
    sections: [
      { id: 'features', title: 'Features', keywords: 'calendar contacts files smime templates keywords sidebar apps unified mailbox archive custom from debug export' },
      { id: 'push-relays', title: 'Push relays', keywords: 'notifications relay url default lock' },
      { id: 'sidebar-apps', title: 'Default sidebar apps', keywords: 'apps rail intranet inline tab icon' },
      { id: 'restrictions', title: 'Locked settings', keywords: 'restrict hide lock font size density layout delete action reply mode session timeout notifications debug' },
    ],
  },
  {
    id: 'plugins',
    label: 'Plugins',
    description: 'Plugins installed for every user, and what users may install themselves',
    group: 'extensions',
    keywords: 'extensions addons upload zip approve permissions configure force enable',
    sections: [
      { id: 'approvals', title: 'Approval requests', keywords: 'approve deny user uploaded code review' },
      { id: 'installed', title: 'Installed plugins', keywords: 'enable disable remove roll back configure' },
      { id: 'policy', title: 'Plugin policy', keywords: 'plugins enabled user uploads require approval' },
    ],
    hasDetail: true,
  },
  {
    id: 'themes',
    label: 'Themes',
    description: 'Themes installed for every user, defaults and what users may pick',
    group: 'extensions',
    keywords: 'colour color mode dark light default upload zip',
    sections: [
      { id: 'installed', title: 'Installed themes', keywords: 'enable disable remove roll back' },
      { id: 'policy', title: 'Theme policy', keywords: 'themes enabled user uploads default theme colour mode lock' },
      { id: 'offered', title: 'Offered to users', keywords: 'built-in themes hide' },
    ],
    hasDetail: true,
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    description: 'Plugins and themes from the extension directory',
    group: 'extensions',
    keywords: 'directory install update browse extensions advisories',
    sections: [],
    hasDetail: true,
  },
  {
    id: 'version',
    label: 'Updates',
    description: 'The running version and the hourly update check',
    group: 'system',
    keywords: 'version release upgrade check security advisory',
    sections: [
      { id: 'status', title: 'Status', keywords: 'running latest release severity advisory' },
      { id: 'schedule', title: 'Schedule', keywords: 'last checked next' },
      { id: 'source', title: 'Source', keywords: 'endpoint disabled env' },
    ],
  },
  {
    id: 'telemetry',
    label: 'Usage stats',
    description: 'The anonymous daily heartbeat, off unless you turn it on',
    group: 'system',
    keywords: 'telemetry heartbeat anonymous consent privacy',
    sections: [
      { id: 'status', title: 'Status', keywords: 'enable disable consent' },
      { id: 'accounts', title: 'Account activity', keywords: 'active total logins' },
      { id: 'endpoint', title: 'Endpoint', keywords: 'collector url' },
      { id: 'payload', title: 'Payload preview', keywords: 'send now json' },
    ],
  },
  {
    id: 'logs',
    label: 'Audit log',
    description: 'Who changed what in this panel, and when',
    group: 'system',
    keywords: 'audit history actions login config policy ip',
    sections: [],
  },
];

const PAGE_BY_ID = new Map(ADMIN_PAGES.map((page) => [page.id, page]));

export function adminPageDef(id: AdminPageId): AdminPageDef {
  return PAGE_BY_ID.get(id)!;
}

export const ADMIN_ROOT = '/admin';

/** Where in the admin panel a pathname points. `page` null is the index. */
export interface AdminLocation {
  page: AdminPageId | null;
  /** The id or slug of a detail page, for pages that have them. */
  detail: string | null;
}

/**
 * Reads the admin location from a pathname (without the base path, as
 * `usePathname()` gives it). Null when the path is not inside /admin.
 * An unknown page name counts as the index rather than a 404: the login and
 * password routes are separate pages and never get here.
 */
export function parseAdminPath(pathname: string): AdminLocation | null {
  if (pathname !== ADMIN_ROOT && !pathname.startsWith(`${ADMIN_ROOT}/`)) return null;
  const segments = pathname
    .slice(ADMIN_ROOT.length)
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try { return decodeURIComponent(segment); } catch { return segment; }
    });
  if (segments.length === 0) return { page: null, detail: null };
  const [first, ...rest] = segments;
  if (!isAdminPageId(first)) return { page: null, detail: null };
  const def = adminPageDef(first);
  const detail = def.hasDetail && rest.length > 0 ? rest.join('/') : null;
  return { page: first, detail };
}

/** The app-relative path of a page, or of one of its detail pages. */
export function adminPath(page?: AdminPageId | null, detail?: string | null): string {
  if (!page) return ADMIN_ROOT;
  const base = `${ADMIN_ROOT}/${page}`;
  return detail ? `${base}/${encodeURIComponent(detail)}` : base;
}
