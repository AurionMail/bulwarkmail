import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';
import type { InstalledPlugin } from '@/lib/plugin-types';

const createSlotInstance = vi.fn((..._args: unknown[]) => ({ destroy: vi.fn(), updateProps: vi.fn(), setTheme: vi.fn() }));
vi.mock('@/lib/plugin-sandbox/host-bridge', () => ({
  createSlotInstance: (...args: unknown[]) => createSlotInstance(...args),
}));
vi.mock('@/lib/plugin-sandbox/host-theme', () => ({ snapshotHostTheme: () => ({}) }));
vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ startTour: vi.fn(), resetTourCompletion: vi.fn(), activeTour: null, endTour: vi.fn(), registerStep: vi.fn() }),
}));
vi.mock('@/contexts/drag-drop-context', () => ({
  useDragDropContext: () => ({ isDragging: false }),
}));
vi.mock('@/hooks/use-mailbox-drop', () => ({
  useMailboxDrop: () => ({ dropHandlers: {}, isValidDropTarget: false, isInvalidDropTarget: false }),
}));
vi.mock('@/hooks/use-tag-drop', () => ({
  useTagDrop: () => ({ dropHandlers: {}, isValidDropTarget: false }),
}));
vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));

const { Sidebar } = await import('../sidebar');
const registry = await import('@/lib/plugin-sandbox/registry');
const { dispatchApiCall } = await import('@/lib/plugin-sandbox/host-api');
const { clearSectionTitle } = await import('@/lib/plugin-sandbox/section-titles');

const mailboxes: Mailbox[] = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, totalEmails: 0, unreadEmails: 0, myRights: { mayAddItems: true } },
] as unknown as Mailbox[];

function offer(id: string, name: string, slot: string) {
  const plugin: InstalledPlugin = {
    id, name, version: '1.0.0', author: '', description: '', type: 'ui-extension',
    permissions: ['ui:sidebar-widget'], grantedPermissions: ['ui:sidebar-widget'], entrypoint: 'index.js',
    enabled: true, status: 'running', settings: {},
  };
  registry.register({
    plugin,
    code: '',
    tier: 'untrusted',
    background: { evaluateShouldShow: vi.fn(async () => true) } as never,
    slotOffers: [{ name: slot as never, order: 100, hasShouldShow: false }],
    hookDisposables: [],
  });
}

beforeEach(() => {
  createSlotInstance.mockClear();
  localStorage.clear();
});

afterEach(() => {
  for (const p of registry.all()) registry.deregister(p.plugin.id);
  clearSectionTitle('cal');
});

describe('Sidebar plugin sections', () => {
  it('draws nothing when no plugin offers a section', () => {
    offer('w', 'Widget only', 'sidebar-widget');
    const { container } = render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    expect(container.querySelector('[data-plugin-slot="sidebar-section"]')).toBeNull();
    expect(screen.queryByText('Widget only')).toBeNull();
  });

  it('gives each plugin a section headed by its name, below the folders, with the open folder', async () => {
    offer('cal', 'Agenda', 'sidebar-section');
    const { container } = render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    const header = screen.getByRole('button', { name: 'Agenda' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    const section = container.querySelector('[data-plugin-slot="sidebar-section"]')!;
    // Below the folder list.
    const inbox = container.querySelector('[data-mailbox-id="inbox"]')!;
    expect(inbox.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await waitFor(() => expect(createSlotInstance).toHaveBeenCalled());
    const opts = createSlotInstance.mock.calls[0][0] as { slot: string; extraProps: Record<string, unknown>; plugin: { id: string } };
    expect(opts.slot).toBe('sidebar-section');
    expect(opts.plugin.id).toBe('cal');
    expect(opts.extraProps).toEqual({ mailboxId: 'inbox' });
  });

  it('folds a section and remembers it per plugin', async () => {
    offer('cal', 'Agenda', 'sidebar-section');
    const first = render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    await waitFor(() => expect(createSlotInstance).toHaveBeenCalledTimes(1));

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Agenda' })); });
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-expanded', 'false');
    first.unmount();

    createSlotInstance.mockClear();
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-expanded', 'false');
    await new Promise((r) => setTimeout(r, 20));
    expect(createSlotInstance).not.toHaveBeenCalled();
  });

  it('heads a section with the title the plugin set, and with its name again after null', async () => {
    offer('cal', 'Agenda', 'sidebar-section');
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    const plugin = registry.get('cal')!.plugin;

    await act(async () => { await dispatchApiCall(plugin, 'ui.setSectionTitle', ['Upcoming birthdays']); });
    expect(screen.getByRole('button', { name: 'Upcoming birthdays' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agenda' })).toBeNull();

    await expect(dispatchApiCall(plugin, 'ui.setSectionTitle', ['x'.repeat(41)])).rejects.toThrow(/at most 40/);
    await act(async () => { await dispatchApiCall(plugin, 'ui.setSectionTitle', [null]); });
    expect(screen.getByRole('button', { name: 'Agenda' })).toBeInTheDocument();

    const noPerm = { ...plugin, id: 'other', permissions: [], grantedPermissions: [] };
    await expect(dispatchApiCall(noPerm, 'ui.setSectionTitle', ['Mine'])).rejects.toThrow(/lacks permission "ui:sidebar-widget"/);
  });
});
