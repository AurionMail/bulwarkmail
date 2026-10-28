import type { SettingsPolicy } from './types';
import { parseJmapServers } from './jmap-servers';
import { isBuiltInHost } from '@/lib/outgoing-hosts';

/**
 * What stays reachable with "no third-party traffic" on: the hosts the
 * deployment configured itself. Shown on Organisation > Security so an admin
 * can check the list against what they expect (#903).
 */

export interface ReachableHost {
  /** What the host is for, e.g. "JMAP server". */
  kind: string;
  /** The host (and port when it isn't the default). */
  host: string;
  /** Where it was configured, e.g. "JMAP_SERVER_URL" or "User policy > Push relays". */
  setIn: string;
  /** Who connects: this server, the browser, or both. */
  side: 'server' | 'browser' | 'both';
}

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

export interface ReachableInput {
  get: (key: string) => unknown;
  policy: Pick<SettingsPolicy, 'pushRelays' | 'pushRelayUrl' | 'defaultSidebarApps'>;
  env: Record<string, string | undefined>;
}

const BRANDING_KEYS = [
  'faviconUrl', 'pwaIconUrl', 'pwaScreenshotMobileUrl', 'pwaScreenshotDesktopUrl',
  'appLogoLightUrl', 'appLogoDarkUrl', 'loginLogoLightUrl', 'loginLogoDarkUrl',
] as const;

export function listReachableHosts({ get, policy, env }: ReachableInput): ReachableHost[] {
  const out: ReachableHost[] = [];
  const seen = new Set<string>();
  const add = (kind: string, url: unknown, setIn: string, side: ReachableHost['side']) => {
    const host = hostOf(url);
    // A built-in host listed here would be off in the mode anyway; leaving
    // it out keeps the list to what really stays reachable.
    if (!host || isBuiltInHost(String(url))) return;
    const key = `${kind}|${host}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, host, setIn, side });
  };

  add('JMAP server', get('jmapServerUrl'), 'JMAP_SERVER_URL', 'both');
  for (const server of parseJmapServers(get('jmapServers'))) {
    add('JMAP server', server.url, `JMAP_SERVERS (${server.label})`, 'both');
    add('OAuth issuer', server.oauth?.issuerUrl, `JMAP_SERVERS (${server.label})`, 'both');
    add('OAuth issuer', server.oauth?.endSessionUrl, `JMAP_SERVERS (${server.label})`, 'browser');
  }
  if (get('oauthEnabled') === true) {
    add('OAuth issuer', get('oauthIssuerUrl'), 'OAUTH_ISSUER_URL', 'both');
    add('OAuth issuer', get('oauthAuthorizeUrl'), 'OAUTH_AUTHORIZE_URL', 'browser');
    add('OAuth issuer', get('oauthEndSessionUrl'), 'OAUTH_END_SESSION_URL', 'browser');
  }
  for (const relay of policy.pushRelays ?? []) add('Push relay', relay?.url, 'User policy > Push relays', 'browser');
  add('Push relay', policy.pushRelayUrl, 'User policy > Push relays', 'browser');
  add('Push relay', env.NEXT_PUBLIC_PUSH_RELAY_URL, 'NEXT_PUBLIC_PUSH_RELAY_URL (build)', 'browser');
  add('Extension directory', get('extensionDirectoryUrl'), 'EXTENSION_DIRECTORY_URL', 'server');
  for (const app of policy.defaultSidebarApps ?? []) add('Sidebar app', app?.url, `User policy > Sidebar apps (${app?.name ?? ''})`, 'browser');
  add('Document editor (WOPI)', get('wopiClientUrl'), 'WOPI_CLIENT_URL', 'both');
  add('Translation (LibreTranslate)', env.LIBRETRANSLATE_URL, 'LIBRETRANSLATE_URL', 'server');
  for (const key of BRANDING_KEYS) add('Branding image', get(key), key, 'browser');
  return out;
}
