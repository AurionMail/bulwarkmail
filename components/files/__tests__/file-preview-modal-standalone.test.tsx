import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { FilePreviewModal } from '../file-preview-modal';

// In an installed app (PWA) "open in new tab" hands the blob: URL to the
// system browser, which cannot load it: the button opened a blank window
// (#865). It must not be offered there; the in-app preview and download stay.

function mockDisplayMode(mode: string) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === `(display-mode: ${mode})`,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })));
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPng() {
  render(
    <FilePreviewModal
      name="photo.png"
      onClose={() => {}}
      onDownload={() => {}}
      getFileContent={async () => ({ blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), contentType: 'image/png' })}
    />,
  );
}

describe('FilePreviewModal open in new tab', () => {
  it('is offered in a browser tab', async () => {
    mockDisplayMode('browser');
    renderPng();
    await screen.findByAltText('photo.png');
    expect(screen.getByLabelText('open_in_new_tab')).toBeTruthy();
  });

  it('is not offered in an installed app, where the image still previews in-app', async () => {
    mockDisplayMode('standalone');
    renderPng();
    expect((await screen.findByAltText('photo.png')).getAttribute('src')).toBe('blob:test');
    expect(screen.queryByLabelText('open_in_new_tab')).toBeNull();
  });
});
