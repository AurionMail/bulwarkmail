import { describe, it, expect } from 'vitest';
import { isJmapSetError, jmapError, jmapErrorProperties, jmapErrorType, jmapSetError } from '../jmap/jmap-error';

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

describe('jmapSetError', () => {
  it('tells a refused object apart from a refused method call of the same type', () => {
    const setError = jmapSetError('PushSubscription/set create failed', {
      type: 'forbidden',
      description: 'No access to one of the accounts in the emailPush map.',
    });
    const methodError = jmapError('PushSubscription/set failed', { type: 'forbidden' });

    expect(jmapErrorType(setError)).toBe('forbidden');
    expect(isJmapSetError(setError)).toBe(true);
    expect(jmapErrorType(methodError)).toBe('forbidden');
    expect(isJmapSetError(methodError)).toBe(false);
  });

  it('is false for anything that is not a SetError', () => {
    expect(isJmapSetError(new Error('Failed to fetch'))).toBe(false);
    expect(isJmapSetError(undefined)).toBe(false);
    expect(isJmapSetError({ jmapSetError: 'yes' })).toBe(false);
  });
});
