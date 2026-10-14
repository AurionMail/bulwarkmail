import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFileStore } from '../file-store';
import { fileHooks, clearAllHooks } from '@/lib/plugin-hooks';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { FileNode } from '@/lib/jmap/types';

const dir = (id: string, name: string, parentId: string | null): FileNode => ({
  id, parentId, name, type: 'd', blobId: null, size: 0, created: '', modified: '2026-01-01T00:00:00Z',
});
const file = (id: string, name: string, parentId: string | null): FileNode => ({
  id, parentId, name, type: 'text/plain', blobId: `b-${id}`, size: 10, created: '', modified: '2026-01-01T00:00:00Z',
});

/** In-memory FileNode backend with spies on every server call. */
function makeClient(initial: FileNode[]) {
  let nodes = initial.map(n => ({ ...n }));
  let seq = 0;
  const create = (name: string, blobId: string | null, type: string, size: number, parentId: string | null) => {
    const node: FileNode = { id: `new${++seq}`, parentId, name, type, blobId, size, created: '', modified: '' };
    nodes.push(node);
    return { ...node };
  };
  const client = {
    listAllFileNodes: vi.fn(async () => nodes.map(n => ({ ...n }))),
    createFileDirectory: vi.fn(async (name: string, parentId: string | null) => create(name, null, 'd', 0, parentId)),
    createFileNode: vi.fn(async (name: string, blobId: string, type: string, size: number, parentId: string | null) =>
      create(name, blobId, type, size, parentId)),
    updateFileNode: vi.fn(async (id: string, patch: Partial<FileNode>) => {
      const node = nodes.find(n => n.id === id);
      if (node) Object.assign(node, patch);
    }),
    destroyFileNodes: vi.fn(async (ids: string[]) => {
      nodes = nodes.filter(n => !ids.includes(n.id));
      return { destroyed: ids, notDestroyed: [] };
    }),
    copyFileNode: vi.fn(async (id: string, newName: string, parentId: string | null) => {
      const original = nodes.find(n => n.id === id)!;
      return create(newName, original.blobId, original.type, original.size, parentId);
    }),
    uploadBlob: vi.fn(async (f: File) => ({ blobId: `blob-${f.name}`, type: f.type })),
    downloadBlob: vi.fn(async () => undefined),
  };
  return client as unknown as IJMAPClient & typeof client;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A drive with /Docs (a.txt, b.txt) and /Docs/Target, opened at /Docs. */
async function openDocs() {
  const client = makeClient([
    dir('docs', 'Docs', null),
    file('a', 'a.txt', 'docs'),
    file('b', 'b.txt', 'docs'),
    dir('target', 'Target', 'docs'),
  ]);
  useFileStore.setState({
    client, currentParentId: null, currentPath: '/', pathStack: [{ id: null, name: '' }],
    resources: [], allFolders: [], selectedResources: new Set(), clipboard: null, lastAction: null,
    uploadAbortController: null, uploadProgress: null, hasListed: false,
  });
  await useFileStore.getState().navigate('docs', 'Docs');
  return client;
}

const names = () => useFileStore.getState().resources.map(r => r.name).sort();

describe('file-store plugin hooks: changing files', () => {
  beforeEach(() => clearAllHooks());

  describe('uploads', () => {
    it('asks about each file before it goes up and skips the refused ones', async () => {
      const client = await openDocs();
      const before = vi.fn(({ name }: { name: string }) => {
        expect(client.uploadBlob).not.toHaveBeenCalled();
        return name !== 'no.txt';
      });
      const after = vi.fn();
      fileHooks.onBeforeFileUpload.register('test', before);
      fileHooks.onAfterFileUpload.register('test', after);

      const yes = new File(['hello'], 'yes.txt', { type: 'text/plain' });
      const no = new File(['nope'], 'no.txt', { type: 'text/plain' });
      const result = await useFileStore.getState().uploadFiles([yes, no]);
      await flush();

      expect(before).toHaveBeenCalledTimes(2);
      expect(before).toHaveBeenCalledWith({ name: 'yes.txt', size: 5, type: 'text/plain', path: '/Docs' });
      expect(result.uploaded).toBe(1);
      expect(client.uploadBlob).toHaveBeenCalledTimes(1);
      expect(names()).not.toContain('no.txt');
      expect(after).toHaveBeenCalledOnce();
      expect(after.mock.calls[0][0]).toMatchObject({ name: 'yes.txt', type: 'file', mimeType: 'text/plain', path: '/Docs' });
    });

    it('uploads nothing when every file is refused', async () => {
      const client = await openDocs();
      fileHooks.onBeforeFileUpload.register('test', () => false);

      await useFileStore.getState().uploadFile(new File(['x'], 'x.txt'));
      const result = await useFileStore.getState().uploadFiles([new File(['y'], 'y.txt')]);

      expect(result).toEqual({ uploaded: 0, canceled: false });
      expect(client.uploadBlob).not.toHaveBeenCalled();
      expect(client.createFileNode).not.toHaveBeenCalled();
    });

    it('does not create the folder of a refused file in a folder upload', async () => {
      const client = await openDocs();
      const after = vi.fn();
      fileHooks.onBeforeFileUpload.register('test', ({ path }: { path: string }) => path !== '/Docs/secret');
      fileHooks.onAfterFileUpload.register('test', after);

      const inSub = new File(['s'], 'key.pem');
      Object.defineProperty(inSub, 'webkitRelativePath', { value: 'secret/key.pem' });
      const top = new File(['t'], 'readme.md');
      await useFileStore.getState().uploadFolder([inSub, top]);
      await flush();

      expect(client.createFileDirectory).not.toHaveBeenCalled();
      expect(after).toHaveBeenCalledOnce();
      expect(after.mock.calls[0][0]).toMatchObject({ name: 'readme.md', path: '/Docs' });
    });

    it('does not report an upload the server refused', async () => {
      const client = await openDocs();
      client.createFileNode.mockRejectedValueOnce(new Error('quota'));
      const after = vi.fn();
      fileHooks.onAfterFileUpload.register('test', after);

      await expect(useFileStore.getState().uploadFiles([new File(['x'], 'x.txt')])).rejects.toThrow('quota');
      await flush();
      expect(after).not.toHaveBeenCalled();
    });

    it('reports a cancelled upload, but only while one runs', async () => {
      await openDocs();
      const cancelled = vi.fn();
      fileHooks.onFileUploadCancel.register('test', cancelled);

      useFileStore.getState().cancelUpload();
      useFileStore.setState({
        uploadAbortController: new AbortController(),
        uploadProgress: { name: 'big.iso', loaded: 1, total: 9, current: 1, totalFiles: 1 },
      });
      useFileStore.getState().cancelUpload();
      await flush();

      expect(cancelled).toHaveBeenCalledOnce();
      expect(cancelled).toHaveBeenCalledWith({ name: 'big.iso', path: '/Docs' });
    });
  });

  it('reports a created folder', async () => {
    await openDocs();
    const created = vi.fn();
    fileHooks.onDirectoryCreate.register('test', created);

    await useFileStore.getState().createDirectory('New');
    await flush();

    expect(created).toHaveBeenCalledOnce();
    expect(created.mock.calls[0][0]).toMatchObject({ name: 'New', type: 'directory', path: '/Docs' });
  });

  describe('delete', () => {
    it('asks once for all files and reports them', async () => {
      const client = await openDocs();
      const before = vi.fn(() => {
        expect(client.destroyFileNodes).not.toHaveBeenCalled();
        return true;
      });
      const after = vi.fn();
      fileHooks.onBeforeFileDelete.register('test', before);
      fileHooks.onAfterFileDelete.register('test', after);

      expect(await useFileStore.getState().deleteResources(['a.txt', 'b.txt'])).toBe(true);
      await flush();

      expect(before).toHaveBeenCalledOnce();
      const asked = (before.mock.calls[0] as unknown as [{ files: { id: string; path: string }[] }])[0];
      expect(asked.files.map(f => f.id)).toEqual(['a', 'b']);
      expect(asked.files[0].path).toBe('/Docs');
      expect(after).toHaveBeenCalledOnce();
      expect(after.mock.calls[0][0].files.map((f: { id: string }) => f.id)).toEqual(['a', 'b']);
    });

    it('keeps everything when a plugin says no', async () => {
      const client = await openDocs();
      const after = vi.fn();
      fileHooks.onBeforeFileDelete.register('test', () => false);
      fileHooks.onAfterFileDelete.register('test', after);

      expect(await useFileStore.getState().deleteResource('a.txt')).toBe(false);
      expect(await useFileStore.getState().deleteResources(['a.txt', 'b.txt'])).toBe(false);
      expect(await useFileStore.getState().deleteNode('target')).toBe(false);
      await flush();

      expect(client.destroyFileNodes).not.toHaveBeenCalled();
      expect(names()).toEqual(['Target', 'a.txt', 'b.txt']);
      expect(after).not.toHaveBeenCalled();
    });

    it('does not report a delete the server refused', async () => {
      const client = await openDocs();
      client.destroyFileNodes.mockRejectedValueOnce(new Error('locked'));
      const after = vi.fn();
      fileHooks.onAfterFileDelete.register('test', after);

      await expect(useFileStore.getState().deleteResource('a.txt')).rejects.toThrow();
      await flush();
      expect(after).not.toHaveBeenCalled();
    });

    it('reports a folder deleted from the tree with its path', async () => {
      await openDocs();
      const after = vi.fn();
      fileHooks.onAfterFileDelete.register('test', after);

      await useFileStore.getState().deleteNode('target');
      await flush();
      expect(after.mock.calls[0][0].files[0]).toMatchObject({ id: 'target', name: 'Target', type: 'directory', path: '/Docs' });
    });
  });

  describe('rename', () => {
    it('passes the file and new name first, then the previous name', async () => {
      const client = await openDocs();
      const before = vi.fn(() => {
        expect(client.updateFileNode).not.toHaveBeenCalled();
        return true;
      });
      const after = vi.fn();
      fileHooks.onBeforeFileRename.register('test', before);
      fileHooks.onFileRename.register('test', after);

      expect(await useFileStore.getState().renameResource('a.txt', 'c.txt')).toBe(true);
      await flush();

      expect(before).toHaveBeenCalledWith({ file: expect.objectContaining({ id: 'a', name: 'a.txt', path: '/Docs' }), newName: 'c.txt' });
      expect(after).toHaveBeenCalledWith({ file: expect.objectContaining({ id: 'a', name: 'c.txt' }), previousName: 'a.txt' });
    });

    it('keeps the name when a plugin says no', async () => {
      const client = await openDocs();
      const after = vi.fn();
      fileHooks.onBeforeFileRename.register('test', () => false);
      fileHooks.onFileRename.register('test', after);

      expect(await useFileStore.getState().renameResource('a.txt', 'c.txt')).toBe(false);
      expect(await useFileStore.getState().renameNode('target', 'Moved')).toBe(false);
      await flush();

      expect(client.updateFileNode).not.toHaveBeenCalled();
      expect(useFileStore.getState().lastAction).toBeNull();
      expect(after).not.toHaveBeenCalled();
    });

    it('does not report a rename the server refused', async () => {
      const client = await openDocs();
      client.updateFileNode.mockRejectedValueOnce(new Error('taken'));
      const after = vi.fn();
      fileHooks.onFileRename.register('test', after);

      await expect(useFileStore.getState().renameNode('target', 'X')).rejects.toThrow();
      await flush();
      expect(after).not.toHaveBeenCalled();
    });
  });

  describe('move and copy', () => {
    it('asks once for all moved files with the target path', async () => {
      const client = await openDocs();
      const before = vi.fn(() => {
        expect(client.updateFileNode).not.toHaveBeenCalled();
        return true;
      });
      const after = vi.fn();
      fileHooks.onBeforeFileMove.register('test', before);
      fileHooks.onFileMove.register('test', after);

      expect(await useFileStore.getState().moveToFolderId(['a.txt', 'b.txt'], 'target')).toBe(true);
      await flush();

      expect(before).toHaveBeenCalledOnce();
      const asked = (before.mock.calls[0] as unknown as [{ files: { id: string }[]; toPath: string }])[0];
      expect(asked.files.map(f => f.id)).toEqual(['a', 'b']);
      expect(asked.toPath).toBe('/Docs/Target');
      expect(after).toHaveBeenCalledOnce();
      expect(after.mock.calls[0][0].toPath).toBe('/Docs/Target');
      expect(after.mock.calls[0][0].files.map((f: { id: string }) => f.id)).toEqual(['a', 'b']);
    });

    it('moves nothing when a plugin says no', async () => {
      const client = await openDocs();
      const after = vi.fn();
      fileHooks.onBeforeFileMove.register('test', () => false);
      fileHooks.onFileMove.register('test', after);

      expect(await useFileStore.getState().moveToFolderId(['a.txt'], 'target')).toBe(false);
      expect(await useFileStore.getState().moveToFolder(['a.txt'], 'Target')).toBe(false);
      expect(await useFileStore.getState().moveToParent(['a.txt'])).toBe(false);
      useFileStore.getState().cutResources(['b.txt']);
      await useFileStore.getState().navigate('target', 'Target');
      expect(await useFileStore.getState().pasteResources()).toBe(false);
      await flush();

      expect(client.updateFileNode).not.toHaveBeenCalled();
      expect(useFileStore.getState().clipboard).not.toBeNull();
      expect(after).not.toHaveBeenCalled();
    });

    it('reports only the files that moved before a failure', async () => {
      const client = await openDocs();
      client.updateFileNode.mockImplementationOnce(async () => undefined).mockRejectedValueOnce(new Error('denied'));
      const after = vi.fn();
      fileHooks.onFileMove.register('test', after);

      await expect(useFileStore.getState().moveToParent(['a.txt', 'b.txt'])).rejects.toThrow('denied');
      await flush();

      expect(after).toHaveBeenCalledOnce();
      expect(after.mock.calls[0][0]).toMatchObject({ toPath: '/', files: [expect.objectContaining({ id: 'a', path: '/' })] });
    });

    it('reports cut and paste as a move and copy and paste as a copy', async () => {
      await openDocs();
      const moved = vi.fn();
      const copied = vi.fn();
      fileHooks.onFileMove.register('test', moved);
      fileHooks.onFileCopy.register('test', copied);

      useFileStore.getState().copyResources(['a.txt']);
      await useFileStore.getState().navigate('target', 'Target');
      await useFileStore.getState().pasteResources();
      await useFileStore.getState().navigate('docs', 'Docs');
      useFileStore.getState().cutResources(['b.txt']);
      await useFileStore.getState().navigate('target', 'Target');
      await useFileStore.getState().pasteResources();
      await flush();

      expect(copied).toHaveBeenCalledOnce();
      const copy = copied.mock.calls[0][0];
      expect(copy.toPath).toBe('/Docs/Target');
      expect(copy.files[0]).toMatchObject({ name: 'a.txt', path: '/Docs/Target' });
      expect(copy.files[0].id).not.toBe('a');
      expect(moved).toHaveBeenCalledOnce();
      expect(moved.mock.calls[0][0]).toMatchObject({ toPath: '/Docs/Target', files: [expect.objectContaining({ id: 'b', path: '/Docs/Target' })] });
    });

    it('reports a duplicate with the new copy', async () => {
      await openDocs();
      const duplicated = vi.fn();
      fileHooks.onFileDuplicate.register('test', duplicated);

      await useFileStore.getState().duplicateResource('a.txt');
      await flush();

      expect(duplicated).toHaveBeenCalledOnce();
      expect(duplicated.mock.calls[0][0]).toMatchObject({ name: 'a (copy).txt', path: '/Docs', type: 'file' });
    });
  });

  describe('download', () => {
    it('reports each downloaded file', async () => {
      await openDocs();
      const downloaded = vi.fn();
      fileHooks.onFileDownload.register('test', downloaded);

      await useFileStore.getState().downloadResources(['a.txt', 'b.txt']);
      await useFileStore.getState().downloadNode('a');
      await flush();

      expect(downloaded.mock.calls.map(c => [c[0].id, c[0].path])).toEqual([['a', '/Docs'], ['b', '/Docs'], ['a', '/Docs']]);
    });

    it('does not report a failed download', async () => {
      const client = await openDocs();
      client.downloadBlob.mockRejectedValueOnce(new Error('gone'));
      const downloaded = vi.fn();
      fileHooks.onFileDownload.register('test', downloaded);

      await expect(useFileStore.getState().downloadResource('a.txt')).rejects.toThrow();
      await flush();
      expect(downloaded).not.toHaveBeenCalled();
    });
  });
});
