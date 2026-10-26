/**
 * base64 data: URIs, as contact photos carry them.
 *
 * Stalwart writes three shapes: `data:<type>;base64,…`, `data:;base64,…`
 * (0.16.x) and `data:base64,…` (0.16.0, no parameter separator). The last two
 * carry no media type, so it comes from the card's `mediaType` when known.
 */

/** The media type (if any) and base64 payload of a base64 data: URI. */
export function parseBase64DataUri(uri: string): { type?: string; data: string } | null {
  if (!uri.toLowerCase().startsWith('data:')) return null;
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const header = uri.slice(5, comma).split(';');
  if (header[header.length - 1].trim().toLowerCase() !== 'base64') return null;
  const type = header.length > 1 ? header[0].trim() : '';
  return { type: type || undefined, data: uri.slice(comma + 1) };
}

/** The bytes of a base64 data: URI; `fallbackType` applies when the URI names none. */
export function dataUriToBlob(uri: string, fallbackType?: string): Blob | null {
  const parsed = parseBase64DataUri(uri);
  if (!parsed) return null;
  let binary: string;
  try {
    binary = atob(parsed.data);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: parsed.type || fallbackType || 'application/octet-stream' });
}

/** A base64 data: URI of the blob, labelled `mediaType` when given, else the blob's own type. */
export function blobToDataUri(blob: Blob, mediaType?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const data = result.slice(result.indexOf(',') + 1);
      resolve(`data:${mediaType || blob.type || 'application/octet-stream'};base64,${data}`);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read-failed'));
    reader.readAsDataURL(blob);
  });
}
