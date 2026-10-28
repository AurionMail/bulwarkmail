import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Organisation > Templates: the admin library per scope (a scope adds to
// Everyone's by id) and the restrictions on users' own and team templates,
// saved in one PUT.

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

import { OrgTemplatesPage } from '../_pages/org-templates';
import { EVERYONE, useOrgScopeStore } from '@/components/admin/org/use-org-policy-draft';

const WELCOME = { id: 'welcome', name: 'Welcome', subject: 'Hello', body: '<p>Hi <b>there</b></p>', isHTML: true, category: 'Sales' };

const POLICY = {
  restrictions: {},
  features: {}, defaults: {}, themePolicy: {},
  forceEnabledPlugins: [], approvedPlugins: [], forceEnabledThemes: [],
  organisation: { templates: { library: [WELCOME] } },
  scopes: [{ id: 'two', label: 'Org two', match: { domains: ['org-two.test'] }, policy: {} }],
};

beforeEach(() => {
  puts.length = 0;
  stored = JSON.parse(JSON.stringify(POLICY));
  useOrgScopeStore.setState({ scopeId: EVERYONE });
});

describe('Organisation > Templates', () => {
  it('edits Everyone\'s library with a preview', async () => {
    render(<OrgTemplatesPage />);
    const items = await screen.findAllByTestId('org-template-item');
    expect(items).toHaveLength(1);
    fireEvent.click(within(items[0]).getByRole('button', { name: /^Welcome/ }));
    expect(screen.getByTestId('org-template-preview').innerHTML).toContain('<b>there</b>');

    fireEvent.click(screen.getByTestId('org-template-add'));
    const names = screen.getAllByTestId('org-template-name');
    fireEvent.change(names[1], { target: { value: 'Offer' } });
    fireEvent.change(screen.getAllByTestId('org-template-body')[1], { target: { value: 'Our offer' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const library = (puts[0].organisation as { templates: { library: Array<{ name: string; body: string }> } }).templates.library;
    expect(library.map((t) => t.name)).toEqual(['Welcome', 'Offer']);
    expect(library[1].body).toBe('Our offer');
  });

  it('adds templates for a scope without copying Everyone\'s, and changes one of Everyone\'s for that scope only', async () => {
    render(<OrgTemplatesPage />);
    await screen.findAllByTestId('org-template-item');
    fireEvent.click(screen.getByRole('button', { name: 'Org two' }));

    // Everyone's template is shown, not editable, and the scope starts empty.
    expect(within(screen.getByTestId('org-template-inherited')).getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByTestId('org-template-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('org-template-add'));
    fireEvent.change(screen.getByTestId('org-template-name'), { target: { value: 'Two only' } });
    fireEvent.click(screen.getByRole('button', { name: /Change for this scope/ }));
    const subjects = screen.getAllByTestId('org-template-subject');
    fireEvent.click(within(screen.getAllByTestId('org-template-item')[1]).getByRole('button', { name: /^Welcome/ }));
    fireEvent.change(screen.getAllByTestId('org-template-subject')[1], { target: { value: 'Hello from two' } });
    expect(subjects).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const scope = (puts[0].scopes as Array<{ policy: { organisation: { templates: { library: Array<{ id: string; name: string; subject: string }> } } } }>)[0];
    const library = scope.policy.organisation.templates.library;
    expect(library.map((t) => t.name)).toEqual(['Two only', 'Welcome']);
    expect(library[1]).toMatchObject({ id: 'welcome', subject: 'Hello from two' });
    // Everyone keeps its own.
    expect((puts[0].organisation as { templates: { library: Array<{ subject: string }> } }).templates.library[0].subject).toBe('Hello');
  });

  it('removing the last template of a scope inherits Everyone\'s library again', async () => {
    stored = JSON.parse(JSON.stringify({
      ...POLICY,
      scopes: [{ ...POLICY.scopes[0], policy: { organisation: { templates: { library: [{ ...WELCOME, id: 'x', name: 'X' }] } } } }],
    }));
    render(<OrgTemplatesPage />);
    await screen.findAllByTestId('org-template-item');
    fireEvent.click(screen.getByRole('button', { name: 'Org two' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove X' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const policy = (puts[0].scopes as Array<{ policy: { organisation?: Record<string, unknown> } }>)[0].policy;
    expect(policy.organisation?.templates).toBeUndefined();
  });

  it('says that a template without a name is not saved', async () => {
    render(<OrgTemplatesPage />);
    await screen.findAllByTestId('org-template-item');
    fireEvent.click(screen.getByTestId('org-template-add'));
    expect(screen.getByText(/A template without a name is not saved/)).toBeInTheDocument();
  });

  it('hides personal templates through the restriction row', async () => {
    render(<OrgTemplatesPage />);
    await screen.findAllByTestId('org-template-item');
    fireEvent.click(screen.getByLabelText('Hide'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0].restrictions as Record<string, unknown>).personalTemplates).toEqual({ hidden: true });
  });

  it('locks team templates for a group scope only', async () => {
    stored = JSON.parse(JSON.stringify({
      ...POLICY,
      scopes: [...POLICY.scopes, { id: 'team', label: 'Team', match: { groups: ['org-team@example.org'] }, policy: {} }],
    }));
    render(<OrgTemplatesPage />);
    await screen.findAllByTestId('org-template-item');
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    fireEvent.click(screen.getByLabelText('Lock'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const scopes = puts[0].scopes as Array<{ id: string; policy: { restrictions?: Record<string, unknown> } }>;
    expect(scopes.find((scope) => scope.id === 'team')?.policy.restrictions).toEqual({ teamTemplates: { locked: true } });
    expect((puts[0].restrictions as Record<string, unknown>).teamTemplates).toBeUndefined();
  });
});
