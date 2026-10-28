import { afterEach, describe, expect, it } from 'vitest';
import type { FilterRule } from '@/lib/jmap/sieve-types';
import { generateScript } from '@/lib/sieve/generator';
import { mockStalwartAccount } from '@/lib/filters/__tests__/sieve-mock';
import { useFilterStore } from '../filter-store';

// After a save from the raw Sieve editor the page reads the script the way
// a page load does: a script the builder understands shows its rules again,
// rather than "edited outside the visual builder" until the next visit.

const EXTENSIONS = ['fileinto', 'mailbox', 'imap4flags'];

const rule: FilterRule = {
  id: 'r1',
  name: 'Newsletters',
  enabled: true,
  matchType: 'all',
  conditions: [{ field: 'from', comparator: 'contains', value: 'news@example.com' }],
  actions: [{ type: 'mark_read' }],
  stopProcessing: false,
};

/** What the settings page does when the raw editor saves. */
async function saveRaw(client: never, content: string) {
  useFilterStore.getState().setRawScript(content);
  useFilterStore.setState({ isOpaque: true, rules: [] });
  await useFilterStore.getState().saveFilters(client);
}

afterEach(() => useFilterStore.getState().clearState());

describe('saving from the raw Sieve editor', () => {
  it('shows the rules of a script the builder understands, as a fresh load does', async () => {
    const script = generateScript([rule], undefined, { extensions: EXTENSIONS });
    const server = mockStalwartAccount('a', [{ name: 'filters', content: script, isActive: true }], EXTENSIONS);
    await useFilterStore.getState().fetchFilters(server.client as never, 'a');
    expect(useFilterStore.getState().rules).toHaveLength(1);

    await saveRaw(server.client as never, script);

    const after = useFilterStore.getState();
    expect(after.isOpaque).toBe(false);
    expect(after.rules.map((r) => r.name)).toEqual(['Newsletters']);

    // The same as a fresh visit to the page.
    await useFilterStore.getState().fetchFilters(server.client as never, 'a');
    expect(useFilterStore.getState().isOpaque).toBe(after.isOpaque);
    expect(useFilterStore.getState().rules.map((r) => r.name)).toEqual(['Newsletters']);
  });

  it('stays in raw mode for a script the builder cannot read', async () => {
    const server = mockStalwartAccount('a', [{ name: 'filters', content: 'keep;', isActive: true }], EXTENSIONS);
    await useFilterStore.getState().fetchFilters(server.client as never, 'a');

    await saveRaw(server.client as never, '/* @metadata:begin\n{corrupt\n@metadata:end */');

    expect(useFilterStore.getState().isOpaque).toBe(true);
    expect(useFilterStore.getState().rules).toEqual([]);
  });
});
