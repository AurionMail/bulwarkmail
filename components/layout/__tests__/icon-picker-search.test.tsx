import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IconPicker } from '../icon-picker';

// A search covers every Tabler icon, not only the popular set: "mail" is not
// a popular name, and used to show "No icons found" until "All" was picked.

describe('IconPicker search', () => {
  it('finds icons outside the popular set without switching to all', async () => {
    render(<IconPicker value="" onChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('search_icons'), { target: { value: 'mail' } });
    expect(await screen.findByTitle('mail', {}, { timeout: 10000 })).toBeTruthy();
    expect(screen.queryByText('no_icons_found')).toBeNull();
  }, 20000);
});
