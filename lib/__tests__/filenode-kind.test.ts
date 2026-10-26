import { describe, it, expect } from 'vitest';
import { fileNodeKind } from '../jmap/filenode-kind';

describe('fileNodeKind', () => {
  it('takes nodeType as Stalwart 0.16.6+ returns it', () => {
    expect(fileNodeKind({ nodeType: 'file', blobId: 'b1' })).toBe('file');
    expect(fileNodeKind({ nodeType: 'directory', blobId: null })).toBe('directory');
  });

  // 1.0 symlinks: `blobId`, `size` and `type` are null, like a folder's.
  it('tells a symlink from a folder on Stalwart 1.0', () => {
    expect(fileNodeKind({ nodeType: 'symlink', blobId: null })).toBe('symlink');
  });

  it('falls back to the blob rule without nodeType (#379)', () => {
    expect(fileNodeKind({ blobId: null })).toBe('directory');
    expect(fileNodeKind({ blobId: 'b1' })).toBe('file');
    // An unknown value from some other server doesn't count.
    expect(fileNodeKind({ nodeType: 'fifo' as never, blobId: 'b1' })).toBe('file');
  });
});
