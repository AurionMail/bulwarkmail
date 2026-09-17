import { describe, expect, it } from 'vitest';

import { getFilePreviewKind, inertBlobType, isFilePreviewable, toInertBlob } from '../file-preview';

describe('file preview detection', () => {
  it('detects browser-renderable image attachments', () => {
    expect(getFilePreviewKind('photo.avif', 'image/avif')).toBe('image');
    expect(getFilePreviewKind('vector.svg')).toBe('image');
  });

  it('detects html attachments', () => {
    expect(getFilePreviewKind('message.html', 'text/html; charset=utf-8')).toBe('html');
    expect(getFilePreviewKind('index.htm')).toBe('html');
  });

  it('detects text and markdown attachments', () => {
    expect(getFilePreviewKind('notes.txt', 'text/plain')).toBe('text');
    expect(getFilePreviewKind('README.md', 'text/markdown')).toBe('markdown');
    expect(getFilePreviewKind('payload.json', 'application/json')).toBe('text');
  });

  it('detects pdf, audio, and video attachments', () => {
    expect(getFilePreviewKind('doc.pdf')).toBe('pdf');
    expect(getFilePreviewKind('audio.m4a')).toBe('audio');
    expect(getFilePreviewKind('movie.webm')).toBe('video');
  });

  it('rejects unsupported attachment types', () => {
    expect(getFilePreviewKind('archive.zip', 'application/zip')).toBe('unsupported');
    expect(isFilePreviewable('archive.zip', 'application/zip')).toBe(false);
  });
});

describe('inert blob typing for cid: parts (GHSA-xvjh-v9c6-qcvc)', () => {
  it('keeps inert media types so inline images and media still render', () => {
    expect(inertBlobType('image/png')).toBe('image/png');
    expect(inertBlobType('image/jpeg; name=a.jpg')).toBe('image/jpeg; name=a.jpg');
    expect(inertBlobType('video/mp4')).toBe('video/mp4');
    expect(inertBlobType('application/pdf')).toBe('application/pdf');
  });

  it('neutralises every sender-declared type that could execute as our origin', () => {
    for (const type of ['text/html', 'TEXT/HTML; charset=utf-8', 'application/xhtml+xml', 'image/svg+xml', 'application/xml', 'text/xml', 'application/javascript']) {
      expect(inertBlobType(type)).toBe('application/octet-stream');
    }
    expect(inertBlobType(undefined)).toBe('application/octet-stream');
    expect(inertBlobType('')).toBe('application/octet-stream');
  });

  it('re-types a fetched Blob without touching its bytes', async () => {
    const html = new Blob(['<script>alert(1)</script>'], { type: 'text/html' });
    const inert = toInertBlob(html);
    expect(inert.type).toBe('application/octet-stream');
    expect(inert.size).toBe(html.size);
    expect(await inert.text()).toBe('<script>alert(1)</script>');

    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    expect(toInertBlob(png)).toBe(png);
  });
});
