import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileHit } from '../types';
import type { FileNode } from '@/lib/jmap/types';
import { subscribePendingDeepLink } from '@/lib/deep-link-handoff';
import { parseFilesPath } from '@/lib/deep-links';

// An own folder found by search while Files shows a folder of a drive shared
// with the user: the real handoff, and a listener that reads the link the way
// FilesApp does (components/files/files-app.tsx) - from the address bar when
// the link comes without a query.

function storeHook(state: object) {
  const hook = (selector?: (s: object) => unknown) => (typeof selector === 'function' ? selector(state) : state);
  hook.getState = () => state;
  hook.setState = (patch: object) => Object.assign(state, patch);
  hook.subscribe = () => () => {};
  return hook;
}
const authState = { activeAccountId: 'login-a', getClientForAccount: () => undefined, switchAccount: vi.fn() };
const tabState = { openTab: vi.fn(), openEmailTab: vi.fn() };
vi.mock('@/stores/auth-store', () => ({ useAuthStore: storeHook(authState) }));
vi.mock('@/stores/file-store', () => ({ useFileStore: storeHook({ currentAccountId: 'login-a', initClient: vi.fn() }) }));
vi.mock('@/stores/pro-tab-store', () => ({ useProTabStore: storeHook(tabState) }));

const { openHit } = await import('../open-hit');

const T = '2026-09-01T08:00:00Z';
const ownFolderHit: FileHit = {
  kind: 'files', localAccountId: 'login-a', jmapAccountId: 'me', id: 'd7', accountLabel: 'A', title: 'Docs', subtitle: '/',
  date: T, source: 'remote', folderPath: '/', isFolder: true,
  node: { id: 'd7', name: 'Docs', parentId: null, type: '', blobId: null, size: 0, created: T, modified: T } as FileNode,
};

function listenLikeFilesApp(opened: string[]) {
  return subscribePendingDeepLink('files', (segments, search) => {
    const link = parseFilesPath(segments, new URLSearchParams(search ?? window.location.search));
    if (!link) return;
    opened.push(link.shared ? `shared ${link.shared}` : `path ${link.path}`);
  });
}

describe('an own folder opened from search while Files shows a shared folder', () => {
  let unsubscribe: (() => void) | undefined;
  afterEach(() => unsubscribe?.());

  it('opens the own folder in the standard layout', async () => {
    window.history.replaceState(null, '', '/files?shared=owner1%3Ad1');
    const opened: string[] = [];
    unsubscribe = listenLikeFilesApp(opened);
    const navigate = vi.fn();

    await openHit(ownFolderHit, { proShell: false, navigate });

    expect(navigate).not.toHaveBeenCalled();
    expect(opened).toEqual(['path /Docs']);
  });

  it('opens the own folder in the Pro shell', async () => {
    window.history.replaceState(null, '', '/files?shared=owner1%3Ad1');
    const opened: string[] = [];
    unsubscribe = listenLikeFilesApp(opened);

    await openHit(ownFolderHit, { proShell: true });

    expect(tabState.openTab).toHaveBeenCalledWith('files');
    expect(opened).toEqual(['path /Docs']);
  });
});
