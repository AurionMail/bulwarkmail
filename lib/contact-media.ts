import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { ContactCard, ContactMedia } from '@/lib/jmap/types';
import { jmapErrorProperties, jmapErrorType } from '@/lib/jmap/jmap-error';
import { blobToDataUri, dataUriToBlob } from '@/lib/data-uri';
import { contactPhotoConcurrency, contactPhotoKey, loadContactPhotoBlob } from '@/lib/contact-photo-cache';
import { debug } from '@/lib/debug';

/**
 * Contact media that live as blobs, and writing a newly picked photo.
 *
 * Stalwart 1.0 returns every embedded PHOTO, LOGO and SOUND as
 * `{kind, blobId, mediaType}`; 0.16 returns data: URIs and refuses a blobId
 * in `media`.
 */

/** Where the blobs of a card can be downloaded. */
export interface ContactMediaSource {
  client: IJMAPClient | null;
  /** JMAP account the card lives in. */
  accountId?: string;
  /** Login the card belongs to in multi-account mode (the cache namespace). */
  localAccountId?: string;
}

/** Options for saving a card from the contact form. */
export interface ContactSaveOptions {
  /** Key of the `media` entry holding a photo the user just picked, as a data: URI. */
  photoKey?: string;
}

type BlobMedia = ContactMedia & { blobId: string };

export function hasBlobMedia(media: Record<string, ContactMedia> | undefined): boolean {
  return Object.values(media ?? {}).some((entry) => !!entry?.blobId && !entry.uri);
}

/**
 * The bytes of one blob media entry, through the photo cache's download queue.
 * `background` puts it behind the avatars and print (an export).
 */
export function loadContactMediaBlob(
  entry: Pick<ContactMedia, 'kind' | 'mediaType'> & { blobId: string },
  source: ContactMediaSource,
  options: { background?: boolean } = {},
): Promise<Blob | null> {
  const { client } = source;
  if (!client) return Promise.resolve(null);
  return loadContactPhotoBlob(
    contactPhotoKey(source.localAccountId, entry.blobId),
    () => client.fetchBlob(entry.blobId, entry.kind, entry.mediaType, source.accountId),
    { concurrency: contactPhotoConcurrency(client.getMaxConcurrentRequests?.()), background: options.background },
  );
}

/** `media` with each blob entry replaced by a data: URI from `uriOf`, or dropped/kept when it has none. */
async function withInlineBlobs(
  media: Record<string, ContactMedia>,
  uriOf: (entry: BlobMedia) => Promise<string | null>,
  onFailure: 'drop' | 'keep',
): Promise<Record<string, ContactMedia>> {
  const entries = await Promise.all(Object.entries(media).map(
    async ([key, entry]): Promise<[string, ContactMedia] | null> => {
      if (!entry?.blobId) return [key, entry];
      const { blobId, ...rest } = entry;
      if (entry.uri) return [key, rest];
      const uri = await uriOf({ ...entry, blobId });
      if (uri) return [key, { ...rest, uri }];
      return onFailure === 'keep' ? [key, entry] : null;
    },
  ));
  return Object.fromEntries(entries.filter((entry): entry is [string, ContactMedia] => entry !== null));
}

async function downloadAsDataUri(entry: BlobMedia, source: ContactMediaSource, background?: boolean): Promise<string | null> {
  const blob = await loadContactMediaBlob(entry, source, { background });
  return blob ? blobToDataUri(blob, entry.mediaType).catch(() => null) : null;
}

/**
 * `media` with every blob entry turned into a data: URI of its bytes. A vCard
 * carries the bytes themselves, and a copy of the card written elsewhere
 * (duplicate, move to another account) cannot count on the source card's
 * blobId resolving. An entry whose download fails is dropped, or with
 * `onFailure: 'keep'` sent on as it is.
 */
export async function inlineContactMedia(
  media: Record<string, ContactMedia> | undefined,
  source: ContactMediaSource,
  onFailure: 'drop' | 'keep',
): Promise<Record<string, ContactMedia> | undefined> {
  if (!media) return media;
  return withInlineBlobs(media, (entry) => downloadAsDataUri(entry, source), onFailure);
}

/**
 * The cards with their blob media turned into data: URIs, for a vCard export.
 *
 * The blobs of all cards of one account come through a few batched Blob/get
 * requests (getBlobsAsBase64). One download each through the photo queue
 * took minutes for a large address book on Stalwart 1.0, and held up the
 * avatars and print meanwhile. What the batch can't deliver (no blob
 * capability, a refused request) is downloaded one by one behind avatars and
 * print; a blob that can't be downloaded at all is left out of the export.
 */
export async function inlineContactMediaForExport(
  contacts: ContactCard[],
  clientFor: (localAccountId?: string) => IJMAPClient | null,
): Promise<ContactCard[]> {
  const sourceKey = (contact: ContactCard) => `${contact.localAccountId ?? ''}|${contact.accountId ?? ''}`;
  const groups = new Map<string, { source: ContactMediaSource; entries: Map<string, BlobMedia> }>();
  for (const contact of contacts) {
    if (!hasBlobMedia(contact.media)) continue;
    const key = sourceKey(contact);
    let group = groups.get(key);
    if (!group) {
      group = {
        source: { client: clientFor(contact.localAccountId), accountId: contact.accountId, localAccountId: contact.localAccountId },
        entries: new Map(),
      };
      groups.set(key, group);
    }
    for (const entry of Object.values(contact.media ?? {})) {
      if (entry?.blobId && !entry.uri) group.entries.set(entry.blobId, entry as BlobMedia);
    }
  }

  const uris = new Map<string, string>();
  for (const [key, { source, entries }] of groups) {
    const { client } = source;
    if (!client) continue;
    let oneByOne = [...entries.values()];
    const batch = await client.getBlobsAsBase64?.([...entries.keys()], source.accountId || client.getContactsAccountId())
      .catch((error: unknown) => {
        debug.warn('contacts', 'Batched download of contact media failed:', error);
        return null;
      });
    if (batch) {
      for (const [blobId, base64] of batch.data) {
        const entry = entries.get(blobId);
        if (entry) uris.set(`${key}|${blobId}`, `data:${entry.mediaType || 'application/octet-stream'};base64,${base64}`);
      }
      const failed = new Set(batch.failed);
      oneByOne = oneByOne.filter((entry) => failed.has(entry.blobId));
    }
    await Promise.all(oneByOne.map(async (entry) => {
      const uri = await downloadAsDataUri(entry, source, true);
      if (uri) uris.set(`${key}|${entry.blobId}`, uri);
    }));
  }

  return Promise.all(contacts.map(async (contact) => {
    if (!hasBlobMedia(contact.media)) return contact;
    const key = sourceKey(contact);
    const media = await withInlineBlobs(contact.media!, async (entry) => uris.get(`${key}|${entry.blobId}`) ?? null, 'drop');
    return { ...contact, media };
  }));
}

/**
 * The server refused a blobId inside `media`: invalidProperties naming
 * `media` or an entry below it. 0.16 answers so ("blobIds in media is not
 * supported.", properties `["media"]`); another server may name the entry.
 * 1.0's "The following blobIds do not exist or are not accessible" names no
 * property and is a different problem.
 */
export function isBlobMediaRejection(error: unknown): boolean {
  return jmapErrorType(error) === 'invalidProperties'
    && jmapErrorProperties(error).some((property) => property === 'media' || property.startsWith('media/'));
}

/**
 * Saves a card whose `media[photoKey]` is a photo the user just picked, as a
 * data: URI, through `write` (a ContactCard/set create or update).
 *
 * Where the account's cards carry blobs (supportsContactBlobMedia), the photo
 * is uploaded and sent as `{kind, blobId, mediaType}`. The upload goes into
 * the user's own account whichever account the card is written to: Stalwart
 * 1.0 resolves an uploaded blob only for members of the account it was
 * uploaded to, so one uploaded into the owner's account of a shared address
 * book would not resolve for a sharee, while the user's own always does.
 *
 * Otherwise, and when the upload fails, the data: URI goes out as it is. If
 * the server still refuses the blobId the way 0.16 does, the same write is
 * sent once more with the data: URI, and the account gets no more uploads for
 * the rest of the session.
 */
export async function writeContactWithNewPhoto<T>(
  client: IJMAPClient,
  accountId: string | undefined,
  card: Partial<ContactCard>,
  photoKey: string,
  write: (card: Partial<ContactCard>) => Promise<T>,
): Promise<T> {
  const photo = card.media?.[photoKey];
  const targetAccountId = accountId || client.getContactsAccountId();
  if (!photo?.uri || !client.supportsContactBlobMedia?.(targetAccountId)) return write(card);
  const bytes = dataUriToBlob(photo.uri, photo.mediaType);
  if (!bytes) return write(card);

  let blobId: string;
  try {
    const file = new File([bytes], 'photo', { type: bytes.type });
    ({ blobId } = await client.uploadBlob(file, client.getContactsAccountId()));
  } catch (error) {
    debug.warn('contacts', 'Contact photo upload failed, saving it inline:', error);
    return write(card);
  }

  const { uri: _uri, ...entry } = photo;
  const withBlob: ContactMedia = { ...entry, mediaType: photo.mediaType ?? bytes.type, blobId };
  try {
    return await write({ ...card, media: { ...card.media, [photoKey]: withBlob } });
  } catch (error) {
    if (!isBlobMediaRejection(error)) throw error;
    client.rejectContactBlobMedia?.(targetAccountId);
    return write(card);
  }
}
