/**
 * A slot frame renders the props the host sent with init and follows every
 * props-update after that. An update that landed after the slot's first
 * render but before it subscribed was dropped, so the slot kept the replaced
 * props and their callbacks, which the host had already forgotten:
 * "unknown callback" (#1266).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, screen, waitFor } from '@testing-library/react';

const HOST_ORIGIN = window.location.origin;

// The slot component shows its label, and tells the test when it renders.
const BUNDLE = `module.exports = { slots: { 'email-banner': { component: function (props) {
  globalThis.__slotRendered && globalThis.__slotRendered(props);
  return React.createElement('span', null, props.label);
} } } };`;
const hooks = globalThis as { __slotRendered?: (props: unknown) => void };

function post(source: unknown, origin: string, data: unknown): void {
  const ev = new MessageEvent('message', { data, origin });
  Object.defineProperty(ev, 'source', { value: source });
  window.dispatchEvent(ev);
}

let hostWindow: { postMessage: ReturnType<typeof vi.fn> };
const realParent = Object.getOwnPropertyDescriptor(window, 'parent');

beforeEach(() => {
  // The runtime keeps its host binding and boot flag at module scope.
  vi.resetModules();
  hostWindow = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { configurable: true, get: () => hostWindow as unknown as Window });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete hooks.__slotRendered;
  if (realParent) Object.defineProperty(window, 'parent', realParent);
});

describe('slot props in the sandbox runtime', () => {
  it('shows an update that arrives before the slot has subscribed to updates', async () => {
    const { SandboxRuntime } = await import('@/lib/plugin-sandbox/runtime');
    render(React.createElement(SandboxRuntime));

    // The first render has read the init props; its effects have not run yet.
    let posted = false;
    hooks.__slotRendered = () => {
      if (posted) return;
      posted = true;
      post(hostWindow, HOST_ORIGIN, { type: 'props-update', props: { label: 'new' } });
    };
    post(hostWindow, HOST_ORIGIN, {
      type: 'init',
      payload: {
        mode: 'slot',
        pluginId: 'x',
        tier: 'privileged',
        slot: 'email-banner',
        locale: 'en',
        manifest: { id: 'x', version: '1.0.0', permissions: [], settings: {} },
        code: BUNDLE,
        extraProps: { label: 'old' },
        theme: { dark: false, fontFamily: 'sans-serif', vars: {} },
      },
    });

    await waitFor(() => expect(posted).toBe(true));
    await waitFor(() => expect(screen.getByText('new')).toBeInTheDocument());
  }, 30_000);
});

describe('theme changes in the sandbox runtime', () => {
  it('applies a theme change and tells the host, which then switches the iframe element', async () => {
    const { SandboxRuntime } = await import('@/lib/plugin-sandbox/runtime');
    render(React.createElement(SandboxRuntime));
    post(hostWindow, HOST_ORIGIN, {
      type: 'init',
      payload: {
        mode: 'slot', pluginId: 'x', tier: 'privileged', slot: 'email-banner', locale: 'en',
        manifest: { id: 'x', version: '1.0.0', permissions: [], settings: {} },
        code: BUNDLE, extraProps: { label: 'x' },
        theme: { dark: false, fontFamily: 'sans-serif', vars: {} },
      },
    });
    await waitFor(() => expect(screen.getByText('x')).toBeInTheDocument());

    post(hostWindow, HOST_ORIGIN, { type: 'theme-change', theme: { dark: true, fontFamily: 'sans-serif', vars: {} } });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(hostWindow.postMessage).toHaveBeenCalledWith({ type: 'theme-applied', dark: true }, HOST_ORIGIN);
    document.documentElement.classList.remove('dark');
  }, 30_000);
});

describe('translations in the sandbox runtime', () => {
  it('uses the tables a locale change brings, and keeps strings the plugin added', async () => {
    const bundle = `module.exports = { activate: function (api) { globalThis.__pluginApi = api; } };`;
    const g = globalThis as { __pluginApi?: { i18n: { t(k: string): string; addTranslations(l: string, s: Record<string, string>): void } } };
    const { SandboxRuntime } = await import('@/lib/plugin-sandbox/runtime');
    render(React.createElement(SandboxRuntime));
    post(hostWindow, HOST_ORIGIN, {
      type: 'init',
      payload: {
        mode: 'background', pluginId: 'x', tier: 'privileged', locale: 'en',
        manifest: { id: 'x', version: '1.0.0', permissions: [], settings: {}, locales: { en: { hello: 'Hello', bye: 'Bye' } } },
        code: bundle,
      },
    });
    await waitFor(() => expect(g.__pluginApi).toBeDefined());
    const api = g.__pluginApi!;
    expect(api.i18n.t('hello')).toBe('Hello');
    api.i18n.addTranslations('fr', { bye: 'Salut' });

    post(hostWindow, HOST_ORIGIN, { type: 'locale-change', locale: 'fr', locales: { fr: { hello: 'Bonjour', bye: 'Au revoir' }, en: { hello: 'Hello', bye: 'Bye' } } });

    expect(api.i18n.t('hello')).toBe('Bonjour');
    expect(api.i18n.t('bye')).toBe('Salut');
    delete g.__pluginApi;
  }, 30_000);
});

describe('slot boot', () => {
  it('shows props the host pushed while React DOM and the kit were loading', async () => {
    const { SandboxRuntime } = await import('@/lib/plugin-sandbox/runtime');
    render(React.createElement(SandboxRuntime));
    post(hostWindow, HOST_ORIGIN, {
      type: 'init',
      payload: {
        mode: 'slot', pluginId: 'x', tier: 'privileged', slot: 'email-banner', locale: 'en',
        manifest: { id: 'x', version: '1.0.0', permissions: [], settings: {} },
        code: BUNDLE, extraProps: { label: 'old' },
        theme: { dark: false, fontFamily: 'sans-serif', vars: {} },
      },
    });
    // Right away: the renderer is still loading.
    post(hostWindow, HOST_ORIGIN, { type: 'props-update', props: { label: 'new' } });

    await waitFor(() => expect(screen.getByText('new')).toBeInTheDocument());
    expect(hostWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init-done' }), HOST_ORIGIN);
  }, 30_000);
});
