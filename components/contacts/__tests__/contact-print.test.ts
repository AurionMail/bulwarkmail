import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contactSheetSections, printContact, resolveContactsPrint, type ContactsPrintState } from '../contact-print';
import { useAuthStore } from '@/stores/auth-store';
import { usePrintStore } from '@/stores/print-store';
import { clearContactPhotoCache } from '@/lib/contact-photo-cache';
import type { ContactCard } from '@/lib/jmap/types';
import type { DirectoryEntry } from '@/stores/contact-store';

const base: ContactCard = {
  id: 'c1',
  addressBookIds: {},
  accountId: 'a',
  name: { full: 'Ann Lee' },
};

describe('printContact', () => {
  const fetchBlob = vi.fn();
  let print: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearContactPhotoCache();
    fetchBlob.mockReset();
    print = vi.spyOn(window, 'print').mockImplementation(() => {});
    useAuthStore.setState({ client: { fetchBlob } as never });
  });

  afterEach(() => {
    useAuthStore.setState({ client: null });
    usePrintStore.setState({ printing: false, target: null });
    clearContactPhotoCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const printed = () => usePrintStore.getState().target;

  it('prints a Stalwart 1.0 photo inline as a data: URI', async () => {
    fetchBlob.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));

    await printContact({ ...base, media: { photo: { kind: 'photo', blobId: 'dbcX', mediaType: 'image/jpeg' } } });

    expect(fetchBlob).toHaveBeenCalledWith('dbcX', 'photo', 'image/jpeg', 'a');
    expect(printed()).toMatchObject({ kind: 'contact', photoUri: 'data:image/jpeg;base64,/9j/' });
    expect(print).toHaveBeenCalledOnce();
  });

  it('prints a Stalwart 0.16 photo as it is', async () => {
    await printContact({ ...base, media: { photo: { kind: 'photo', uri: 'data:base64,/9j/' } } });

    expect(fetchBlob).not.toHaveBeenCalled();
    expect(printed()).toMatchObject({ kind: 'contact', photoUri: 'data:image/jpeg;base64,/9j/' });
  });

  it('prints without the photo when it cannot be downloaded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fetchBlob.mockRejectedValue(new Error('Failed to fetch blob: 404'));

    const done = printContact({ ...base, media: { photo: { kind: 'photo', blobId: 'dbcGone' } } });
    await vi.advanceTimersByTimeAsync(1000);
    await done;

    expect(printed()).toMatchObject({ kind: 'contact', photoUri: undefined });
    expect(print).toHaveBeenCalledOnce();
  });
});

describe('contactSheetSections', () => {
  const en = (key: string) => key;

  it('prints the headings and dates in the language of the app', () => {
    const de = (key: string) => ({ 'detail.emails': 'E-Mail-Adressen', 'detail.anniversaries': 'Jahrestage', 'detail.anniversary_birth': 'Geburtstag' } as Record<string, string>)[key] ?? key;
    const sections = contactSheetSections({
      ...base,
      emails: { e: { address: 'ann@example.com' } },
      anniversaries: { b: { kind: 'birth', date: { year: 1988, month: 3, day: 15 } } },
    } as ContactCard, de, 'de');

    expect(sections.map((s) => s.title)).toEqual(['E-Mail-Adressen', 'Jahrestage']);
    expect(sections[1].rows).toEqual([{ label: 'Geburtstag', value: '15. März 1988' }]);
  });

  it('leaves out empty fields and sections, and keeps the order of the contact page', () => {
    const sections = contactSheetSections({
      ...base,
      notes: { n: { note: 'Met at FOSDEM' } },
      phones: { p: { number: '' } },
      emails: { e: { address: 'ann@example.com', label: 'Work' } },
      organizations: { o: { name: 'Acme', units: [{ name: 'R&D' }] } },
    } as unknown as ContactCard, en, 'en');

    expect(sections.map((s) => s.title)).toEqual(['detail.emails', 'detail.organizations', 'detail.notes']);
    expect(sections[0].rows).toEqual([{ label: 'Work', value: 'ann@example.com' }]);
    expect(sections[1].rows[0].value).toBe('Acme · R&D');
    expect(sections[2].text).toBe(true);
  });

  it('prints the address of a website or online service, which paper cannot link to', () => {
    const sections = contactSheetSections({
      ...base,
      onlineServices: { w: { service: 'Website', uri: 'https://ann.example' }, m: { service: 'Mastodon', user: '@ann@social.example', uri: 'https://social.example/@ann' } },
    } as unknown as ContactCard, en, 'en');

    expect(sections[0].rows).toEqual([
      { label: 'Website', value: 'https://ann.example' },
      { label: 'Mastodon', value: '@ann@social.example\nhttps://social.example/@ann' },
    ]);
  });
});

describe('resolveContactsPrint', () => {
  const ann = { ...base } as ContactCard;
  const team = { ...base, id: 'g1', kind: 'group', name: { full: 'Team' } } as ContactCard;
  const entry: DirectoryEntry = { name: 'Room 1', email: 'room1@example.com', type: 'location' };
  const wide: ContactsPrintState = {
    directory: false, detailShown: true, view: 'list', selectedContact: ann, selectedGroup: null, openDirectoryEntry: null,
  };

  it('prints what a Print action asked for', () => {
    expect(resolveContactsPrint({ kind: 'contact-list' }, wide)).toEqual({ kind: 'list' });
    expect(resolveContactsPrint({ kind: 'contact-group', group: team }, wide)).toEqual({ kind: 'group', group: team });
  });

  it('prints the open contact on Ctrl+P, and the list when none is open', () => {
    expect(resolveContactsPrint(null, wide)).toEqual({ kind: 'contact', contact: ann });
    expect(resolveContactsPrint(null, { ...wide, selectedContact: null })).toEqual({ kind: 'list' });
  });

  it('prints the list a phone shows, even with a contact selected', () => {
    expect(resolveContactsPrint(null, { ...wide, detailShown: false })).toEqual({ kind: 'list' });
  });

  it('prints the open group, and the list while a form is open', () => {
    expect(resolveContactsPrint(null, { ...wide, view: 'group-detail', selectedGroup: team })).toEqual({ kind: 'group', group: team });
    expect(resolveContactsPrint(null, { ...wide, view: 'edit' })).toEqual({ kind: 'list' });
  });

  it('prints the open directory entry, else the directory', () => {
    expect(resolveContactsPrint(null, { ...wide, directory: true, openDirectoryEntry: entry })).toEqual({ kind: 'directory-entry', entry });
    expect(resolveContactsPrint(null, { ...wide, directory: true })).toEqual({ kind: 'directory-list' });
  });
});
