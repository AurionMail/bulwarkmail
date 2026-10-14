import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFilterStore } from '../filter-store';
import { updateAccountFilters, FiltersSaveVetoedError } from '@/lib/filters/account-filters';
import { generateScript } from '@/lib/sieve/generator';
import { clearAllHooks, filterHooks } from '@/lib/plugin-hooks';
import type { FilterRule } from '@/lib/jmap/sieve-types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

const rule = (overrides: Partial<FilterRule> = {}): FilterRule => ({
  id: 'r1',
  name: 'Receipts',
  enabled: true,
  matchType: 'all',
  conditions: [{ field: 'from', comparator: 'contains', value: 'shop@example.com' }],
  actions: [{ type: 'move', value: 'Receipts', mailboxId: 'mb-receipts' }],
  stopProcessing: false,
  ...overrides,
});

const VIEW = {
  id: 'r1',
  name: 'Receipts',
  isActive: true,
  conditions: [{ field: 'from', comparator: 'contains', value: 'shop@example.com' }],
  actions: [{ type: 'move', value: 'Receipts', mailboxId: 'mb-receipts' }],
};

function mockClient(script: string) {
  return {
    getSieveAccountId: () => 'primary',
    getSieveAccounts: () => [{ id: 'primary', name: 'Me', isPrimary: true }],
    getSieveCapabilities: () => null,
    getSieveScripts: vi.fn(async () => [{ id: 's1', name: 'filters', blobId: 'b1', isActive: true }]),
    getSieveScriptContent: vi.fn(async () => script),
    updateSieveScript: vi.fn(async () => {}),
    createSieveScript: vi.fn(async () => ({ id: 's2' })),
  };
}

describe('filter plugin hooks', () => {
  beforeEach(() => useFilterStore.getState().clearState());
  afterEach(() => clearAllHooks());

  it('hands plugins the loaded rules as plain views', async () => {
    const loaded = vi.fn();
    filterHooks.onFiltersLoaded.register('test', loaded);
    const client = mockClient(generateScript([rule({ rawBlock: 'secret' })]));

    await useFilterStore.getState().fetchFilters(client as unknown as IJMAPClient);

    expect(loaded).toHaveBeenCalledTimes(1);
    expect(loaded).toHaveBeenCalledWith([VIEW]);
  });

  it('does not report a load that failed', async () => {
    const loaded = vi.fn();
    filterHooks.onFiltersLoaded.register('test', loaded);
    const client = mockClient('');
    client.getSieveScripts.mockRejectedValueOnce(new Error('down'));
    await useFilterStore.getState().fetchFilters(client as unknown as IJMAPClient);
    expect(loaded).not.toHaveBeenCalled();
  });

  it('reports each kind of rule edit, and none for read-only rules', () => {
    const changed = vi.fn();
    filterHooks.onFilterRuleChange.register('test', changed);
    const store = useFilterStore.getState();

    store.addRule(rule());
    store.addRule(rule({ id: 'r2' }));
    store.updateRule('r1', { name: 'Shop' });
    store.toggleRule('r1');
    store.reorderRules(['r2', 'r1']);
    store.deleteRule('r2');
    useFilterStore.setState({ rules: [...useFilterStore.getState().rules, rule({ id: 'ext', origin: 'external' })] });
    store.toggleRule('ext');
    store.deleteRule('missing');

    expect(changed.mock.calls.map((c) => c[0])).toEqual([
      { ruleId: 'r1', change: 'added' },
      { ruleId: 'r2', change: 'added' },
      { ruleId: 'r1', change: 'updated' },
      { ruleId: 'r1', change: 'toggled' },
      { ruleId: 'r2', change: 'reordered' },
      { ruleId: 'r2', change: 'deleted' },
    ]);
  });

  it('asks before saving and saves when allowed', async () => {
    const client = mockClient('');
    const before = vi.fn(() => {
      expect(client.updateSieveScript).not.toHaveBeenCalled();
      expect(client.createSieveScript).not.toHaveBeenCalled();
      return true;
    });
    filterHooks.onBeforeFiltersSave.register('test', before);
    useFilterStore.getState().addRule(rule());

    await useFilterStore.getState().saveFilters(client as unknown as IJMAPClient);

    expect(before).toHaveBeenCalledWith({ rules: [VIEW] });
    expect(client.createSieveScript).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when a plugin stops the save', async () => {
    const client = mockClient('');
    const saved = vi.fn();
    filterHooks.onBeforeFiltersSave.register('test', () => false);
    filterHooks.onFiltersSave.register('test', saved);
    useFilterStore.getState().addRule(rule());

    await expect(useFilterStore.getState().saveFilters(client as unknown as IJMAPClient)).rejects.toBeInstanceOf(FiltersSaveVetoedError);

    expect(client.createSieveScript).not.toHaveBeenCalled();
    expect(client.updateSieveScript).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    expect(useFilterStore.getState().isSaving).toBe(false);
  });

  it('asks before a rule made from a message is saved', async () => {
    const client = mockClient(generateScript([]));
    const before = vi.fn(() => false);
    filterHooks.onBeforeFiltersSave.register('test', before);

    await expect(updateAccountFilters(client as unknown as IJMAPClient, 'primary', () => [rule()]))
      .rejects.toBeInstanceOf(FiltersSaveVetoedError);

    expect(before).toHaveBeenCalledWith({ rules: [VIEW] });
    expect(client.updateSieveScript).not.toHaveBeenCalled();
  });
});
