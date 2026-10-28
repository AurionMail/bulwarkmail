/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let readOnly = false;
let saveError: Error | null = null;
let stalwart016 = false;
let signedIn = true;
const jmapCalls: Array<[string, Record<string, unknown>]> = [];

vi.mock('@/lib/admin/session', () => ({
  requireAdminAuth: async () => ({ ok: true }),
  getClientIP: () => '127.0.0.1',
}));
vi.mock('@/lib/stalwart/credentials', () => ({
  getStalwartCredentials: async () => (signedIn
    ? {
      serverUrl: 'https://mail.example.org',
      authHeader: 'Basic x',
      trusted: true,
      username: 'admin@example.org',
    }
    : null),
}));
vi.mock('@/lib/admin/paths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/paths')>()),
  isConfigReadOnly: () => readOnly,
}));
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: async () => {},
    setAdminConfig: async () => { if (saveError) throw saveError; },
  },
}));
vi.mock('@/lib/admin/audit', () => ({ auditLog: async () => {} }));
vi.mock('@/lib/stalwart/server-fetch', () => ({
  fetchJmapServer: async (url: string, init: { body?: string }) => {
    if (url.endsWith('/.well-known/jmap')) {
      return Response.json({ primaryAccounts: { 'urn:stalwart:jmap': 'a' } });
    }
    const [name, args] = JSON.parse(init.body!).methodCalls[0];
    jmapCalls.push([name, args]);
    if (name === 'x:OAuthClient/query') return Response.json({ methodResponses: [[name, { ids: [] }, '0']] });
    // Stalwart 0.16 has no firstParty and refuses it (answer seen in its source:
    // PatchError "Invalid property" -> invalidPatch naming the path).
    if (stalwart016 && JSON.stringify(args).includes('firstParty')) {
      return Response.json({ methodResponses: [[name, { notCreated: { new: { type: 'invalidPatch', description: 'Invalid property', properties: ['firstParty'] } } }, '0']] });
    }
    return Response.json({ methodResponses: [[name, { created: { new: { id: 'h' } } }, '0']] });
  },
}));

import { GET, POST } from '../route';

function setup() {
  return POST(new NextRequest('http://localhost/api/admin/oauth/setup', {
    method: 'POST',
    body: JSON.stringify({ origin: 'https://webmail.example.org', issuerUrl: 'https://mail.example.org' }),
  }));
}

beforeEach(() => {
  readOnly = false;
  saveError = null;
  stalwart016 = false;
  signedIn = true;
  jmapCalls.length = 0;
});

describe('POST /api/admin/oauth/setup', () => {
  it('creates the client on Stalwart when the config is writable', async () => {
    const res = await setup();
    expect(res.status).toBe(200);
    expect(jmapCalls.map(([name]) => name)).toEqual(['x:OAuthClient/query', 'x:OAuthClient/set']);
  });

  it('registers a first-party client, which Stalwart 1.0 gives full access', async () => {
    const res = await setup();
    expect(res.status).toBe(200);
    const create = (jmapCalls[1][1].create as Record<string, Record<string, unknown>>).new;
    expect(create.firstParty).toBe(true);
  });

  it('registers the client without firstParty on Stalwart 0.16, which has no such field', async () => {
    stalwart016 = true;
    const res = await setup();
    expect(res.status).toBe(200);
    expect(jmapCalls.map(([name]) => name)).toEqual(['x:OAuthClient/query', 'x:OAuthClient/set', 'x:OAuthClient/set']);
    const create = (jmapCalls[2][1].create as Record<string, Record<string, unknown>>).new;
    expect(create.clientId).toBe('bulwark-webmail');
    expect(create).not.toHaveProperty('firstParty');
  });

  it('tells the admin to sign in to the webmail when no mail account is signed in here', async () => {
    signedIn = false;
    const res = await setup();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Sign in to this webmail.*Stalwart web admin does not count/);
    expect(jmapCalls).toEqual([]);
  });

  it('refuses in read-only mode without sending anything to Stalwart (#1250)', async () => {
    readOnly = true;
    const res = await setup();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/read-only/);
    expect(jmapCalls).toEqual([]);
  });

  it('destroys the client it just created when saving the config fails', async () => {
    saveError = new Error('EROFS');
    const res = await setup();
    expect(res.status).toBe(500);
    expect(jmapCalls.at(-1)).toEqual(['x:OAuthClient/set', { accountId: 'a', destroy: ['h'] }]);
  });
});

describe('GET /api/admin/oauth/setup', () => {
  const check = () => GET(new NextRequest('http://localhost/api/admin/oauth/setup'));

  it('names the mail account the setup would run as', async () => {
    const res = await check();
    expect(await res.json()).toEqual({ signedIn: true, username: 'admin@example.org' });
  });

  it('says so when no mail account is signed in to this webmail', async () => {
    signedIn = false;
    const res = await check();
    expect(await res.json()).toEqual({ signedIn: false });
  });

  it('never hands the credential to the page', async () => {
    const body = JSON.stringify(await (await check()).json());
    expect(body).not.toContain('Basic');
  });
});
