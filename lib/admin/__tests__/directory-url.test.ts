// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkExtensionDirectoryUrl } from '../directory-url';

// The server fetches the extension directory's JSON on an admin session's
// behalf and hands it back, so a directory URL on an internal address would
// read internal services for that session.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('checkExtensionDirectoryUrl', () => {
  it('refuses private, loopback and local addresses', async () => {
    for (const url of ['http://127.0.0.1:3000', 'http://10.0.0.5', 'https://192.168.1.10/', 'http://[::1]/', 'http://localhost:8080', 'http://admin.localhost']) {
      expect(await checkExtensionDirectoryUrl(url), url).toMatch(/private address|this host/);
    }
  });

  it('accepts a public address and an empty value', async () => {
    expect(await checkExtensionDirectoryUrl('https://203.0.113.5/')).toBeNull();
    expect(await checkExtensionDirectoryUrl('')).toBeNull();
    expect(await checkExtensionDirectoryUrl(undefined)).toBeNull();
  });

  it('refuses other schemes and embedded credentials', async () => {
    expect(await checkExtensionDirectoryUrl('ftp://203.0.113.5/')).toMatch(/http\(s\)/);
    expect(await checkExtensionDirectoryUrl('https://user:pw@203.0.113.5/')).toMatch(/credentials/);
    expect(await checkExtensionDirectoryUrl('not a url')).toMatch(/valid URL/);
  });

  it('lets the operator allow a directory on their own network', async () => {
    vi.stubEnv('EXTENSION_DIRECTORY_ALLOW_PRIVATE', 'true');
    expect(await checkExtensionDirectoryUrl('http://10.0.0.5:3000')).toBeNull();
  });
});
