import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const push = vi.hoisted(() => vi.fn());
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));

import { PluginPageNavigator } from '../plugin-page-navigator';
import { requestPageNavigation, resetPageNavigation } from '@/lib/plugin-sandbox/page-navigation';
import { resetPages, setPluginPages } from '@/lib/plugin-sandbox/pages';

afterEach(() => {
  push.mockReset();
  resetPages();
  resetPageNavigation();
});

describe('PluginPageNavigator', () => {
  it('moves the tab while it is mounted, and no longer after', () => {
    setPluginPages('p1', 'Plugin One', [{ id: 'files', title: 'Files' }]);
    const { unmount } = render(<PluginPageNavigator />);

    expect(requestPageNavigation('p1', 'files', 'docs/a')).toBe(true);
    expect(push).toHaveBeenCalledWith('/apps/p1/files/docs/a');

    unmount();
    expect(requestPageNavigation('p1', 'files', 'docs/a')).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
