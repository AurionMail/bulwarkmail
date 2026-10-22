import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// public/sw.js is served raw, never bundled, so it cannot be imported. Run it
// in a VM with a minimal ServiceWorkerGlobalScope and fire the event.
const SW_SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

function loadWorker(tabs: { postMessage: (msg: unknown) => void }[]) {
  const listeners = new Map<string, (event: unknown) => void>();
  const subscribe = vi.fn(async () => ({}));
  const self = {
    location: { href: 'https://mail.example.com/sw.js', origin: 'https://mail.example.com' },
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => tabs },
    registration: { pushManager: { subscribe } },
  };
  const context = vm.createContext({
    self, caches: {}, fetch: vi.fn(), URL, URLSearchParams, Response, Date, console,
  });
  vm.runInContext(SW_SOURCE, context);

  async function fire(type: string, event: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  return { fire, subscribe };
}

// The push service dropped or replaced the subscription while no page was
// involved (#1321). The worker puts a subscription back and tells the open
// tabs, which hold the login needed to register the new endpoint.
describe('service worker pushsubscriptionchange', () => {
  it('re-subscribes with the old key and tells the open tabs to re-register', async () => {
    const tab = { postMessage: vi.fn() };
    const { fire, subscribe } = loadWorker([tab]);
    const options = { userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) };

    await fire('pushsubscriptionchange', { oldSubscription: { options }, newSubscription: null });

    expect(subscribe).toHaveBeenCalledWith(options);
    expect(tab.postMessage).toHaveBeenCalledWith({ kind: 'pushsubscriptionchange' });
  });

  it('leaves a subscription the browser already replaced alone', async () => {
    const tab = { postMessage: vi.fn() };
    const { fire, subscribe } = loadWorker([tab]);

    await fire('pushsubscriptionchange', {
      oldSubscription: { options: { userVisibleOnly: true } },
      newSubscription: { endpoint: 'https://push.example/new' },
    });

    expect(subscribe).not.toHaveBeenCalled();
    expect(tab.postMessage).toHaveBeenCalledWith({ kind: 'pushsubscriptionchange' });
  });

  it('still tells the tabs when re-subscribing fails', async () => {
    const tab = { postMessage: vi.fn() };
    const { fire, subscribe } = loadWorker([tab]);
    subscribe.mockRejectedValueOnce(new Error('permission revoked'));

    await fire('pushsubscriptionchange', { oldSubscription: { options: {} }, newSubscription: null });

    expect(tab.postMessage).toHaveBeenCalledWith({ kind: 'pushsubscriptionchange' });
  });
});
