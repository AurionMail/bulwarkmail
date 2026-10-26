import { describe, it, expect } from 'vitest';
import { blobToDataUri, dataUriToBlob, parseBase64DataUri } from '../data-uri';

describe('parseBase64DataUri', () => {
  it('reads the three shapes Stalwart writes', () => {
    expect(parseBase64DataUri('data:image/jpeg;base64,/9j/')).toEqual({ type: 'image/jpeg', data: '/9j/' });
    expect(parseBase64DataUri('data:;base64,/9j/')).toEqual({ type: undefined, data: '/9j/' });
    expect(parseBase64DataUri('data:base64,/9j/')).toEqual({ type: undefined, data: '/9j/' });
    expect(parseBase64DataUri('data:image/png;charset=x;base64,iVBO')).toEqual({ type: 'image/png', data: 'iVBO' });
  });

  it('refuses what is not a base64 data: URI', () => {
    expect(parseBase64DataUri('https://x.test/p.jpg')).toBeNull();
    expect(parseBase64DataUri('data:image/svg+xml,<svg/>')).toBeNull();
    expect(parseBase64DataUri('data:image/jpeg;base64')).toBeNull();
  });
});

describe('dataUriToBlob / blobToDataUri', () => {
  it('round-trips the bytes', async () => {
    const blob = dataUriToBlob('data:;base64,/9j/4AAQ', 'image/jpeg')!;
    expect(blob.type).toBe('image/jpeg');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(await blobToDataUri(blob)).toBe('data:image/jpeg;base64,/9j/4AAQ');
    expect(await blobToDataUri(blob, 'image/png')).toBe('data:image/png;base64,/9j/4AAQ');
  });

  it('gives up on broken base64', () => {
    expect(dataUriToBlob('data:image/jpeg;base64,***')).toBeNull();
  });
});
