// Contract tests for the plugin-facing message-list category tabs
// (api.tabs.set → stores/message-list-tabs-store.ts).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useMessageListTabsStore,
  validateTabsConfig,
  resolveTabFilter,
} from '@/stores/message-list-tabs-store';
import type { MessageListTab } from '@/lib/plugin-types';

const GMAIL_STYLE = {
  tabs: [
    { id: 'primary', label: 'Primary', keyword: null },
    { id: 'promotions', label: 'Promotions', keyword: '$category-promotions' },
    { id: 'social', label: 'Social', query: { operator: 'OR', conditions: [{ from: 'reddit.com' }, { from: 'linkedin.com' }] } },
    { id: 'updates', label: 'Updates', keyword: '$category-updates' },
  ],
};

function resetStore() {
  useMessageListTabsStore.setState({
    registrations: {},
    tabs: [],
    mailboxRoles: [],
    activeTabId: null,
    tabCounts: {},
    isCountsLoading: false,
  });
}

beforeEach(resetStore);

describe('validateTabsConfig', () => {
  it('normalizes a valid config and defaults mailboxRoles to inbox', () => {
    const v = validateTabsConfig(GMAIL_STYLE);
    expect(v.tabs).toHaveLength(4);
    expect(v.mailboxRoles).toEqual(['inbox']);
    expect(v.tabs[1].keyword).toBe('$category-promotions');
    expect(v.tabs[2].query).toEqual(GMAIL_STYLE.tabs[2].query);
  });

  it('lowercases keywords (IMAP keywords are case-insensitive)', () => {
    const v = validateTabsConfig({
      tabs: [
        { id: 'a', label: 'A', keyword: '$Category-Promotions' },
        { id: 'b', label: 'B', keyword: null },
      ],
    });
    expect(v.tabs[0].keyword).toBe('$category-promotions');
  });

  it('rejects reserved and tag keywords', () => {
    expect(() => validateTabsConfig({
      tabs: [{ id: 'a', label: 'A', keyword: '$seen' }, { id: 'b', label: 'B' }],
    })).toThrow(/reserved/);
    expect(() => validateTabsConfig({
      tabs: [{ id: 'a', label: 'A', keyword: '$label.x' }, { id: 'b', label: 'B' }],
    })).toThrow(/reserved/);
  });

  it('rejects duplicate ids, multiple default tabs, and single-tab configs', () => {
    expect(() => validateTabsConfig({
      tabs: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B', keyword: '$x' }],
    })).toThrow(/duplicate/);
    expect(() => validateTabsConfig({
      tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    })).toThrow(/default/);
    expect(() => validateTabsConfig({
      tabs: [{ id: 'a', label: 'A', keyword: '$x' }],
    })).toThrow(/at least 2/);
  });

  it('rejects non-object and oversized queries', () => {
    expect(() => validateTabsConfig({
      tabs: [{ id: 'a', label: 'A', query: 'from:x' as unknown as Record<string, unknown> }, { id: 'b', label: 'B' }],
    })).toThrow(/filter object/);
    const huge = { from: 'x'.repeat(20000) };
    expect(() => validateTabsConfig({
      tabs: [{ id: 'a', label: 'A', query: huge }, { id: 'b', label: 'B' }],
    })).toThrow(/exceeds/);
  });

  // Stalwart 1.0 parses JMAP Metadata filter conditions, then hits `todo!()`
  // in Email/query and panics; 0.16 answers `unsupportedFilter`.
  it('rejects JMAP Metadata filter conditions at any depth (they panic Stalwart 1.0)', () => {
    const tabsWith = (query: Record<string, unknown>) => ({
      tabs: [{ id: 'a', label: 'A', query }, { id: 'b', label: 'B' }],
    });
    expect(() => validateTabsConfig(tabsWith({ metadataExists: 'example.com/category' })))
      .toThrow('tab "a" query may not filter on JMAP Metadata ("metadataExists")');
    expect(() => validateTabsConfig(tabsWith({
      operator: 'OR',
      conditions: [
        { from: 'news@example.com' },
        { operator: 'NOT', conditions: [{ privateMetadataTextContains: { path: 'x/y', value: 'z' } }] },
      ],
    }))).toThrow(/JMAP Metadata \("privateMetadataTextContains"\)/);
    expect(() => validateTabsConfig(tabsWith({ MetadataTextEquals: 'x' }))).toThrow(/JMAP Metadata/);
  });

  it('accepts ordinary filters that only mention metadata in values', () => {
    const query = { operator: 'AND', conditions: [{ header: ['X-Metadata', 'yes'] }, { subject: 'metadata' }] };
    const v = validateTabsConfig({ tabs: [{ id: 'a', label: 'A', query }, { id: 'b', label: 'B' }] });
    expect(v.tabs[0].query).toEqual(query);
  });
});

describe('resolveTabFilter', () => {
  const tabs = validateTabsConfig(GMAIL_STYLE).tabs as MessageListTab[];

  it('uses hasKeyword for keyword tabs and the raw query for search tabs', () => {
    expect(resolveTabFilter(tabs[1], tabs)).toEqual({ hasKeyword: '$category-promotions' });
    expect(resolveTabFilter(tabs[2], tabs)).toEqual(GMAIL_STYLE.tabs[2].query);
  });

  it('resolves the default tab to NOT(all other positive fragments)', () => {
    const filter = resolveTabFilter(tabs[0], tabs) as { operator: string; conditions: unknown[] };
    expect(filter.operator).toBe('NOT');
    expect(filter.conditions).toHaveLength(3);
    expect(filter.conditions).toContainEqual({ hasKeyword: '$category-promotions' });
    expect(filter.conditions).toContainEqual(GMAIL_STYLE.tabs[2].query);
  });
});

describe('store registration', () => {
  it('registers tabs, activates the default tab, and scopes to the inbox role', () => {
    const store = useMessageListTabsStore.getState();
    store.registerTabs('category-tabs', GMAIL_STYLE);

    const s = useMessageListTabsStore.getState();
    expect(s.tabs.map(t => t.id)).toEqual(['primary', 'promotions', 'social', 'updates']);
    expect(s.activeTabId).toBe('primary');
    expect(s.isEnabledForRole('inbox')).toBe(true);
    expect(s.isEnabledForRole('trash')).toBe(false);
    // Default tab active → NOT filter.
    const filter = s.getCategoryFilter('inbox') as { operator: string };
    expect(filter.operator).toBe('NOT');
    expect(s.getCategoryFilter('trash')).toBeNull();
  });

  it('keeps only the first default tab when two plugins both register one', () => {
    const store = useMessageListTabsStore.getState();
    store.registerTabs('p1', { tabs: [{ id: 'main', label: 'Main', order: 1 }, { id: 'x', label: 'X', keyword: '$x' }] });
    store.registerTabs('p2', { tabs: [{ id: 'other', label: 'Other', order: 2 }, { id: 'y', label: 'Y', keyword: '$y' }] });
    const defaults = useMessageListTabsStore.getState().tabs.filter(t => !t.query && !t.keyword);
    expect(defaults.map(t => t.id)).toEqual(['main']);
  });

  it('clears a plugin registration and resets counts when the strip empties', () => {
    const store = useMessageListTabsStore.getState();
    store.registerTabs('category-tabs', GMAIL_STYLE);
    useMessageListTabsStore.setState({ tabCounts: { promotions: 5 } });
    store.clearTabs('category-tabs');
    const s = useMessageListTabsStore.getState();
    expect(s.tabs).toHaveLength(0);
    expect(s.activeTabId).toBeNull();
    expect(s.tabCounts).toEqual({});
    expect(s.getCategoryFilter('inbox')).toBeNull();
  });

  it('switches the active tab and exposes its filter', () => {
    const store = useMessageListTabsStore.getState();
    store.registerTabs('category-tabs', GMAIL_STYLE);
    store.setActiveTab('promotions', 'inbox-id');
    expect(useMessageListTabsStore.getState().getCategoryFilter('inbox')).toEqual({ hasKeyword: '$category-promotions' });
  });
});
