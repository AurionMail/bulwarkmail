import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Pro shell takes over the standard routes and hands their deep link to
// the tab it opens. A folder of a drive shared with the user is linked by id
// in the query (`/files?shared=<owner>:<id>`), so the query has to travel
// with the link: /pro has none left when the Files tab reads it.

const nav = vi.hoisted(() => ({ pathname: '/files', replace: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace }),
}));
vi.mock('@/hooks/use-media-query', () => ({ useIsDesktop: () => true }));
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: (selector: (s: { proInterface: boolean }) => unknown) => selector({ proInterface: true }),
}));
const { openTab } = vi.hoisted(() => ({ openTab: vi.fn() }));
vi.mock('@/stores/pro-tab-store', () => ({ useProTabStore: { getState: () => ({ openTab }) } }));
const { setPendingDeepLink } = vi.hoisted(() => ({ setPendingDeepLink: vi.fn() }));
vi.mock('@/lib/deep-link-handoff', () => ({ setPendingDeepLink }));

const { ProInterfaceRedirect } = await import('../pro-interface-redirect');

describe('ProInterfaceRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function visit(path: string, search: string) {
    nav.pathname = path;
    window.history.replaceState(null, '', `${path}${search}`);
    render(<ProInterfaceRedirect />);
  }

  it('hands a shared folder\'s link, which is only a query, to the Files tab', () => {
    visit('/files', '?shared=owner1%3Ad1');

    expect(openTab).toHaveBeenCalledWith('files');
    expect(setPendingDeepLink).toHaveBeenCalledWith('files', [], '?shared=owner1%3Ad1');
    expect(nav.replace).toHaveBeenCalledWith('/pro');
  });

  it('hands the query along with the path', () => {
    visit('/files/Docs', '?preview=a.txt');

    expect(setPendingDeepLink).toHaveBeenCalledWith('files', ['Docs'], '?preview=a.txt');
  });

  it('hands a path without a query as before, and parks nothing for a bare surface', () => {
    visit('/mail/message/m1', '');
    expect(setPendingDeepLink).toHaveBeenLastCalledWith('mail', ['message', 'm1'], undefined);

    setPendingDeepLink.mockClear();
    visit('/files', '');
    expect(setPendingDeepLink).not.toHaveBeenCalled();
    expect(openTab).toHaveBeenLastCalledWith('files');
  });
});
