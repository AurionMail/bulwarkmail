import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateScript } from '@/lib/sieve/generator';
import { STALWART_VACATION_SCRIPT, mockSieveAccount } from '@/lib/filters/__tests__/sieve-mock';
import { useVacationStore } from '../vacation-store';

const SIEVE = 'urn:ietf:params:jmap:sieve';

/**
 * The session lists Sieve, and account "b" runs its auto-reply from the
 * filters script. `sieveInAccount` is whether b's own accountCapabilities
 * list Sieve too.
 */
function accountB(sieveInAccount: boolean) {
  const account = mockSieveAccount('b', [
    { name: 'filters', content: generateScript([], undefined, { extensions: ['include'], includeVacation: true }), isActive: true },
    { name: 'vacation', content: STALWART_VACATION_SCRIPT, isActive: false },
  ]);
  const client = Object.assign(account.client, {
    supportsSieve: () => true,
    accountSupports: (_accountId: string, capability: string) => capability !== SIEVE || sieveInAccount,
    getVacationResponse: vi.fn(async () => ({
      id: 'singleton', isEnabled: false, fromDate: null, toDate: null, subject: '', textBody: 'away', htmlBody: null,
    })),
    setVacationResponse: vi.fn(async () => {}),
  });
  return { ...account, client };
}

const initial = useVacationStore.getState();
afterEach(() => {
  useVacationStore.setState(initial, true);
});

describe('vacation on a shared account (#1263)', () => {
  it('leaves Sieve alone when the account does not list it', async () => {
    const server = accountB(false);
    await useVacationStore.getState().fetchVacationResponse(server.client, 'b');
    expect(useVacationStore.getState()).toMatchObject({ isEnabled: false, textBody: 'away', error: null });
    expect(server.client.getSieveScripts).not.toHaveBeenCalled();

    await useVacationStore.getState().updateVacationResponse(server.client, { isEnabled: true }, 'b');
    expect(server.client.setVacationResponse).toHaveBeenCalledWith({ isEnabled: true }, 'b');
    expect(server.client.getSieveScripts).not.toHaveBeenCalled();
    expect(server.writes()).toBe(0);
  });

  it('reads the filters script when the account lists Sieve', async () => {
    const server = accountB(true);
    await useVacationStore.getState().fetchVacationResponse(server.client, 'b');
    expect(server.client.getSieveScripts).toHaveBeenCalledWith('b');
    expect(useVacationStore.getState().isEnabled).toBe(true);
  });

  it('goes by the session for the own account', async () => {
    const server = accountB(false);
    await useVacationStore.getState().fetchVacationResponse(server.client);
    expect(server.client.getSieveScripts).toHaveBeenCalledWith('b');
    expect(useVacationStore.getState().isEnabled).toBe(true);
  });
});
