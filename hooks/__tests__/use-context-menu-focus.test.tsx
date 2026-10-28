import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { useContextMenu } from '@/hooks/use-context-menu';

// A list row whose menu handler sits on the row, while the keyboard focus
// is on a control inside it (a folder's button, a message's checkbox).
function Row() {
  const { contextMenu, openContextMenu, closeContextMenu, menuRef } = useContextMenu<string>();
  return (
    <>
      <div data-testid="row" onContextMenu={(e) => openContextMenu(e, 'row')}>
        <button type="button">Inbox</button>
      </div>
      <ContextMenu ref={menuRef} isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={closeContextMenu}>
        <ContextMenuItem label="Rename" onClick={closeContextMenu} />
      </ContextMenu>
    </>
  );
}

async function openFromKeyboard() {
  render(<Row />);
  const control = screen.getByText('Inbox');
  control.focus();
  // Shift+F10 fires contextmenu at 0,0 on the focused control; it bubbles to the row.
  fireEvent.contextMenu(control, { clientX: 0, clientY: 0 });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Rename').closest('button')));
  return control;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useContextMenu focus return', () => {
  it('gives the focus back to the focused control inside the row on Escape', async () => {
    const control = await openFromKeyboard();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(control);
  });

  it('gives the focus back to the focused control inside the row on Tab', async () => {
    const control = await openFromKeyboard();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(control);
  });

  it('still anchors the menu to the row', async () => {
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') === 'menu') return rect(0, 0, 200, 120);
      if (this.dataset.testid === 'row') return rect(500, 400, 300, 40);
      return rect(0, 0, 0, 0);
    });
    render(<Row />);
    screen.getByText('Inbox').focus();
    fireEvent.contextMenu(screen.getByText('Inbox'), { clientX: 0, clientY: 0 });
    await waitFor(() => expect(screen.getByRole('menu').style.visibility).toBe('visible'));
    expect(screen.getByRole('menu').style.left).toBe('500px');
    expect(screen.getByRole('menu').style.top).toBe('444px');
  });
});
