import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateAddress } from '@/lib/security/ip-ranges';

/**
 * Whether an extension directory URL may be stored. The server fetches the
 * directory's listing, detail and bundle endpoints with an admin session's
 * say-so and returns their JSON to the dashboard, so a directory on an
 * internal address would let an admin session read what internal services
 * answer at those paths. Self-hosted directories on a LAN exist; the
 * operator allows them with EXTENSION_DIRECTORY_ALLOW_PRIVATE=true.
 *
 * Returns null when the URL is acceptable, otherwise the reason.
 */
export async function checkExtensionDirectoryUrl(raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string' || !raw.trim()) return null; // cleared: the default applies
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'extensionDirectoryUrl must be a valid URL';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'extensionDirectoryUrl must be an http(s) URL';
  if (url.username || url.password) return 'extensionDirectoryUrl must not carry credentials';
  if (process.env.EXTENSION_DIRECTORY_ALLOW_PRIVATE === 'true') return null;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    return 'extensionDirectoryUrl must not point at this host (set EXTENSION_DIRECTORY_ALLOW_PRIVATE=true for a directory on your own network)';
  }
  if (isIP(host)) {
    return isPrivateAddress(host)
      ? 'extensionDirectoryUrl resolves to a private address (set EXTENSION_DIRECTORY_ALLOW_PRIVATE=true for a directory on your own network)'
      : null;
  }
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      return 'extensionDirectoryUrl resolves to a private address (set EXTENSION_DIRECTORY_ALLOW_PRIVATE=true for a directory on your own network)';
    }
  } catch {
    return `extensionDirectoryUrl: ${host} could not be resolved`;
  }
  return null;
}
