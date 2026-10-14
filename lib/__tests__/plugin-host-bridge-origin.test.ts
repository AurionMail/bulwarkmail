import { afterEach, describe, it, expect, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';

vi.mock('../plugin-sandbox/host-api', () => ({
  dispatchApiCall: vi.fn(async () => 'ok'),
}));

import { createBackgroundInstance, createSlotInstance } from '../plugin-sandbox/host-bridge';
import { dispatchApiCall } from '../plugin-sandbox/host-api';

function plugin(): InstalledPlugin {
  return {
    id: 'p1', name: 'P', version: '1.0.0', author: '', description: '', type: 'hook',
    permissions: [], entrypoint: 'index.js', enabled: true, status: 'running', settings: {},
  };
}

function post(source: Window | null, origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

const instances: Array<{ destroy(): void }> = [];
afterEach(() => {
  for (const i of instances.splice(0)) i.destroy();
  vi.clearAllMocks();
});

describe('host bridge origin pin for untrusted sandboxes', () => {
  it('answers API requests from the null-origin sandbox document', async () => {
    const inst = createBackgroundInstance({ plugin: plugin(), code: '', locale: 'en', tier: 'untrusted' });
    instances.push(inst);

    post(inst.iframe.contentWindow, 'null', { type: 'api-request', id: '1', method: 'storage.keys', args: [] });
    await new Promise((r) => setTimeout(r, 0));

    expect(dispatchApiCall).toHaveBeenCalledTimes(1);
  });

  it('ignores the same frame once it has navigated to another origin', async () => {
    // A sandboxed frame may navigate itself. The page it lands on is no
    // longer under the sandbox CSP, so it must not inherit the RPC channel.
    const inst = createBackgroundInstance({ plugin: plugin(), code: '', locale: 'en', tier: 'untrusted' });
    instances.push(inst);

    post(inst.iframe.contentWindow, 'https://attacker.example', { type: 'api-request', id: '1', method: 'storage.keys', args: [] });
    await new Promise((r) => setTimeout(r, 0));

    expect(dispatchApiCall).not.toHaveBeenCalled();
  });
});

describe('init payload settings', () => {
  it('hands a new iframe the settings with defaults filled in', async () => {
    const p = {
      ...plugin(),
      settings: { size: 64 },
      settingsSchema: {
        size: { type: 'number' as const, label: 'Size', default: 160 },
        mode: { type: 'select' as const, label: 'Mode', default: 'auto', options: ['auto', 'manual'] },
      },
    };
    const inst = createBackgroundInstance({ plugin: p, code: '', locale: 'en', tier: 'untrusted' });
    instances.push(inst);
    const sent = vi.spyOn(inst.iframe.contentWindow!, 'postMessage');

    post(inst.iframe.contentWindow, 'null', { type: 'sandbox-ready' });
    await new Promise((r) => setTimeout(r, 0));

    const init = sent.mock.calls.map(([msg]) => msg as { type: string; payload?: { manifest: { settings: unknown } } }).find((m) => m.type === 'init');
    expect(init?.payload?.manifest.settings).toEqual({ size: 64, mode: 'auto' });
  });
});

describe('slot sizing', () => {
  function slot(name: 'email-banner' | 'composer-toolbar') {
    const onResize = vi.fn();
    const inst = createSlotInstance({
      plugin: plugin(), slot: name, code: '', locale: 'en', tier: 'untrusted', extraProps: {},
      hostContainer: document.body, onResize,
    });
    instances.push(inst);
    return { inst, onResize };
  }

  it('ignores a height that is not a number and caps a huge one', async () => {
    const { inst, onResize } = slot('email-banner');
    post(inst.iframe.contentWindow, 'null', { type: 'slot-resize', height: Number.NaN });
    post(inst.iframe.contentWindow, 'null', { type: 'slot-resize', height: 1e9 });
    await new Promise((r) => setTimeout(r, 0));

    expect(onResize).toHaveBeenCalledTimes(1);
    expect(inst.iframe.style.height).toBe('2000px');
  });

  it('sizes a toolbar slot to the width of its content', async () => {
    // A toolbar slot's iframe used to get no width in the composer's
    // button row and squeezed its content to one letter per line.
    const { inst, onResize } = slot('composer-toolbar');
    post(inst.iframe.contentWindow, 'null', { type: 'slot-resize', height: 32, width: 120 });
    await new Promise((r) => setTimeout(r, 0));

    expect(inst.iframe.style.width).toBe('120px');
    expect(onResize).toHaveBeenCalledWith(32, 120);
  });

  it('keeps a block slot at full width whatever it reports', async () => {
    const { inst } = slot('email-banner');
    post(inst.iframe.contentWindow, 'null', { type: 'slot-resize', height: 40, width: 120 });
    await new Promise((r) => setTimeout(r, 0));

    expect(inst.iframe.style.width).toBe('100%');
  });
});

describe('shouldShow context', () => {
  it('leaves host callbacks out instead of failing to post them', async () => {
    const inst = createBackgroundInstance({ plugin: plugin(), code: '', locale: 'en', tier: 'untrusted' });
    instances.push(inst);
    const sent = vi.spyOn(inst.iframe.contentWindow!, 'postMessage');

    void inst.evaluateShouldShow('composer-attachment-source', { onAttach: () => {}, nested: { cb: () => {}, n: 1 } });

    const msg = sent.mock.calls.map(([m]) => m as { type: string; context?: unknown }).find((m) => m.type === 'slot-should-show');
    expect(msg?.context).toEqual({ nested: { n: 1 } });
  });
});

describe('host bookkeeping', () => {
  it('fails a hook call whose arguments cannot be sent, without keeping it pending', async () => {
    const inst = createBackgroundInstance({ plugin: plugin(), code: '', locale: 'en', tier: 'untrusted' });
    instances.push(inst);
    vi.spyOn(inst.iframe.contentWindow!, 'postMessage').mockImplementation(() => { throw new DOMException('no clone', 'DataCloneError'); });

    await expect(inst.invokeHook('onEmailOpen', [() => {}])).rejects.toThrow(/no clone/);
    expect((inst as unknown as { pendingHookInvokes: Map<string, unknown> }).pendingHookInvokes.size).toBe(0);
  });

  it('drops callbacks of props that were replaced', () => {
    const inst = createSlotInstance({
      plugin: plugin(), slot: 'email-banner', code: '', locale: 'en', tier: 'untrusted', extraProps: { a: () => 1 },
      hostContainer: document.body, onResize: () => {},
    });
    instances.push(inst);
    const table = (inst as unknown as { callbackTable: Map<string, unknown> }).callbackTable;

    for (let i = 0; i < 50; i++) inst.updateProps({ onAttach: () => i });

    expect(table.size).toBe(1);
  });
});

describe('plugin frame permissions', () => {
  it('may write to the clipboard and use forms, nothing more', () => {
    const inst = createBackgroundInstance({ plugin: plugin(), code: '', locale: 'en', tier: 'untrusted' });
    try {
      expect(inst.iframe.getAttribute('allow')).toBe('clipboard-write');
      expect(inst.iframe.getAttribute('sandbox')?.split(' ').sort()).toEqual(
        process.env.NODE_ENV === 'development' ? ['allow-same-origin', 'allow-scripts'] : ['allow-forms', 'allow-scripts'],
      );
    } finally {
      inst.destroy();
    }
  });
});

describe('plugin frame color scheme', () => {
  // A frame whose document says dark while the iframe element says light gets
  // an opaque white canvas from the browser: dark text tokens on white.
  it('gives the iframe element the color-scheme the frame declares, at start and on a theme change', () => {
    document.documentElement.classList.add('dark');
    try {
      const inst = createSlotInstance({
        plugin: plugin(), slot: 'plugin-dialog', code: '', locale: 'en', tier: 'untrusted', extraProps: {},
        hostContainer: document.body, onResize: () => {},
      });
      instances.push(inst);
      expect(inst.iframe.style.colorScheme).toBe('dark');
      inst.setTheme({ dark: false, fontFamily: 'sans-serif', vars: {} });
      expect(inst.iframe.style.colorScheme).toBe('light');
      inst.setTheme({ dark: true, fontFamily: 'sans-serif', vars: {} });
      expect(inst.iframe.style.colorScheme).toBe('dark');
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });
});
