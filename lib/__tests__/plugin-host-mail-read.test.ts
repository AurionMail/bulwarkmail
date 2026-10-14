import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';
import type { IJMAPClient } from '../jmap/client-interface';
import type { Email, Mailbox } from '../jmap/types';
import { useAuthStore } from '@/stores/auth-store';
import { useEmailStore } from '@/stores/email-store';

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { dispatchApiCall } from '../plugin-sandbox/host-api';

function plugin(perms: string[]): InstalledPlugin {
  return {
    id: 'reader', name: 'Reader', version: '1.0.0', author: 'test', description: '',
    type: 'hook', permissions: perms, grantedPermissions: perms, entrypoint: 'index.js',
    enabled: true, status: 'running', settings: {},
  };
}

const READER = plugin(['email:read']);
const call = (p: InstalledPlugin, method: string, ...args: unknown[]) => dispatchApiCall(p, method, args);

function mail(id: string, over: Partial<Email> = {}): Email {
  return {
    id, threadId: `t-${id}`, mailboxIds: { inbox: true }, keywords: { $seen: true },
    from: [{ name: 'Bob', email: 'bob@example.com' }], to: [{ email: 'ann@example.com' }],
    subject: `Subject ${id}`, receivedAt: '2026-05-01T10:00:00Z', preview: 'preview', size: 1234,
    hasAttachment: false,
    ...over,
  } as Email;
}

const inbox = { id: 'inbox', name: 'Inbox', role: 'inbox', totalEmails: 12, unreadEmails: 3, sortOrder: 0 } as Mailbox;
const shared = {
  id: 'acc2:box', originalId: 'box', name: 'Team', role: undefined, parentId: undefined,
  totalEmails: 1, unreadEmails: 0, isShared: true, accountId: 'acc2', sortOrder: 1,
} as unknown as Mailbox;

let client: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  client = {
    getEmail: vi.fn(async (id: string) => (id === 'm1'
      ? mail('m1', { textBody: [{ partId: '1' }], bodyValues: { 1: { value: 'Full body text' } } } as unknown as Partial<Email>)
      : null)),
    getEmails: vi.fn(async () => ({ emails: [mail('a'), mail('b')], hasMore: false, total: 2 })),
    getMailboxes: vi.fn(async () => [inbox]),
  };
  useAuthStore.setState({ client: client as unknown as IJMAPClient });
  useEmailStore.setState({ mailboxes: [inbox, shared], selectedEmail: null });
});

afterEach(() => {
  useAuthStore.setState({ client: null });
  useEmailStore.setState({ mailboxes: [], selectedEmail: null });
});

describe('api.email.get', () => {
  it('returns any message with its body, not only the open one', async () => {
    const view = await call(READER, 'email.get', 'm1') as { id: string; text: string; from: unknown };
    expect(view).toEqual(expect.objectContaining({
      id: 'm1', subject: 'Subject m1', text: 'Full body text', from: [{ name: 'Bob', email: 'bob@example.com' }],
    }));
    expect(client.getEmail).toHaveBeenCalledWith('m1');
    expect(await call(READER, 'email.get', 'gone')).toBeNull();
  });

  it('uses the open message when its body is loaded', async () => {
    useEmailStore.setState({ selectedEmail: mail('open', { bodyValues: { 1: { value: 'x' } }, textBody: [{ partId: '1' }] } as unknown as Partial<Email>) });
    expect(await call(READER, 'email.get', 'open')).toEqual(expect.objectContaining({ id: 'open', text: 'x' }));
    expect(client.getEmail).not.toHaveBeenCalled();
  });

  it('needs email:read and a string id', async () => {
    await expect(call(plugin([]), 'email.get', 'm1')).rejects.toThrow(/lacks permission "email:read"/);
    await expect(call(READER, 'email.get', { id: 'm1' })).rejects.toThrow(/emailId must be a string/);
    expect(client.getEmail).not.toHaveBeenCalled();
  });
});

describe('api.email.list', () => {
  it('returns summaries of a folder page', async () => {
    const list = await call(READER, 'email.list', { mailboxId: 'inbox', limit: 2, position: 10 }) as { id: string }[];
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
    expect(list[0]).not.toHaveProperty('text');
    expect(client.getEmails).toHaveBeenCalledWith('inbox', undefined, 2, 10);
  });

  it('asks the owning account for a shared folder', async () => {
    await call(READER, 'email.list', { mailboxId: 'acc2:box' });
    expect(client.getEmails).toHaveBeenCalledWith('box', 'acc2', 50, 0);
  });

  it('caps the page at 100 and refuses unknown folders', async () => {
    await expect(call(READER, 'email.list', { limit: 101 })).rejects.toThrow(/limit must be a whole number from 1 to 100/);
    await expect(call(READER, 'email.list', { mailboxId: 'nope' })).rejects.toThrow(/no mailbox with id "nope"/);
    await expect(call(READER, 'email.list', { mailbox: 'inbox' })).rejects.toThrow(/unknown property "mailbox"/);
    await expect(call(plugin([]), 'email.list')).rejects.toThrow(/lacks permission "email:read"/);
    expect(client.getEmails).not.toHaveBeenCalled();
  });
});

describe('api.mailboxes.list', () => {
  it('returns plain folder views', async () => {
    expect(await call(READER, 'mailboxes.list')).toEqual([
      { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, totalEmails: 12, unreadEmails: 3 },
      { id: 'acc2:box', name: 'Team', role: null, parentId: null, totalEmails: 1, unreadEmails: 0 },
    ]);
    await expect(call(plugin(['email:write']), 'mailboxes.list')).rejects.toThrow(/lacks permission "email:read"/);
  });

  it('asks the server when the app has not loaded folders yet', async () => {
    useEmailStore.setState({ mailboxes: [] });
    expect(await call(READER, 'mailboxes.list')).toHaveLength(1);
    expect(client.getMailboxes).toHaveBeenCalled();
  });
});
