import { describe, expect, it } from 'vitest';
import {
  groupAccountTags,
  parseSharedTags,
  removeSharedTag,
  sharedTagsValue,
  upsertSharedTag,
} from '../shared-tags';
import { MetadataTooLargeError } from '../jmap/bulwark-metadata';

// Shared tag definitions of a group account, as they sit in the metadata of
// its Inbox: `{ list: KeywordDefinition[] }` (Stalwart takes only objects as
// namespace values).

describe('parseSharedTags', () => {
  it('reads the definitions under list', () => {
    expect(parseSharedTags({ list: [{ id: 'urgent', label: 'Urgent', color: 'red' }] }))
      .toEqual([{ id: 'urgent', label: 'Urgent', color: 'red' }]);
  });

  it('takes a bare array another client may have written', () => {
    expect(parseSharedTags([{ id: 'urgent', label: 'Urgent', color: 'red' }])).toHaveLength(1);
  });

  it('drops what cannot be a tag and keeps the first of an id in any case', () => {
    const tags = parseSharedTags({
      list: [
        { id: 'urgent', label: 'Urgent', color: 'red' },
        { id: 'URGENT', label: 'Twice', color: 'blue' },
        { id: 'has space', label: 'Bad', color: 'red' },
        { id: 'ctl\u0001', label: 'Bad', color: 'red' },
        { label: 'No id', color: 'red' },
        'urgent',
        null,
        { id: 'later', label: '   ', color: 'not-a-colour', visibility: 'sometimes' },
      ],
    });
    expect(tags).toEqual([
      { id: 'urgent', label: 'Urgent', color: 'red' },
      // An empty name falls back to the id, an unknown colour to grey.
      { id: 'later', label: 'later', color: 'gray' },
    ]);
  });

  it('reads nothing from a missing or odd value', () => {
    expect(parseSharedTags(undefined)).toEqual([]);
    expect(parseSharedTags({ list: 'x' })).toEqual([]);
    expect(parseSharedTags(7)).toEqual([]);
  });
});

describe('sharedTagsValue', () => {
  it('writes id, name, colour and visibility only', () => {
    expect(sharedTagsValue([{ id: 'a', label: 'A', color: 'red', addedBy: 'plugin-x', visibility: 'unread' }]))
      .toEqual({ list: [{ id: 'a', label: 'A', color: 'red', visibility: 'unread' }] });
  });

  it('refuses a list larger than one metadata entry', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `tag-number-${i}`, label: `Tag number ${i}`, color: 'blue' }));
    expect(() => sharedTagsValue(many)).toThrow(MetadataTooLargeError);
    expect(() => sharedTagsValue(many.slice(0, 20))).not.toThrow();
  });
});

describe('upsertSharedTag and removeSharedTag', () => {
  const list = [{ id: 'urgent', label: 'Urgent', color: 'red' }, { id: 'later', label: 'Later', color: 'blue' }];

  it('adds a new tag at the end and replaces one with the same id in place', () => {
    expect(upsertSharedTag(list, { id: 'new', label: 'New', color: 'green' }).map((t) => t.id)).toEqual(['urgent', 'later', 'new']);
    expect(upsertSharedTag(list, { id: 'Urgent', label: 'Very urgent', color: 'red-dark' })[0])
      .toEqual({ id: 'urgent', label: 'Very urgent', color: 'red-dark' });
  });

  it('removes by id in any case', () => {
    expect(removeSharedTag(list, 'URGENT')).toEqual([{ id: 'later', label: 'Later', color: 'blue' }]);
  });
});

describe('groupAccountTags', () => {
  it('lists the shared definitions, then every tag on the messages nobody named', () => {
    const { definitions, discoveredIds } = groupAccountTags(
      [{ id: 'urgent', label: 'Urgent', color: 'red' }],
      { '$label:urgent': 4, '$label:q3-invoices': 2 },
      false,
    );
    expect(definitions.map((t) => t.id)).toEqual(['urgent', 'q3-invoices']);
    expect(definitions[0]).toEqual({ id: 'urgent', label: 'Urgent', color: 'red' });
    expect(definitions[1].label).toBe('Q3 Invoices');
    expect(discoveredIds).toEqual(['q3-invoices']);
  });

  it('names a tag by its shared definition whatever case the message uses', () => {
    const { definitions } = groupAccountTags([{ id: 'urgent', label: 'Urgent', color: 'red' }], { '$label:Urgent': 1 }, false);
    expect(definitions).toHaveLength(1);
  });
});
