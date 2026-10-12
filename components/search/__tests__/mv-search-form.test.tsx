import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SEARCH_FILTERS } from '@/lib/jmap/search-utils';
import { MvSearchForm } from '../mv-search-form';

describe('MvSearchForm', () => {
  it('edits the filters without searching, and searches on submit', () => {
    const onChange = vi.fn();
    const onSearch = vi.fn();
    render(<MvSearchForm filters={DEFAULT_SEARCH_FILTERS} onChange={onChange} onSearch={onSearch} onClear={() => {}} />);

    fireEvent.change(screen.getByLabelText('from'), { target: { value: 'alice' } });
    expect(onChange).toHaveBeenCalledWith({ from: 'alice' });
    fireEvent.click(screen.getByLabelText('has_attachment_check'));
    expect(onChange).toHaveBeenCalledWith({ hasAttachment: true });
    expect(onSearch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('unticking a criterion drops it rather than searching for its opposite', () => {
    const onChange = vi.fn();
    render(
      <MvSearchForm filters={{ ...DEFAULT_SEARCH_FILTERS, isUnread: true }} onChange={onChange} onSearch={() => {}} onClear={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText('unread'));
    expect(onChange).toHaveBeenCalledWith({ isUnread: null });
  });
});
