import { describe, expect, it, vi } from 'vitest';

// Lite's static router opens the login page at `/login/`, with a trailing
// slash the login path checks don't match, so a signed-out visitor still
// reloads into the login page there.
vi.mock('@/lib/lite', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lite')>()),
  IS_LITE: true,
}));

const { canEnterLoginInPlace } = await import('../auth-store');

describe('canEnterLoginInPlace in Lite', () => {
  it('reloads into the login page', () => {
    expect(canEnterLoginInPlace()).toBe(false);
  });
});
