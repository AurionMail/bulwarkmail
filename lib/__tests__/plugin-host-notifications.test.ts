import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';
import { ALL_PERMISSIONS } from '../plugin-types';
import { toastHooks } from '../plugin-hooks';
import { resetPluginRateLimits } from '../plugin-sandbox/host-api-input';
import { HIGH_RISK_PERMISSIONS } from '../plugin-sandbox/permission-text';

const toastInfo = vi.fn();
vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: (...a: unknown[]) => toastInfo(...a), warning: vi.fn() },
}));

import { dispatchApiCall } from '../plugin-sandbox/host-api';

function plugin(id: string, perms = ['ui:notifications']): InstalledPlugin {
  return {
    id, name: id === 'rss' ? 'RSS Reader' : 'Other', version: '1.0.0', author: 'test', description: '',
    type: 'hook', permissions: perms, grantedPermissions: perms, entrypoint: 'index.js',
    enabled: true, status: 'running', settings: {},
  };
}

const RSS = plugin('rss');
const call = (p: InstalledPlugin, ...args: unknown[]) => dispatchApiCall(p, 'notifications.show', args);

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static shown: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) {
    FakeNotification.shown.push(this);
  }
}

beforeEach(() => {
  resetPluginRateLimits();
  toastInfo.mockClear();
  FakeNotification.shown = [];
  FakeNotification.permission = 'granted';
  vi.stubGlobal('Notification', FakeNotification);
});

afterEach(() => {
  vi.unstubAllGlobals();
  toastHooks.onNotificationClick.removePlugin('rss');
  toastHooks.onNotificationClick.removePlugin('other');
});

describe('api.notifications.show', () => {
  it('shows a system notification naming the plugin, with a tag scoped to it', async () => {
    expect(await call(RSS, { title: '3 new posts', body: 'From Hacker News', tag: 'feed:hn' })).toBe('system');
    const [n] = FakeNotification.shown;
    expect(n.title).toBe('3 new posts');
    expect(n.options.body).toBe('From Hacker News\nRSS Reader');
    expect(n.options.tag).toBe('plugin:rss:feed:hn');
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('falls back to a toast without notification permission', async () => {
    FakeNotification.permission = 'default';
    expect(await call(RSS, { title: 'Synced' })).toBe('toast');
    expect(FakeNotification.shown).toHaveLength(0);
    expect(toastInfo).toHaveBeenCalledWith('Synced', { message: 'RSS Reader' });
  });

  it('falls back to a toast when the browser refuses page notifications', async () => {
    vi.stubGlobal('Notification', class extends FakeNotification {
      constructor(title: string, options: NotificationOptions) {
        super(title, options);
        throw new TypeError('Illegal constructor');
      }
    });
    expect(await call(RSS, { title: 'Synced', body: 'All feeds' })).toBe('toast');
    expect(toastInfo).toHaveBeenCalledWith('Synced', { message: 'All feeds (RSS Reader)' });
  });

  it('tells only the sending plugin about a click', async () => {
    const mine = vi.fn();
    const theirs = vi.fn();
    toastHooks.onNotificationClick.register('rss', mine);
    toastHooks.onNotificationClick.register('other', theirs);
    await call(RSS, { title: 'Hi', tag: 'x' });
    FakeNotification.shown[0].onclick?.();
    await Promise.resolve();
    expect(mine).toHaveBeenCalledWith({ tag: 'x' });
    expect(theirs).not.toHaveBeenCalled();
    expect(FakeNotification.shown[0].close).toHaveBeenCalled();
  });

  it('allows five a minute per plugin', async () => {
    for (let i = 0; i < 5; i++) await call(RSS, { title: `n${i}` });
    await expect(call(RSS, { title: 'too many' })).rejects.toThrow(/at most 5 notifications a minute/);
    expect(await call(plugin('other'), { title: 'mine' })).toBe('system');
    expect(FakeNotification.shown).toHaveLength(6);
  });

  it('caps title and body, refuses odd tags and needs ui:notifications', async () => {
    await expect(call(RSS, { title: 'x'.repeat(121) })).rejects.toThrow(/title must be 1-120 characters/);
    await expect(call(RSS, { title: '' })).rejects.toThrow(/title must be 1-120/);
    await expect(call(RSS, { title: 'ok', body: 'x'.repeat(301) })).rejects.toThrow(/body must be at most 300/);
    await expect(call(RSS, { title: 'ok', tag: 'has space' })).rejects.toThrow(/tag must be/);
    await expect(call(RSS, { title: 'ok', icon: 'https://evil.example/x.png' })).rejects.toThrow(/unknown property "icon"/);
    await expect(call(plugin('rss', []), { title: 'ok' })).rejects.toThrow(/lacks permission "ui:notifications"/);
    expect(FakeNotification.shown).toHaveLength(0);
    expect(ALL_PERMISSIONS).toContain('ui:notifications');
    expect(HIGH_RISK_PERMISSIONS.has('ui:notifications')).toBe(false);
  });

  it('keeps a notification to one line', async () => {
    await call(RSS, { title: 'Line 1\nLine 2', body: 'a\r\nb' });
    expect(FakeNotification.shown[0].title).toBe('Line 1 Line 2');
    expect(FakeNotification.shown[0].options.body).toBe('a b\nRSS Reader');
  });
});

describe('api.notifications.show in the notification panel', () => {
  beforeEach(async () => {
    const { useNotificationCenterStore } = await import('@/stores/notification-center-store');
    useNotificationCenterStore.getState().clear();
  });
  const entries = async () => (await import('@/stores/notification-center-store')).useNotificationCenterStore.getState().entries;

  it('lists each one with the plugin and its tag, shown as system notification or toast', async () => {
    await call(RSS, { title: '3 new posts', body: 'From Hacker News', tag: 'feed:hn' });
    FakeNotification.permission = 'default';
    await call(RSS, { title: 'Synced' });

    expect((await entries()).map((e) => [e.title, e.body, e.pluginId, e.pluginName, e.tag])).toEqual([
      ['Synced', '', 'rss', 'RSS Reader', undefined],
      ['3 new posts', 'From Hacker News', 'rss', 'RSS Reader', 'feed:hn'],
    ]);
  });

  it('lists nothing the plugin was refused', async () => {
    await expect(call(RSS, { title: 'ok', tag: 'has space' })).rejects.toThrow();
    for (let i = 0; i < 5; i++) await call(RSS, { title: `n${i}` });
    await expect(call(RSS, { title: 'too many' })).rejects.toThrow();
    expect((await entries()).map((e) => e.title)).not.toContain('too many');
    expect(await entries()).toHaveLength(5);
  });
});
