import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/oauth/discovery', () => ({
  discoverOAuth: vi.fn(),
}));

vi.mock('@/lib/security/url-guard', () => ({
  isPublicHttpUrl: vi.fn(),
}));

vi.mock('@/lib/read-file-env', () => ({
  readFileEnv: () => '',
}));

const SERVERS = [
  { id: 'mx1', label: 'Server 1', url: 'https://mx1.example.com' },
  { id: 'mx2', label: 'Server 2', url: 'https://mx2.example.com' },
  {
    id: 'mx3',
    label: 'Server 3',
    url: 'https://mx3.example.com',
    oauth: { issuerUrl: 'https://idp3.example.com' },
  },
];

vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    get: (key: string, def: unknown) => (key === 'jmapServers' ? SERVERS : def),
    ensureLoaded: async () => {},
  },
}));

import { getRequiredConfig } from '@/lib/oauth/token-exchange';

describe('SSO discovery issuer precedence (#952)', () => {
  beforeEach(() => {
    vi.stubEnv('JMAP_SERVER_URL', 'https://mx1.example.com');
    vi.stubEnv('OAUTH_CLIENT_ID', 'client');
    // Global issuer points at server 1's IdP.
    vi.stubEnv('OAUTH_ISSUER_URL', 'https://idp1.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('discovers against the selected server, not the global issuer', () => {
    const config = getRequiredConfig('mx2');
    expect(config.serverId).toBe('mx2');
    expect(config.discoveryUrl).toBe('https://mx2.example.com');
  });

  it('prefers the selected server\'s own issuer when it has one', () => {
    const config = getRequiredConfig('mx3');
    expect(config.discoveryUrl).toBe('https://idp3.example.com');
  });

  it('falls back to the global issuer when no server entry matched', () => {
    expect(getRequiredConfig(null).discoveryUrl).toBe('https://idp1.example.com');
    expect(getRequiredConfig('unknown').discoveryUrl).toBe('https://idp1.example.com');
  });
});
