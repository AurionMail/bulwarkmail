import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVacationStore } from '../vacation-store';
import { clearAllHooks, vacationHooks } from '@/lib/plugin-hooks';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

const SERVER = {
  id: 'singleton',
  isEnabled: false,
  fromDate: null,
  toDate: null,
  subject: 'Away',
  textBody: 'Back soon',
  htmlBody: null,
};

function mockClient() {
  return {
    supportsSieve: () => false,
    getVacationResponse: vi.fn(async () => ({ ...SERVER })),
    setVacationResponse: vi.fn(async () => {}),
  };
}

const initial = useVacationStore.getState();
afterEach(() => {
  useVacationStore.setState(initial, true);
  clearAllHooks();
});

describe('vacation plugin hooks', () => {
  it('reports the loaded reply, and nothing when loading failed', async () => {
    const loaded = vi.fn();
    vacationHooks.onVacationLoaded.register('test', loaded);
    const client = mockClient();

    client.getVacationResponse.mockRejectedValueOnce(new Error('down'));
    await useVacationStore.getState().fetchVacationResponse(client as unknown as IJMAPClient);
    expect(loaded).not.toHaveBeenCalled();

    await useVacationStore.getState().fetchVacationResponse(client as unknown as IJMAPClient);
    expect(loaded).toHaveBeenCalledWith({
      isEnabled: false, subject: 'Away', htmlBody: '', textBody: 'Back soon', fromDate: null, toDate: null,
    });
  });

  it('asks before saving, then reports the saved reply', async () => {
    const client = mockClient();
    await useVacationStore.getState().fetchVacationResponse(client as unknown as IJMAPClient);
    const before = vi.fn(() => {
      expect(client.setVacationResponse).not.toHaveBeenCalled();
      return true;
    });
    const updated = vi.fn();
    vacationHooks.onBeforeVacationUpdate.register('test', before);
    vacationHooks.onVacationUpdate.register('test', updated);

    const saved = await useVacationStore.getState().updateVacationResponse(client as unknown as IJMAPClient, { isEnabled: true });

    const expected = { isEnabled: true, subject: 'Away', htmlBody: '', textBody: 'Back soon', fromDate: null, toDate: null };
    expect(saved).toBe(true);
    expect(before).toHaveBeenCalledWith(expected);
    expect(updated).toHaveBeenCalledWith(expected);
  });

  it('leaves the reply alone when a plugin says no', async () => {
    const client = mockClient();
    const updated = vi.fn();
    vacationHooks.onBeforeVacationUpdate.register('test', () => false);
    vacationHooks.onVacationUpdate.register('test', updated);

    const saved = await useVacationStore.getState().updateVacationResponse(client as unknown as IJMAPClient, { isEnabled: true });

    expect(saved).toBe(false);
    expect(client.setVacationResponse).not.toHaveBeenCalled();
    expect(useVacationStore.getState().isEnabled).toBe(false);
    expect(useVacationStore.getState().isSaving).toBe(false);
    expect(updated).not.toHaveBeenCalled();
  });

  it('does not report a save the server refused', async () => {
    const client = mockClient();
    client.setVacationResponse.mockRejectedValueOnce(new Error('refused'));
    const updated = vi.fn();
    vacationHooks.onVacationUpdate.register('test', updated);

    await expect(useVacationStore.getState().updateVacationResponse(client as unknown as IJMAPClient, { isEnabled: true })).rejects.toThrow();
    expect(updated).not.toHaveBeenCalled();
  });
});
