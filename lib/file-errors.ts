import { jmapError, jmapErrorProperties, jmapErrorType } from '@/lib/jmap/jmap-error';

/**
 * Why a FileNode write failed, from the SetError the JMAP client threw
 * (see jmapError), for the Files toasts to explain under their own title.
 */
export type FileErrorKind = 'overQuota' | 'tooDeep' | 'invalidName' | 'forbidden' | 'tooLarge';

// Stalwart 1.0's description for a node past maxFileNodeDepth.
const TOO_DEEP = 'Maximum folder depth exceeded.';

/** The error for a node that would sit deeper than the server allows, worded as Stalwart 1.0 does. */
export function folderDepthError(): Error {
  return jmapError(TOO_DEEP, { type: 'invalidProperties', properties: ['parentId'] });
}

export function fileErrorKind(error: unknown): FileErrorKind | null {
  switch (jmapErrorType(error)) {
    // Stalwart 1.0, once an administrator limits files or folders per account.
    case 'overQuota':
      return 'overQuota';
    // 1.0 for content over 4 GiB.
    case 'tooLarge':
      return 'tooLarge';
    case 'forbidden':
      return 'forbidden';
    case 'invalidProperties': {
      const properties = jmapErrorProperties(error);
      if (properties.includes('name')) return 'invalidName';
      // `parentId` is refused for other reasons too (the folder is gone, a
      // folder moved into itself); only the description tells depth apart.
      if (properties.includes('parentId') && error instanceof Error && /depth/i.test(error.message)) {
        return 'tooDeep';
      }
      return null;
    }
    default:
      return null;
  }
}
