import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { FileBrowser } from '../file-browser';
import { useFileStore, type FileResource } from '@/stores/file-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { FileNode } from '@/lib/jmap/types';

vi.mock('@/lib/debug', () => ({ debug: { log: () => {}, warn: () => {}, error: () => {} } }));
vi.mock('@/components/settings/share-collection-dialog', () => ({
  ShareCollectionDialog: ({ collectionName, shareWith }: { collectionName: string; shareWith?: Record<string, unknown> | null }) => (
    <div data-testid="share-dialog">{collectionName}:{Object.keys(shareWith ?? {}).join(',')}</div>
  ),
}));

function node(id: string, name: string, parentId: string | null, extra: Partial<FileNode> = {}): FileNode {
  return {
    id,
    name,
    parentId,
    type: 'd',
    blobId: null,
    size: 0,
    created: '2026-10-01T00:00:00Z',
    modified: '2026-10-01T00:00:00Z',
    ...extra,
  };
}

function resource(n: FileNode): FileResource {
  return {
    id: n.id,
    name: n.name,
    serverName: n.name,
    isDirectory: n.blobId == null,
    contentType: n.blobId == null ? '' : n.type,
    contentLength: n.size,
    lastModified: n.modified ?? '',
    blobId: n.blobId,
    parentId: n.parentId,
    shareWith: n.shareWith,
    isShared: n.isShared,
    ownerName: n.accountName,
  } as FileResource;
}

const OWN: FileNode[] = [
  node('f-docs', 'Documents', null),
  node('f-notes', 'notes.txt', null, { blobId: 'b-notes', type: 'text/plain', size: 10 }),
];
const SHARED = node('e:f-team', 'Team', null, { isShared: true, accountId: 'e', accountName: 'userb@example.org' });

type Overrides = Partial<React.ComponentProps<typeof FileBrowser>>;

function renderBrowser(opts: { resources?: FileResource[]; allFolders?: FileResource[]; props?: Overrides } = {}) {
  const client = {
    listAllFileNodesAcrossAccounts: vi.fn(async () => [...OWN, SHARED]),
  } as unknown as IJMAPClient;
  act(() => {
    useFileStore.setState({
      client,
      sharedRoots: [],
      allFolders: opts.allFolders ?? OWN.filter((n) => n.blobId == null).map(resource),
      currentParentId: null,
      pathStack: [{ id: null, name: '' }],
    });
  });
  const handlers = {
    onNavigate: vi.fn(),
    onSetSelection: vi.fn(),
    onToggleSelect: vi.fn(),
    onPreviewFile: vi.fn(),
    onDownload: vi.fn(async () => {}),
    onRenameNode: vi.fn(async () => {}),
    onDeleteNode: vi.fn(async () => {}),
    onDownloadNode: vi.fn(async () => {}),
    onRevealNode: vi.fn(async () => {}),
    onRemoveRecent: vi.fn(),
  };
  const noop = vi.fn(async () => {});
  render(
    <FileBrowser
      currentPath="/"
      resources={opts.resources ?? OWN.map(resource)}
      isLoading={false}
      error={null}
      selectedResources={new Set()}
      uploadProgress={null}
      clipboard={null}
      onCreateFolder={noop}
      onUploadFiles={noop}
      onUploadFolder={noop}
      onCancelUpload={vi.fn()}
      onDelete={noop}
      onBatchDelete={noop}
      onRename={noop}
      onBatchDownload={noop}
      onRefresh={noop}
      onClearSelection={vi.fn()}
      onCut={vi.fn()}
      onCopy={vi.fn()}
      onPaste={noop}
      onMoveTo={noop}
      onPreviewImage={vi.fn()}
      onCreateTextFile={noop}
      onDuplicate={noop}
      getImageUrl={async () => ''}
      favorites={[]}
      recentFiles={[]}
      onToggleFavorite={vi.fn()}
      onOpenRecent={vi.fn()}
      client={client}
      ownAccountId="a"
      sharingEnabled
      onShare={noop}
      {...handlers}
      {...opts.props}
    />,
  );
  return handlers;
}

// Narrow panes (and jsdom) show the sidebar as a drawer; open it like a user would.
function tree() {
  const toggle = screen.queryByRole('button', { name: 'open_folder_tree' });
  if (toggle && toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return screen.getByRole('navigation', { name: 'folders' });
}

function list() {
  return screen.getByRole('grid', { name: 'file_list' });
}

describe('FileBrowser', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    act(() => { useFileStore.setState({ client: null, sharedRoots: [], allFolders: [] }); });
  });

  it('lists folders shared with the user at the root and in the sidebar (#1181)', async () => {
    const { onNavigate } = renderBrowser();
    await screen.findAllByText('Team');
    const section = screen.getByRole('region', { name: 'shared_with_me' });
    fireEvent.click(within(section).getByText('Team'));
    expect(onNavigate).toHaveBeenCalledWith('/Team', 'e:f-team');
    expect(within(tree()).getByText('Team')).toBeInTheDocument();
  });

  it('shows shared folders instead of the empty state when the own root is empty', async () => {
    renderBrowser({ resources: [], allFolders: [] });
    expect(await screen.findAllByText('Team')).not.toHaveLength(0);
    expect(screen.queryByText('empty_state_title')).toBeNull();
  });

  it('lists folders in the file list as well as the tree', () => {
    renderBrowser();
    expect(within(list()).getByText('Documents')).toBeInTheDocument();
    expect(within(tree()).getByText('Documents')).toBeInTheDocument();
  });

  it('opens a folder from its name and selects it from the row', () => {
    const { onNavigate, onSetSelection } = renderBrowser();
    const row = within(list()).getByText('Documents').closest('[role=row]')!;
    fireEvent.click(row);
    expect(onSetSelection).toHaveBeenCalledWith(new Set(['Documents']));
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.click(within(list()).getByText('Documents'));
    expect(onNavigate).toHaveBeenCalledWith('/Documents', 'f-docs');
  });

  it('previews a text file when its name is clicked', () => {
    const { onPreviewFile } = renderBrowser();
    fireEvent.click(within(list()).getByText('notes.txt'));
    expect(onPreviewFile).toHaveBeenCalledWith('notes.txt');
  });

  it('shares an own folder from the tree with its current shares', async () => {
    const shared = resource({ ...OWN[0], shareWith: { p1: { mayRead: true } } } as unknown as FileNode);
    // Browsing another folder: the tree's folder is not in the listing.
    renderBrowser({ resources: [resource(OWN[1])], allFolders: [shared] });

    fireEvent.contextMenu(within(tree()).getByText('Documents'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'share' }));

    expect(await screen.findByTestId('share-dialog')).toHaveTextContent('Documents:p1');
  });

  it('offers no share action on folders shared with the user', async () => {
    renderBrowser();
    await screen.findAllByText('Team');
    fireEvent.contextMenu(within(tree()).getByText('Team'));
    expect(screen.queryByRole('menuitem', { name: 'share' })).toBeNull();
  });

  it('hides dot files unless the setting shows them', () => {
    const hidden = resource(node('f-env', '.env', null, { blobId: 'b-env', type: 'text/plain', size: 1 }));
    renderBrowser({ resources: [...OWN.map(resource), hidden] });
    expect(within(list()).queryByText('.env')).toBeNull();
  });

  it('shows dot files when the setting is on', () => {
    localStorage.setItem('files-settings', JSON.stringify({ showHiddenFiles: true }));
    const hidden = resource(node('f-env', '.env', null, { blobId: 'b-env', type: 'text/plain', size: 1 }));
    renderBrowser({ resources: [...OWN.map(resource), hidden] });
    expect(within(list()).getByText('.env')).toBeInTheDocument();
  });

  it('starts in the default view and sort from the settings', () => {
    localStorage.setItem('files-settings', JSON.stringify({ defaultSortKey: 'name', defaultSortDir: 'desc' }));
    const files = ['a.txt', 'c.txt', 'b.txt'].map((n, i) => resource(node(`f${i}`, n, null, { blobId: `b${i}`, type: 'text/plain', size: 1 })));
    renderBrowser({ resources: files, allFolders: [] });
    const names = within(list()).getAllByRole('row').slice(1).map((r) => r.getAttribute('data-resource'));
    expect(names).toEqual(['c.txt', 'b.txt', 'a.txt']);
  });

  it('shows an empty state with upload and new folder in an empty folder', () => {
    renderBrowser({ resources: [], allFolders: [], props: { currentPath: '/Documents' } });
    expect(screen.getByText('empty_folder_title')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /upload_files/ }).length).toBeGreaterThan(0);
  });

  it('keeps a drag selection when the mouse is released', () => {
    const onClearSelection = vi.fn();
    const { onSetSelection } = renderBrowser({ props: { onClearSelection, selectedResources: new Set(['notes.txt']) } });
    const area = list().parentElement!;
    // jsdom lays everything out at 0,0, so a box from -5,-5 to 20,20 covers every row.
    fireEvent.mouseDown(area, { button: 0, clientX: -5, clientY: -5 });
    fireEvent.mouseMove(window, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(window, { clientX: 20, clientY: 20 });
    fireEvent.click(area);

    expect(onSetSelection).toHaveBeenLastCalledWith(new Set(['Documents', 'notes.txt']));
    // Only the press that started the drag cleared the old selection.
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('offers new and upload entries on My files in the sidebar', () => {
    renderBrowser();
    fireEvent.contextMenu(within(tree()).getByText('my_files'));
    for (const name of ['open', 'new_folder', 'new_text_file', 'upload_files', 'upload_folder']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
  });

  it('renames and deletes a folder from the tree', async () => {
    const { onRenameNode, onDeleteNode } = renderBrowser();
    fireEvent.contextMenu(within(tree()).getByText('Documents'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'rename' }));
    const input = await screen.findByDisplayValue('Documents');
    fireEvent.change(input, { target: { value: 'Docs' } });
    fireEvent.submit(input.closest('form')!);
    await vi.waitFor(() => expect(onRenameNode).toHaveBeenCalledWith('f-docs', 'Docs'));

    fireEvent.contextMenu(within(tree()).getByText('Documents'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }));
    expect(onDeleteNode).toHaveBeenCalledWith('f-docs', 'Documents');
  });

  it('offers no rename or delete on a folder shared with the user', async () => {
    renderBrowser();
    await screen.findAllByText('Team');
    fireEvent.contextMenu(within(tree()).getByText('Team'));
    expect(screen.getByRole('menuitem', { name: 'open' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'rename' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'delete' })).toBeNull();
  });

  it('shows, downloads and forgets a recent file from its menu', () => {
    const { onRevealNode, onDownloadNode, onRemoveRecent } = renderBrowser({
      props: { recentFiles: [{ name: 'notes.txt', id: 'f-notes', timestamp: 1 }] },
    });
    const open = (name: string) => {
      fireEvent.contextMenu(within(tree()).getByText('notes.txt'));
      fireEvent.click(screen.getByRole('menuitem', { name }));
    };
    open('show_in_folder');
    expect(onRevealNode).toHaveBeenCalledWith('f-notes');
    open('download');
    expect(onDownloadNode).toHaveBeenCalledWith('f-notes');
    open('remove_from_recent');
    expect(onRemoveRecent).toHaveBeenCalledWith('f-notes');
  });

  it('replaces the toolbar with selection actions when items are selected', () => {
    renderBrowser({ props: { selectedResources: new Set(['notes.txt']) } });
    const bar = screen.getByRole('toolbar', { name: 'selection_actions' });
    expect(within(bar).getByRole('button', { name: 'download' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'delete' })).toBeInTheDocument();
  });
});
