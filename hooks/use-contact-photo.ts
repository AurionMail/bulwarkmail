"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { IJMAPClient } from "@/lib/jmap/client-interface";
import { useAuthStore } from "@/stores/auth-store";
import { getClientByLocalAccountId } from "@/stores/client-registry";
import type { ContactPhotoRef } from "@/stores/contact-store";
import {
  contactPhotoKey,
  peekContactPhoto,
  requestContactPhoto,
  subscribeContactPhotos,
} from "@/lib/contact-photo-cache";

/** The client that downloads blobs of a card from the given login (multi-account mode), else the active one. */
export function getContactPhotoClient(localAccountId?: string): IJMAPClient | null {
  const active = useAuthStore.getState().client;
  return (localAccountId ? getClientByLocalAccountId(localAccountId) : undefined) ?? active;
}

const visibilityCallbacks = new Map<Element, (visible: boolean) => void>();
let sharedObserver: IntersectionObserver | null = null;

/** Reports whether the element is on or near the screen; one observer serves every avatar. */
function observeVisibility(element: Element, onChange: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onChange(true);
    return () => {};
  }
  sharedObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) visibilityCallbacks.get(entry.target)?.(entry.isIntersecting);
  }, { rootMargin: "200px" });
  visibilityCallbacks.set(element, onChange);
  sharedObserver.observe(element);
  return () => {
    visibilityCallbacks.delete(element);
    sharedObserver?.unobserve(element);
  };
}

/**
 * The src to show for a contact photo. A URI is used as it is. A blob is
 * downloaded through the photo cache once the element passed to `observe` is
 * on screen, since the contacts list renders every row; until then, and if
 * the download fails, `src` is undefined.
 */
export function useContactPhotoSrc(photo: ContactPhotoRef | null | undefined): {
  src: string | undefined;
  observe: (element: Element | null) => void;
} {
  const blob = photo && "blobId" in photo ? photo : undefined;
  const key = blob ? contactPhotoKey(blob.localAccountId, blob.blobId) : undefined;
  const blobUrl = useSyncExternalStore(
    subscribeContactPhotos,
    () => (key ? peekContactPhoto(key) : undefined),
    () => undefined,
  );
  const [element, setElement] = useState<Element | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!key || !element) return;
    return observeVisibility(element, setVisible);
  }, [key, element]);

  const blobId = blob?.blobId;
  const mediaType = blob?.mediaType;
  const accountId = blob?.accountId;
  const localAccountId = blob?.localAccountId;
  useEffect(() => {
    if (!key || !blobId || !visible) return;
    // Also re-runs when the cached copy goes (evicted, cache cleared) while
    // the avatar is still on screen.
    return requestContactPhoto(key, async () => {
      const client = getContactPhotoClient(localAccountId);
      if (!client) throw new Error("Not connected");
      return client.fetchBlob(blobId, "photo", mediaType, accountId);
    });
  }, [key, blobId, mediaType, accountId, localAccountId, visible, blobUrl]);

  return { src: photo && "uri" in photo ? photo.uri : blobUrl, observe: setElement };
}
