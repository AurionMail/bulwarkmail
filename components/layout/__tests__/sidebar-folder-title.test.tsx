import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';

// R11: text cut with an ellipsis gets a title with the full text. A folder
// name the sidebar had no shorter form for was cut by CSS with no title
// ("Gemeinsamer Postein…").

vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
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
const { useAuthStore } = await import('@/stores/auth-store');
const { useSettingsStore } = await import('@/stores/settings-store');

const box = (id: string, name: string) => ({
  id, name, role: null, parentId: null, totalEmails: 0, unreadEmails: 0, myRights: {},
}) as unknown as Mailbox;
const mailboxes: Mailbox[] = [box('a', 'A very long folder name that does not fit'), box('b', 'Short')];

function label(name: string): HTMLElement {
  return screen.getByText(name);
}
function setWidths(el: HTMLElement, scroll: number, client: number) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scroll });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: client });
}

describe('cut folder names', () => {
  beforeEach(() => {
    useAuthStore.setState({ activeAccountId: 'login-a', client: { getAccountId: () => 'me', getCapabilities: () => ({}) } } as never);
    useSettingsStore.setState({ hideAccountSwitcher: true } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('show the full name as a title when the ellipsis cuts them', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="b" />);
    const long = label('A very long folder name that does not fit');
    setWidths(long, 300, 120);
    fireEvent.pointerEnter(long);
    expect(long.title).toBe('A very long folder name that does not fit');
  });

  it('get no title when they fit', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="b" />);
    const short = label('Short');
    setWidths(short, 40, 120);
    fireEvent.pointerEnter(short);
    expect(short.title).toBe('');
  });
});
