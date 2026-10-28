import { describe, expect, it } from 'vitest';
import { DemoJMAPClient } from '@/lib/demo/demo-client';

// A move, its Undo and a restore from the trash are all parentId updates;
// none of them may make a file look edited.
describe('DemoJMAPClient files', () => {
  it('keeps a file\'s Modified time when it is moved or renamed', async () => {
    const client = new DemoJMAPClient();
    const folder = await client.createFileDirectory('Target', null);
    const nodes = await client.listAllFileNodes();
    const original = nodes.find((n) => n.blobId != null && n.modified)!;
    const before = original.modified;

    await client.updateFileNodes({ [original.id]: { parentId: folder.id } });
    await client.updateFileNode(original.id, { name: 'renamed.txt' });

    const after = (await client.getFileNodes([original.id]))[0];
    expect(after.parentId).toBe(folder.id);
    expect(after.name).toBe('renamed.txt');
    expect(after.modified).toBe(before);
  });
});
