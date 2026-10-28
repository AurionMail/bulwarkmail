import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { useFocusTrap } from '../use-focus-trap';

function Dialog({ onEscape, note }: { onEscape: () => void; note?: string }) {
  const ref = useFocusTrap({ isActive: true, onEscape });
  return (
    <div ref={ref} role="dialog">
      <button type="button">close</button>
      <input aria-label="name" />
      {note && <p>{note}</p>}
    </div>
  );
}

function Page({ open, onEscape, note }: { open: boolean; onEscape: () => void; note?: string }) {
  return (
    <>
      <button type="button">opener</button>
      {open && <Dialog onEscape={onEscape} note={note} />}
    </>
  );
}

// Like the identity and template managers: a list that gives way to a form,
// taking the button that had the focus with it.
function Manager() {
  const [editing, setEditing] = useState(false);
  const ref = useFocusTrap({ isActive: true, onEscape: () => setEditing(false) });
  return (
    <div ref={ref} role="dialog">
      <button type="button">close</button>
      {editing
        ? <input aria-label="field" />
        : <button type="button" onClick={() => setEditing(true)}>edit</button>}
    </div>
  );
}

describe('useFocusTrap', () => {
  it('moves the focus in when it opens and back to the opener when it closes', () => {
    const { rerender } = render(<Page open={false} onEscape={() => {}} />);
    screen.getByText('opener').focus();
    rerender(<Page open onEscape={() => {}} />);
    expect(document.activeElement).toBe(screen.getByText('close'));
    rerender(<Page open={false} onEscape={() => {}} />);
    expect(document.activeElement).toBe(screen.getByText('opener'));
  });

  it('leaves the focus in the field while the page behind renders again', () => {
    // A background request renders the page again, and the dialog gets a
    // new onEscape: the field the user is typing in keeps the focus.
    const { rerender } = render(<Page open onEscape={() => {}} />);
    const field = screen.getByLabelText('name');
    field.focus();
    rerender(<Page open onEscape={() => {}} />);
    rerender(<Page open onEscape={() => {}} />);
    expect(document.activeElement).toBe(field);
  });

  it('answers Escape with the onEscape of the latest render', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<Page open onEscape={first} />);
    rerender(<Page open onEscape={latest} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('keeps the focus in the dialog when a view change removes the element that had it', async () => {
    render(<Manager />);
    const edit = screen.getByText('edit');
    edit.focus();
    fireEvent.click(edit);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('close')));
  });

  it('leaves a focus the user moved away alone when the dialog changes', async () => {
    const { rerender } = render(<Page open onEscape={() => {}} />);
    const field = screen.getByLabelText('name');
    field.focus();
    field.blur();
    rerender(<Page open onEscape={() => {}} note="saved" />);
    await screen.findByText('saved');
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
  });

  it('closes on Escape after a click on text inside the dialog', () => {
    const onEscape = vi.fn();
    render(<Page open onEscape={onEscape} note="Heading" />);
    const dialog = screen.getByRole('dialog');
    // A click on non-focusable content focuses its nearest focusable
    // ancestor; the dialog has to be one, or the focus drops to <body>.
    expect(dialog).toHaveAttribute('tabindex', '-1');
    dialog.focus();
    fireEvent.keyDown(screen.getByText('Heading'), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape after a click on the backdrop moved the focus to the page', () => {
    const onEscape = vi.fn();
    render(<Page open onEscape={onEscape} />);
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('lets only the dialog opened last answer Escape', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function Nested() {
      const outerRef = useFocusTrap({ isActive: true, onEscape: outer });
      const innerRef = useFocusTrap({ isActive: true, onEscape: inner });
      return (
        <div ref={outerRef}>
          <button type="button">outer</button>
          <div ref={innerRef}><button type="button">inner</button></div>
        </div>
      );
    }
    render(<Nested />);
    fireEvent.keyDown(screen.getByText('inner'), { key: 'Escape' });
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(2);
    expect(outer).not.toHaveBeenCalled();
  });

  it('removes the tabindex it added when the dialog closes', () => {
    function Panel({ active }: { active: boolean }) {
      const ref = useFocusTrap({ isActive: active });
      return <div ref={ref} data-testid="panel"><button type="button">x</button></div>;
    }
    const { rerender } = render(<Panel active />);
    expect(screen.getByTestId('panel')).toHaveAttribute('tabindex', '-1');
    rerender(<Panel active={false} />);
    expect(screen.getByTestId('panel')).not.toHaveAttribute('tabindex');
  });
});

describe('useFocusTrap and the page behind', () => {
  it('keeps an Escape that closed the dialog from the page', () => {
    const page = vi.fn();
    document.addEventListener('keydown', page);
    try {
      const onEscape = vi.fn();
      render(<Page open onEscape={onEscape} />);
      fireEvent.keyDown(screen.getByLabelText('name'), { key: 'Escape' });
      expect(onEscape).toHaveBeenCalledTimes(1);
      expect(page).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', page);
    }
  });
});
