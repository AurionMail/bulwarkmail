"use client";

import { useEffect, useState } from "react";
import type { Email } from "@/lib/jmap/types";
import { renderHooks } from "@/lib/plugin-hooks";
import { toInertBlob } from "@/lib/file-preview";
import { debug } from "@/lib/debug";

export interface PluginRenderedBody {
  /** HTML a crypto plugin (PGP, S/MIME) rendered for the message, unsanitized. */
  html: string | null;
  /** Plain text the plugin rendered, when it gave no HTML. */
  text: string | null;
  /** blob: URLs for the decrypted inline parts, keyed by Content-ID without brackets. */
  cidUrls: Record<string, string>;
}

const EMPTY: PluginRenderedBody = { html: null, text: null, cidUrls: {} };

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  try {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const meta = dataUrl.slice(0, comma);
    const data = dataUrl.slice(comma + 1);
    if (meta.includes(';base64')) {
      const bin = atob(data);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8;
    }
    return new TextEncoder().encode(decodeURIComponent(data));
  } catch {
    return null;
  }
}

/**
 * Asks the onRenderEmailBody hook for a replacement body, the way the single
 * reader does, so a message a PGP or S/MIME plugin decrypts also shows
 * decrypted inside a conversation (#902). Re-runs when a plugin calls
 * api.ui.rerenderEmail, e.g. after the user unlocked a key.
 */
export function usePluginRenderedBody(email: Email): PluginRenderedBody {
  const [body, setBody] = useState<PluginRenderedBody>(EMPTY);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const bump = () => setNonce((n) => n + 1);
    window.addEventListener('plugin:rerender-email', bump);
    return () => window.removeEventListener('plugin:rerender-email', bump);
  }, []);

  useEffect(() => {
    if (renderHooks.onRenderEmailBody.size === 0) {
      setBody(EMPTY);
      return;
    }
    let cancelled = false;
    const objectUrls: string[] = [];

    (async () => {
      try {
        const rawContentType = email.headers?.['content-type'] || email.headers?.['Content-Type'];
        const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
        const result = await renderHooks.onRenderEmailBody.transform(
          { html: '', text: '', attachments: [] as unknown[] },
          {
            id: email.id,
            contentType,
            bodyStructure: email.bodyStructure,
            bodyValues: email.bodyValues,
            attachments: email.attachments,
            blobId: email.blobId,
            from: email.from,
          },
        ) as {
          html?: string;
          text?: string;
          attachments?: Array<{ name?: string; type?: string; dataUrl?: string; cid?: string }>;
          handledBy?: string;
        };
        if (cancelled) return;
        if (!result || !result.handledBy) {
          setBody(EMPTY);
          return;
        }
        const cidUrls: Record<string, string> = {};
        for (const att of Array.isArray(result.attachments) ? result.attachments : []) {
          if (!att.cid || !att.dataUrl) continue;
          const bytes = dataUrlToBytes(att.dataUrl);
          if (!bytes) continue;
          // Same re-typing as fetched cid parts before they get a blob: URL
          // in our origin (GHSA-xvjh-v9c6-qcvc).
          const url = URL.createObjectURL(toInertBlob(new Blob([bytes as BlobPart], { type: att.type || 'application/octet-stream' })));
          objectUrls.push(url);
          cidUrls[att.cid.replace(/^<|>$/g, '')] = url;
        }
        setBody({
          html: typeof result.html === 'string' && result.html ? result.html : null,
          text: typeof result.text === 'string' && result.text ? result.text : null,
          cidUrls,
        });
      } catch (err) {
        if (cancelled) return;
        debug.error('onRenderEmailBody hook failed:', err);
        setBody(EMPTY);
      }
    })();

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [email, nonce]);

  return body;
}
