import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { FilePreviewModal, htmlAttachmentDocument } from '../file-preview-modal';

// An HTML attachment was previewed from a text/html blob: URL of the sender's
// bytes. That URL is a document of the webmail origin: a link in the
// sandboxed frame resolved to it, and dragged or copied into a new tab it
// ran the sender's script as the webmail (GHSA-xvjh-v9c6-qcvc, again).
// Nothing sanitised it either, so remote images loaded regardless of the
// remote-content setting and a meta refresh swapped the preview for any page.

const HTML = [
  '<html><head><meta http-equiv="refresh" content="0;url=https://evil.example/"></head>',
  '<body><script>alert(document.domain)</script>',
  '<img src="https://evil.example/beacon.png" onerror="alert(1)">',
  '<a href="">self</a><p id="text">Invoice 4711</p></body></html>',
].join('');

let created: Blob[];

beforeEach(() => {
  created = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    created.push(blob as Blob);
    return 'blob:test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FilePreviewModal HTML attachments', () => {
  it('renders the sanitised markup in a locked srcdoc frame and mints no blob: URL', async () => {
    render(
      <FilePreviewModal
        name="invoice.html"
        onClose={() => {}}
        onDownload={() => {}}
        getFileContent={async () => ({ blob: new Blob([HTML], { type: 'text/html' }), contentType: 'text/html' })}
      />,
    );
    const frame = (await screen.findByTitle('invoice.html')) as HTMLIFrameElement;
    expect(created).toEqual([]);
    expect(frame.getAttribute('src')).toBeNull();
    expect(frame.getAttribute('sandbox')).toBe('');
    const doc = frame.getAttribute('srcdoc') ?? '';
    expect(doc).toContain('Invoice 4711');
    expect(doc).not.toContain('<script');
    expect(doc).not.toContain('onerror');
    expect(doc).not.toContain('http-equiv="refresh"');
    expect(doc).not.toMatch(/<img[^>]*\ssrc="https:\/\/evil\.example/);
    expect(doc).toContain('Content-Security-Policy');
  });

  it('builds the document the way the .eml preview does', () => {
    const doc = htmlAttachmentDocument('<p>hi</p><script>x()</script>', true);
    expect(doc.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(doc).toContain('<p>hi</p>');
    expect(doc).not.toContain('<script');
    expect(doc).toContain('name="referrer" content="no-referrer"');
  });
});
