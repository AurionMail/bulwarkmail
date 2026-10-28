import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolbarButton, ToolbarSearch, ToolbarSearchAction } from '../toolbar';

const classes = (el: Element) => el.className.split(/\s+/);

describe('ToolbarButton', () => {
  it('is muted until active, then takes the one active tint', () => {
    const { rerender } = render(<ToolbarButton label="filters"><svg /></ToolbarButton>);
    const button = screen.getByRole('button', { name: 'filters' });
    expect(classes(button)).toContain('text-muted-foreground');
    expect(classes(button)).not.toContain('bg-primary/10');

    rerender(<ToolbarButton label="filters" active><svg /></ToolbarButton>);
    expect(classes(button)).toContain('bg-primary/10');
    expect(classes(button)).toContain('text-primary');
    expect(classes(button)).not.toContain('text-muted-foreground');
  });

  it('is a 32px icon button', () => {
    render(<ToolbarButton label="print"><svg /></ToolbarButton>);
    const button = screen.getByRole('button', { name: 'print' });
    expect(classes(button)).toEqual(expect.arrayContaining(['h-8', 'w-8']));
  });
});

describe('ToolbarSearch', () => {
  it('is 32px high like the buttons beside it', () => {
    render(<ToolbarSearch value="" onChange={() => {}} aria-label="search" />);
    expect(classes(screen.getByRole('searchbox', { name: 'search' }))).toContain('h-8');
  });

  it('shows the shortcut key while empty and the clear button once there is text', () => {
    const onClear = vi.fn();
    const { container, rerender } = render(
      <ToolbarSearch value="" onChange={() => {}} onClear={onClear} clearLabel="clear" shortcut="/" aria-label="search" />,
    );
    expect(container.querySelector('kbd')?.textContent).toBe('/');
    expect(screen.getByRole('searchbox').getAttribute('aria-keyshortcuts')).toBe('/');
    expect(screen.queryByRole('button', { name: 'clear' })).toBeNull();

    rerender(<ToolbarSearch value="anna" onChange={() => {}} onClear={onClear} clearLabel="clear" shortcut="/" aria-label="search" />);
    expect(container.querySelector('kbd')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('keeps the clear button on an empty field when asked (a phone search row)', () => {
    render(<ToolbarSearch value="" onChange={() => {}} onClear={() => {}} clearLabel="close" alwaysShowClear aria-label="search" />);
    expect(screen.getByRole('button', { name: 'close' })).toBeTruthy();
  });

  it('keeps typed text clear of the end controls', () => {
    const { rerender } = render(<ToolbarSearch value="" onChange={() => {}} aria-label="search" />);
    const input = screen.getByRole('searchbox');
    expect(classes(input)).toContain('pe-3');

    rerender(<ToolbarSearch value="x" onChange={() => {}} onClear={() => {}} clearLabel="clear" aria-label="search" />);
    expect(classes(input)).toContain('pe-8');

    rerender(
      <ToolbarSearch
        value="x"
        onChange={() => {}}
        onClear={() => {}}
        clearLabel="clear"
        aria-label="search"
        trailing={<ToolbarSearchAction aria-label="filters" active />}
      />,
    );
    expect(classes(input)).toContain('pe-16');
    const filters = screen.getByRole('button', { name: 'filters' });
    expect(classes(filters)).toContain('bg-primary/10');
    // Clear and the trailing control share the end slot inside the field.
    expect(filters.parentElement).toBe(screen.getByRole('button', { name: 'clear' }).parentElement);
  });
});
