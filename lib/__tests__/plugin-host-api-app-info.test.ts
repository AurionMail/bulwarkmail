import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';

// api.app.getInfo: what a plugin may know about the app it runs in (an AI
// assistant answering "what webmail is this?"), with no permission.

const config = { appName: 'Rath Mail', stalwartFeaturesEnabled: false, demoMode: false };
const fetchConfig = vi.fn(async () => config);
vi.mock('@/hooks/use-config', () => ({ fetchConfig: () => fetchConfig() }));

const { dispatchApiCall } = await import('../plugin-sandbox/host-api');

const plugin = (permissions: string[] = []) => ({
  id: 'p', name: 'P', version: '1.0.0', author: 'a', description: 'd', type: 'hook',
  permissions, entrypoint: 'index.js', enabled: true, status: 'running', settings: {}, httpPostAllowedOrigins: [],
} as unknown as InstalledPlugin);

afterEach(() => {
  vi.unstubAllEnvs();
  fetchConfig.mockClear();
});

describe('api.app.getInfo', () => {
  it('gives the product, the administrator\'s name for it, the version and the edition, without a permission', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.17.0');
    expect(await dispatchApiCall(plugin(), 'app.getInfo', [])).toEqual({
      product: 'Bulwark Mail',
      name: 'Rath Mail',
      version: '1.17.0',
      edition: 'full',
      stalwartFeatures: false,
      demoMode: false,
    });
  });

  it('still answers when the config can not be read', async () => {
    fetchConfig.mockRejectedValueOnce(new Error('offline'));
    const info = await dispatchApiCall(plugin(), 'app.getInfo', []) as { name: string; product: string };
    expect(info.product).toBe('Bulwark Mail');
    expect(info.name).toBe('Webmail');
  });
});
