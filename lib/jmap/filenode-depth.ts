import type { FileNode } from './types';

/**
 * How deep a node sits in `nodes`: 0 for the root (`null`), 1 for a node at
 * the top level. Stalwart 1.0 refuses a node below its maxFileNodeDepth,
 * counted this way. A parent missing from the listing ends the walk, so the
 * result can only come out low.
 */
export function fileNodeDepth(nodes: Pick<FileNode, 'id' | 'parentId'>[], id: string | null): number {
  const parents = new Map(nodes.map(n => [n.id, n.parentId ?? null]));
  const seen = new Set<string>();
  let depth = 0;
  for (let current = id; current !== null && !seen.has(current); current = parents.get(current) ?? null) {
    seen.add(current);
    depth++;
  }
  return depth;
}
