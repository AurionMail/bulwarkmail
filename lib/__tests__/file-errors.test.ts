import { describe, it, expect } from 'vitest';
import { fileErrorKind, folderDepthError, isPartialCopy, partialCopyError } from '../file-errors';
import { jmapError } from '../jmap/jmap-error';

// SetErrors as Stalwart words them (1.0: jmap/src/file/*.rs; 0.16.23:
// jmap/src/file/set.rs), thrown by the JMAP client through jmapError.
const setError = (type: string, description: string, properties?: string[]) =>
  jmapError(description, { type, description, properties });

describe('fileErrorKind', () => {
  it('explains Stalwart 1.0\'s limits on files and folders', () => {
    expect(fileErrorKind(setError('overQuota', 'There are too many files, please delete some before adding a new one.'))).toBe('overQuota');
    expect(fileErrorKind(setError('overQuota', 'There are too many folders, please delete some before adding a new one.'))).toBe('overQuota');
    expect(fileErrorKind(setError('invalidProperties', 'Maximum folder depth exceeded.', ['parentId']))).toBe('tooDeep');
    expect(fileErrorKind(setError('tooLarge', 'File is too large.'))).toBe('tooLarge');
  });

  it('treats Bulwark\'s own depth check like the server\'s', () => {
    expect(fileErrorKind(folderDepthError())).toBe('tooDeep');
  });

  it('explains refused names on 0.16 and 1.0', () => {
    expect(fileErrorKind(setError('invalidProperties', 'Name is reserved and cannot be used.', ['name']))).toBe('invalidName');
    expect(fileErrorKind(setError('invalidProperties', 'Name contains a forbidden character.', ['name']))).toBe('invalidName');
    expect(fileErrorKind(setError('invalidProperties', 'Name must be between 1 and 255 octets.', ['name']))).toBe('invalidName');
  });

  it('explains missing rights on 0.16 and 1.0', () => {
    expect(fileErrorKind(setError('forbidden', 'You are not allowed to create file nodes in this folder.'))).toBe('forbidden');
    expect(fileErrorKind(setError('forbidden', 'You do not have access to blobId b2.'))).toBe('forbidden');
    expect(fileErrorKind(setError('forbidden', 'You are not allowed to modify this file node.'))).toBe('forbidden');
  });

  it('keeps why a copy stopped when part of it was left in place', () => {
    const cause = setError('overQuota', 'There are too many files, please delete some before adding a new one.');
    const partial = partialCopyError(cause);
    expect(isPartialCopy(partial)).toBe(true);
    expect(fileErrorKind(partial)).toBe('overQuota');
    expect(partial.message).toBe(cause.message);
    expect(fileErrorKind(partialCopyError(folderDepthError()))).toBe('tooDeep');
    expect(isPartialCopy(partialCopyError(new TypeError('Failed to fetch')))).toBe(true);
    expect(isPartialCopy(cause)).toBe(false);
  });

  it('has nothing to add for other errors', () => {
    // The folder is gone, or a folder was moved into itself.
    expect(fileErrorKind(setError('invalidProperties', 'Parent ID does not exist or is not a folder.', ['parentId']))).toBeNull();
    expect(fileErrorKind(setError('invalidProperties', 'Circular reference in parent ids.', ['parentId']))).toBeNull();
    expect(fileErrorKind(setError('notFound', 'Not found'))).toBeNull();
    expect(fileErrorKind(new Error('Failed to upload file: 500'))).toBeNull();
    expect(fileErrorKind(undefined)).toBeNull();
  });
});
