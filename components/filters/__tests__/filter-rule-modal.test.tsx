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
    expect(screen.getByRole('alert').textContent).toBe('validation_header_name');
  });

  it('saves a valid header name, trimmed', () => {
    const onSave = vi.fn();
    render(<FilterRuleModal rule={headerRule(' X-Spam_Flag-2 ')} mailboxes={[]} onSave={onSave} onClose={() => {}} />);

    fireEvent.click(screen.getByText('save'));

    expect(screen.queryByRole('alert')).toBeNull();
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
    expect(screen.getByRole('alert').textContent).toBe('validation_header_name');
  });
});

// A new rule starts with "Move to folder" and no folder. Saving it says so
// under the actions and marks the folder field, instead of a toast in a
// corner of the window.
describe('FilterRuleModal incomplete action', () => {
  const mailboxes = [
    { id: 'inbox', name: 'Inbox', role: 'inbox', sortOrder: 0 },
    { id: 'news', name: 'News', sortOrder: 1 },
  ] as never;

  it('points at the folder field when no folder was chosen', async () => {
    vi.mocked(toast.error).mockClear();
    const onSave = vi.fn();
    render(<FilterRuleModal mailboxes={mailboxes} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('rule_name_placeholder'), { target: { value: 'News' } });
    fireEvent.change(screen.getByPlaceholderText('value_placeholder_multi'), { target: { value: 'news@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('validation_empty_actions');
    const folder = screen.getByRole('combobox', { name: 'move_to_folder' });
    expect(folder.getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(folder, { target: { value: 'news' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    expect(onSave.mock.calls[0][0].actions).toEqual([{ type: 'move', mailboxId: 'news', value: 'News' }]);
  });

  it('starts a changed action without a folder too, like a new row', () => {
    render(<FilterRuleModal mailboxes={mailboxes} onSave={vi.fn()} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'actions' }), { target: { value: 'copy' } });
    expect((screen.getByRole('combobox', { name: 'move_to_folder' }) as HTMLSelectElement).value).toBe('');
  });
});
