import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { ViewSourceDialog } from '../view-source-dialog';

// View source shows the message as the server holds it (the .eml), not a
// summary built in the client, in a dialog that closes on Escape (R4).

const RAW = 'Return-Path: <a@example.org>\r\nDKIM-Signature: v=1; a=rsa-sha256\r\nSubject: Hello\r\n\r\nHi there\r\n';

describe('ViewSourceDialog', () => {
  it('shows the raw message', async () => {
    const fetchBlob = vi.fn().mockResolvedValue(new Blob([RAW]));
    render(<ViewSourceDialog isOpen onClose={vi.fn()} blobId="b1" client={{ fetchBlob } as unknown as IJMAPClient} accountId="acc" />);
    await waitFor(() => expect(screen.getByTestId('email-source').textContent).toContain('DKIM-Signature: v=1'));
    expect(fetchBlob).toHaveBeenCalledWith('b1', 'message.eml', 'message/rfc822', 'acc');
    expect(screen.getByTestId('email-source').textContent).not.toContain('=== EMAIL HEADERS ===');
  });

  it('closes on Escape and nothing else hears it', async () => {
    const onClose = vi.fn();
    const pageEscape = vi.fn();
    document.addEventListener('keydown', pageEscape);
    const fetchBlob = vi.fn().mockResolvedValue(new Blob([RAW]));
    render(<ViewSourceDialog isOpen onClose={onClose} blobId="b1" client={{ fetchBlob } as unknown as IJMAPClient} />);
    await screen.findByTestId('email-source');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pageEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', pageEscape);
  });

  it('says so when the source cannot be loaded', async () => {
    const fetchBlob = vi.fn().mockRejectedValue(new Error('404'));
    render(<ViewSourceDialog isOpen onClose={vi.fn()} blobId="b1" client={{ fetchBlob } as unknown as IJMAPClient} />);
    expect((await screen.findByRole('alert')).textContent).toBe('source_load_failed');
  });
});
