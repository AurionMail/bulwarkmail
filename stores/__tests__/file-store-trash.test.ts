import { describe, it, expect, beforeEach } from 'vitest';
import { useFileStore, deletesToTrash } from '../file-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { FileNode } from '@/lib/jmap/types';
import { TRASH_LOCATION, parseTrashBatchName, trashBatchName } from '@/lib/files-trash';

// An in-memory FileNode server: a folder is a node without a blob, and
// destroying a node destroys what is below it, as on Stalwart.
function makeServer(initial: FileNode[]) {
  let nodes = initial.map(n => ({ ...n }));
  let seq = 0;
  const now = () => new Date().toISOString();
  const client = {
    getCapabilities: () => ({}),
    async listAllFileNodes() { return nodes.map(n => ({ ...n })); },
    async listAllFileNodesAcrossAccounts() { return nodes.map(n => ({ ...n })); },
    async createFileDirectory(name: string, parentId: string | null) {
      const node: FileNode = { id: `n${++seq}`, parentId, name, type: '', blobId: null, size: 0, created: now(), modified: now() };
      nodes.push(node);
      return { ...node };
    },
    async updateFileNode(id: string, patch: Partial<FileNode>) {
      Object.assign(nodes.find(n => n.id === id)!, patch);
    },
    async updateFileNodes(updates: Record<string, Partial<FileNode>>) {
      const updated: string[] = [];
      for (const [id, patch] of Object.entries(updates)) {
        const node = nodes.find(n => n.id === id);
        if (!node) continue;
        const clash = nodes.some(n => n.id !== id && (n.parentId ?? null) === (patch.parentId !== undefined ? patch.parentId : node.parentId) && n.name === (patch.name ?? node.name));
        if (clash) continue;
        Object.assign(node, patch);
        updated.push(id);
      }
      return { updated, notUpdated: {} };
    },
    async destroyFileNodes(ids: string[]) {
      const gone = new Set(ids);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of nodes) {
          if (n.parentId && gone.has(n.parentId) && !gone.has(n.id)) { gone.add(n.id); grew = true; }
        }
      }
      nodes = nodes.filter(n => !gone.has(n.id));
      return { destroyed: [...gone], notDestroyed: [] };
    },
    nodes: () => nodes,
  };
  return client as unknown as IJMAPClient & { nodes: () => FileNode[] };
}

const dir = (id: string, name: string, parentId: string | null): FileNode => ({
  id, parentId, name, type: '', blobId: null, size: 0, created: '', modified: '',
});
const file = (id: string, name: string, parentId: string | null): FileNode => ({
  id, parentId, name, type: 'text/plain', blobId: `b-${id}`, size: 3, created: '', modified: '',
});

const names = () => useFileStore.getState().resources.map(r => r.name);

describe('file-store trash', () => {
  beforeEach(() => {
    localStorage.clear();
    useFileStore.setState({
      client: null, currentParentId: null, currentPath: '/', pathStack: [{ id: null, name: '' }],
      resources: [], selectedResources: new Set(), clipboard: null, lastAction: null,
      favorites: [], recentFiles: [], trashCount: 0,
    });
  });

  async function open(nodes: FileNode[], folder: string | null = null) {
    const server = makeServer(nodes);
    useFileStore.getState().initClient(server);
    await useFileStore.getState().navigate(folder, folder ?? undefined);
    return server;
  }

  it('moves deleted items into the trash instead of destroying them, and hides the trash', async () => {
    const server = await open([dir('docs', 'Documents', null), file('a', 'a.txt', 'docs'), file('b', 'b.txt', 'docs')], 'docs');
    expect(await useFileStore.getState().trashResources(['a.txt'])).toBe(1);

    expect(server.nodes().find(n => n.id === 'a')).toBeDefined();
    expect(names()).toEqual(['b.txt']);
    expect(useFileStore.getState().trashCount).toBe(1);

    await useFileStore.getState().navigate(null);
    expect(names()).toEqual(['Documents']);
    expect(useFileStore.getState().allFolders.map(f => f.name)).toEqual(['Documents']);
  });

  it('records where an item came from in the name of its delete', () => {
    expect(parseTrashBatchName(trashBatchName('docs', 1730112000000))).toEqual({ deletedAt: 1730112000000, parentId: 'docs' });
    expect(parseTrashBatchName(trashBatchName(null, 1730112000000))).toEqual({ deletedAt: 1730112000000, parentId: null });
    expect(parseTrashBatchName('Holiday photos')).toBeNull();
  });

  it('puts the items back on undo and leaves no empty folder in the trash', async () => {
    const server = await open([dir('docs', 'Documents', null), file('a', 'a.txt', 'docs')], 'docs');
    await useFileStore.getState().trashResources(['a.txt']);
    await useFileStore.getState().undoLastAction();

    expect(names()).toEqual(['a.txt']);
    expect(useFileStore.getState().trashCount).toBe(0);
    const trash = server.nodes().find(n => n.name === '.Trash')!;
    expect(server.nodes().filter(n => n.parentId === trash.id)).toEqual([]);
  });

  it('lists the trash with where each item came from, and restores it there', async () => {
    const server = await open([dir('docs', 'Documents', null), file('a', 'a.txt', 'docs')], 'docs');
    await useFileStore.getState().trashResources(['a.txt']);

    await useFileStore.getState().navigate(TRASH_LOCATION);
    const [item] = useFileStore.getState().resources;
    expect(item.name).toBe('a.txt');
    expect(item.trash?.fromParentId).toBe('docs');
    expect(useFileStore.getState().currentPath).toBe('/.Trash');

    expect(await useFileStore.getState().restoreResources(['a.txt'])).toBe(1);
    expect(server.nodes().find(n => n.id === 'a')?.parentId).toBe('docs');
    expect(names()).toEqual([]);
  });

  it('restores to the root when the folder is gone, under a new name when the old one is taken', async () => {
    const server = await open([dir('docs', 'Documents', null), file('a', 'a.txt', 'docs'), file('top', 'a.txt', null)], 'docs');
    await useFileStore.getState().trashResources(['a.txt']);
    await server.destroyFileNodes(['docs']);

    await useFileStore.getState().navigate(TRASH_LOCATION);
    await useFileStore.getState().restoreResources(['a.txt']);
    const restored = server.nodes().find(n => n.id === 'a')!;
    expect(restored.parentId).toBeNull();
    expect(restored.name).toBe('a (1).txt');
  });

  it('deletes items for good from the trash, and empties it', async () => {
    const server = await open([file('a', 'a.txt', null), file('b', 'b.txt', null)]);
    await useFileStore.getState().trashResources(['a.txt']);
    await useFileStore.getState().trashResources(['b.txt']);
    await useFileStore.getState().navigate(TRASH_LOCATION);

    expect(await useFileStore.getState().purgeResources(['a.txt'])).toBe(1);
    expect(server.nodes().find(n => n.id === 'a')).toBeUndefined();
    expect(names()).toEqual(['b.txt']);

    await useFileStore.getState().emptyTrash();
    expect(server.nodes()).toEqual([]);
    expect(useFileStore.getState().trashCount).toBe(0);
  });

  it('trashes a folder from the tree and steps out of it', async () => {
    const server = await open([dir('docs', 'Documents', null), dir('sub', 'Sub', 'docs')], 'docs');
    await useFileStore.getState().navigate('sub', 'Sub');
    expect(await useFileStore.getState().trashNode('docs')).toBe(true);
    expect(useFileStore.getState().currentParentId).toBeNull();
    expect(server.nodes().find(n => n.id === 'docs')).toBeDefined();
    expect(names()).toEqual([]);
  });

  it('has no trash in a drive someone shared', () => {
    expect(deletesToTrash(null)).toBe(true);
    expect(deletesToTrash('docs')).toBe(true);
    expect(deletesToTrash('e:team')).toBe(false);
    expect(deletesToTrash(TRASH_LOCATION)).toBe(false);
  });

  it('moves a folder of the tree by id, and not into itself', async () => {
    const server = await open([dir('docs', 'Documents', null), dir('sub', 'Sub', 'docs'), dir('arch', 'Archive', null)]);
    expect(await useFileStore.getState().moveNode('docs', 'sub')).toBe(false);
    expect(await useFileStore.getState().moveNode('docs', 'arch')).toBe(true);
    expect(server.nodes().find(n => n.id === 'docs')?.parentId).toBe('arch');
    await useFileStore.getState().undoLastAction();
    expect(server.nodes().find(n => n.id === 'docs')?.parentId).toBeNull();
  });
});
