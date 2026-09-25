import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FilterRule } from '@/lib/jmap/sieve-types';
import { toast } from '@/stores/toast-store';
import { FilterRuleModal } from '../filter-rule-modal';

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

function headerRule(headerName: string): FilterRule {
  return {
    id: 'rule-1',
    name: 'Spam flag',
    enabled: true,
    matchType: 'all',
    conditions: [{ field: 'header', comparator: 'contains', value: 'yes', headerName }],
    actions: [{ type: 'discard' }],
    stopProcessing: false,
  };
}

// Stalwart's Sieve compiler (sieve-rs, on 0.16 and 1.0) refuses a header name
// outside [A-Za-z0-9_-], and with it the whole script, so every other rule
// would stop running too. The modal keeps such a rule from being saved.
describe('FilterRuleModal header names', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it.each(['X-Spam Flag', 'X-Foo.Bar', ''])('blocks saving the header name %j', (headerName) => {
    const onSave = vi.fn();
    render(<FilterRuleModal rule={headerRule(headerName)} mailboxes={[]} onSave={onSave} onClose={() => {}} />);

    fireEvent.click(screen.getByText('save'));

    expect(onSave).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('validation_header_name');
  });

  it('saves a valid header name, trimmed', () => {
    const onSave = vi.fn();
    render(<FilterRuleModal rule={headerRule(' X-Spam_Flag-2 ')} mailboxes={[]} onSave={onSave} onClose={() => {}} />);

    fireEvent.click(screen.getByText('save'));

    expect(toast.error).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].conditions).toEqual([
      { field: 'header', comparator: 'contains', value: 'yes', headerName: 'X-Spam_Flag-2' },
    ]);
  });

  it('blocks a name typed into the header field', () => {
    const onSave = vi.fn();
    render(<FilterRuleModal rule={headerRule('X-Ok')} mailboxes={[]} onSave={onSave} onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText('header_name'), { target: { value: 'X-Mailer: Foo' } });
    fireEvent.click(screen.getByText('save'));

    expect(onSave).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('validation_header_name');
  });
});
