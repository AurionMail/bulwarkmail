import { afterEach, describe, it, expect, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';

vi.mock('../plugin-sandbox/host-api', () => ({
  dispatchApiCall: vi.fn(async () => 'ok'),
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

// A slot iframe of 300x100 px; messages come from its own (null-origin) window.
function slot() {
  const onFloatingDropdown = vi.fn();
  const inst = createSlotInstance({
    plugin: plugin(), slot: 'plugin-dialog', code: '', locale: 'en', tier: 'untrusted', extraProps: {},
    hostContainer: document.body, onResize: vi.fn(), onFloatingDropdown,
  });
  instances.push(inst);
  inst.iframe.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 100, width: 300, height: 100, x: 0, y: 0, toJSON: () => ({}) });
  const post = (data: unknown) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin: 'null', source: inst.iframe.contentWindow }));
  return { onFloatingDropdown, post };
}

const goodRect = { left: 10, top: 20, bottom: 50, width: 200, height: 30 };

describe('floating dropdown messages from a plugin', () => {
  it('passes a well-formed open message through', () => {
    const { onFloatingDropdown, post } = slot();
    post({
      type: 'floating-dropdown-open', id: 'x-listbox', rect: goodRect,
      options: [{ value: 'a', label: 'A' }], selectedValues: [], highlightedIndex: 0,
    });
    expect(onFloatingDropdown).toHaveBeenCalledTimes(1);
    expect(onFloatingDropdown.mock.calls[0][0]).toMatchObject({ id: 'x-listbox', rect: goodRect, options: [{ value: 'a', label: 'A' }] });
  });

  it('drops an open message whose options are not a list, so the host never renders it', () => {
    const { onFloatingDropdown, post } = slot();
    post({ type: 'floating-dropdown-open', id: 'x', rect: goodRect, options: 'boom', selectedValues: [], highlightedIndex: 0 });
    expect(onFloatingDropdown).not.toHaveBeenCalled();
  });

  it('keeps only options with string labels and fills in missing selectedValues', () => {
    const { onFloatingDropdown, post } = slot();
    post({
      type: 'floating-dropdown-open', id: 'x', rect: goodRect, highlightedIndex: 0,
      options: [{ value: 'a', label: { $$typeof: 'x' } }, { value: 'b', label: 'B' }, null],
    });
    const msg = onFloatingDropdown.mock.calls[0][0];
    expect(msg.options).toEqual([{ value: 'b', label: 'B' }]);
    expect(msg.selectedValues).toEqual([]);
  });

  it('clamps the anchor rect to the plugin frame', () => {
    const { onFloatingDropdown, post } = slot();
    post({
      type: 'floating-dropdown-open', id: 'x', options: [], selectedValues: [], highlightedIndex: -1,
      rect: { left: -900, top: 5000, bottom: 6000, width: 99999, height: 1000 },
    });
    expect(onFloatingDropdown.mock.calls[0][0].rect).toEqual({ left: 0, top: 100, bottom: 100, width: 300, height: 0 });
  });

  it('ignores a bad rect in an update but keeps the rest', () => {
    const { onFloatingDropdown, post } = slot();
    post({ type: 'floating-dropdown-update', id: 'x', rect: { left: 'a' }, highlightedIndex: 2 });
    expect(onFloatingDropdown.mock.calls[0][0]).toEqual({ type: 'floating-dropdown-update', id: 'x', highlightedIndex: 2 });
  });
});
