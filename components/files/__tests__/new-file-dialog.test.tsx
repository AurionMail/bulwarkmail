import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NewFileDialog, withExtension } from '@/components/files/new-file-dialog';

// #1393: with a document editor, "New file" offers its formats next to .txt.

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

afterEach(cleanup);

const nameField = () => screen.getByLabelText('file_name') as HTMLInputElement;
const checked = () => screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.textContent);

describe('NewFileDialog', () => {
  it('is the plain text-file prompt without an editor', () => {
    render(<NewFileDialog isOpen onClose={() => {}} onSubmit={() => {}} formats={[]} />);
    expect(screen.getByText('new_text_file')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(nameField().value).toBe('new-file.txt');
  });

  it('switches the extension with the format and the format with the extension', () => {
    const onSubmit = vi.fn();
    render(<NewFileDialog isOpen onClose={() => {}} onSubmit={onSubmit} formats={['docx', 'xlsx', 'pdf']} />);
    expect(screen.getByText('new_file')).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'format_text.txt', 'format_document.docx', 'format_spreadsheet.xlsx', 'format_pdf.pdf',
    ]);
    expect(checked()).toEqual(['format_text.txt']);

    fireEvent.change(nameField(), { target: { value: 'Budget 2027.txt' } });
    fireEvent.click(screen.getByText('format_spreadsheet'));
    expect(nameField().value).toBe('Budget 2027.xlsx');
    expect(checked()).toEqual(['format_spreadsheet.xlsx']);

    fireEvent.change(nameField(), { target: { value: 'Budget 2027.DOCX' } });
    expect(checked()).toEqual(['format_document.docx']);
    fireEvent.change(nameField(), { target: { value: 'Budget 2027.md' } });
    expect(checked()).toEqual([]);

    fireEvent.click(screen.getByText('create'));
    expect(onSubmit).toHaveBeenCalledWith('Budget 2027.md');
  });

  it('keeps the base name when changing the extension', () => {
    expect(withExtension('report.txt', 'docx')).toBe('report.docx');
    expect(withExtension('archive.tar.gz', 'odt')).toBe('archive.tar.odt');
    expect(withExtension('notes', 'pptx')).toBe('notes.pptx');
    expect(withExtension('.hidden', 'ods')).toBe('.hidden.ods');
    expect(withExtension('', 'pdf')).toBe('new-file.pdf');
  });
});
