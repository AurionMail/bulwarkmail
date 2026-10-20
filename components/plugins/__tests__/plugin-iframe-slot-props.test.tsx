import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { InstalledPlugin } from '@/lib/plugin-types';

const evaluateShouldShow = vi.fn(async () => true);
let activePlugin: InstalledPlugin;
let hasShouldShow = false;

vi.mock('@/lib/plugin-sandbox/registry', () => ({
  get: () => ({
    plugin: activePlugin,
    code: '',
    tier: 'untrusted',
    background: { evaluateShouldShow },
    slotOffers: [{ name: 'email-banner', hasShouldShow, order: 100 }, { name: 'composer-sidebar-right', hasShouldShow: false, order: 100, fill: true }],
  }),
}));

const createSlotInstance = vi.fn(() => ({ destroy: vi.fn(), updateProps: vi.fn(), setTheme: vi.fn() }));
vi.mock('@/lib/plugin-sandbox/host-bridge', () => ({
  createSlotInstance: (...args: unknown[]) => createSlotInstance(...(args as [])),
}));
vi.mock('@/lib/plugin-sandbox/host-theme', () => ({ snapshotHostTheme: () => ({}) }));

import { PluginIframeSlot } from '../plugin-iframe-slot';

function plugin(perms: string[]): InstalledPlugin {
  return {
    id: 'p1', name: 'P', version: '1.0.0', author: '', description: '', type: 'ui-extension',
    permissions: perms, grantedPermissions: perms, entrypoint: 'index.js',
    enabled: true, status: 'running', settings: {},
  };
}

const EMAIL = { id: 'm1', text: 'confidential body' };

beforeEach(() => {
  vi.clearAllMocks();
  hasShouldShow = false;
});

describe('PluginIframeSlot', () => {
  it('lets a panel frame fill its panel instead of growing with its content', async () => {
    activePlugin = plugin(['ui:composer-sidebar']);
    const { container } = render(<PluginIframeSlot pluginId="p1" slot="composer-sidebar-right" extraProps={{}} fill />);

    await waitFor(() => expect(createSlotInstance).toHaveBeenCalled());
    const opts = (createSlotInstance.mock.calls[0] as unknown[])[0] as { fill?: boolean };
    expect(opts.fill).toBe(true);
    const wrapper = container.querySelector('[data-plugin-iframe-slot]') as HTMLElement;
    expect(wrapper.dataset.pluginIframeFill).toBe('true');
    expect(wrapper.style.flex).toBe('1 1 0%');
  });

  it('mounts a banner-only plugin without the opened message', async () => {
    activePlugin = plugin(['ui:email-banner']);
    render(<PluginIframeSlot pluginId="p1" slot="email-banner" extraProps={{ email: EMAIL }} />);

    await waitFor(() => expect(createSlotInstance).toHaveBeenCalled());
    const opts = (createSlotInstance.mock.calls[0] as unknown[])[0] as { extraProps: Record<string, unknown> };
    expect(opts.extraProps.email).toBeUndefined();
  });

  it('does not show the message to shouldShow either', async () => {
    activePlugin = plugin(['ui:email-banner']);
    hasShouldShow = true;
    render(<PluginIframeSlot pluginId="p1" slot="email-banner" extraProps={{ email: EMAIL }} />);

    await waitFor(() => expect(evaluateShouldShow).toHaveBeenCalled());
    expect((evaluateShouldShow.mock.calls[0] as unknown[])[1]).toEqual({});
  });

  it('hands the message to a plugin that may read mail', async () => {
    activePlugin = plugin(['ui:email-banner', 'email:read']);
    render(<PluginIframeSlot pluginId="p1" slot="email-banner" extraProps={{ email: EMAIL }} />);

    await waitFor(() => expect(createSlotInstance).toHaveBeenCalled());
    const opts = (createSlotInstance.mock.calls[0] as unknown[])[0] as { extraProps: Record<string, unknown> };
    expect(opts.extraProps.email).toEqual(EMAIL);
  });
});
