import { toInertBlob } from '@/lib/file-preview';

/**
 * Downloads of contact photos that are blobs, and the object URLs they become.
 *
 * Stalwart 1.0 returns every embedded PHOTO as `media/<key>/blobId` without a
 * `uri`, so showing one takes an authenticated download. Those downloads
 * share the account's HTTP budget with JMAP calls: by default 4 requests at a
 * time and 1000 a minute, and a 429 makes the client refuse every request
 * until Retry-After has passed. The contacts list is not virtualised and mail
 * avatars look photos up by sender, so one screen can ask for dozens at once.
 * Hence:
 * - one download per `${localAccountId}|${blobId}`, shared by every caller;
 * - at most half the server's maxConcurrentRequests at a time, and after a
 *   first burst a paced start rate;
 * - avatars and print go first; downloads only an export asked for wait
 *   behind them and leave part of the burst to them;
 * - a queued download that no avatar on screen wants any more is dropped
 *   before it starts;
 * - a failed download is tried once more a little later, since the server
 *   refuses a request over the concurrency limit outright; after that the
 *   failure is remembered for a while instead of retried on every render;
 * - an LRU of object URLs, revoked on eviction and when the cache is cleared
 *   (account switch, logout).
 */

const MAX_ENTRIES = 300;
// Half of the 4 requests at a time Stalwart takes from a user, for a server
// that doesn't say.
const DEFAULT_CONCURRENCY = 2;
const BURST = 40;
const REFILL_PER_SECOND = 6;
// Export downloads only take a token while this many are left, so a long
// export never spends the burst that avatars coming on screen need.
const BACKGROUND_RESERVE = BURST / 2;
const RETRY_DELAY_MS = 1000;
const FAILURE_TTL_MS = 2 * 60_000;

/**
 * Resolves the photo's bytes, or null when there is nothing to ask right now
 * (no client for the card's login): that is neither retried nor remembered
 * as a failure.
 */
type Fetcher = () => Promise<Blob | null>;

export interface ContactPhotoDownloadOptions {
  /** Downloads allowed at once for this photo's server; see contactPhotoConcurrency. */
  concurrency?: number;
  /** Only an export wants it: it waits behind avatars and print. */
  background?: boolean;
}

interface Download {
  fetcher: Fetcher;
  /** Avatars on screen waiting for it. */
  viewers: number;
  /** Someone needs the bytes whether or not an avatar shows them (print, export, copy). */
  forced: boolean;
  /** Keep the result for display; a download only for export is not cached. */
  keep: boolean;
  background: boolean;
  concurrency: number;
  retried: boolean;
  waiters: Array<(blob: Blob | null) => void>;
}

const photos = new Map<string, { blob: Blob; url: string }>();
const failedUntil = new Map<string, number>();
const downloads = new Map<string, Download>();
const queue: string[] = [];
const backgroundQueue: string[] = [];
const listeners = new Set<() => void>();
let running = 0;
let tokens = BURST;
let refilledAt = 0;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
let pumpAt = 0;
// Bumped by clearContactPhotoCache, so a download that was running across a
// clear is not stored into the next account's cache.
let generation = 0;

/**
 * Photo downloads to run at once for a server that takes
 * `maxConcurrentRequests` requests from a user at a time (RFC 8620 core
 * capability): half of them, so JMAP calls keep the other half.
 */
export function contactPhotoConcurrency(maxConcurrentRequests: number | undefined): number {
  if (!maxConcurrentRequests || maxConcurrentRequests < 0) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.floor(maxConcurrentRequests / 2));
}

export function contactPhotoKey(localAccountId: string | undefined, blobId: string): string {
  return `${localAccountId ?? ''}|${blobId}`;
}

/** The object URL of a downloaded photo, if it is cached. */
export function peekContactPhoto(key: string): string | undefined {
  return photos.get(key)?.url;
}

/** Called whenever a photo is added, evicted or the cache is cleared. */
export function subscribeContactPhotos(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function touch(key: string): { blob: Blob; url: string } | undefined {
  const entry = photos.get(key);
  if (entry) {
    photos.delete(key);
    photos.set(key, entry);
  }
  return entry;
}

function recentlyFailed(key: string): boolean {
  const until = failedUntil.get(key);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  failedUntil.delete(key);
  return false;
}

function enqueue(key: string, fetcher: Fetcher, options: ContactPhotoDownloadOptions): Download {
  let download = downloads.get(key);
  if (!download) {
    download = {
      fetcher,
      viewers: 0,
      forced: false,
      keep: false,
      background: !!options.background,
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      retried: false,
      waiters: [],
    };
    downloads.set(key, download);
    (download.background ? backgroundQueue : queue).push(key);
  } else if (download.background && !options.background) {
    // An avatar or print now wants what only an export asked for.
    download.background = false;
    const at = backgroundQueue.indexOf(key);
    if (at >= 0) {
      backgroundQueue.splice(at, 1);
      queue.push(key);
    }
  }
  return download;
}

/**
 * Asks for a photo on behalf of an avatar on screen. Once downloaded it is in
 * the cache (peekContactPhoto) and subscribers are told. Call the returned
 * function when the avatar unmounts or scrolls away.
 */
export function requestContactPhoto(
  key: string,
  fetcher: Fetcher,
  options: Pick<ContactPhotoDownloadOptions, 'concurrency'> = {},
): () => void {
  if (touch(key) || recentlyFailed(key)) return () => {};
  const download = enqueue(key, fetcher, options);
  download.viewers++;
  download.keep = true;
  pump();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    download.viewers--;
  };
}

/**
 * The bytes of a photo for print, export or copying a card, from the cache
 * when it has them. Resolves null when the download fails.
 */
export function loadContactPhotoBlob(
  key: string,
  fetcher: Fetcher,
  options: ContactPhotoDownloadOptions = {},
): Promise<Blob | null> {
  const cached = touch(key);
  if (cached) return Promise.resolve(cached.blob);
  if (recentlyFailed(key)) return Promise.resolve(null);
  const download = enqueue(key, fetcher, options);
  download.forced = true;
  const result = new Promise<Blob | null>((resolve) => download.waiters.push(resolve));
  pump();
  return result;
}

function refill(): void {
  const now = Date.now();
  tokens = Math.min(BURST, tokens + (Math.max(0, now - refilledAt) / 1000) * REFILL_PER_SECOND);
  refilledAt = now;
}

function schedulePump(delayMs: number): void {
  const at = Date.now() + delayMs;
  // A foreground download waits for the next token, not for the later one a
  // background download was scheduled for.
  if (pumpTimer && pumpAt <= at) return;
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpAt = at;
  pumpTimer = setTimeout(() => {
    pumpTimer = null;
    pump();
  }, delayMs);
}

function pump(): void {
  for (;;) {
    const from = queue.length > 0 ? queue : backgroundQueue.length > 0 ? backgroundQueue : null;
    if (!from) return;
    const key = from[0];
    const download = downloads.get(key);
    if (!download || (!download.forced && download.viewers <= 0)) {
      // Scrolled away or unmounted before its turn came.
      from.shift();
      downloads.delete(key);
      continue;
    }
    if (running >= download.concurrency) return;
    const reserve = from === backgroundQueue ? BACKGROUND_RESERVE : 0;
    refill();
    if (tokens < 1 + reserve) {
      schedulePump(Math.ceil(((1 + reserve - tokens) / REFILL_PER_SECOND) * 1000));
      return;
    }
    tokens -= 1;
    from.shift();
    start(key, download);
  }
}

function start(key: string, download: Download): void {
  running++;
  const startedIn = generation;
  let fetched: Promise<Blob | null>;
  try {
    fetched = download.fetcher();
  } catch (error) {
    fetched = Promise.reject(error);
  }
  fetched.then(
    (blob) => finish(key, download, startedIn, blob, false),
    () => finish(key, download, startedIn, null, true),
  );
}

function finish(key: string, download: Download, startedIn: number, blob: Blob | null, failed: boolean): void {
  // A download from before a clear no longer counts against the new account.
  if (startedIn === generation) running--;
  if (failed && !download.retried && startedIn === generation) {
    download.retried = true;
    setTimeout(() => {
      if (downloads.get(key) !== download) return;
      (download.background ? backgroundQueue : queue).push(key);
      pump();
    }, RETRY_DELAY_MS);
    pump();
    return;
  }
  if (startedIn === generation) {
    downloads.delete(key);
    if (failed) failedUntil.set(key, Date.now() + FAILURE_TTL_MS);
    else if (blob && download.keep) remember(key, blob);
  }
  for (const resolve of download.waiters) resolve(blob);
  pump();
}

function remember(key: string, blob: Blob): void {
  // The download echoes the card's mediaType as the Blob type; an SVG photo
  // must not become a blob: URL that runs script as our origin when opened.
  photos.set(key, { blob, url: URL.createObjectURL(toInertBlob(blob)) });
  while (photos.size > MAX_ENTRIES) {
    const oldest = photos.keys().next().value as string;
    URL.revokeObjectURL(photos.get(oldest)!.url);
    photos.delete(oldest);
  }
  notify();
}

/** Revokes every cached photo and forgets queued downloads (account switch, logout). */
export function clearContactPhotoCache(): void {
  generation++;
  for (const { url } of photos.values()) URL.revokeObjectURL(url);
  photos.clear();
  failedUntil.clear();
  // Queued, running or waiting to retry: print and export stop waiting.
  for (const download of downloads.values()) {
    for (const resolve of download.waiters) resolve(null);
  }
  queue.length = 0;
  backgroundQueue.length = 0;
  downloads.clear();
  // The limits are per account, and a clear means another account.
  running = 0;
  tokens = BURST;
  refilledAt = 0;
  if (pumpTimer) {
    clearTimeout(pumpTimer);
    pumpTimer = null;
  }
  notify();
}
