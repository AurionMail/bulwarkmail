import { describe, it, expect, vi } from 'vitest';
import { JMAPClient } from '../jmap/client';

type Call = [string, Record<string, unknown>, string];

interface FakeOptions {
  /** The SetError the server answers a create with, if it refuses it. */
  refuseCreate?: (props: Record<string, unknown>) => Record<string, unknown> | undefined;
}

// A primary account "me" plus a shared drive "grp", as listed by
// listAllFileNodesAcrossAccounts ("grp:<id>").
function makeClient(nodes: Record<string, Array<Record<string, unknown>>>, options: FakeOptions = {}) {
  const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
  const fileCap = { 'urn:ietf:params:jmap:filenode': {} };
  Object.assign(client, {
    accountId: 'me',
    capabilities: { 'urn:ietf:params:jmap:filenode': {} },
    accounts: { me: { accountCapabilities: fileCap, isPersonal: true }, grp: { accountCapabilities: fileCap, isPersonal: false } },
    session: {
      primaryAccounts: { 'urn:ietf:params:jmap:filenode': 'me' },
      accounts: { me: { accountCapabilities: fileCap, isPersonal: true }, grp: { accountCapabilities: fileCap, isPersonal: false } },
    },
  });
  vi.spyOn(client as unknown as { getFilesCapableAccountIds: () => string[] }, 'getFilesCapableAccountIds')
    .mockReturnValue(['me', 'grp']);
  const calls: Call[] = [];
  let seq = 0;
  vi.spyOn(client as unknown as { request: (c: Call[]) => Promise<unknown> }, 'request')
    .mockImplementation(async (reqCalls: Call[]) => {
      const [method, args, id] = reqCalls[0];
      calls.push(reqCalls[0]);
      if (method === 'FileNode/get') {
        return { methodResponses: [['FileNode/get', { list: nodes[args.accountId as string] ?? [] }, id]] };
      }
      if (method === 'Blob/copy') {
        const blobIds = args.blobIds as string[];
        return { methodResponses: [['Blob/copy', { copied: Object.fromEntries(blobIds.map(b => [b, `${b}-copy`])) }, id]] };
      }
      if (method === 'FileNode/set' && args.create) {
        const refusal = options.refuseCreate?.((args.create as { n0: Record<string, unknown> }).n0);
        if (refusal) return { methodResponses: [['FileNode/set', { notCreated: { n0: refusal } }, id]] };
        return { methodResponses: [['FileNode/set', { created: { n0: { id: `new${++seq}` } } }, id]] };
      }
      if (method === 'FileNode/set' && args.update) {
        return { methodResponses: [['FileNode/set', { updated: Object.fromEntries(Object.keys(args.update as object).map(k => [k, null])) }, id]] };
      }
      if (method === 'FileNode/set' && args.destroy) {
        return { methodResponses: [['FileNode/set', { destroyed: args.destroy }, id]] };
      }
      throw new Error(`unexpected ${method}`);
    });
  return { client, calls };
}

const sets = (calls: Call[]) => calls.filter(([m]) => m === 'FileNode/set').map(([, a]) => a);

describe('FileNode writes', () => {
  it('writes inside a shared drive go to that account with bare ids', async () => {
    const { client, calls } = makeClient({});
    const dir = await client.createFileDirectory('New', 'grp:f1');
    await client.updateFileNode('grp:n1', { name: 'Renamed', parentId: 'grp:f2' });
    await client.destroyFileNodes(['grp:n1', 'n9']);

    expect(dir.id).toBe('grp:new1');
    const [create, update, destroyGrp, destroyMe] = sets(calls);
    expect(create).toMatchObject({ accountId: 'grp', onExists: 'rename', create: { n0: { name: 'New', parentId: 'f1' } } });
    expect(update).toMatchObject({ accountId: 'grp', update: { n1: { name: 'Renamed', parentId: 'f2' } } });
    expect(destroyGrp).toMatchObject({ accountId: 'grp', destroy: ['n1'] });
    expect(destroyMe).toMatchObject({ accountId: 'me', destroy: ['n9'] });
  });

  it('refuses a move into another account instead of sending a foreign id', async () => {
    const { client } = makeClient({});
    await expect(client.updateFileNode('grp:n1', { parentId: null })).rejects.toThrow('between accounts');
  });

  it('copies a folder with its whole subtree', async () => {
    const { client, calls } = makeClient({
      me: [
        { id: 'd1', name: 'Docs', parentId: null, blobId: null },
        { id: 'f1', name: 'a.txt', parentId: 'd1', blobId: 'b1', type: 'text/plain', size: 3 },
        { id: 'd2', name: 'Sub', parentId: 'd1', blobId: null },
        { id: 'f2', name: 'b.txt', parentId: 'd2', blobId: 'b2', type: 'text/plain', size: 4 },
      ],
    });
    await client.copyFileNode('d1', 'Docs (copy)', null);

    const creates = sets(calls).map(a => (a.create as { n0: Record<string, unknown> }).n0);
    // No `size`: the server takes it from the blob, and 1.0 refuses a mismatch.
    expect(creates).toEqual([
      { name: 'Docs (copy)' },
      { name: 'a.txt', parentId: 'new1', type: 'text/plain', blobId: 'b1' },
      { name: 'Sub', parentId: 'new1' },
      { name: 'b.txt', parentId: 'new3', type: 'text/plain', blobId: 'b2' },
    ]);
    expect(calls.some(([m]) => m === 'Blob/copy')).toBe(false);
  });

  it('leaves symlinks out of a folder copy instead of making them empty folders (Stalwart 1.0)', async () => {
    const { client, calls } = makeClient({
      me: [
        { id: 'd1', name: 'Docs', parentId: null, nodeType: 'directory', blobId: null, type: null, size: null },
        { id: 'l1', name: 'latest', parentId: 'd1', nodeType: 'symlink', blobId: null, type: null, size: null },
        { id: 'f1', name: 'a.txt', parentId: 'd1', nodeType: 'file', blobId: 'b1', type: 'text/plain', size: 3 },
      ],
    });
    await client.copyFileNode('d1', 'Docs (copy)', null);

    // Nor is nodeType ever sent: 1.0 treats it as immutable.
    const creates = sets(calls).map(a => (a.create as { n0: Record<string, unknown> }).n0);
    expect(creates).toEqual([
      { name: 'Docs (copy)' },
      { name: 'a.txt', parentId: 'new1', type: 'text/plain', blobId: 'b1' },
    ]);
  });

  it('refuses to copy a symlink itself', async () => {
    const { client, calls } = makeClient({
      me: [{ id: 'l1', name: 'latest', parentId: null, nodeType: 'symlink', blobId: null, type: null, size: null }],
    });
    await expect(client.copyFileNode('l1', 'latest (copy)', null)).rejects.toThrow('Symbolic links');
    expect(sets(calls)).toEqual([]);
  });

  it('copies WebDAV-created names inside a folder the way they are shown (#869)', async () => {
    const { client, calls } = makeClient({
      me: [
        { id: 'd1', name: 'Docs', parentId: null, blobId: null },
        { id: 'f1', name: 'My%20Notes.txt', parentId: 'd1', blobId: 'b1', type: 'text/plain', size: 3 },
      ],
    });
    await client.copyFileNode('d1', 'Docs (copy)', null);

    const creates = sets(calls).map(a => (a.create as { n0: Record<string, unknown> }).n0);
    expect(creates[1]).toMatchObject({ name: 'My Notes.txt' });
  });

  it('leaves the size of a new file to the server', async () => {
    const { client, calls } = makeClient({});
    await client.createFileNode('a.txt', 'b1', 'text/plain', 3, null);
    expect(sets(calls)).toEqual([
      { accountId: 'me', onExists: 'rename', create: { n0: { name: 'a.txt', type: 'text/plain', blobId: 'b1' } } },
    ]);
  });

  it('shares with the mayWrite rights of servers before 0.16.6', async () => {
    const { client, calls } = makeClient({});
    await client.setFileNodeShare('n1', 'p1', {
      mayRead: true, mayAddChildren: true, mayRename: false, mayDelete: false, mayModifyContent: false, mayShare: false,
    }).catch(() => {});
    expect(sets(calls)[0]).toMatchObject({
      accountId: 'me',
      update: { n1: { 'shareWith/p1': { mayRead: true, mayWrite: true, mayShare: false } } },
    });
  });

  it('reads old mayWrite rights as the finer rights', async () => {
    const { client } = makeClient({
      me: [{ id: 'd1', name: 'Docs', parentId: null, blobId: null, myRights: { mayRead: true, mayWrite: true, mayShare: false } }],
    });
    const [node] = await client.listAllFileNodes();
    expect(node.myRights).toEqual({
      mayRead: true, mayAddChildren: true, mayRename: true, mayDelete: true, mayModifyContent: true, mayShare: false,
    });
  });

  // Stalwart (0.16.6+ and 1.0) accepts another account's FileNode blobId
  // from anyone who may read that node, so copies reuse it. Blob/copy would
  // reserve the content to the target account, usable by its members only.
  it('copies a file out of a shared drive by reusing its blobId, without Blob/copy', async () => {
    const { client, calls } = makeClient({
      grp: [{ id: 'f1', name: 'shared.pdf', parentId: null, blobId: 'b1', type: 'application/pdf', size: 9 }],
    });
    const copy = await client.copyFileNode('grp:f1', 'shared.pdf', null);

    expect(sets(calls)).toEqual([
      { accountId: 'me', onExists: 'rename', create: { n0: { name: 'shared.pdf', type: 'application/pdf', blobId: 'b1' } } },
    ]);
    expect(calls.some(([m]) => m === 'Blob/copy')).toBe(false);
    expect(copy.id).toBe('new1');
  });

  it('copies an own folder into someone else\'s shared drive with the same blobs', async () => {
    const { client, calls } = makeClient({
      me: [
        { id: 'd1', name: 'Docs', parentId: null, blobId: null },
        { id: 'f1', name: 'a.txt', parentId: 'd1', blobId: 'b1', type: 'text/plain', size: 3 },
      ],
    });
    const copy = await client.copyFileNode('d1', 'Docs', 'grp:d9');

    expect(sets(calls)).toEqual([
      { accountId: 'grp', onExists: 'rename', create: { n0: { name: 'Docs', parentId: 'd9' } } },
      { accountId: 'grp', onExists: 'rename', create: { n0: { name: 'a.txt', parentId: 'new1', type: 'text/plain', blobId: 'b1' } } },
    ]);
    expect(calls.some(([m]) => m === 'Blob/copy')).toBe(false);
    expect(copy.id).toBe('grp:new1');
  });

  const docs = [
    { id: 'd1', name: 'Docs', parentId: null, blobId: null },
    { id: 'f1', name: 'a.txt', parentId: 'd1', blobId: 'b1', type: 'text/plain', size: 3 },
    { id: 'f2', name: 'b.txt', parentId: 'd1', blobId: 'b2', type: 'text/plain', size: 4 },
  ];

  it('removes the half-made copy and reports why when a create fails part-way on Stalwart 1.0', async () => {
    const { client, calls } = makeClient({ me: docs }, {
      // 1.0 once an administrator has set maxFiles.
      refuseCreate: (props) => props.name === 'b.txt'
        ? { type: 'overQuota', description: 'There are too many files, please delete some before adding a new one.' }
        : undefined,
    });

    await expect(client.copyFileNode('d1', 'Docs', 'grp:d9')).rejects.toThrow('There are too many files');
    expect(sets(calls).at(-1)).toEqual({ accountId: 'grp', destroy: ['new1'], onDestroyRemoveChildren: true });
  });

  it('removes the half-made copy when the server refuses a blob on 0.16', async () => {
    const { client, calls } = makeClient({ grp: docs }, {
      refuseCreate: (props) => props.blobId === 'b2'
        ? { type: 'forbidden', description: 'You do not have access to blobId b2.' }
        : undefined,
    });

    await expect(client.copyFileNode('grp:d1', 'Docs', null)).rejects.toThrow('You do not have access to blobId b2.');
    expect(sets(calls).at(-1)).toEqual({ accountId: 'me', destroy: ['new1'], onDestroyRemoveChildren: true });
  });

  it('has nothing to remove when the copy itself is refused', async () => {
    const { client, calls } = makeClient({ me: docs }, {
      refuseCreate: () => ({ type: 'forbidden', description: 'You are not allowed to create file nodes in this folder.' }),
    });

    await expect(client.copyFileNode('d1', 'Docs', 'grp:d9')).rejects.toThrow('not allowed');
    expect(sets(calls).some(a => a.destroy)).toBe(false);
  });
});
