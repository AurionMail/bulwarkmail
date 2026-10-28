import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { FileNode } from '@/lib/jmap/types';
import { useToastStore } from '@/stores/toast-store';
import { SaveToFilesDialog } from '../save-to-files-dialog';

// "Save to Files" files an attachment in a folder of the Files app by its
// blobId: no download, no upload.

const folder = (id: string, name: string, parentId: string | null = null) =>
  ({ id, name, parentId, blobId: null, type: 'd', size: 0, created: '', modified: '' }) as FileNode;
const nodes = [folder('docs', 'Documents'), folder('invoices', 'Invoices', 'docs'), folder('hidden', '.Trash')];
const attachment = { name: 'invoice.pdf', type: 'application/pdf', size: 1234, blobId: 'blob-1' };

describe('SaveToFilesDialog', () => {
  it('saves the attachment into the picked folder by its blob', async () => {
    const createFileNode = vi.fn().mockResolvedValue({});
    const client = { listAllFileNodes: vi.fn().mockResolvedValue(nodes), createFileNode } as unknown as IJMAPClient;
    const onClose = vi.fn();
    render(<SaveToFilesDialog attachment={attachment} client={client} onClose={onClose} />);

    fireEvent.click(await screen.findByText('Documents'));
    expect(screen.queryByText('.Trash')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'save_here' }));

    await waitFor(() => expect(createFileNode).toHaveBeenCalledWith('invoice.pdf', 'blob-1', 'application/pdf', 1234, 'docs'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useToastStore.getState().toasts.some((toast) => toast.title === 'saved')).toBe(true);
  });
});
