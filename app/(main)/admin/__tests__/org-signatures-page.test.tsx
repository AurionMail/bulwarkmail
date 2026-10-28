import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// Organisation > Signatures: the templates, the user details they ask for
// and the `signature` restriction, edited per scope and saved in one PUT.

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
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ loginCompanyName: 'ACME Ltd' }) }));

import { OrgSignaturesPage } from '../_pages/org-signatures';
import { EVERYONE, useOrgScopeStore } from '@/components/admin/org/use-org-policy-draft';

const POLICY = {
  restrictions: {},
  features: {}, defaults: {}, themePolicy: {},
  forceEnabledPlugins: [], approvedPlugins: [], forceEnabledThemes: [],
  organisation: { signature: { html: '<p>{name}</p>', text: '', fields: [] } },
  scopes: [{ id: 'example', label: 'Example', match: { domains: ['example.org'] }, policy: {} }],
};

beforeEach(() => {
  puts.length = 0;
  stored = JSON.parse(JSON.stringify(POLICY));
  useOrgScopeStore.setState({ scopeId: EVERYONE });
});

describe('Organisation > Signatures', () => {
  it('sets a signature for a domain scope, with the fields it asks for and a lock', async () => {
    render(<OrgSignaturesPage />);
    const html = await screen.findByTestId('org-signature-html') as HTMLTextAreaElement;
    expect(html.value).toBe('<p>{name}</p>');

    fireEvent.click(screen.getByRole('button', { name: 'Example' }));
    expect(screen.getByText(/From Everyone: <p>\{name\}<\/p>/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('org-signature-html'), {
      target: { value: '<p>{name}<br>Phone: {phone}<br>Mobile: {mobile}</p><p>{company}</p>' },
    });

    // The preview fills in sample values and leaves out empty lines.
    const preview = screen.getByTestId('org-signature-preview');
    expect(preview.innerHTML).toContain('Alex Example<br>Phone: +49 30 1234567<br>Mobile: +49 170 1234567');
    expect(preview.innerHTML).toContain('ACME Ltd');
    fireEvent.click(screen.getByLabelText('For a user who filled in no details'));
    expect(screen.getByTestId('org-signature-preview').innerHTML).toContain('<p>Alex Example</p><p>ACME Ltd</p>');

    const fields = screen.getByTestId('org-signature-fields');
    expect([...fields.querySelectorAll('[data-used]')].map((li) => li.textContent)).toEqual(['Phoneasked for', 'Mobileasked for']);

    fireEvent.click(screen.getByLabelText('Lock'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const scope = (puts[0].scopes as Array<{ policy: Record<string, unknown> }>)[0];
    expect(scope.policy).toEqual({
      organisation: { signature: { html: '<p>{name}<br>Phone: {phone}<br>Mobile: {mobile}</p><p>{company}</p>', fields: ['phone', 'mobile'] } },
      restrictions: { signature: { locked: true } },
    });
    // Everyone keeps its own.
    expect((puts[0].organisation as { signature: { html: string } }).signature.html).toBe('<p>{name}</p>');
  });

  it('inserts a placeholder at the cursor of the template last edited', async () => {
    render(<OrgSignaturesPage />);
    const text = await screen.findByTestId('org-signature-text') as HTMLTextAreaElement;
    fireEvent.focus(text);
    fireEvent.click(screen.getByRole('button', { name: '{department}' }));
    await waitFor(() => expect((screen.getByTestId('org-signature-text') as HTMLTextAreaElement).value).toBe('{department}'));
    // Branding per domain goes by the web address Bulwark is opened on, not the sender's domain.
    expect(screen.getByText('company name from Branding, for the web address Bulwark is opened on')).toBeInTheDocument();
  });

  it('sets a disclaimer for a scope, with a preview', async () => {
    render(<OrgSignaturesPage />);
    await screen.findByTestId('org-disclaimer-text');
    fireEvent.click(screen.getByRole('button', { name: 'Example' }));
    fireEvent.change(screen.getByTestId('org-disclaimer-text'), { target: { value: 'Confidential, {company}' } });
    expect(screen.getByTestId('org-disclaimer-sample')).toHaveTextContent('Confidential, ACME Ltd');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const scope = (puts[0].scopes as Array<{ policy: Record<string, unknown> }>)[0];
    expect(scope.policy).toEqual({ organisation: { disclaimer: { text: 'Confidential, {company}' } } });
  });
});
