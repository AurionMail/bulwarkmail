import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '../button';

describe('Button', () => {
  it('renders with children text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('handles click events', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByText('Click'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('applies disabled state', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByText('Disabled')).toBeDisabled();
  });

  it('renders different variants without errors', () => {
    const { rerender } = render(<Button variant="default">Default</Button>);
    expect(screen.getByText('Default')).toBeInTheDocument();

    rerender(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByText('Ghost')).toBeInTheDocument();

    rerender(<Button variant="outline">Outline</Button>);
    expect(screen.getByText('Outline')).toBeInTheDocument();

    rerender(<Button variant="destructive">Destructive</Button>);
    expect(screen.getByText('Destructive')).toBeInTheDocument();
  });

  it('draws the dense sizes from R1', () => {
    const { rerender } = render(<Button size="xs">Dense</Button>);
    expect(screen.getByText('Dense')).toHaveClass('h-8', 'px-2.5', 'text-sm');
    rerender(<Button size="icon-sm" aria-label="Small" />);
    expect(screen.getByLabelText('Small')).toHaveClass('h-8', 'w-8');
    rerender(<Button size="icon-lg" aria-label="Large" />);
    expect(screen.getByLabelText('Large')).toHaveClass('h-11', 'w-11');
  });

  it('keeps the drawn size and adds a 44px hit area on coarse pointers only', () => {
    render(<Button size="icon-sm" aria-label="Hit" />);
    const button = screen.getByLabelText('Hit');
    expect(button).toHaveClass('relative', 'pointer-coarse:after:min-h-11', 'pointer-coarse:after:min-w-11');
    expect(button.className).not.toMatch(/(^|\s)after:/);
  });

  it('lets a positioned className replace relative', () => {
    render(<Button className="absolute bottom-4" aria-label="Fab" />);
    const button = screen.getByLabelText('Fab');
    expect(button).toHaveClass('absolute');
    expect(button).not.toHaveClass('relative');
  });
});
