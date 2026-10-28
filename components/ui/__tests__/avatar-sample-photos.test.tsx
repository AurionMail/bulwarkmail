import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { setNoThirdPartyTraffic } from '@/lib/third-party-mode';

// #903: the mock server's sample photos come from randomuser.me and
// img.freepik.com; none of them while third-party traffic is off.

vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ devMode: true }) }));

import { Avatar } from '../avatar';
import { avatarHooks } from '@/lib/plugin-hooks';

const PEOPLE = ['anna', 'ben', 'carla', 'dirk', 'eva', 'finn', 'greta', 'hans'].map((n) => `${n}@gmail.com`);

function sampleImages(): string[] {
  const { container, unmount } = render(
    <div>
      {PEOPLE.map((email) => <Avatar key={email} name={email} email={email} />)}
      <Avatar name="Alice" email="alice@example.com" />
    </div>,
  );
  const srcs = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
  unmount();
  return srcs.filter((src) => /randomuser\.me|img\.freepik\.com/.test(src));
}

afterEach(() => setNoThirdPartyTraffic(false));

describe('mock server sample photos', () => {
  it('show with third-party traffic allowed', () => {
    expect(sampleImages().length).toBeGreaterThan(0);
  });

  it('are left out with no third-party traffic', () => {
    setNoThirdPartyTraffic(true);
    expect(sampleImages()).toEqual([]);
  });
});

describe('plugin avatars (Gravatar and the like)', () => {
  afterEach(() => avatarHooks.onAvatarResolve.clear());

  async function renderWithGravatar() {
    avatarHooks.onAvatarResolve.register('gravatar', (async () => 'https://www.gravatar.com/avatar/abc?d=404') as never);
    const view = render(<Avatar name="Zoe" email="zoe@corp.example.net" />);
    await new Promise((r) => setTimeout(r, 20));
    return view;
  }

  it("show the plugin's outside URL with third-party traffic allowed", async () => {
    const { container } = await renderWithGravatar();
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toMatch(/gravatar\.com/));
  });

  it('fall back to initials with no third-party traffic', async () => {
    setNoThirdPartyTraffic(true);
    const { container } = await renderWithGravatar();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('ZO');
  });
});
