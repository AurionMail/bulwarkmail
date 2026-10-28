import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AddressBookPickerDialog } from '../address-book-picker-dialog';
import type { AddressBook } from '@/lib/jmap/types';

// next-intl is mocked globally (t returns the key).
const books = [
  { id: 'b1', name: 'Personal' },
  { id: 'b2', name: 'Work' },
] as unknown as AddressBook[];

describe('AddressBookPickerDialog', () => {
  it('says the contacts are being moved, not added', () => {
    render(<AddressBookPickerDialog isOpen onClose={vi.fn()} addressBooks={books} currentId="b1" count={1} onPick={vi.fn()} />);
    expect(screen.getByText('bulk.moving_contacts')).toBeInTheDocument();
    expect(screen.queryByText('bulk.adding_contacts')).toBeNull();
  });
});
