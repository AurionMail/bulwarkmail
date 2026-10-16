import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { expandImportableEmails, readMessageDate, EML_IMPORT_ACCEPT } from '@/lib/eml-import';

const emlFile = (name: string, content = 'raw email', type = 'message/rfc822') =>
  new File([content], name, { type });

describe('expandImportableEmails', () => {
  it('wraps a .eml file as a message/rfc822 blob, keeping its name', async () => {
    const out = await expandImportableEmails([emlFile('msg.eml')]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('msg.eml');
    expect(out[0].blob.type).toBe('message/rfc822');
    await expect(out[0].blob.text()).resolves.toBe('raw email');
  });

  it('CHARACTERISATION: wraps a non-.eml, non-zip file as rfc822 too', async () => {
    const out = await expandImportableEmails([emlFile('note.txt', 'hi', 'text/plain')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'note.txt' });
    expect(out[0].blob.type).toBe('message/rfc822');
  });

  it('extracts only .eml entries from a .zip, stripping path prefixes', async () => {
    const zip = new JSZip();
    zip.file('a.eml', 'A');
    zip.file('sub/b.eml', 'B');
    zip.file('c.txt', 'C'); // skipped (not .eml)
    zip.folder('emptydir'); // skipped (directory)
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'archive.zip', { type: 'application/zip' });

    const out = await expandImportableEmails([file]);
    expect(out.map((e) => e.name).sort()).toEqual(['a.eml', 'b.eml']);
    expect(out.every((e) => e.blob.type === 'message/rfc822')).toBe(true);
  });

  it('uses the zip path when the MIME type is application/zip even without a .zip name', async () => {
    const zip = new JSZip();
    zip.file('only.eml', 'X');
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'archive-no-ext', { type: 'application/zip' });

    const out = await expandImportableEmails([file]);
    expect(out.map((e) => e.name)).toEqual(['only.eml']);
  });

  it('exposes the accept string for the file picker', () => {
    expect(EML_IMPORT_ACCEPT).toBe('.eml,.zip,message/rfc822,application/zip');
  });
});

describe('Date header as receivedAt (#891)', () => {
  const CRLF = String.fromCharCode(13, 10);
  const raw = [
    'From: Alice <alice@example.com>',
    'Subject: old mail',
    'Date: Tue, 5 Mar 2019 09:30:00',
    ' +0100 (CET)',
    '',
    'Date: Wed, 1 Jan 2025 00:00:00 +0000',
    'body',
  ].join(CRLF);

  it('carries the Date header of an .eml file as a JMAP UTCDate', async () => {
    const out = await expandImportableEmails([emlFile('old.eml', raw)]);
    expect(out[0].receivedAt).toBe('2019-03-05T08:30:00Z');
  });

  it('carries the Date header of each .eml inside a .zip', async () => {
    const zip = new JSZip();
    zip.file('old.eml', raw);
    const blob = await zip.generateAsync({ type: 'blob' });
    const out = await expandImportableEmails([new File([blob], 'a.zip', { type: 'application/zip' })]);
    expect(out[0].receivedAt).toBe('2019-03-05T08:30:00Z');
  });

  it('leaves receivedAt unset when there is no usable Date header', async () => {
    const bodyOnly = ['Subject: x', '', 'Date: Tue, 5 Mar 2019 09:30:00 +0100'].join(CRLF);
    await expect(readMessageDate(new Blob([bodyOnly]))).resolves.toBeUndefined();
    const garbage = ['Date: not a date', '', 'body'].join(CRLF);
    await expect(readMessageDate(new Blob([garbage]))).resolves.toBeUndefined();
  });

  it('ignores a Date header far in the future', async () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const future = ['Date: Fri, 1 Jan 2027 00:00:00 +0000', '', 'body'].join(CRLF);
    await expect(readMessageDate(new Blob([future]), now)).resolves.toBeUndefined();
  });
});
