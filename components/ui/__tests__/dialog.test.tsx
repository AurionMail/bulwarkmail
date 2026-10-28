import { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '../dialog';
import { ConfirmDialog } from '../confirm-dialog';
import { PromptDialog, nameSelectionRange } from '../prompt-dialog';

afterEach(() => vi.useRealTimers());

function backdropOf(panel: HTMLElement) {
  return panel.parentElement as HTMLElement;
}

describe('Dialog', () => {
  it('renders in a portal on body, labelled by its title and described by its description', () => {
    const { container } = render(
      <div data-testid="host">
        <Dialog isOpen onClose={() => {}} title="Rename" description="Pick a name" />
      </div>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Rename' });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.closest('body > div.fixed')).not.toBeNull();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Pick a name');
    expect(screen.getByRole('heading', { level: 2, name: 'Rename' })).toHaveClass('text-lg', 'font-semibold');
    expect(backdropOf(dialog)).toHaveClass('z-[60]', 'bg-black/50');
  });

  it('has a named close button at the top end that closes it', () => {
    const onClose = vi.fn();
    render(<Dialog isOpen onClose={onClose} title="T" />);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the first field, or the initialFocus target, and restores the focus on close', () => {
    function Host() {
      const [open, setOpen] = useState(false);
      const target = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>opener</button>
          <Dialog isOpen={open} onClose={() => setOpen(false)} title="T">
            <button type="button">first button</button>
            <input aria-label="field" />
          </Dialog>
          <Dialog isOpen={false} onClose={() => {}} title="unused" initialFocus={target} />
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByText('opener');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText('field'));
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('skips fields out of the tab order, like the hidden input behind a drop zone', () => {
    render(
      <Dialog isOpen onClose={() => {}} title="T">
        <button type="button">drop zone</button>
        <input type="file" tabIndex={-1} className="hidden" aria-label="file" />
        <input aria-label="name" />
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('name'));
  });

  it('honours initialFocus', () => {
    function Host() {
      const target = useRef<HTMLButtonElement>(null);
      return (
        <Dialog isOpen onClose={() => {}} title="T" initialFocus={target}>
          <input aria-label="field" />
          <button ref={target} type="button">target</button>
        </Dialog>
      );
    }
    render(<Host />);
    expect(document.activeElement).toBe(screen.getByText('target'));
  });

  it('closes on an outside click, but not while dirty or on a press that started inside', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog isOpen onClose={onClose} title="T"><input aria-label="f" /></Dialog>);
    const backdrop = backdropOf(screen.getByRole('dialog'));
    // A selection dragged out of the field, released on the backdrop.
    fireEvent.mouseDown(screen.getByLabelText('f'));
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Dialog isOpen onClose={onClose} title="T" dirty><input aria-label="f" /></Dialog>);
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape after the focus left for the page', () => {
    const onClose = vi.fn();
    render(<Dialog isOpen onClose={onClose} title="T"><p>text</p></Dialog>);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDialog on the Dialog shell', () => {
  it('keeps its alertdialog markup and has no close X', () => {
    render(
      <ConfirmDialog isOpen onClose={() => {}} onConfirm={() => {}} title="Delete file?" message="It is gone for good." variant="destructive" confirmText="Delete" />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete file?' });
    expect(dialog).toHaveAccessibleDescription('It is gone for good.');
    expect(dialog).toHaveClass('max-w-md', 'rounded-lg', 'shadow-xl');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['cancel', 'Delete']);
  });

  it('confirms and closes', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog isOpen onClose={onClose} onConfirm={onConfirm} title="T" message="M" />);
    fireEvent.click(screen.getByText('confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PromptDialog', () => {
  it('shows the validation message and blocks Enter while it fails', () => {
    const onSubmit = vi.fn();
    render(
      <PromptDialog
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit}
        title="New folder"
        validate={(v) => (v.includes('/') ? 'No slashes' : null)}
      />,
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'a/b' } });
    expect(screen.getByRole('alert')).toHaveTextContent('No slashes');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.submit(input.closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'ab' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.submit(input.closest('form')!);
    expect(onSubmit).toHaveBeenCalledWith('ab');
  });

  it('selects the base name of a file', () => {
    vi.useFakeTimers();
    render(<PromptDialog isOpen onClose={() => {}} onSubmit={() => {}} title="Rename" defaultValue="report.final.pdf" selectBaseName />);
    act(() => { vi.advanceTimersByTime(60); });
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'report.final'.length]);
  });

  it('works out the base name range', () => {
    expect(nameSelectionRange('a.txt', true)).toEqual([0, 1]);
    expect(nameSelectionRange('.bashrc', true)).toEqual([0, 7]);
    expect(nameSelectionRange('notes', true)).toEqual([0, 5]);
    expect(nameSelectionRange('a.txt', false)).toEqual([0, 5]);
  });
});
