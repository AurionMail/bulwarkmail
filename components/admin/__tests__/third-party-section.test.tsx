import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listReachableHosts } from '@/lib/admin/reachable-hosts';
import { OUTGOING_HOSTS } from '@/lib/admin/outgoing-hosts-registry';
import type { OrgPolicyDraft } from '@/components/admin/org/use-org-policy-draft';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/browser-navigation', async (orig) => ({
  ...(await orig<typeof import('@/lib/browser-navigation')>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const { ThirdPartySection } = await import('@/components/admin/org/sections/third-party-section');

const setMessage = vi.fn();
const draft = { setMessage } as unknown as OrgPolicyDraft;

function state(overrides: Record<string, unknown> = {}) {
  return {
    noThirdPartyTraffic: false,
    source: 'default',
    readOnly: false,
    envLocked: false,
    builtIn: OUTGOING_HOSTS,
    reachable: [{ kind: 'JMAP server', host: 'mail.corp.example', setIn: 'JMAP_SERVER_URL', side: 'both' }],
    networkPlugins: [],
    ...overrides,
  };
}

function switchOf() {
  return within(screen.getByTestId('third-party-switch')).getByRole('switch');
}

beforeEach(() => {
  apiFetch.mockReset();
  setMessage.mockReset();
});

describe('ThirdPartySection', () => {
  it('saves the switch as config through /api/admin/config', async () => {
    let current = state();
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/config' && init?.method === 'PATCH') {
        current = state({ noThirdPartyTraffic: true, source: 'admin' });
        return Response.json({ ok: true });
      }
      return Response.json(current);
    });
    render(<ThirdPartySection draft={draft} />);
    await waitFor(() => expect(switchOf()).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByTestId('third-party-scope-note').textContent).toMatch(/whole server, not per domain or group/);
    expect(screen.getByTestId('third-party-reachable').textContent).toContain('mail.corp.example');

    await act(async () => { fireEvent.click(switchOf()); });
    expect(apiFetch).toHaveBeenCalledWith('/api/admin/config', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ noThirdPartyTraffic: true }),
    }));
    await waitFor(() => expect(switchOf()).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByText('config.json')).toBeInTheDocument();
    // No relay of their own: push needs one now.
    expect(screen.getByText(/Push notifications now need a relay you run yourself/)).toBeInTheDocument();
  });

  it('is read-only when the environment sets it', async () => {
    apiFetch.mockImplementation(async () => Response.json(state({ noThirdPartyTraffic: true, source: 'env', envLocked: true })));
    render(<ThirdPartySection draft={draft} />);
    await waitFor(() => expect(switchOf()).toBeDisabled());
    expect(screen.getByText('NO_THIRD_PARTY_TRAFFIC')).toBeInTheDocument();
    expect(screen.getByText(/Set by NO_THIRD_PARTY_TRAFFIC in the environment/)).toBeInTheDocument();
  });

  it('is read-only on a read-only config', async () => {
    apiFetch.mockImplementation(async () => Response.json(state({ readOnly: true })));
    render(<ThirdPartySection draft={draft} />);
    await waitFor(() => expect(switchOf()).toBeDisabled());
    expect(screen.getByText(/The configuration is read-only/)).toBeInTheDocument();
  });
});

describe('listReachableHosts', () => {
  it('lists the hosts the deployment configured and leaves the built-in ones out', () => {
    const config: Record<string, unknown> = {
      jmapServerUrl: 'https://mail.corp.example',
      jmapServers: [{ id: 'b', label: 'Branch', url: 'https://jmap.branch.example', oauth: { issuerUrl: 'https://sso.corp.example' } }],
      oauthEnabled: false,
      oauthIssuerUrl: 'https://ignored.example',
      extensionDirectoryUrl: 'https://extensions.bulwarkmail.org',
      wopiClientUrl: 'https://office.corp.example',
      loginLogoLightUrl: '/branding/Bulwark_Logo_Color.svg',
      appLogoLightUrl: 'https://cdn.corp.example/logo.svg',
    };
    const hosts = listReachableHosts({
      get: (key) => config[key],
      policy: {
        pushRelays: [{ label: 'Own', url: 'https://push.corp.example' }, { label: 'Built-in', url: 'https://notifications.relay.bulwarkmail.org' }],
        pushRelayUrl: '',
        defaultSidebarApps: [{ id: 'w', name: 'Wiki', url: 'https://wiki.corp.example', icon: 'Globe', openMode: 'inline', showOnMobile: true }],
      },
      env: { LIBRETRANSLATE_URL: 'https://translate.corp.example' },
    });
    expect(hosts.map((h) => `${h.kind}: ${h.host}`)).toEqual([
      'JMAP server: mail.corp.example',
      'JMAP server: jmap.branch.example',
      'OAuth issuer: sso.corp.example',
      'Push relay: push.corp.example',
      'Sidebar app: wiki.corp.example',
      'Document editor (WOPI): office.corp.example',
      'Translation (LibreTranslate): translate.corp.example',
      'Branding image: cdn.corp.example',
    ]);
  });
});
