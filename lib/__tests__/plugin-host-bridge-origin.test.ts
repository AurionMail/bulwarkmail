import { afterEach, describe, it, expect, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';

vi.mock('../plugin-sandbox/host-api', () => ({
  dispatchApiCall: vi.fn(async () => 'ok'),
}));

import { createBackgroundInstance } from '../plugin-sandbox/host-bridge';
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
