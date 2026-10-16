// #902: the phone conversation view (also used by Mountain View's expanded
// messages) rendered the raw message body and never asked the
// onRenderEmailBody hook, so a PGP message the plugin decrypts in the single
// reader stayed an armored block inside a thread.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const t = Object.assign((k: string) => k, { raw: (k: string) => k, rich: (k: string) => k });
vi.mock('next-intl', () => ({
  useTranslations: () => t,
  useLocale: () => 'en',
}));
vi.mock('@/hooks/use-wopi-status', () => ({ useWopiStatus: () => ({ enabled: false }), canWopiOpen: () => false }));
vi.mock('@/hooks/use-own-domain-address', () => ({ useOwnDomainAddress: () => () => false }));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/hooks/use-plugin-slot-offers', () => ({ usePluginSlotOffers: () => [] }));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

const { renderHooks, clearAllHooks } = await import('@/lib/plugin-hooks');
const { ThreadConversationView } = await import('@/components/email/thread-conversation-view');

const ARMORED = '-----BEGIN PGP MESSAGE-----\nhQEMA1234\n-----END PGP MESSAGE-----';

const pgpEmail = (id: string, receivedAt: string) => ({
  id, blobId: `blob-${id}`, threadId: 't1', mailboxIds: { inbox: true }, keywords: { $seen: false },
  from: [{ name: 'Alice', email: 'alice@example.com' }], to: [{ email: 'me@example.org' }],
  subject: 'Secret', receivedAt, size: 1, preview: '-----BEGIN PGP MESSAGE-----', hasAttachment: false,
  textBody: [{ partId: '1', type: 'text/plain' }], htmlBody: [{ partId: '1', type: 'text/plain' }], attachments: [],
  bodyValues: { '1': { value: ARMORED } },
});

const renderThread = () => {
  const newer = pgpEmail('new', '2026-10-02T10:00:00Z');
  const older = pgpEmail('old', '2026-10-01T10:00:00Z');
  return render(
    <ThreadConversationView
      thread={{ threadId: 't1', emails: [newer, older], latestEmail: newer } as never}
      emails={[newer, older] as never}
      onBack={() => {}}
    />,
  );
};

afterEach(() => clearAllHooks());

describe('conversation view runs the onRenderEmailBody hook', () => {
  it('shows the plain text a plugin decrypted for each unfolded message', async () => {
    const handler = vi.fn(async (_body: unknown, ctx: { id: string }) => ({
      html: '', text: `Decrypted ${ctx.id}`, attachments: [], handledBy: 'pgp',
    }));
    renderHooks.onRenderEmailBody.register('pgp', handler as never);

    renderThread();

    expect(await screen.findByText('Decrypted new')).toBeTruthy();
    expect(await screen.findByText('Decrypted old')).toBeTruthy();
    expect(screen.queryByText(/BEGIN PGP MESSAGE/)).toBeNull();
    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'new', blobId: 'blob-new' }),
    );
  }, 30_000);

  it('puts decrypted HTML into the sandboxed body frame, sanitized', async () => {
    renderHooks.onRenderEmailBody.register('pgp', (async () => ({
      html: '<p>Decrypted html body</p><script>alert(1)</script>', text: '', attachments: [], handledBy: 'pgp',
    })) as never);

    const { container } = renderThread();

    await waitFor(() => {
      const srcdocs = [...container.querySelectorAll('iframe')].map((f) => f.getAttribute('srcdoc') ?? '');
      expect(srcdocs).toHaveLength(2);
      for (const doc of srcdocs) {
        expect(doc).toContain('Decrypted html body');
        expect(doc).not.toContain('alert(1)');
      }
    });
  }, 30_000);

  it('keeps the original body when no plugin handles the message', async () => {
    renderHooks.onRenderEmailBody.register('pgp', (async (body: unknown) => body) as never);

    renderThread();
    await act(async () => {});

    expect(screen.getAllByText(/BEGIN PGP MESSAGE/).length).toBe(2);
  }, 30_000);

  it('decrypts again when a plugin asks for a re-render', async () => {
    let unlocked = false;
    renderHooks.onRenderEmailBody.register('pgp', (async () => (unlocked
      ? { html: '', text: 'Unlocked body', attachments: [], handledBy: 'pgp' }
      : { html: '', text: '', attachments: [] })) as never);

    renderThread();
    await act(async () => {});
    expect(screen.queryByText('Unlocked body')).toBeNull();

    unlocked = true;
    act(() => { window.dispatchEvent(new Event('plugin:rerender-email')); });
    expect((await screen.findAllByText('Unlocked body')).length).toBe(2);
  }, 30_000);
});
