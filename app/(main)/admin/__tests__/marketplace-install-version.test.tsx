import { beforeEach, describe, expect, it, vi } from 'vitest';

// A version older than the installed one comes back as 409 with a
// `downgrade` marker (the marketplace route). The admin is asked, like for
// a withdrawn version, and only then is the install repeated with `force`.

const calls: Array<{ body: Record<string, unknown> }> = [];
let responses: Response[] = [];
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body ?? '{}')) });
    return responses.shift() ?? new Response('{}', { status: 500 });
  }),
}));
vi.mock('next/link', () => ({ default: () => null }));

import { installVersion } from '../_pages/marketplace';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const BODY = { slug: 'jitsi-meet', version: '2.0.9', type: 'plugin' as const };

beforeEach(() => {
  calls.length = 0;
  responses = [];
});

describe('installVersion', () => {
  it('asks before installing an older version and repeats with force when the admin agrees', async () => {
    responses = [json({ error: 'Version 2.0.9 is older than the installed 2.1.0.', downgrade: { installedVersion: '2.1.0' } }, 409), json({ warnings: [] })];
    const asked: string[] = [];
    const result = await installVersion(BODY, (message) => { asked.push(message); return true; });
    expect(asked).toEqual(['Version 2.0.9 is older than the installed 2.1.0.\n\nInstall the older version anyway?']);
    expect(calls.map((c) => c.body.force)).toEqual([undefined, true]);
    expect(result.ok).toBe(true);
  });

  it('does not install an older version the admin declined', async () => {
    responses = [json({ error: 'older', downgrade: { installedVersion: '2.1.0' } }, 409)];
    const result = await installVersion(BODY, () => false);
    expect(result).toEqual({ ok: false, error: 'Not installed.' });
    expect(calls).toHaveLength(1);
  });

  it('shows any other 409 as the error it is', async () => {
    responses = [json({ error: 'The configuration is read-only' }, 409)];
    const result = await installVersion(BODY, () => true);
    expect(result).toEqual({ ok: false, error: 'The configuration is read-only' });
    expect(calls).toHaveLength(1);
  });
});
