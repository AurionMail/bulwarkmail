import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Email } from '@/lib/jmap/types';
import { MvConversationRun } from '../email-viewer';

const mail = (n: number): Email => ({
  id: `m${n}`,
  threadId: 't',
  mailboxIds: { inbox: true },
  keywords: { $seen: true },
  size: 1,
  receivedAt: `2024-01-0${n}T10:00:00Z`,
  from: [{ name: `Sender ${n}`, email: `s${n}@example.com` }],
  subject: 'Subject',
  preview: `Preview ${n}`,
  hasAttachment: false,
} as Email);

const cards = (c: HTMLElement) => [...c.querySelectorAll('[data-mv-conversation-card]')].map((e) => e.getAttribute('data-email-id'));

describe('MvConversationRun', () => {
  it('folds a long run to its first and last message around a count, and unfolds it', () => {
    const { container } = render(
      <MvConversationRun emails={[mail(1), mail(2), mail(3), mail(4), mail(5)]} timeFormat="24h" collapseLongRun />,
    );
    expect(cards(container)).toEqual(['m1', 'm5']);

    fireEvent.click(screen.getByText('3'));
    expect(cards(container)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('shows a short run whole, and opens the message clicked', () => {
    const onOpen = vi.fn();
    const { container } = render(<MvConversationRun emails={[mail(1), mail(2)]} timeFormat="24h" onOpen={onOpen} collapseLongRun />);
    expect(cards(container)).toEqual(['m1', 'm2']);

    fireEvent.click(screen.getByText('Sender 2'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2' }));
  });
});
