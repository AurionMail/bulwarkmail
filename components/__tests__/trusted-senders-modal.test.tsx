import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings-store';
import { useToastStore } from '@/stores/toast-store';
import { TrustedSendersModal } from '../trusted-senders-modal';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  useSettingsStore.setState({ trustedSenders: [], trustedSendersAddressBook: false } as never);
});

describe('trusted senders', () => {
  it('offers an address field when the list is empty', () => {
    render(<TrustedSendersModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'add_manually' }));
    const field = screen.getByRole('textbox', { name: 'add_placeholder' });
    fireEvent.change(field, { target: { value: 'News@Example.org' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(useSettingsStore.getState().trustedSenders).toEqual(['news@example.org']);
  });

  it('closes on the first Escape after "Add sender manually"', () => {
    const onClose = vi.fn();
    render(<TrustedSendersModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'add_manually' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('takes a sender off without asking, and Undo puts it back', () => {
    useSettingsStore.setState({ trustedSenders: ['a@example.org', 'b@example.org'] } as never);
    render(<TrustedSendersModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'remove a@example.org' }));
    expect(useSettingsStore.getState().trustedSenders).toEqual(['b@example.org']);
    const removed = useToastStore.getState().toasts.find(t => t.title === 'removed');
    expect(removed?.action?.label).toBe('undo');
    removed!.action!.onClick();
    return vi.waitFor(() => expect(useSettingsStore.getState().trustedSenders).toContain('a@example.org'));
  });
});
