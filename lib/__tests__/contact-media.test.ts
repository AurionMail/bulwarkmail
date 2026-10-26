import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { jmapError } from '../jmap/jmap-error';
import { clearContactPhotoCache } from '../contact-photo-cache';
import {
  hasBlobMedia,
  inlineContactMedia,
  inlineContactMediaForExport,
  isBlobMediaRejection,
  writeContactWithNewPhoto,
} from '../contact-media';
import type { BlobBatch, IJMAPClient } from '../jmap/client-interface';
import type { ContactCard, ContactMedia } from '../jmap/types';

// The blob capability as each version advertises it (common/src/config/mailstore/capabilities.rs).
const BLOB_CAPABILITY_1_0 = {
  maxSizeBlobSet: 7499488,
  maxDataSources: 16,
  supportedTypeNames: ['Email', 'Thread', 'SieveScript', 'CalendarEvent', 'ContactCard'],
  supportedDigestAlgorithms: ['sha', 'sha-256', 'sha-512'],
};
const BLOB_CAPABILITY_0_16 = { ...BLOB_CAPABILITY_1_0, supportedTypeNames: ['Email', 'Thread', 'SieveScript'] };

// 0.16.23 contact/set.rs:511-522 (0.16.6 set.rs:489-497): the whole create or update fails.
const REFUSED_0_16 = {
  type: 'invalidProperties',
  properties: ['media'],
  description: 'blobIds in media is not supported.',
};

const NEW_PHOTO = 'data:image/jpeg;base64,/9j/4AAQ';
// 1.0 get: `{kind, blobId, mediaType}`, no uri (calcard import/props.rs map_blob_media).
const LOGO_1_0: ContactMedia = { kind: 'logo', blobId: 'dbcLogo', mediaType: 'image/png' };

function createClient(blobCapability: object | null, shared = false): JMAPClient {
  const client = new JMAPClient('https://jmap.example.com', 'user', 'pass');
  const capabilities = (extra: Record<string, unknown> = {}) => ({
    'urn:ietf:params:jmap:contacts': {},
    ...(blobCapability ? { 'urn:ietf:params:jmap:blob': blobCapability } : {}),
    ...extra,
  });
  Object.assign(client, {
    apiUrl: 'https://jmap.example.com/jmap/',
    accountId: 'a',
    downloadUrl: 'https://jmap.example.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
    session: {
      uploadUrl: 'https://jmap.example.com/jmap/upload/{accountId}/',
      primaryAccounts: { 'urn:ietf:params:jmap:contacts': 'a' },
      accounts: {
        a: { name: 'me', isPersonal: true, accountCapabilities: capabilities() },
        ...(shared ? { b: { name: 'team', isPersonal: false, accountCapabilities: capabilities() } } : {}),
      },
    },
  });
  return client;
}

function jsonResponse(body: object, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

/** Routes the upload endpoint and ContactCard/set; `setResults` answers the sets in order. */
function mockServer(setResults: Array<Record<string, unknown>>, upload: object | null = { accountId: 'a', blobId: 'Gupload1', type: 'image/jpeg', size: 6 }) {
  const uploads: Array<{ url: string; type: string | undefined; body: unknown }> = [];
  const sets: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/jmap/upload/')) {
      uploads.push({ url, type: (init?.headers as Record<string, string>)['Content-Type'], body: init?.body });
      return upload ? jsonResponse(upload) : jsonResponse({ type: 'about:blank', status: 413 }, 413);
    }
    const request = JSON.parse(String(init?.body));
    const [method, args] = request.methodCalls[0];
    if (method === 'ContactCard/get') {
      // createContact reads the new card back.
      return jsonResponse({ methodResponses: [['ContactCard/get', { list: [{ id: args.ids[0], addressBookIds: { ab: true } }] }, '0']] });
    }
    sets.push(args);
    return jsonResponse({ methodResponses: [['ContactCard/set', setResults.shift() ?? {}, '0']] });
  });
  return { uploads, sets };
}

const updateWith = (client: IJMAPClient, accountId?: string) =>
  (card: Partial<ContactCard>) => client.updateContact('c1', card, accountId);

describe('writeContactWithNewPhoto', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads the new photo and sends its blobId on Stalwart 1.0', async () => {
    const client = createClient(BLOB_CAPABILITY_1_0);
    const { uploads, sets } = mockServer([{ updated: { c1: null } }]);

    await writeContactWithNewPhoto(client, undefined, {
      media: { photo: { kind: 'photo', uri: NEW_PHOTO, mediaType: 'image/jpeg' }, logo: LOGO_1_0 },
    }, 'photo', updateWith(client));

    expect(uploads).toHaveLength(1);
    expect(uploads[0].url).toBe('https://jmap.example.com/jmap/upload/a/');
    expect(uploads[0].type).toBe('image/jpeg');
    expect((uploads[0].body as Blob).size).toBe(6);
    expect(sets).toHaveLength(1);
    expect((sets[0].update as Record<string, ContactCard>).c1.media).toEqual({
      photo: { kind: 'photo', mediaType: 'image/jpeg', blobId: 'Gupload1' },
      logo: LOGO_1_0,
    });
  });

  it('uploads into the own account when the card goes into a shared address book on Stalwart 1.0', async () => {
    // 1.0 resolves an uploaded blob only for members of the account it went
    // into (blob/download.rs has_access_blob), whatever account the set targets.
    const client = createClient(BLOB_CAPABILITY_1_0, true);
    const { uploads, sets } = mockServer([{ updated: { c1: null } }]);

    await writeContactWithNewPhoto(client, 'b', {
      media: { photo: { kind: 'photo', uri: NEW_PHOTO, mediaType: 'image/jpeg' } },
    }, 'photo', updateWith(client, 'b'));

    expect(uploads[0].url).toBe('https://jmap.example.com/jmap/upload/a/');
    expect(sets[0].accountId).toBe('b');
    expect((sets[0].update as Record<string, ContactCard>).c1.media?.photo.blobId).toBe('Gupload1');
  });

  it('sends the data: URI without uploading on Stalwart 0.16', async () => {
    const client = createClient(BLOB_CAPABILITY_0_16);
    const { uploads, sets } = mockServer([{ updated: { c1: null } }]);
    const media = { photo: { kind: 'photo' as const, uri: NEW_PHOTO, mediaType: 'image/jpeg' } };

    await writeContactWithNewPhoto(client, undefined, { media }, 'photo', updateWith(client));

    expect(uploads).toHaveLength(0);
    expect((sets[0].update as Record<string, ContactCard>).c1.media).toEqual(media);
  });

  it('retries with the data: URI when the server refuses blobIds in media as 0.16 does, and stops uploading to that account', async () => {
    const client = createClient(BLOB_CAPABILITY_1_0);
    const { uploads, sets } = mockServer([
      { notUpdated: { c1: REFUSED_0_16 } },
      { updated: { c1: null } },
      { updated: { c1: null } },
    ]);
    const card = { media: { photo: { kind: 'photo' as const, uri: NEW_PHOTO, mediaType: 'image/jpeg' } } };

    await writeContactWithNewPhoto(client, undefined, card, 'photo', updateWith(client));

    expect(uploads).toHaveLength(1);
    expect(sets).toHaveLength(2);
    expect((sets[0].update as Record<string, ContactCard>).c1.media?.photo.blobId).toBe('Gupload1');
    expect((sets[1].update as Record<string, ContactCard>).c1.media).toEqual(card.media);
    expect(client.supportsContactBlobMedia()).toBe(false);

    // Remembered for the session: the next photo goes inline straight away.
    await writeContactWithNewPhoto(client, undefined, card, 'photo', updateWith(client));
    expect(uploads).toHaveLength(1);
    expect((sets[2].update as Record<string, ContactCard>).c1.media).toEqual(card.media);
  });

  it('retries a create the same way', async () => {
    const client = createClient(BLOB_CAPABILITY_1_0);
    const { sets } = mockServer([
      { notCreated: { 'new-contact': REFUSED_0_16 } },
      { created: { 'new-contact': { id: 'c9' } } },
    ]);
    const created = await writeContactWithNewPhoto(client, undefined, {
      addressBookIds: { ab: true },
      media: { photo: { kind: 'photo', uri: NEW_PHOTO, mediaType: 'image/jpeg' } },
    }, 'photo', (card) => client.createContact(card));

    expect(created.id).toBe('c9');
    expect(sets).toHaveLength(2);
    expect((sets[0].create as Record<string, ContactCard>)['new-contact'].media?.photo.blobId).toBe('Gupload1');
    const retried = (sets[1].create as Record<string, ContactCard>)['new-contact'];
    expect(retried.media?.photo).toEqual({ kind: 'photo', uri: NEW_PHOTO, mediaType: 'image/jpeg' });
  });

  it('saves the photo inline when the upload fails on Stalwart 1.0', async () => {
    const client = createClient(BLOB_CAPABILITY_1_0);
    const { uploads, sets } = mockServer([{ updated: { c1: null } }], null);

    await writeContactWithNewPhoto(client, undefined, {
      media: { photo: { kind: 'photo', uri: NEW_PHOTO, mediaType: 'image/jpeg' } },
    }, 'photo', updateWith(client));

    expect(uploads).toHaveLength(1);
    expect((sets[0].update as Record<string, ContactCard>).c1.media?.photo.uri).toBe(NEW_PHOTO);
    // A failed upload says nothing about the server; the next save tries again.
    expect(client.supportsContactBlobMedia()).toBe(true);
  });

  it('does not retry other errors', async () => {
    const client = createClient(BLOB_CAPABILITY_1_0);
    const { sets } = mockServer([
      { notUpdated: { c1: { type: 'invalidProperties', properties: ['emails/e0/address'], description: 'Invalid email.' } } },
    ]);

    await expect(writeContactWithNewPhoto(client, undefined, {
      media: { photo: { kind: 'photo', uri: NEW_PHOTO, mediaType: 'image/jpeg' } },
    }, 'photo', updateWith(client))).rejects.toThrow('Invalid email.');
    expect(sets).toHaveLength(1);
    expect(client.supportsContactBlobMedia()).toBe(true);
  });
});

describe('isBlobMediaRejection', () => {
  it('recognises the 0.16 refusal', () => {
    expect(isBlobMediaRejection(jmapError(REFUSED_0_16.description, REFUSED_0_16))).toBe(true);
  });

  it('also counts a refusal that names an entry below media, whatever it says', () => {
    const entry = { type: 'invalidProperties', properties: ['media/photo'], description: 'Unsupported media.' };
    const field = { type: 'invalidProperties', properties: ['name', 'media/photo/blobId'] };
    expect(isBlobMediaRejection(jmapError(entry.description, entry))).toBe(true);
    expect(isBlobMediaRejection(jmapError('Invalid', field))).toBe(true);
  });

  it('leaves out an unresolvable blobId on Stalwart 1.0, which names no property', () => {
    // blob/embedded.rs:425-437
    const unresolved = { type: 'invalidProperties', description: 'The following blobIds do not exist or are not accessible: dbcX.' };
    expect(isBlobMediaRejection(jmapError(unresolved.description, unresolved))).toBe(false);
    expect(isBlobMediaRejection(new Error('network'))).toBe(false);
  });

  it('leaves out refusals of other properties', () => {
    const other = { type: 'invalidProperties', properties: ['mediaType', 'emails/e0/address'] };
    expect(isBlobMediaRejection(jmapError('Invalid', other))).toBe(false);
    expect(isBlobMediaRejection(jmapError('Too large', { type: 'tooLarge', properties: ['media'] }))).toBe(false);
  });
});

describe('inlineContactMedia', () => {
  beforeEach(() => {
    clearContactPhotoCache();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    clearContactPhotoCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const photo1_0: ContactMedia = { kind: 'photo', blobId: 'dbcX', mediaType: 'image/jpeg' };
  const photo0_16: ContactMedia = { kind: 'photo', uri: 'data:image/jpeg;base64,/9j/', mediaType: 'image/jpeg' };

  it('turns Stalwart 1.0 blob media into data: URIs and leaves 0.16 data: URIs alone', async () => {
    const fetchBlob = vi.fn(async (_blobId: string, _name?: string, type?: string) => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type }));
    const client = { fetchBlob } as unknown as IJMAPClient;

    const media = await inlineContactMedia(
      { photo: photo1_0, legacy: photo0_16 },
      { client, accountId: 'shared-1', localAccountId: 'me@host' },
      'drop',
    );

    expect(fetchBlob).toHaveBeenCalledWith('dbcX', 'photo', 'image/jpeg', 'shared-1');
    expect(media).toEqual({
      photo: { kind: 'photo', mediaType: 'image/jpeg', uri: 'data:image/jpeg;base64,/9j/' },
      legacy: photo0_16,
    });
  });

  it('drops a blob entry whose download fails, or keeps it as it is', async () => {
    const fetchBlob = vi.fn().mockRejectedValue(new Error('Failed to fetch blob: 404'));
    const client = { fetchBlob } as unknown as IJMAPClient;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const dropped = inlineContactMedia({ photo: photo1_0, logo: LOGO_1_0 }, { client }, 'drop');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await dropped).toEqual({});
    // Each blob was tried twice: once, and once more a second later.
    expect(fetchBlob).toHaveBeenCalledTimes(4);

    // The cache would answer from its memory of the failure without asking.
    clearContactPhotoCache();
    fetchBlob.mockClear();
    const kept = inlineContactMedia({ photo: photo1_0 }, { client }, 'keep');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await kept).toEqual({ photo: photo1_0 });
    expect(fetchBlob).toHaveBeenCalledTimes(2);
  });

  it('knows which media still need downloading', () => {
    expect(hasBlobMedia({ photo: photo1_0 })).toBe(true);
    expect(hasBlobMedia({ photo: photo0_16 })).toBe(false);
    expect(hasBlobMedia(undefined)).toBe(false);
  });
});

describe('inlineContactMediaForExport', () => {
  beforeEach(() => {
    clearContactPhotoCache();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    clearContactPhotoCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const card = (id: string, media: ContactCard['media'], extra: Partial<ContactCard> = {}): ContactCard =>
    ({ id, addressBookIds: {}, name: { full: id }, media, ...extra });
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

  function exportClient(batch: BlobBatch | null | Error | undefined) {
    return {
      getContactsAccountId: () => 'a',
      fetchBlob: vi.fn(async () => jpeg()),
      ...(batch === undefined ? {} : {
        getBlobsAsBase64: vi.fn(async () => {
          if (batch instanceof Error) throw batch;
          return batch;
        }),
      }),
    };
  }

  it('fetches the blob media of every card in one batch on Stalwart 1.0', async () => {
    const client = exportClient({ data: new Map([['dbcA', '/9j/A'], ['dbcLogo', 'iVBO'], ['dbcB', '/9j/B']]), failed: [] });
    const legacy: ContactMedia = { kind: 'photo', uri: 'data:image/jpeg;base64,/9j/', mediaType: 'image/jpeg' };

    const cards = await inlineContactMediaForExport([
      card('1', { photo: { kind: 'photo', blobId: 'dbcA', mediaType: 'image/jpeg', pref: 1 }, logo: LOGO_1_0 }),
      card('2', { photo: { kind: 'photo', blobId: 'dbcB', mediaType: 'image/jpeg' } }),
      card('3', { photo: legacy }),
      card('4', undefined),
    ], () => client as unknown as IJMAPClient);

    expect(client.getBlobsAsBase64).toHaveBeenCalledTimes(1);
    expect(client.getBlobsAsBase64).toHaveBeenCalledWith(['dbcA', 'dbcLogo', 'dbcB'], 'a');
    expect(client.fetchBlob).not.toHaveBeenCalled();
    expect(cards.map((c) => c.media)).toEqual([
      {
        photo: { kind: 'photo', mediaType: 'image/jpeg', pref: 1, uri: 'data:image/jpeg;base64,/9j/A' },
        logo: { kind: 'logo', mediaType: 'image/png', uri: 'data:image/png;base64,iVBO' },
      },
      { photo: { kind: 'photo', mediaType: 'image/jpeg', uri: 'data:image/jpeg;base64,/9j/B' } },
      { photo: legacy },
      undefined,
    ]);
  });

  // The batch names the card's account. Where that is an address book shared
  // with the user, Stalwart refuses Blob/get in it, and the client asks in the
  // user's own account instead (see jmap-blob-get.test.ts).
  it('asks each account and login for its own blobs', async () => {
    const own = exportClient({ data: new Map([['dbcA', 'QQ==']]), failed: [] });
    const other = exportClient({ data: new Map([['dbcB', 'Qg==']]), failed: [] });
    const clientFor = vi.fn((login?: string) => (login === 'other@host' ? other : own) as unknown as IJMAPClient);

    const cards = await inlineContactMediaForExport([
      card('1', { photo: { kind: 'photo', blobId: 'dbcA', mediaType: 'image/jpeg' } }, { accountId: 'shared-1' }),
      card('2', { photo: { kind: 'photo', blobId: 'dbcB', mediaType: 'image/jpeg' } }, { localAccountId: 'other@host' }),
    ], clientFor);

    expect(own.getBlobsAsBase64).toHaveBeenCalledWith(['dbcA'], 'shared-1');
    expect(other.getBlobsAsBase64).toHaveBeenCalledWith(['dbcB'], 'a');
    expect(clientFor).toHaveBeenCalledWith('other@host');
    expect(cards.map((c) => c.media?.photo.uri)).toEqual(['data:image/jpeg;base64,QQ==', 'data:image/jpeg;base64,Qg==']);
  });

  it.each([
    ['the session lacks the blob capability', null],
    ['the batch request fails', new Error('Request failed: 500')],
    ['the client cannot batch', undefined],
  ])('downloads the blobs one by one when %s', async (_why, batch) => {
    const client = exportClient(batch as BlobBatch | null | Error | undefined);

    const [exported] = await inlineContactMediaForExport([
      card('1', { photo: { kind: 'photo', blobId: 'dbcA', mediaType: 'image/jpeg' } }, { accountId: 'a' }),
    ], () => client as unknown as IJMAPClient);

    expect(client.fetchBlob).toHaveBeenCalledWith('dbcA', 'photo', 'image/jpeg', 'a');
    expect(exported.media?.photo.uri).toBe('data:image/jpeg;base64,/9j/');
  });

  it('downloads only what the batch left unfetched, and leaves out what the server no longer has', async () => {
    // dbcGone is in neither list: Blob/get reported it notFound.
    const client = exportClient({ data: new Map([['dbcA', 'QQ==']]), failed: ['dbcB'] });

    const cards = await inlineContactMediaForExport([
      card('1', { photo: { kind: 'photo', blobId: 'dbcA', mediaType: 'image/jpeg' } }),
      card('2', { photo: { kind: 'photo', blobId: 'dbcB', mediaType: 'image/jpeg' } }),
      card('3', { photo: { kind: 'photo', blobId: 'dbcGone', mediaType: 'image/jpeg' } }),
    ], () => client as unknown as IJMAPClient);

    expect(client.fetchBlob).toHaveBeenCalledTimes(1);
    expect(client.fetchBlob).toHaveBeenCalledWith('dbcB', 'photo', 'image/jpeg', undefined);
    expect(cards.map((c) => c.media)).toEqual([
      { photo: { kind: 'photo', mediaType: 'image/jpeg', uri: 'data:image/jpeg;base64,QQ==' } },
      { photo: { kind: 'photo', mediaType: 'image/jpeg', uri: 'data:image/jpeg;base64,/9j/' } },
      {},
    ]);
  });

  it('leaves the photos out when the card\'s login has no client', async () => {
    const cards = await inlineContactMediaForExport([
      card('1', { photo: { kind: 'photo', blobId: 'dbcA' }, logo: { kind: 'logo', uri: 'https://x.test/l.png' } }, { localAccountId: 'gone@host' }),
    ], () => null);

    expect(cards[0].media).toEqual({ logo: { kind: 'logo', uri: 'https://x.test/l.png' } });
  });
});
