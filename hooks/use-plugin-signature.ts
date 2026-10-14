import { useEffect, useMemo, useState } from 'react';
import type { Identity } from '@/lib/jmap/types';
import { identityHooks } from '@/lib/plugin-hooks';

interface RenderedSignature {
  identityId: string;
  source: string;
  html: string;
  text: string;
}

const sourceKey = (identity: Identity) => JSON.stringify([identity.htmlSignature ?? '', identity.textSignature ?? '']);

/**
 * The signature the composer inserts for `identity`, after plugins had their
 * say through onSignatureRender. Returns the identity unchanged while no
 * plugin listens, and until a plugin's result arrives; after that, a copy
 * with the plugin's htmlSignature and textSignature. Every place that builds
 * a signature (the initial body, the identity swap, drafts, the send path)
 * reads the identity this returns, so they all insert the same text. The HTML
 * goes through the composer's signature sanitizer like any other signature.
 *
 * `revision` changes each time a plugin result is applied, so the composer
 * can swap the signature already in the body.
 */
export function usePluginSignature(identity: Identity | null | undefined): {
  identity: Identity | null | undefined;
  revision: number;
} {
  const [rendered, setRendered] = useState<RenderedSignature | null>(null);
  const [revision, setRevision] = useState(0);
  const id = identity?.id;
  const source = identity ? sourceKey(identity) : '';

  useEffect(() => {
    if (!identity || !id || identityHooks.onSignatureRender.size === 0) return;
    let cancelled = false;
    const initial = { html: identity.htmlSignature ?? '', text: identity.textSignature ?? '' };
    void identityHooks.onSignatureRender.transform(initial, { identityId: id }).then((result: unknown) => {
      if (cancelled) return;
      const r = result as { html?: unknown; text?: unknown } | null;
      const html = typeof r?.html === 'string' ? r.html : initial.html;
      const text = typeof r?.text === 'string' ? r.text : initial.text;
      if (html === initial.html && text === initial.text) return;
      setRendered({ identityId: id, source, html, text });
      setRevision((n) => n + 1);
    });
    return () => { cancelled = true; };
    // Keyed to the identity and its signature text, not the object, which is
    // rebuilt on unrelated store updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, source]);

  const result = useMemo(() => {
    if (!identity || !rendered || rendered.identityId !== identity.id || rendered.source !== sourceKey(identity)) {
      return identity;
    }
    return { ...identity, htmlSignature: rendered.html, textSignature: rendered.text };
  }, [identity, rendered]);

  return { identity: result, revision };
}
