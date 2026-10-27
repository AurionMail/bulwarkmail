import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

// The Organisation pages edit one scope at a time: Everyone (the global
// policy) or a domain or group scope. A value a scope doesn't set comes from
// Everyone and can be reset to it; saving sends the whole policy.

const puts: Array<Record<string, unknown>> = [];
let stored: Record<string, unknown> = {};
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      puts.push(body);
      stored = body;
      return new Response('{"ok":true}');
    }
    return new Response(JSON.stringify(stored));
  }),
  withBasePath: (p: string) => p,
  getPathPrefix: () => '',
}));

import { OrganisationPage } from '../_pages/organisation';
import { useOrgPolicyDraft, useOrgScopeStore, EVERYONE } from '@/components/admin/org/use-org-policy-draft';

const POLICY = {
  restrictions: { density: { locked: true, value: 'compact' } },
  features: {}, defaults: {}, themePolicy: {},
  forceEnabledPlugins: [], approvedPlugins: [], forceEnabledThemes: [],
  organisation: { session: { idleMinutes: 30 } },
  scopes: [{ id: 'team', label: 'Team', match: { groups: ['org-team@example.org'] }, policy: {} }],
};

beforeEach(() => {
  puts.length = 0;
  stored = JSON.parse(JSON.stringify(POLICY));
  useOrgScopeStore.setState({ scopeId: EVERYONE });
});

describe('useOrgPolicyDraft', () => {
  it('writes into the selected scope and shows Everyone\'s value until then', async () => {
    const { result } = renderHook(() => useOrgPolicyDraft('test'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setScopeId('team'));
    expect(result.current.orgValue('session', 'idleMinutes')).toEqual({ value: 30, own: false, everyone: 30 });

    act(() => result.current.setOrgValue('session', 'idleMinutes', 5));
    expect(result.current.orgValue('session', 'idleMinutes')).toEqual({ value: 5, own: true, everyone: 30 });
    expect(result.current.policy?.organisation?.session.idleMinutes).toBe(30);
    expect(result.current.dirty).toBe(true);

    act(() => result.current.clearOrgValue('session', 'idleMinutes'));
    expect(result.current.orgValue('session', 'idleMinutes').own).toBe(false);
    expect(result.current.policy?.scopes?.[0].policy.organisation).toEqual({});
  });

  it('lets a scope unlock what Everyone locks, and saves the whole policy', async () => {
    const { result } = renderHook(() => useOrgPolicyDraft('test'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setScopeId('team'));
    act(() => result.current.setRestriction('density', { locked: false }));
    expect(result.current.policy?.scopes?.[0].policy.restrictions).toEqual({ density: {} });
    expect(result.current.policy?.restrictions.density).toEqual({ locked: true, value: 'compact' });

    await act(async () => { await result.current.save(); });
    expect(puts).toHaveLength(1);
    expect((puts[0].scopes as Array<{ policy: unknown }>)[0].policy).toEqual({ restrictions: { density: {} } });
    expect(puts[0].organisation).toMatchObject({ session: { idleMinutes: 30 } });
  });

  it('writes to the global policy for Everyone', async () => {
    const { result } = renderHook(() => useOrgPolicyDraft('test'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setOrgValue('externalMail', 'senderLabel', true));
    expect(result.current.policy?.organisation?.externalMail.senderLabel).toBe(true);
    expect(result.current.policy?.scopes?.[0].policy).toEqual({});
  });
});

describe('OrganisationPage', () => {
  it('adds a domain scope and shows which entry sets what for a user', async () => {
    render(<OrganisationPage />);
    await screen.findByTestId('org-scope-team');

    fireEvent.click(screen.getByRole('button', { name: /Add domains/ }));
    const names = screen.getAllByLabelText('Name') as HTMLInputElement[];
    expect(names.map((n) => n.value)).toEqual(['Team', 'New domain']);

    fireEvent.change(screen.getByLabelText('User address'), { target: { value: 'org-alice@example.org' } });
    fireEvent.change(screen.getByLabelText('Groups the user is a member of'), { target: { value: 'org-team@example.org' } });
    const table = await screen.findByTestId('org-effective-policy');
    expect(table.textContent).toContain('Applies, in this order: Everyone, Team.');
    expect(table.textContent).toContain('restrictions.density');
    expect(table.textContent).toContain('organisation.session.idleMinutes');
  });
});
