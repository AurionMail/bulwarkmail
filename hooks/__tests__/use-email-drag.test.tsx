import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DragEvent } from 'react';
import type { Email } from '@/lib/jmap/types';

// Every message row runs useEmailDrag. It must not re-render rows when the
// list changes, and a drag must still carry the selection as it is when the
// drag starts.

const startDrag = vi.fn();
vi.mock('@/contexts/drag-drop-context', () => ({
  useDragDropContext: () => ({ startDrag, endDrag: vi.fn(), isDragging: false, draggedEmails: [] }),
}));

const { useEmailDrag } = await import('../use-email-drag');
const { useEmailStore } = await import('@/stores/email-store');
const { emailKeyFor } = await import('@/lib/thread-utils');

const mail = (id: string) => ({
  id, threadId: `t-${id}`, mailboxIds: { inbox: true }, keywords: {}, subject: id,
  receivedAt: '2026-10-01T00:00:00Z', size: 1, hasAttachment: false,
}) as unknown as Email;

describe('useEmailDrag', () => {
  it('does not re-render its row when the list changes, and drags the selection current at drag start', () => {
    const a = mail('a');
    const b = mail('b');
    useEmailStore.setState({ emails: [a, b], selectedEmailKeys: new Set() });
    let renders = 0;
    let handlers!: ReturnType<typeof useEmailDrag>['dragHandlers'];
    function Row() {
      renders++;
      handlers = useEmailDrag({ email: a, sourceMailboxId: 'inbox' }).dragHandlers;
      return null;
    }
    render(<Row />);
    const mounted = renders;

    act(() => { useEmailStore.setState({ emails: [a, b, mail('c')] }); });
    act(() => { useEmailStore.setState({ selectedEmailKeys: new Set([emailKeyFor(a), emailKeyFor(b)]) }); });
    expect(renders).toBe(mounted);

    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' };
    act(() => { handlers.onDragStart?.({ dataTransfer } as unknown as DragEvent<HTMLDivElement>); });
    expect(startDrag).toHaveBeenCalledWith([a, b], 'inbox');
  });
});
