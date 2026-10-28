import type { FileNode } from '@/lib/jmap/types';
import { fileNodeKind } from '@/lib/jmap/filenode-kind';

/*
 * The Files trash. Neither Stalwart 0.16 nor 1.0 keeps deleted FileNodes:
 * FileNode/set destroy removes a node and everything below it for good (1.0
 * can label a folder `role: "trash"`, 0.16 ignores the role, and neither moves
 * anything there). So the trash is a folder the app manages: `.Trash` at the
 * root, hidden from every listing. Each delete puts its items into a folder
 * of its own inside it, named after when it happened and where the items came
 * from, so Restore can put them back and two deleted files of the same name
 * never clash:
 *
 *   /.Trash/1730112000000~<parentId>/report.pdf
 *
 * The name is the record, so a WebDAV client or another device sees the same
 * trash, and nothing else has to be stored.
 */

export const TRASH_FOLDER_NAME = '.Trash';
/** The trash as a place in the Files view. JMAP ids never contain "*". */
export const TRASH_LOCATION = '*trash';
/** The trash's path, for links and the breadcrumb. */
export const TRASH_PATH = `/${TRASH_FOLDER_NAME}`;

export function isTrashLocation(id: string | null | undefined): boolean {
  return id === TRASH_LOCATION;
}

/** The trash folder of the account's own drive, if there is one yet. */
export function findTrashFolder(nodes: FileNode[]): FileNode | undefined {
  return nodes.find(n =>
    (n.parentId ?? null) === null
    && n.name === TRASH_FOLDER_NAME
    && !n.isShared
    && !n.id.includes(':')
    && fileNodeKind(n) === 'directory');
}

/** The name of the folder one delete's items go into. */
export function trashBatchName(parentId: string | null, deletedAt: number = Date.now()): string {
  return `${deletedAt}~${parentId ?? ''}`;
}

/** When a batch was deleted and from which folder (null: the root); null for any other name. */
export function parseTrashBatchName(name: string): { deletedAt: number; parentId: string | null } | null {
  const match = /^(\d{10,})~([A-Za-z0-9_-]*)$/.exec(name);
  if (!match) return null;
  return { deletedAt: Number(match[1]), parentId: match[2] || null };
}

/** The trash folder and everything in it, to keep out of normal listings. */
export function trashSubtreeIds(nodes: FileNode[], trashId: string | undefined): Set<string> {
  const ids = new Set<string>();
  if (!trashId) return ids;
  ids.add(trashId);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        grew = true;
      }
    }
  }
  return ids;
}

export interface TrashedItem {
  node: FileNode;
  /** The delete's folder in the trash; null for something put into the trash directly. */
  batchId: string | null;
  deletedAt: number | null;
  /** Where it came from; null for the root or when unknown. */
  fromParentId: string | null;
}

/** What the trash holds, one entry per deleted item. */
export function trashedItems(nodes: FileNode[], trash: FileNode | undefined): TrashedItem[] {
  if (!trash) return [];
  const items: TrashedItem[] = [];
  for (const child of nodes.filter(n => n.parentId === trash.id)) {
    const batch = fileNodeKind(child) === 'directory' ? parseTrashBatchName(child.name) : null;
    if (!batch) {
      items.push({ node: child, batchId: null, deletedAt: null, fromParentId: null });
      continue;
    }
    for (const node of nodes.filter(n => n.parentId === child.id)) {
      items.push({ node, batchId: child.id, deletedAt: batch.deletedAt, fromParentId: batch.parentId });
    }
  }
  return items;
}
