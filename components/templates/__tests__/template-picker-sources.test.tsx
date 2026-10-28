import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TemplatePicker } from '../template-picker';
import { DEFAULT_POLICY, type SettingsPolicy } from '@/lib/admin/types';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { resolvePolicy } from '@/lib/admin/policy-scopes';
import { resetAccountSubjects } from '@/lib/org/account-subjects';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';
import { useTemplateStore } from '@/stores/template-store';
import type { EmailTemplate } from '@/lib/template-types';
import { emptyPartition, useAccountTemplatesStore } from '@/stores/account-templates-store';

// The picker shows the user's own templates, then the admin library under
// "Organisation", from the policy of the account the message is written
// from. The global next-intl mock returns keys.

const own = (id: string, name: string, extra: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id, name, subject: '', body: `${name} body`, category: '', isFavorite: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});

const lib = (id: string, name: string) => ({ id, name, subject: `${name} subject`, body: `<p>${name}</p><script>x()</script>`, isHTML: true, category: '' });

const RAW: SettingsPolicy = {
  ...DEFAULT_POLICY,
  organisation: { ...DEFAULT_ORGANISATION_POLICY, templates: { library: [lib('welcome', 'Welcome')] } },
  scopes: [
    { id: 'two', label: 'Two', match: { domains: ['org-two.test'] }, policy: { organisation: { templates: { library: [lib('two', 'Two only')] } } } },
  ],
};
const ALICE = { email: 'alice@example.org', groups: [] };
const DAVE_CLIENT = {
  getUsername: () => 'dave@org-two.test',
  getSharedAccounts: () => [],
  getAccountInfo: () => null,
};

const original = useAuthStore.getState();

function setPolicy(raw: SettingsPolicy) {
  usePolicyStore.setState({ rawPolicy: raw, policy: resolvePolicy(raw, ALICE).policy, subject: ALICE });
}

beforeEach(() => {
  resetAccountSubjects();
  useAuthStore.setState({
    activeAccountId: 'a1',
    getClientForAccount: (id: string) => (id === 'a2' ? DAVE_CLIENT : undefined),
  } as never);
  setPolicy(RAW);
  useTemplateStore.setState({ templates: [own('mine', 'Mine')], recentTemplateIds: [], deletedTemplateIds: {} });
  useAccountTemplatesStore.setState({ personal: {}, teams: {}, active: null });
});
afterEach(() => {
  resetAccountSubjects();
  useAuthStore.setState({ activeAccountId: original.activeAccountId, getClientForAccount: original.getClientForAccount } as never);
});

const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).slice(1);

describe('template picker sources', () => {
  it('heads the user\'s own templates and the organisation library', () => {
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={() => {}} />);
    expect(headings()).toEqual(['section_personal', 'section_organisation']);
    const organisation = screen.getByTestId('template-source-organisation');
    expect(within(organisation).getByText('Welcome')).toBeInTheDocument();
    expect(within(organisation).queryByText('Two only')).toBeNull();
    expect(within(screen.getByTestId('template-source-personal')).getByText('Mine')).toBeInTheDocument();
  });

  it('looks as before when there is no organisation library', () => {
    setPolicy({ ...RAW, organisation: DEFAULT_ORGANISATION_POLICY, scopes: [] });
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={() => {}} />);
    expect(headings()).toEqual([]);
    expect(screen.queryByTestId('template-source-personal')).toBeNull();
    expect(screen.getByText('Mine')).toBeInTheDocument();
  });

  it('shows the library of the account the message is sent from', () => {
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={() => {}} accountId="a2" />);
    const organisation = screen.getByTestId('template-source-organisation');
    expect(within(organisation).getByText('Welcome')).toBeInTheDocument();
    expect(within(organisation).getByText('Two only')).toBeInTheDocument();
  });

  it('hands an organisation template to the composer sanitised', () => {
    const onSelect = vi.fn();
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Welcome'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const template = onSelect.mock.calls[0][0] as EmailTemplate;
    expect(template.subject).toBe('Welcome subject');
    expect(template.body).toContain('<p>Welcome</p>');
    expect(template.body).not.toContain('script');
    // Recently used is for the user's own templates.
    expect(useTemplateStore.getState().recentTemplateIds).toEqual([]);
  });

  it('leaves out personal templates the admin hid', () => {
    setPolicy({ ...RAW, restrictions: { personalTemplates: { hidden: true } } });
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={() => {}} />);
    expect(screen.queryByText('Mine')).toBeNull();
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });

  it('searches every source under its heading', () => {
    useTemplateStore.setState({ templates: [own('mine', 'Welcome back')] });
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('search_placeholder'), { target: { value: 'welc' } });
    expect(within(screen.getByTestId('template-source-personal')).getByText('Welcome back')).toBeInTheDocument();
    expect(within(screen.getByTestId('template-source-organisation')).getByText('Welcome')).toBeInTheDocument();
  });

  it('shows the own templates of the account the message is sent from once it keeps them', () => {
    useAccountTemplatesStore.setState({ personal: { a2: { ...emptyPartition(), templates: [own('dave-1', "Dave's own")] } } });
    const { unmount } = render(<TemplatePicker isOpen onClose={() => {}} onSelect={() => {}} accountId="a2" />);
    expect(screen.getByText("Dave's own")).toBeInTheDocument();
    expect(screen.queryByText('Mine')).toBeNull();
    unmount();
    // The active account has no copy of its own yet: the browser's list.
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('Mine')).toBeInTheDocument();
    expect(screen.queryByText("Dave's own")).toBeNull();
  });
});
