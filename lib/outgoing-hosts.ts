/**
 * Every outside host Bulwark itself knows about, what talks to it, and what
 * turns it off (#903).
 *
 * "Outside" means a host the deployment didn't configure: the admin's JMAP
 * servers, push relays, OAuth issuer, WOPI editor, sidebar apps and a
 * self-hosted extension directory are the deployment's own choice and stay
 * reachable. Everything listed here is off while `noThirdPartyTraffic`
 * (env NO_THIRD_PARTY_TRAFFIC) is on.
 *
 * lib/__tests__/outgoing-hosts.test.ts scans the source for http(s) host
 * literals and fails on any that is neither listed here nor in
 * NON_REQUEST_HOSTS, so a new built-in host can't slip in unnoticed; a
 * second test turns the mode on and checks every entry's switch.
 *
 * Plain data and pure functions: imported by the browser, the server routes,
 * the admin page and the tests.
 */

import { noThirdPartyTraffic } from './third-party-mode';

export type OutgoingSide = 'server' | 'browser';

export interface OutgoingHost {
  /** Stable id, used by the tests and the admin list. */
  id: string;
  /** The host as people should read it. */
  host: string;
  /** How the host appears in the source after `https://`, when it differs from `host`. */
  literals?: string[];
  /** Who opens the connection: this server, or the user's browser. */
  side: OutgoingSide;
  /** What uses it, in one sentence. */
  usedBy: string;
  /** How to turn it off without the mode. */
  off: string;
  /** What the mode does instead. */
  inMode: string;
  /** Also present in Bulwark Lite. */
  lite: boolean;
}

export const OUTGOING_HOSTS: readonly OutgoingHost[] = [
  {
    id: 'telemetry',
    host: 'telemetry.bulwarkmail.org',
    side: 'server',
    usedBy: 'Anonymous daily heartbeat, sent only after an admin turned telemetry on.',
    off: 'Off by default. BULWARK_TELEMETRY=off, or Admin > Telemetry.',
    inMode: 'Never sent, whatever the telemetry setting says.',
    lite: false,
  },
  {
    id: 'version-check',
    host: 'version.telemetry.bulwarkmail.org',
    side: 'server',
    usedBy: 'Hourly check for a newer Bulwark release, shown to admins.',
    off: 'BULWARK_UPDATE_CHECK=off, or BULWARK_UPDATE_CHECK_URL= (empty).',
    inMode: 'Not checked; Admin > Version says why.',
    lite: false,
  },
  {
    id: 'push-relay',
    host: 'notifications.relay.bulwarkmail.org',
    side: 'browser',
    usedBy: 'Built-in Web Push relay that wakes the browser for new mail.',
    off: 'Add your own relays under Admin > User policy > Push relays and lock the choice.',
    inMode: 'Not offered. Push works only with a relay the admin configured.',
    lite: false,
  },
  {
    id: 'extension-directory',
    host: 'extensions.bulwarkmail.org',
    side: 'server',
    usedBy: 'Marketplace browsing, installs and update checks in the admin panel.',
    off: 'EXTENSION_DIRECTORY_URL pointing at a self-hosted directory.',
    inMode: 'Off, unless extensionDirectoryUrl points at another host.',
    lite: false,
  },
  {
    id: 'connector',
    host: 'connector.bulwarkmail.org',
    side: 'server',
    usedBy: 'Links in the docs and the directory that open this instance; the connector asks this server what it can open.',
    off: 'CONNECTOR_ENABLED=false.',
    inMode: 'The capabilities endpoint the connector asks answers 404.',
    lite: false,
  },
  {
    id: 'favicons',
    host: 'icons.duckduckgo.com',
    side: 'server',
    usedBy: 'Sender icons next to messages, fetched by /api/favicon.',
    off: 'Users can turn sender icons off in Settings > Message list.',
    inMode: 'Avatars show initials; /api/favicon answers 403 before any request.',
    lite: false,
  },
  {
    id: 'translate',
    host: 'api.mymemory.translated.net',
    side: 'server',
    usedBy: 'Default provider of /api/translate, which the Translate plugin calls.',
    off: 'Set LIBRETRANSLATE_URL to your own LibreTranslate and pick it in the plugin.',
    inMode: 'Refused with 403; LibreTranslate at LIBRETRANSLATE_URL still works.',
    lite: false,
  },
  {
    id: 'maps',
    host: 'www.google.com',
    side: 'browser',
    usedBy: 'Tapping the address of a calendar event opens Google Maps.',
    off: 'Nothing else turns it off; it is a link the user taps.',
    inMode: 'The address is plain text with a copy button.',
    lite: true,
  },
  {
    id: 'wkd',
    host: 'openpgpkey.<recipient domain>',
    literals: ['openpgpkey.'],
    side: 'browser',
    usedBy: 'OpenPGP key lookup (WKD) at the recipient\'s domain, for PGP plugins.',
    off: 'Don\'t install a PGP plugin that looks keys up.',
    inMode: 'The lookup is refused.',
    lite: false,
  },
  {
    id: 'dev-avatars',
    host: 'randomuser.me',
    literals: ['randomuser.me', 'img.freepik.com'],
    side: 'browser',
    usedBy: 'Sample sender photos, only with the built-in mock server (DEV_MOCK_JMAP=true).',
    off: 'Don\'t run the mock server.',
    inMode: 'Not shown.',
    lite: false,
  },
];

/**
 * Hosts in the source that Bulwark never connects to on its own: docs links,
 * XML namespaces, credits, examples in comments and sample text. Each is
 * allowed only in the files named, so the same host turning up somewhere new
 * has to be looked at again.
 */
export const NON_REQUEST_HOSTS: readonly { host: string; files: readonly string[]; why: string }[] = [
  { host: 'bulwarkmail.org', why: 'docs links and comments', files: ['app/(main)/admin/_pages/telemetry.tsx', 'instrumentation.node.ts', 'lib/telemetry/state.ts', 'lib/telemetry/types.ts'] },
  { host: 'bulwarkmail.com', why: 'JMAP capability URI', files: ['lib/jmap/client.ts'] },
  { host: 'extensions.bulwarkmail.org', why: 'signed statement type URIs', files: ['lib/admin/directory-keys.ts'] },
  { host: 'www.w3.org', why: 'XML namespaces', files: ['app/(main)/setup/page.tsx', 'components/ui/flag-icons.tsx', 'lib/favicon-badge.ts'] },
  { host: 'creativecommons.org', why: 'licence metadata inside an SVG', files: ['components/ui/flag-icons.tsx'] },
  { host: 'github.com', why: 'source code link (AGPL) and SVG metadata', files: ['components/settings/about-data-settings.tsx', 'components/ui/flag-icons.tsx'] },
  { host: 'www.rfc-editor.org', why: 'comments', files: ['lib/jmap/client.ts'] },
  { host: 'devguide.calconnect.org', why: 'comment', files: ['lib/jmap/client.ts'] },
  { host: 'stalw.art', why: 'comment', files: ['app/api/auth/impersonate/route.ts'] },
  { host: 'tabler.io', why: 'icon credit link', files: ['app/(main)/admin/_pages/policy.tsx'] },
  { host: 'www.youtube-nocookie.com', why: 'example in a comment', files: ['lib/plugin-types.ts'] },
  { host: 'bulwark-webmail.vercel.app', why: 'sample message text', files: ['stores/email-store.ts'] },
];

/** Folders whose host literals are sample mail content, never requests. */
export const NON_REQUEST_PATHS: readonly string[] = [
  'lib/demo/fixtures/',
  'app/api/dev-jmap/',
];

const RESERVED_TLDS = new Set(['example', 'test', 'invalid', 'localhost', 'local', 'internal', 'lan']);

/**
 * Hosts that can't be anyone else's: example and reserved names, single
 * labels, IP literals and CSP wildcards. Placeholders and tests use them.
 */
export function isPlaceholderHost(raw: string): boolean {
  const host = raw.toLowerCase().replace(/:\d+$/, '').replace(/\.+$/, '');
  if (!host.includes('.') || host.includes('*')) return true;
  if (/^\d{1,3}(\.\d{1,3}){0,3}\.?$/.test(host)) return true;
  const labels = host.split('.');
  const tld = labels[labels.length - 1];
  if (RESERVED_TLDS.has(tld)) return true;
  return /(^|\.)example\.(com|org|net)$/.test(host);
}

/** Every host literal the registry accounts for. */
export function registeredLiterals(): Set<string> {
  const out = new Set<string>();
  for (const entry of OUTGOING_HOSTS) for (const literal of entry.literals ?? [entry.host]) out.add(literal);
  return out;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether a URL points at one of the built-in outside hosts above. */
export function isBuiltInHost(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  return OUTGOING_HOSTS.some((entry) => (entry.literals ?? [entry.host]).some((literal) => literal === host));
}

// ─── Browser-side switches ────────────────────────────────────────────────

/** A push relay may be used: always, except the built-in one in the mode. */
export function relayAllowed(url: string): boolean {
  return !(noThirdPartyTraffic() && isBuiltInHost(url));
}

/** Sender icons through /api/favicon. */
export function senderFaviconsAllowed(): boolean {
  return !noThirdPartyTraffic();
}

/** The Google Maps link on an event's address. */
export function mapsLinksAllowed(): boolean {
  return !noThirdPartyTraffic();
}

/** OpenPGP WKD lookups at the recipient's domain. */
export function wkdAllowed(): boolean {
  return !noThirdPartyTraffic();
}

/** Sample photos of the mock server. */
export function sampleAvatarsAllowed(): boolean {
  return !noThirdPartyTraffic();
}

export interface NetworkDeclaringPlugin {
  permissions?: readonly string[];
  httpOrigins?: readonly string[];
  frameOrigins?: readonly string[];
}

/**
 * A plugin declares network access when it may fetch outside hosts
 * (`http:fetch` with httpOrigins), use the credential proxy (`http:proxy`) or
 * embed outside frames (frameOrigins). Same-origin `http:post` doesn't count.
 */
export function pluginDeclaresNetwork(plugin: NetworkDeclaringPlugin): boolean {
  const permissions = plugin.permissions ?? [];
  return permissions.includes('http:fetch')
    || permissions.includes('http:proxy')
    || (plugin.httpOrigins?.length ?? 0) > 0
    || (plugin.frameOrigins?.length ?? 0) > 0;
}

/** Error code a refused plugin carries (shown translated in Settings > Plugins). */
export const PLUGIN_REFUSED_ERROR = 'third-party-off';

/** Whether a plugin may run in this browser. */
export function pluginAllowed(plugin: NetworkDeclaringPlugin): boolean {
  return !(noThirdPartyTraffic() && pluginDeclaresNetwork(plugin));
}
