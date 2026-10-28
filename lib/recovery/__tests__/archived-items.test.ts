import { describe, expect, it } from 'vitest';
import {
  buildRestoreCalls,
  classifyArchiveError,
  parseArchivedFrom,
  parseArchivedItems,
  readRestoreResults,
  visibleArchivedItems,
} from '../archived-items';
import { jmapError } from '@/lib/jmap/jmap-error';
import { ACCOUNT, ARCHIVED_FILE, LICENSE_REFUSAL, archivedEmail } from './fixtures';

describe('parseArchivedFrom', () => {
  it('reads the three forms the server stores', () => {
    expect(parseArchivedFrom('Org Bob <org-bob@example.org>')).toEqual({ name: 'Org Bob', email: 'org-bob@example.org' });
    expect(parseArchivedFrom('org-bob@example.org')).toEqual({ name: '', email: 'org-bob@example.org' });
    expect(parseArchivedFrom('Org Bob')).toEqual({ name: 'Org Bob', email: '' });
    expect(parseArchivedFrom('')).toEqual({ name: '', email: '' });
  });
});

describe('parseArchivedItems', () => {
  it('keeps deleted messages with sender, subject and dates, and leaves other kinds out', () => {
    const items = parseArchivedItems([archivedEmail('a'), ARCHIVED_FILE, archivedEmail('b', { from: 'carol@example.org', subject: '' })]);
    expect(items).toEqual([
      {
        id: 'a', fromName: 'Org Bob', fromEmail: 'org-bob@example.org', subject: 'Message a',
        receivedAt: '2026-10-01T09:00:00Z', archivedAt: '2026-10-20T08:00:00Z', archivedUntil: '2026-11-19T08:00:00Z',
        size: 2048, accountId: ACCOUNT,
      },
      expect.objectContaining({ id: 'b', fromName: '', fromEmail: 'carol@example.org', subject: '' }),
    ]);
  });

  it('drops malformed entries instead of failing', () => {
    expect(parseArchivedItems([null, 'x', { '@type': 'Email' }, archivedEmail('c', { archivedAt: 'yesterday' })])).toEqual([]);
    expect(parseArchivedItems(undefined)).toEqual([]);
  });

  it("keeps only the asked account's items (an admin's query sees every account)", () => {
    const items = parseArchivedItems([archivedEmail('a'), archivedEmail('z', { accountId: 'cz' })], ACCOUNT);
    expect(items.map((i) => i.id)).toEqual(['a']);
  });
});

describe('visibleArchivedItems', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  const items = parseArchivedItems([
    archivedEmail('old', { archivedAt: '2026-10-01T08:00:00Z' }),
    archivedEmail('new', { archivedAt: '2026-10-27T08:00:00Z' }),
    archivedEmail('mid', { archivedAt: '2026-10-20T08:00:00Z' }),
    archivedEmail('gone', { archivedAt: '2026-10-26T08:00:00Z', archivedUntil: '2026-10-27T08:00:00Z' }),
  ]);

  it('lists everything the server still keeps, newest deletion first, with days 0', () => {
    expect(visibleArchivedItems(items, 0, now).map((i) => i.id)).toEqual(['new', 'mid', 'old']);
  });

  it('limits the list to the last N days', () => {
    expect(visibleArchivedItems(items, 10, now).map((i) => i.id)).toEqual(['new', 'mid']);
    expect(visibleArchivedItems(items, 2, now).map((i) => i.id)).toEqual(['new']);
    expect(visibleArchivedItems(items, 1, now)).toEqual([]);
  });
});

describe('restore calls', () => {
  it('asks for requestRestore per item, split at maxObjectsInSet', () => {
    const calls = buildRestoreCalls(['a', 'b', 'c'], ACCOUNT, 2);
    expect(calls).toEqual([
      ['x:ArchivedItem/set', { accountId: ACCOUNT, update: { a: { status: 'requestRestore' }, b: { status: 'requestRestore' } } }, 'r0'],
      ['x:ArchivedItem/set', { accountId: ACCOUNT, update: { c: { status: 'requestRestore' } } }, 'r1'],
    ]);
  });

  it('reports every item: restored, refused with the reason, or failed with its call', () => {
    const calls = buildRestoreCalls(['a', 'b', 'c'], ACCOUNT, 2);
    const results = readRestoreResults(calls, [
      ['x:ArchivedItem/set', { updated: { a: null }, notUpdated: { b: { type: 'notFound' } } }, 'r0'],
      ['error', LICENSE_REFUSAL, 'r1'],
    ]);
    expect(results).toEqual([
      { id: 'a', ok: true },
      { id: 'b', ok: false, error: 'notFound' },
      { id: 'c', ok: false, error: LICENSE_REFUSAL.description },
    ]);
  });

  it('fails the items of a call the answer leaves out', () => {
    const calls = buildRestoreCalls(['a'], ACCOUNT, 10);
    expect(readRestoreResults(calls, [])).toEqual([{ id: 'a', ok: false, error: 'No answer' }]);
  });
});

describe('classifyArchiveError', () => {
  it('counts a refusal by the server as unsupported and anything else as an error', () => {
    expect(classifyArchiveError(jmapError(LICENSE_REFUSAL.description, LICENSE_REFUSAL))).toBe('unsupported');
    expect(classifyArchiveError(jmapError('x', { type: 'unknownMethod' }))).toBe('unsupported');
    expect(classifyArchiveError(new Error('Request failed: 400 - {"type":"urn:ietf:params:jmap:error:unknownCapability"}'))).toBe('unsupported');
    expect(classifyArchiveError(new Error('Failed to fetch'))).toBe('error');
    expect(classifyArchiveError(jmapError('x', { type: 'serverFail' }))).toBe('error');
  });
});
