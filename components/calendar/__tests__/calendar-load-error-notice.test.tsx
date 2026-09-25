import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CalendarLoadErrorNotice } from '../calendar-load-error-notice';

// A range that fails to load keeps the events it had; the notice says so and
// offers to load the range again.

describe('CalendarLoadErrorNotice', () => {
  it('says the events may be out of date and retries on request', () => {
    const onRetry = vi.fn();
    render(<CalendarLoadErrorNotice onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('events_load_failed');
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says the task list may be out of date for a failed task load', () => {
    render(<CalendarLoadErrorNotice what="tasks" onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('tasks_load_failed');
  });
});
