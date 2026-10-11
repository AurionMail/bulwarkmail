import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';
import type { FilterRule } from '@/lib/jmap/sieve-types';
import { generateScript } from '@/lib/sieve/generator';
import { mockSieveAccount } from '@/lib/filters/__tests__/sieve-mock';
import { FolderRulesSubMenu } from '../rules-menu';
import { ContextMenu } from '@/components/ui/context-menu';
import { useAuthStore } from '@/stores/auth-store';
import { useEmailStore } from '@/stores/email-store';
import { useToastStore } from '@/stores/toast-store';

const mailboxes = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, myRights: { mayAddItems: true } },
  { id: 'archive', name: 'Old stuff', role: null, parentId: null, myRights: { mayAddItems: true } },
  { id: 'news', name: 'News', role: null, parentId: null, myRights: { mayAddItems: true } },
] as unknown as Mailbox[];

function rule(id: string, overrides: Partial<FilterRule> = {}): FilterRule {
  return {
    id,
    name: `Rule ${id}`,
    enabled: true,
    matchType: 'all',
    conditions: [{ field: 'from', comparator: 'address_is', value: 'anna@acme.com' }],
    actions: [{ type: 'move', value: 'News', mailboxId: 'news' }],
    stopProcessing: true,
    ...overrides,
  };
}

function setup(rules: FilterRule[], supportsSieve = true) {
  const account = mockSieveAccount('a', [{ name: 'filters', content: generateScript(rules), isActive: true }]);
  Object.assign(account.client, { supportsSieve: () => supportsSieve });
  useAuthStore.setState({ client: account.client, activeAccountId: 'login-a' } as never);
  return account;
}

function renderMenu(mailbox: Mailbox) {
  return render(
    <ContextMenu isOpen position={{ x: 0, y: 0 }} onClose={() => {}}>
      <FolderRulesSubMenu mailbox={mailbox} onClose={() => {}} />
    </ContextMenu>,
  );
}

function openRules() {
  fireEvent.mouseEnter(screen.getByTestId('mailbox-rules').parentElement!);
}

describe('Rules entry of the folder menu', () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
    useEmailStore.setState({ mailboxes, viewingAccountId: null, accountMailboxes: {}, error: null });
  });

  it('runs a saved rule on the mail already in the folder', async () => {
    const account = setup([rule('r1')]);
    account.client.queryEmailFields.mockResolvedValue([
      { id: 'e1', mailboxIds: { archive: true }, keywords: {}, from: [{ email: 'anna@acme.com' }] },
      { id: 'e2', mailboxIds: { archive: true }, keywords: {}, from: [{ email: 'bob@acme.com' }] },
    ]);
    const batchMoveToMailbox = vi.fn(async () => {});
    useEmailStore.setState({ batchMoveToMailbox });

    renderMenu(mailboxes[1]);
    openRules();
    fireEvent.click(await screen.findByTestId('folder-rules:run:r1'));

    // The progress toast names the rule and the folder while it runs.
    expect(useToastStore.getState().toasts[0]).toMatchObject({ title: 'rules.running', progress: null });
    await vi.waitFor(() => expect(useToastStore.getState().toasts.at(-1)?.title).toBe('rule_applied'));
    expect(useToastStore.getState().toasts.some((t) => t.title === 'rules.running')).toBe(false);
    expect(account.client.queryEmailFields).toHaveBeenCalledWith(
      { operator: 'AND', conditions: [{ inMailbox: 'archive' }, { from: 'anna@acme.com' }] },
      ['mailboxIds', 'keywords', 'from'],
      'a',
    );
    expect(batchMoveToMailbox).toHaveBeenCalledWith(account.client, 'news', { emailIds: ['e1'], client: account.client, accountId: 'a' });
  });

  it('disables a rule that cannot run on existing mail', async () => {
    const account = setup([rule('dated', { activeFrom: '2026-01-01T00:00:00Z' }), rule('ok')]);
    renderMenu(mailboxes[1]);
    openRules();
    const dated = await screen.findByTestId('folder-rules:run:dated');
    expect(dated).toHaveProperty('disabled', true);
    expect(dated.textContent).toContain('rules.new_mail_only');
    fireEvent.click(dated);
    expect(account.client.queryEmailFields).not.toHaveBeenCalled();
    expect(screen.getByTestId('folder-rules:run:ok')).toHaveProperty('disabled', false);
  });

  it('says so when the account has no rules', async () => {
    setup([]);
    renderMenu(mailboxes[1]);
    openRules();
    expect(await screen.findByTestId('folder-rules:empty')).toBeTruthy();
  });

  it('is hidden for an account without Sieve and for a shared folder', () => {
    setup([rule('r1')], false);
    const { unmount } = renderMenu(mailboxes[1]);
    expect(screen.queryByTestId('mailbox-rules')).toBeNull();
    unmount();

    setup([rule('r1')]);
    renderMenu({ ...mailboxes[1], id: 'owner:archive', isShared: true } as Mailbox);
    expect(screen.queryByTestId('mailbox-rules')).toBeNull();
  });
});
