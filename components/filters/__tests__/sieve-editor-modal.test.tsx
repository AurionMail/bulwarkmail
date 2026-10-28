import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { FilterRule } from '@/lib/jmap/sieve-types';
import { generateScript } from '@/lib/sieve/generator';
import { SieveEditorModal } from '../sieve-editor-modal';

const visualRule: FilterRule = {
  id: 'r1',
  name: 'Receipts',
  enabled: true,
  matchType: 'all',
  conditions: [{ field: 'from', comparator: 'contains', value: 'shop@example.com' }],
  actions: [{ type: 'move', value: 'Receipts' }],
  stopProcessing: false,
};

const handWritten = 'require ["fileinto"];\nif header :contains "Subject" "x" {\n    fileinto "X";\n}\n';

function renderEditor(content: string, onSave = vi.fn()) {
  render(
    <SieveEditorModal content={content} onSave={onSave} onClose={() => {}} onValidate={async () => ({ isValid: true })} />,
  );
  return onSave;
}

// The Save button stays "Save": it never turns into "Save anyway" and never
// needs a second click. Only a save that would drop the visual builder's
// rules asks, once, in a confirm dialog.
describe('SieveEditorModal save', () => {
  it('saves at once when the visual rules are not lost', () => {
    const onSave = renderEditor(handWritten);
    fireEvent.change(screen.getByLabelText('script_content'), { target: { value: `${handWritten}# note\n` } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(`${handWritten}# note\n`);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks once before a script the builder cannot read replaces the visual rules', async () => {
    const onSave = renderEditor(generateScript([visualRule]));
    fireEvent.change(screen.getByLabelText('script_content'), { target: { value: handWritten } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('overwrite_title');
    expect(onSave).not.toHaveBeenCalled();
    // The editor's own button keeps its label.
    expect(screen.queryByText('confirm_save')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'save' }).at(-1)!);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(handWritten);
  });

  it('does not save when the user keeps editing', async () => {
    const onSave = renderEditor(generateScript([visualRule]));
    fireEvent.change(screen.getByLabelText('script_content'), { target: { value: handWritten } });

    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'keep_editing' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onSave).not.toHaveBeenCalled();
  });
});
