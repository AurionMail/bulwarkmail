import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ENTRIES,
  reloadNotificationCenter,
  selectUnreadCount,
  useNotificationCenterStore,
} from '../notification-center-store';
import { toast } from '../toast-store';

const store = () => useNotificationCenterStore.getState();

beforeEach(() => {
  localStorage.clear();
  store().clear();
});
afterEach(() => vi.restoreAllMocks());

describe('notification center', () => {
  it('keeps the newest first and only the last 50', () => {
    for (let i = 0; i < MAX_ENTRIES + 5; i++) store().add({ level: 'info', title: `n${i}`, body: '' });
    expect(store().entries).toHaveLength(MAX_ENTRIES);
    expect(store().entries[0].title).toBe(`n${MAX_ENTRIES + 4}`);
    expect(store().entries.at(-1)!.title).toBe('n5');
  });

  it('survives a reload of the page', () => {
    store().add({ level: 'info', title: 'From the plugin', body: 'b', pluginId: 'rss', pluginName: 'RSS', tag: 't1' });
    useNotificationCenterStore.setState({ entries: [] });
    reloadNotificationCenter();
    expect(store().entries).toMatchObject([{ title: 'From the plugin', pluginId: 'rss', pluginName: 'RSS', tag: 't1', read: false }]);
  });

  it('counts unread, marks all read and clears', () => {
    store().add({ level: 'error', title: 'a', body: '' });
    store().add({ level: 'warning', title: 'b', body: '' });
    expect(selectUnreadCount(store())).toBe(2);
    store().markAllRead();
    expect(selectUnreadCount(store())).toBe(0);
    reloadNotificationCenter();
    expect(selectUnreadCount(store())).toBe(0);
    store().clear();
    reloadNotificationCenter();
    expect(store().entries).toEqual([]);
  });

  it('works without storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => store().add({ level: 'info', title: 'x', body: '' })).not.toThrow();
    expect(store().entries).toHaveLength(1);
  });

  it('drops malformed stored entries', () => {
    localStorage.setItem('notification-center', JSON.stringify([{ id: 1 }, 'x', { id: 'a', time: 1, title: 't', body: '', read: false, level: 'info' }]));
    reloadNotificationCenter();
    expect(store().entries.map((e) => e.id)).toEqual(['a']);
  });

  it('records the app\'s error and warning toasts, not the others', () => {
    toast.error('Could not send', 'Server said no');
    toast.warning('Quota almost full');
    toast.success('Sent');
    toast.info('Heads up');
    expect(store().entries.map((e) => [e.level, e.title, e.body])).toEqual([
      ['warning', 'Quota almost full', ''],
      ['error', 'Could not send', 'Server said no'],
    ]);
    expect(store().entries[0].pluginId).toBeUndefined();
  });
});
