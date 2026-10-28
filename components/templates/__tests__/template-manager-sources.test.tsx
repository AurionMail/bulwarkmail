import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TemplateManagerModal } from '../template-manager-modal';
import { DEFAULT_POLICY, type SettingsPolicy } from '@/lib/admin/types';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { resolvePolicy } from '@/lib/admin/policy-scopes';
import { resetAccountSubjects } from '@/lib/org/account-subjects';
import { usePolicyStore } from '@/stores/policy-store';
import { useTemplateStore } from '@/stores/template-store';
import type { EmailTemplate } from '@/lib/template-types';

// The template manager lists the organisation library read-only next to
// the user's own templates; a template from it can be copied into the
// user's own.

const own = (id: string, name: string): EmailTemplate => ({
  id, name, subject: '', body: '', category: '', isFavorite: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

const RAW: SettingsPolicy = {
  ...DEFAULT_POLICY,
  organisation: {
    ...DEFAULT_ORGANISATION_POLICY,
    templates: { library: [{ id: 'welcome', name: 'Welcome', subject: 'Hello', body: 'Welcome text', isHTML: false, category: '' }] },
  },
};
const ALICE = { email: 'alice@example.org', groups: [] };

function setPolicy(raw: SettingsPolicy) {
  usePolicyStore.setState({ rawPolicy: raw, policy: resolvePolicy(raw, ALICE).policy, subject: ALICE });
}

beforeEach(() => {
  resetAccountSubjects();
  setPolicy(RAW);
  useTemplateStore.setState({ templates: [own('mine', 'Mine')], recentTemplateIds: [], deletedTemplateIds: {} });
});
afterEach(() => resetAccountSubjects());

describe('template manager sources', () => {
  it('shows the organisation library read-only, with a preview and a copy into the user\'s own', () => {
    render(<TemplateManagerModal isOpen onClose={() => {}} />);
    expect(screen.getByText('Mine')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('template-source-tab-organisation'));

    expect(screen.getByTestId('template-source-note')).toHaveTextContent('organisation_note');
    const row = screen.getByTestId('template-row');
    expect(within(row).getByText('Welcome')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'edit' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'confirm_delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'add' })).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'preview' }));
    expect(screen.getByTestId('template-preview')).toHaveTextContent('Welcome text');

    fireEvent.click(within(row).getByRole('button', { name: 'copy_to_personal' }));
    const names = useTemplateStore.getState().templates.map((t) => t.name);
    expect(names).toEqual(['Mine', 'Welcome']);
    expect(useTemplateStore.getState().templates[1].id).not.toBe('welcome');
  });

  it('offers no personal templates and no copy when the admin hid them', () => {
    setPolicy({ ...RAW, restrictions: { personalTemplates: { hidden: true } } });
    render(<TemplateManagerModal isOpen onClose={() => {}} />);
    expect(screen.queryByTestId('template-source-tab-personal')).toBeNull();
    expect(screen.queryByText('Mine')).toBeNull();
    const row = screen.getByTestId('template-row');
    expect(within(row).getByText('Welcome')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'copy_to_personal' })).toBeNull();
  });
});
