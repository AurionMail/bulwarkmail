import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewModal } from '../file-preview-modal';

vi.mock('@/lib/standalone-display', () => ({ canOpenUrlInNewWindow: () => false }));

// Modeled history, NOT native-browser verification. jsdom pushState cancels
// queued traversals, masking the race under investigation. This model lets
// back() complete asynchronously after another push, without any mail server.
const originalState = {
  __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['mail'],
  bulwarkNavigation: { threadId: 'conversation' },
};
let entries: Record<string, unknown>[];
let position: number;
let push: ReturnType<typeof vi.spyOn>;
let back: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  entries = [structuredClone(originalState)];
  position = 0;
  vi.spyOn(window.history, 'state', 'get').mockImplementation(() => entries[position]);
  push = vi.spyOn(window.history, 'pushState').mockImplementation(state => {
    entries.splice(position + 1);
    entries.push(structuredClone(state));
    position++;
  });
  back = vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.setTimeout(() => {
      if (position === 0) return;
      position--;
      window.dispatchEvent(new PopStateEvent('popstate', { state: entries[position] }));
    }, 10);
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  await act(async () => { await vi.runAllTimersAsync(); });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

function openPreview(strict = false, getFileContent = vi.fn(() => new Promise<{ blob: Blob; contentType: string }>(() => {})), name = "attached.eml") {
  const onClose = vi.fn();
  const onDownload = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    return <>
      <button onClick={() => setOpen(true)}>Open preview</button>
      {open && <FilePreviewModal name={name} getFileContent={getFileContent}
        onDownload={onDownload} onClose={() => { onClose(); setOpen(false); }} />}
    </>;
  }
  const view = render(strict ? <StrictMode><Host /></StrictMode> : <Host />);
  return { ...view, onClose, onDownload, getFileContent };
}

function clickClose() {
  const header = screen.getByRole('dialog').querySelector('h3')!.parentElement!;
  const buttons = within(header).getAllByRole('button');
  fireEvent.click(buttons[buttons.length - 1]);
}

describe('FilePreviewModal history lifecycle (modeled queued traversal)', () => {
  it('keeps a Strict Mode preview open through effect replay and permits Download', async () => {
    const { onClose, onDownload } = openPreview(true);
    await advance(30);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    const header = screen.getByRole('dialog').querySelector('h3')!.parentElement!;
    fireEvent.click(within(header).getAllByRole('button')[0]);
    expect(onDownload).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('preserves existing history fields and restores them on explicit Close', async () => {
    const { onClose } = openPreview();
    await advance(0);
    expect(window.history.state).toMatchObject(originalState);
    expect(window.history.state.__filePreview).toBeTruthy();
    clickClose();
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    await advance(10);
    expect(back).toHaveBeenCalledOnce();
    expect(position).toBe(0);
    expect(window.history.state).toEqual(originalState);
  });

  it.each([false, true])('Browser Back closes once without issuing another back (strict=%s)', async strict => {
    const { onClose } = openPreview(strict);
    await advance(0);
    window.history.back();
    await advance(10);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(back).toHaveBeenCalledOnce();
    expect(window.history.state).toEqual(originalState);
  });

  it('can reopen after Browser Back and close normally', async () => {
    const { onClose } = openPreview(true);
    await advance(0);
    window.history.back();
    await advance(10);
    fireEvent.click(screen.getByText('Open preview'));
    await advance(30);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();
    clickClose();
    await advance(10);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(position).toBe(0);
  });

  it('does not change history if unmounted before deferred setup', async () => {
    const { unmount, onClose } = openPreview(true);
    unmount();
    await advance(30);
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(window.history.state).toEqual(originalState);
  });

  it('waits for an old Close traversal before registering a reopened preview', async () => {
    const { onClose } = openPreview(true);
    await advance(0);
    clickClose();
    fireEvent.click(screen.getByText('Open preview'));
    await advance(0);
    expect(push).toHaveBeenCalledTimes(1);
    await advance(30);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledTimes(2);
    expect(window.history.state).toMatchObject(originalState);
    window.history.back();
    await advance(10);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(position).toBe(0);
  });

  it('cancels a reopened preview while the preceding traversal is pending', async () => {
    const { onClose } = openPreview();
    await advance(0);
    clickClose();
    fireEvent.click(screen.getByText('Open preview'));
    await advance(0);
    fireEvent.keyDown(window, { key: 'Escape' });
    await advance(30);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
    expect(window.history.state).toEqual(originalState);
  });

  it('does not pop another history entry added above the preview', async () => {
    openPreview();
    await advance(0);
    const otherState = { ...originalState, elsewhere: true };
    window.history.pushState(otherState, '');
    clickClose();
    await advance(30);
    expect(back).not.toHaveBeenCalled();
    expect(window.history.state).toEqual(otherState);
  });

  it('retains object-URL cleanup after a successfully loaded Strict Mode preview', async () => {
    const getContent = vi.fn().mockResolvedValue({
      blob: new Blob(['png'], { type: 'image/png' }), contentType: 'image/png',
    });
    openPreview(true, getContent, 'photo.png');
    await advance(0);
    expect(screen.getByAltText('photo.png')).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    clickClose();
    await advance(10);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:preview');
  });

  it('ignores a content response arriving after the preview was closed', async () => {
    let finish!: (value: { blob: Blob; contentType: string }) => void;
    const getContent = vi.fn(() => new Promise<{ blob: Blob; contentType: string }>(resolve => { finish = resolve; }));
    const { onClose } = openPreview(false, getContent);
    await advance(0);
    clickClose();
    await act(async () => { finish({ blob: new Blob(['png'], { type: 'image/png' }), contentType: 'image/png' }); });
    await advance(10);
    expect(onClose).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
