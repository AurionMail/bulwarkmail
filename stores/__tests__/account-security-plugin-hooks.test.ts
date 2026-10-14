import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/stalwart/jmap-passthrough', () => ({
  stalwartJmap: vi.fn(),
  requireResult: <T,>(responses: Array<[string, unknown, string]>, method: string): T => {
    const match = responses.find(r => r[0] === method);
    if (!match) throw new Error(`Missing ${method}`);
    return match[1] as T;
  },
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      updateBasicPassword: async () => {},
      client: {
        getAccountId: () => 'acc-primary',
        hasAccountCapability: (cap: string) => cap === 'urn:stalwart:jmap',
      },
    }),
  },
}));

import { useAccountSecurityStore } from '../account-security-store';
import { stalwartJmap } from '@/lib/stalwart/jmap-passthrough';
import { accountSecurityHooks, clearAllHooks } from '@/lib/plugin-hooks';

const jmap = stalwartJmap as unknown as ReturnType<typeof vi.fn>;

const updated = (method: string) => [[method, { updated: { singleton: null } }, '0']];
const refused = (method: string) => [[method, { notUpdated: { singleton: { type: 'invalidProperties', description: 'wrong password' } } }, '0']];
const authInfo = [
  ['x:AccountPassword/get', { list: [{ otpAuth: {} }] }, '0'],
  ['x:AppPassword/query', { ids: [] }, '1'],
  ['x:ApiKey/query', { ids: [] }, '2'],
];

/** Every argument any security hook received, flattened to one string. */
function allPayloads(...handlers: ReturnType<typeof vi.fn>[]): string {
  return JSON.stringify(handlers.flatMap((h) => h.mock.calls));
}

describe('account security plugin hooks', () => {
  beforeEach(() => {
    jmap.mockReset();
    useAccountSecurityStore.getState().clearState();
  });
  afterEach(() => clearAllHooks());

  it('reports a password change only once the server accepted it, without the password', async () => {
    const changed = vi.fn();
    accountSecurityHooks.onPasswordChange.register('test', changed);
    const store = useAccountSecurityStore.getState();

    jmap.mockResolvedValueOnce(refused('x:AccountPassword/set'));
    await expect(store.changePassword('old-secret', 'new-secret')).rejects.toThrow();
    expect(changed).not.toHaveBeenCalled();

    jmap.mockResolvedValueOnce(updated('x:AccountPassword/set'));
    await store.changePassword('old-secret', 'new-secret', '123456');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith({});
  });

  it('reports two-factor sign-in turned on and off, without seed or code', async () => {
    const changed = vi.fn();
    accountSecurityHooks.onTotpChange.register('test', changed);
    const store = useAccountSecurityStore.getState();

    jmap.mockResolvedValueOnce(refused('x:AccountPassword/set'));
    await expect(store.enableTotp('pw-secret', 'otpauth://totp/x?secret=SEED', '111111')).rejects.toThrow();
    expect(changed).not.toHaveBeenCalled();

    jmap.mockResolvedValueOnce(updated('x:AccountPassword/set'));
    await store.enableTotp('pw-secret', 'otpauth://totp/x?secret=SEED', '111111');
    jmap.mockResolvedValueOnce(updated('x:AccountPassword/set'));
    await store.disableTotp('pw-secret', '222222');

    expect(changed.mock.calls).toEqual([[{ enabled: true }], [{ enabled: false }]]);
    expect(allPayloads(changed)).not.toMatch(/SEED|111111|222222|pw-secret/);
  });

  it('reports app passwords created and removed, never their value', async () => {
    const changed = vi.fn();
    accountSecurityHooks.onAppPasswordChange.register('test', changed);
    const store = useAccountSecurityStore.getState();

    jmap
      .mockResolvedValueOnce([['x:AppPassword/set', { created: { new: { id: 'ap1', secret: 'APP-SECRET' } } }, '0']])
      .mockResolvedValueOnce(authInfo);
    const created = await store.createAppPassword({ description: 'Phone' });
    expect(created.secret).toBe('APP-SECRET');

    jmap
      .mockResolvedValueOnce([['x:AppPassword/set', { notDestroyed: { ap1: { type: 'notFound' } } }, '0']])
      .mockResolvedValueOnce(authInfo);
    await store.removeAppPassword('ap1');

    jmap
      .mockResolvedValueOnce([['x:AppPassword/set', { destroyed: ['ap1'] }, '0']])
      .mockResolvedValueOnce(authInfo);
    await store.removeAppPassword('ap1');

    expect(changed.mock.calls).toEqual([[{ change: 'created' }], [{ change: 'removed' }]]);
    expect(allPayloads(changed)).not.toContain('APP-SECRET');
  });

  it('does not report API keys as app passwords', async () => {
    const changed = vi.fn();
    accountSecurityHooks.onAppPasswordChange.register('test', changed);
    jmap
      .mockResolvedValueOnce([['x:ApiKey/set', { created: { new: { id: 'k1', secret: 'KEY' } } }, '0']])
      .mockResolvedValueOnce(authInfo);
    await useAccountSecurityStore.getState().createApiKey({ description: 'CI' });
    expect(changed).not.toHaveBeenCalled();
  });

  it('reports encryption at rest switched on and off after the server accepted it', async () => {
    const changed = vi.fn();
    accountSecurityHooks.onEncryptionChange.register('test', changed);
    const store = useAccountSecurityStore.getState();

    jmap.mockResolvedValueOnce(refused('x:AccountSettings/set'));
    await expect(store.updateEncryptionAtRest({ type: 'Aes256', publicKeyId: 'pk1' })).rejects.toThrow();
    expect(changed).not.toHaveBeenCalled();

    jmap.mockResolvedValue(updated('x:AccountSettings/set'));
    await store.updateEncryptionAtRest({ type: 'Aes256', publicKeyId: 'pk1' }).catch(() => {});
    await store.updateEncryptionAtRest({ type: 'Disabled', publicKeyId: null }).catch(() => {});

    expect(changed.mock.calls).toEqual([[{ enabled: true }], [{ enabled: false }]]);
  });

  it('reports a new display name after the server accepted it', async () => {
    const changed = vi.fn();
    accountSecurityHooks.onDisplayNameChange.register('test', changed);
    const store = useAccountSecurityStore.getState();

    jmap.mockResolvedValueOnce(refused('x:AccountSettings/set'));
    await expect(store.updateDisplayName('Ann')).rejects.toThrow();
    expect(changed).not.toHaveBeenCalled();

    jmap.mockResolvedValueOnce(updated('x:AccountSettings/set'));
    await store.updateDisplayName('Ann');
    expect(changed).toHaveBeenCalledWith({ displayName: 'Ann' });
  });
});
