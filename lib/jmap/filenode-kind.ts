import type { FileNode, FileNodeType } from './types';

/**
 * What a FileNode is: a file, a folder or a symlink.
 *
 * `nodeType` says so on Stalwart 0.16.6 and later. Without it, a node is a
 * folder exactly when it has no content blob (#379). Stalwart 1.0 adds
 * symlinks, which have no blob either but can't hold anything, so the blob
 * rule alone would show them as empty folders.
 */
export function fileNodeKind(node: Pick<FileNode, 'nodeType' | 'blobId'>): FileNodeType {
  switch (node.nodeType) {
    case 'file':
    case 'directory':
    case 'symlink':
      return node.nodeType;
    default:
      return node.blobId == null ? 'directory' : 'file';
  }
}
