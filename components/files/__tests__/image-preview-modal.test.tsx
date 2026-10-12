import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ImagePreviewModal } from '../image-preview-modal';

async function renderViewer() {
  const onClose = vi.fn();
  render(
    <ImagePreviewModal
      name="photo.jpg"
      onClose={onClose}
      onDownload={async () => {}}
      getImageUrl={async () => 'data:image/png;base64,AAAA'}
    />,
  );
  const img = await screen.findByAltText('photo.jpg');
  return { onClose, img, box: img.parentElement! };
}

function tap(el: Element, x = 10, y = 10) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: x, clientY: y, pointerType: 'mouse' });
  fireEvent.pointerUp(el, { pointerId: 1, button: 0, clientX: x, clientY: y, pointerType: 'mouse' });
}

describe('ImagePreviewModal', () => {
  it('closes when the area around the image is clicked', async () => {
    const { onClose, box } = await renderViewer();
    tap(box);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when the image itself is clicked', async () => {
    const { onClose, img } = await renderViewer();
    tap(img);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close after a drag that starts beside the image', async () => {
    const { onClose, box } = await renderViewer();
    fireEvent.pointerDown(box, { pointerId: 1, button: 0, clientX: 10, clientY: 10, pointerType: 'mouse' });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 80, clientY: 60, pointerType: 'mouse' });
    fireEvent.pointerUp(box, { pointerId: 1, button: 0, clientX: 80, clientY: 60, pointerType: 'mouse' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('zooms with the buttons and resets to fit', async () => {
    const { img } = await renderViewer();
    fireEvent.click(screen.getByRole('button', { name: 'zoom_in' }));
    expect(img.style.transform).toContain('scale(1.5)');
    act(() => { fireEvent.keyDown(window, { key: '0' }); });
    expect(img.style.transform).toContain('scale(1)');
  });

  it('closes on Escape', async () => {
    const { onClose } = await renderViewer();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
