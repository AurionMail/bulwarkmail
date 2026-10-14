import { afterEach, describe, it, expect, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';
import type { ThemeSnapshot } from '../plugin-sandbox/host-theme';

// Folder rows are 44px tall below the lg breakpoint. A plugin frame's own
// viewport is the frame, so the page passes that height in as a variable,
// and has to pass it again when the page crosses the breakpoint, which no
// DOM mutation reports.

const page = vi.hoisted(() => ({ theme: { dark: false, fontFamily: 'sans-serif', vars: { '--touch-row-min-h': '0px' } } as ThemeSnapshot }));

vi.mock('../plugin-sandbox/host-api', () => ({ dispatchApiCall: vi.fn(async () => 'ok') }));
vi.mock('../plugin-sandbox/host-theme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../plugin-sandbox/host-theme')>()),
  snapshotHostTheme: () => page.theme,
}));

import { createSlotInstance } from '../plugin-sandbox/host-bridge';

function plugin(): InstalledPlugin {
  return {
    id: 'p1', name: 'P', version: '1.0.0', author: '', description: '', type: 'hook',
    permissions: [], entrypoint: 'index.js', enabled: true, status: 'running', settings: {},
  };
}

const instances: Array<{ destroy(): void }> = [];
afterEach(() => {
  for (const i of instances.splice(0)) i.destroy();
});

describe('touch row height in plugin frames', () => {
  it('is among the tokens the page mirrors into frames', async () => {
    const { snapshotHostTheme } = await vi.importActual<typeof import('../plugin-sandbox/host-theme')>('../plugin-sandbox/host-theme');
    document.documentElement.style.setProperty('--touch-row-min-h', '44px');
    try {
      expect(snapshotHostTheme().vars['--touch-row-min-h']).toBe('44px');
    } finally {
      document.documentElement.style.removeProperty('--touch-row-min-h');
    }
  });

  it('reaches open frames when the page is resized across the breakpoint', async () => {
    const inst = createSlotInstance({
      plugin: plugin(), slot: 'sidebar-widget', code: '', locale: 'en', tier: 'untrusted', extraProps: {},
      hostContainer: document.body, onResize: () => {},
    });
    instances.push(inst);
    const setTheme = vi.spyOn(inst, 'setTheme');

    page.theme = { ...page.theme, vars: { '--touch-row-min-h': '44px' } };
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 50));

    expect(setTheme).toHaveBeenCalledWith(expect.objectContaining({ vars: { '--touch-row-min-h': '44px' } }));
  });
});
