import { describe, it, expect } from 'vitest';
import { jmapError, jmapErrorProperties, jmapErrorType } from '../jmap/jmap-error';

describe('jmapError', () => {
  it('keeps the SetError type and properties on the thrown error', () => {
    const error = jmapError('Could not save the contact', {
      type: 'invalidProperties',
      description: 'blobIds in media is not supported.',
      properties: ['media'],
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Could not save the contact');
    expect(jmapErrorType(error)).toBe('invalidProperties');
    expect(jmapErrorProperties(error)).toEqual(['media']);
  });

  it('copies the properties so later edits to the response do not leak in', () => {
    const properties = ['name'];
    const error = jmapError('rejected', { type: 'invalidProperties', properties });
    properties.push('parentId');

    expect(jmapErrorProperties(error)).toEqual(['name']);
  });

  it('works without error details', () => {
    const error = jmapError('failed', null);

    expect(jmapErrorType(error)).toBeUndefined();
    expect(jmapErrorProperties(error)).toEqual([]);
  });

  it('reads nothing from values that are not JMAP errors', () => {
    expect(jmapErrorType(new Error('plain'))).toBeUndefined();
    expect(jmapErrorType(undefined)).toBeUndefined();
    expect(jmapErrorType('overQuota')).toBeUndefined();
    expect(jmapErrorProperties(null)).toEqual([]);
  });
});
