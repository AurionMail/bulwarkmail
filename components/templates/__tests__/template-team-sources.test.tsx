import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Team templates of a group mailbox: under the group's name in the picker,
// editable in the manager by members who may, read-only with "Set by your
// organisation" when the admin locked them (`teamTemplates`).

const save = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<string> => 'ok'));
vi.mock('@/lib/templates/team-templates', () => ({
  saveTeamTemplate: save,
  deleteTeamTemplate: vi.fn(async () => 'ok'),
  refreshTeamTemplates: vi.fn(),
}));

import { TemplatePicker } from '../template-picker';
import { TemplateManagerModal } from '../template-manager-modal';
import { DEFAULT_POLICY, type SettingsPolicy } from '@/lib/admin/types';
import { DEFAULT_ORGANISATION_POLICY } from '@/lib/admin/organisation-policy';
import { resolvePolicy } from '@/lib/admin/policy-scopes';
import { resetAccountSubjects } from '@/lib/org/account-subjects';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';
import { useTemplateStore } from '@/stores/template-store';
import { useAccountTemplatesStore } from '@/stores/account-templates-store';
import type { EmailTemplate } from '@/lib/template-types';

const tpl = (id: string, name: string): EmailTemplate => ({
  id, name, subject: '', body: `${name} body`, category: '', isFavorite: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

const RAW: SettingsPolicy = {
  ...DEFAULT_POLICY,
  organisation: { ...DEFAULT_ORGANISATION_POLICY, templates: { library: [{ id: 'org-1', name: 'Company', subject: '', body: 'x', isHTML: false, category: '' }] } },
};
const ALICE = { email: 'alice@example.org', groups: ['team@example.org'] };

function setPolicy(raw: SettingsPolicy) {
  usePolicyStore.setState({ rawPolicy: raw, policy: resolvePolicy(raw, ALICE).policy, subject: ALICE });
}

function setTeam(mayWrite = true) {
  useAccountTemplatesStore.setState({
    personal: {},
    teams: { a1: [{ accountId: 'g1', name: 'team@example.org', templates: [tpl('t1', 'Team reply')], mayWrite }] },
    active: 'a1',
  });
}

const original = useAuthStore.getState();

beforeEach(() => {
  save.mockClear();
  save.mockResolvedValue('ok');
  resetAccountSubjects();
  useAuthStore.setState({ activeAccountId: 'a1' } as never);
  setPolicy(RAW);
  useTemplateStore.setState({ templates: [tpl('mine', 'Mine')], recentTemplateIds: [], deletedTemplateIds: {} });
  setTeam();
});
afterEach(() => {
  resetAccountSubjects();
  useAuthStore.setState({ activeAccountId: original.activeAccountId } as never);
});

describe('team templates in the picker', () => {
  it('heads them with the group\'s name between the user\'s own and the organisation\'s', () => {
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={() => {}} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).slice(1);
    expect(headings).toEqual(['section_personal', 'team@example.org', 'section_organisation']);
    expect(within(screen.getByTestId('template-source-team')).getByText('Team reply')).toBeInTheDocument();
  });

  it('shows a team template the admin locked, which members still use', () => {
    setPolicy({ ...RAW, restrictions: { teamTemplates: { locked: true } } });
    const onSelect = vi.fn();
    render(<TemplatePicker isOpen onClose={() => {}} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Team reply'));
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 't1', body: 'Team reply body' });
  });
});

describe('team templates in the manager', () => {
  it('adds a template to the group mailbox', async () => {
    render(<TemplateManagerModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('template-source-tab-team'));
    expect(screen.getByTestId('template-source-note')).toHaveTextContent('team_note');
    fireEvent.click(screen.getByRole('button', { name: 'add' }));
    // A team template has no sending identity and no favourite.
    expect(screen.queryByText('favorite')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('name_placeholder'), { target: { value: 'For the team' } });
    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toBe('a1');
    expect(save.mock.calls[0][1]).toBe('g1');
    expect(save.mock.calls[0][2]).toMatchObject({ name: 'For the team' });
  });

  it('keeps what the user typed when the server refuses it', async () => {
    save.mockResolvedValue('too-large');
    render(<TemplateManagerModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('template-source-tab-team'));
    fireEvent.click(screen.getByRole('button', { name: 'add' }));
    fireEvent.change(screen.getByPlaceholderText('name_placeholder'), { target: { value: 'Too long' } });
    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    expect(await screen.findByTestId('template-save-error')).toHaveTextContent('save_failed_too_large');
    expect((screen.getByPlaceholderText('name_placeholder') as HTMLInputElement).value).toBe('Too long');
  });

  it('is read-only with "Set by your organisation" when the admin locked team templates', () => {
    setPolicy({ ...RAW, restrictions: { teamTemplates: { locked: true } } });
    render(<TemplateManagerModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('template-source-tab-team'));
    expect(screen.getByTestId('template-source-note').querySelector('[data-org-locked]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'add' })).toBeNull();
    const row = screen.getByTestId('template-row');
    expect(within(row).queryByRole('button', { name: 'edit' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'delete' })).toBeNull();
    expect(within(row).getByRole('button', { name: 'copy_to_personal' })).toBeInTheDocument();
  });

  it('is read-only for a member without write rights, and says so', () => {
    setTeam(false);
    render(<TemplateManagerModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('template-source-tab-team'));
    expect(screen.getByTestId('template-source-note')).toHaveTextContent('team_read_only');
    expect(screen.queryByRole('button', { name: 'add' })).toBeNull();
  });

  it('says that someone else changed it, and keeps what the user typed', async () => {
    save.mockResolvedValue('conflict');
    render(<TemplateManagerModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('template-source-tab-team'));
    fireEvent.click(screen.getByRole('button', { name: 'edit' }));
    fireEvent.change(screen.getByPlaceholderText('name_placeholder'), { target: { value: 'My change' } });
    fireEvent.click(screen.getByRole('button', { name: 'update' }));
    expect(await screen.findByTestId('template-save-error')).toHaveTextContent('save_failed_conflict');
    expect((screen.getByPlaceholderText('name_placeholder') as HTMLInputElement).value).toBe('My change');
    // The edit started from the version the user saw.
    expect(save.mock.calls[0][3]).toBe('2026-01-01T00:00:00.000Z');
  });

  it('moves between the lists with the arrow keys, as a tab list', () => {
    render(<TemplateManagerModal isOpen onClose={() => {}} />);
    const personal = screen.getByTestId('template-source-tab-personal');
    expect(personal).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', personal.id);
    personal.focus();
    fireEvent.keyDown(personal, { key: 'ArrowRight' });
    const team = screen.getByTestId('template-source-tab-team');
    expect(team).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(team);
    expect(team).toHaveAttribute('tabindex', '0');
    expect(personal).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(team, { key: 'End' });
    expect(screen.getByTestId('template-source-tab-organisation')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(personal).toHaveAttribute('aria-selected', 'true');
  });
});
