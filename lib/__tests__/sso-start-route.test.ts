import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      json: async () => data,
      status: init?.status ?? 200,
    }),
  },
}));

const cookieSet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/auth/crypto', () => ({
  encryptPayload: () => 'encrypted',
}));

vi.mock('@/lib/oauth/pkce-server', () => ({
  generateCodeVerifierServer: () => 'verifier',
  generateCodeChallengeServer: () => 'challenge',
  generateStateServer: () => 'state-123',
}));

vi.mock('@/lib/oauth/token-exchange', () => ({
  getRequiredConfig: () => ({ clientId: 'client', discoveryUrl: 'https://idp.example.com' }),
  getDiscoveryValidator: () => undefined,
}));

vi.mock('@/lib/oauth/discovery', () => ({
  discoverOAuth: async () => ({
    issuer: 'https://idp.example.com',
    authorization_endpoint: 'https://idp.example.com/authorize',
    token_endpoint: 'https://idp.example.com/token',
  }),
}));

vi.mock('@/lib/oauth/tokens', () => ({
  getOauthScopes: () => 'openid email',
}));

vi.mock('@/lib/oauth/cookie-config', () => ({
  getCookieOptions: () => ({ httpOnly: true }),
}));

vi.mock('@/lib/auth/session-secret', () => ({
  hasSessionSecret: () => true,
}));

vi.mock('@/lib/admin/config-manager', () => ({
  configManager: { get: () => '' },
}));

function mockRequest(body: Record<string, unknown>): unknown {
  return {
    json: async () => body,
    headers: {
      get: (k: string) =>
        k === 'origin' ? 'https://mail.example.com' : k === 'host' ? 'mail.example.com' : null,
    },
    nextUrl: { origin: 'https://mail.example.com' },
  };
}

async function callRoute(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/auth/sso/start/route');
  const res = (await POST(mockRequest(body) as Parameters<typeof POST>[0])) as unknown as {
    status: number;
    json: () => Promise<{ authorize_url: string }>;
  };
  return { status: res.status, body: await res.json() };
}

describe('sso start route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forces prompt=login without max_age for re-authentication', async () => {
    const { status, body } = await callRoute({
      redirect_uri: 'https://mail.example.com/auth/callback',
      purpose: 'reauth',
    });

    expect(status).toBe(200);
    const url = new URL(body.authorize_url);
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.has('max_age')).toBe(false);
  });

  it('sends neither prompt nor max_age for a regular login', async () => {
    const { status, body } = await callRoute({
      redirect_uri: 'https://mail.example.com/auth/callback',
    });

    expect(status).toBe(200);
    const url = new URL(body.authorize_url);
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.has('max_age')).toBe(false);
  });
});
