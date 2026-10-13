import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';

import { pastedImageFiles } from '../paste-images';

// Trimmed from what Excel 365 on Windows puts on the clipboard for A1:B2.
const EXCEL_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta name=ProgId content=Excel.Sheet><meta name=Generator content="Microsoft Excel 15">
<style>.xl65 {font-weight:700;}</style></head>
<body link="#0563C1" vlink="#954F72">
<table border=0 cellpadding=0 cellspacing=0 width=128 style='border-collapse:collapse;width:96pt'>
<col width=64 span=2 style='width:48pt'>
<tr height=20 style='height:15.0pt'>
<!--StartFragment-->
  <td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Name</td>
  <td class=xl65 width=64 style='width:48pt'>Qty</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 style='height:15.0pt'>Apples</td>
  <td align=right>3</td>
<!--EndFragment-->
 </tr>
</table>
</body>
</html>`;

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });

function clipboard(files: File[], data: Record<string, string>): DataTransfer {
  return {
    files: files as unknown as FileList,
    getData: (type: string) => data[type] ?? '',
  } as DataTransfer;
}

describe('pastedImageFiles', () => {
  it('leaves an Excel range to the HTML paste even though a picture comes with it', () => {
    const data = clipboard([png()], { 'text/html': EXCEL_HTML, 'text/plain': 'Name\tQty\r\nApples\t3\r\n' });
    expect(pastedImageFiles(data)).toEqual([]);
  });

  it('leaves any HTML table to the HTML paste', () => {
    const data = clipboard([png()], { 'text/html': '<table><tr><td>a</td></tr></table>' });
    expect(pastedImageFiles(data)).toEqual([]);
  });

  it('leaves a Word selection to the HTML paste', () => {
    const html = '<html><head><meta name=ProgId content=Word.Document></head><body><p>Hi</p></body></html>';
    expect(pastedImageFiles(clipboard([png()], { 'text/html': html }))).toEqual([]);
  });

  it('uploads a screenshot that comes without HTML', () => {
    const file = png();
    expect(pastedImageFiles(clipboard([file], {}))).toEqual([file]);
  });

  it('uploads an image copied from a web page', () => {
    const file = png();
    const data = clipboard([file], { 'text/html': '<meta charset="utf-8"><img src="https://example.com/a.png">' });
    expect(pastedImageFiles(data)).toEqual([file]);
  });

  it('ignores files that are not images', () => {
    const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    expect(pastedImageFiles(clipboard([pdf], {}))).toEqual([]);
  });
});

describe('pasting an Excel range into the composer', () => {
  it('arrives as a table with the cell values', () => {
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Table, TableRow, TableHeader, TableCell],
      content: '<p></p>',
    });
    editor.view.pasteHTML(EXCEL_HTML, new Event('paste') as ClipboardEvent);
    const table = editor.view.dom.querySelector('table');
    expect(table).not.toBeNull();
    const cells = Array.from(table!.querySelectorAll('td, th')).map((c) => c.textContent);
    expect(cells).toEqual(['Name', 'Qty', 'Apples', '3']);
    editor.destroy();
  });
});
