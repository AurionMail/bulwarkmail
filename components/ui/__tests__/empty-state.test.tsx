import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from '../empty-state';
import { PaneSpinner, Spinner } from '../spinner';
import { Button } from '../button';
import { Inbox } from '@/components/icons';

describe('EmptyState', () => {
  it('shows the icon in a muted circle, the title, the line and the actions', () => {
    const { container } = render(
      <EmptyState
        icon={Inbox}
        title="No messages"
        description="New mail shows up here."
        actions={<><Button size="sm">Compose</Button><Button size="sm" variant="outline">Clear search</Button></>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No messages' })).toBeInTheDocument();
    expect(screen.getByText('New mail shows up here.')).toHaveClass('text-muted-foreground');
    expect(container.querySelector('.rounded-full.bg-muted svg')).not.toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Compose', 'Clear search']);
  });

  it('renders without icon, line or actions', () => {
    render(<EmptyState title="Nothing here" compact />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Spinner', () => {
  it('has two sizes and is silent unless labelled', () => {
    const { container, rerender } = render(<Spinner size="sm" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveClass('w-4', 'h-4', 'animate-spin');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    rerender(<Spinner label="Loading" />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveClass('w-6', 'h-6');
  });

  it('centres one md spinner in a pane', () => {
    const { container } = render(<PaneSpinner />);
    expect(container.firstElementChild).toHaveClass('flex', 'items-center', 'justify-center');
    expect(container.querySelector('svg')).toHaveClass('w-6');
  });
});
