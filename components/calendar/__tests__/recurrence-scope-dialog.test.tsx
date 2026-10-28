import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RecurrenceScopeDialog } from '../recurrence-scope-dialog';

// The delete scope dialog asked "Which events would you like to modify?":
// no word of what is lost (R3), and a title without a question mark.

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${Object.values(values).join(',')})` : key,
}));

describe('RecurrenceScopeDialog', () => {
  it('asks to delete with a question and says what goes for the chosen scope', () => {
    render(
      <RecurrenceScopeDialog isOpen actionType="delete" eventTitle="Yoga" note="cancel_notification" onSelect={vi.fn()} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'delete_question' });
    expect(dialog).toHaveAccessibleDescription('delete_this_message(Yoga)');
    fireEvent.click(screen.getByLabelText('all_events'));
    expect(dialog).toHaveAccessibleDescription('delete_all_message(Yoga)');
    fireEvent.click(screen.getByLabelText('this_and_future'));
    expect(dialog).toHaveAccessibleDescription('delete_following_message(Yoga)');
    // The cancellation note for an organizer's event with participants
    expect(screen.getByText('cancel_notification')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'delete' }).className).toMatch(/destructive/);
  });

  it('keeps the edit wording for an edit', () => {
    render(<RecurrenceScopeDialog isOpen actionType="edit" eventTitle="Yoga" onSelect={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'edit_title' });
    expect(dialog).toHaveAccessibleDescription('description');
    expect(screen.getByRole('button', { name: 'save' })).toBeInTheDocument();
  });
});
