import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from '../icon-button';
import { X } from '@/components/icons';

describe('IconButton', () => {
  it('is named and titled by its label', () => {
    render(<IconButton label="Close"><X /></IconButton>);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveAttribute('title', 'Close');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('defaults to ghost icon-sm and takes another size', () => {
    const { rerender } = render(<IconButton label="More"><X /></IconButton>);
    expect(screen.getByRole('button')).toHaveClass('h-8', 'w-8', 'hover:bg-accent');
    rerender(<IconButton label="More" size="icon-lg"><X /></IconButton>);
    expect(screen.getByRole('button')).toHaveClass('h-11', 'w-11');
  });

  it('forwards the ref and other props', () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(<IconButton ref={ref} label="Delete" onClick={onClick} data-testid="del" title=""><X /></IconButton>);
    expect(ref.current).toBe(screen.getByTestId('del'));
    expect(ref.current).not.toHaveAttribute('title', 'Delete');
    fireEvent.click(ref.current!);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
