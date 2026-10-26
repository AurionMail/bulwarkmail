/**
 * The demo data is what every screenshot and the public demo show. These
 * tests pin the facts the drivers and the viewer rely on: ids resolve, the
 * files behind attachments exist with the recorded sizes, and the fixtures
 * trigger the features they are written for (mention chips, the invitation
 * banner, the verification-code chip, the sender-authentication warning,
 * unsubscribe, read receipts).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getDemoData } from '../demo-data';
import { DemoJMAPClient } from '../demo-client';
import { DEMO_ASSETS } from '../fixtures/assets';
import { PORTRAITS, NORA, ALICE, BOB } from '../fixtures/people';
import { GONOGO_INVITE_BLOB, GONOGO_UID } from '../fixtures/emails';
import { GONOGO_EVENT_ID, createGoNoGoInvitationIcs } from '../fixtures/calendars';
import { SUPPORT_ACCOUNT_ID, SMB, MB } from '../fixtures/mailboxes';
import { DEMO_KEYWORDS } from '../fixtures/keywords';
import { getSenderVerification, extractListHeaders } from '@/lib/email-headers';
import { findVerificationCode } from '@/lib/verification-code';
import { findCalendarAttachment } from '@/lib/calendar-invitation';
import { mentionFromLink } from '@/lib/recipient-mentions';
import { KEYWORD_PALETTE } from '@/stores/settings-store';

const PUBLIC = path.resolve(__dirname, '..', '..', '..', 'public');
const work = getDemoData('work');
const personal = getDemoData('personal');

function allMailboxIds(data: ReturnType<typeof getDemoData>): Set<string> {
  const ids = data.mailboxes.map((m) => m.id);
  for (const shared of Object.values(data.sharedMailboxes)) ids.push(...shared.mailboxes.map((m) => m.id));
  return new Set(ids);
}

describe('demo fixtures: structure', () => {
  it.each([['work', work], ['personal', personal]] as const)('%s mail only uses folders that exist and has unique ids', (_name, data) => {
    const mailboxIds = allMailboxIds(data);
    const seenIds = new Set<string>();
    const seenMessageIds = new Set<string>();
    for (const email of data.emails) {
      expect(seenIds.has(email.id), `duplicate id ${email.id}`).toBe(false);
      seenIds.add(email.id);
      expect(seenMessageIds.has(email.messageId!), `duplicate Message-ID ${email.messageId}`).toBe(false);
      seenMessageIds.add(email.messageId!);
      for (const mailboxId of Object.keys(email.mailboxIds)) {
        expect(mailboxIds.has(mailboxId), `${email.id} is filed in unknown folder ${mailboxId}`).toBe(true);
      }
    }
  });

  it('reply chains point at messages that exist', () => {
    const known = new Set([...work.emails, ...personal.emails].map((e) => e.messageId));
    for (const email of [...work.emails, ...personal.emails]) {
      for (const ref of [...(email.inReplyTo ?? []), ...(email.references ?? [])]) {
        expect(known.has(ref), `${email.id} references ${ref}`).toBe(true);
      }
    }
  });

  it('every thread with several messages shares one subject stem', () => {
    const byThread = new Map<string, typeof work.emails>();
    for (const e of [...work.emails, ...personal.emails]) byThread.set(e.threadId, [...(byThread.get(e.threadId) ?? []), e]);
    for (const [threadId, emails] of byThread) {
      if (emails.length < 2) continue;
      const stems = new Set(emails.map((e) => (e.subject ?? '').replace(/^(re|fwd?):\s*/i, '').toLowerCase()));
      expect(stems.size, `thread ${threadId} mixes subjects ${[...stems].join(' | ')}`).toBe(1);
    }
  });

  it('nothing in an inbox is dated in the future', () => {
    const now = Date.now();
    for (const e of [...work.emails, ...personal.emails]) {
      expect(new Date(e.receivedAt).getTime(), `${e.id} is in the future`).toBeLessThanOrEqual(now);
    }
  });

  it('the inbox is busy enough to scroll and about a third unread', () => {
    const inbox = work.emails.filter((e) => e.mailboxIds[MB.inbox]);
    expect(inbox.length).toBeGreaterThanOrEqual(35);
    const unread = inbox.filter((e) => !e.keywords.$seen).length / inbox.length;
    expect(unread).toBeGreaterThan(0.25);
    expect(unread).toBeLessThan(0.5);
  });

  it('every tag on a message has a definition with a palette colour', () => {
    const defined = new Set(DEMO_KEYWORDS.map((k) => `$label:${k.id}`));
    for (const k of DEMO_KEYWORDS) expect(KEYWORD_PALETTE[k.color], `colour ${k.color}`).toBeDefined();
    for (const e of [...work.emails, ...personal.emails]) {
      for (const keyword of Object.keys(e.keywords)) {
        if (keyword.startsWith('$label:')) expect(defined.has(keyword), `${e.id} carries undefined tag ${keyword}`).toBe(true);
      }
    }
    // The sidebar should have something to count for each tag.
    for (const tag of defined) {
      expect(work.emails.some((e) => e.keywords[tag]) || personal.emails.some((e) => e.keywords[tag]), `${tag} is never used`).toBe(true);
    }
  });

  it('calendar items and files point at calendars and assets that exist', () => {
    const calendars = new Set(work.calendars.map((c) => c.id));
    for (const ev of work.calendarEvents) for (const id of Object.keys(ev.calendarIds)) expect(calendars.has(id), ev.id).toBe(true);
    for (const t of work.calendarTasks) for (const id of Object.keys(t.calendarIds)) expect(calendars.has(id), t.id).toBe(true);
    for (const node of work.fileNodes) {
      if (node.blobId) expect(DEMO_ASSETS[node.blobId as keyof typeof DEMO_ASSETS], `${node.name} -> ${node.blobId}`).toBeDefined();
      if (node.parentId) expect(work.fileNodes.some((n) => n.id === node.parentId), `${node.name} parent`).toBe(true);
    }
  });

  it('contact groups only list contacts that exist', () => {
    const ids = new Set(work.contacts.map((c) => c.id));
    for (const group of work.contacts.filter((c) => c.kind === 'group')) {
      for (const member of Object.keys(group.members ?? {})) expect(ids.has(member), `${group.id} -> ${member}`).toBe(true);
    }
    expect(work.contacts.filter((c) => c.kind === 'group').length).toBeGreaterThanOrEqual(3);
  });

  it('people who write to Nora from the cast are in her address books', () => {
    const contactEmails = new Set(work.contacts.flatMap((c) => Object.values(c.emails ?? {}).map((e) => e.address.toLowerCase())));
    for (const p of PORTRAITS) {
      if (p.email === NORA.email) continue;
      expect(contactEmails.has(p.email.toLowerCase()), `${p.name} has a portrait but no contact card`).toBe(true);
    }
  });
});

describe('demo fixtures: files behind the data', () => {
  it('every asset exists in public/demo with the recorded size', () => {
    for (const [blobId, asset] of Object.entries(DEMO_ASSETS)) {
      const file = path.join(PUBLIC, asset.path);
      expect(fs.existsSync(file), `${blobId}: ${asset.path} missing`).toBe(true);
      expect(fs.statSync(file).size, `${asset.path} size changed; update fixtures/assets.ts`).toBe(asset.size);
    }
  });

  it('every attachment is backed by an asset', () => {
    for (const e of [...work.emails, ...personal.emails]) {
      for (const att of e.attachments ?? []) {
        if (att.blobId === GONOGO_INVITE_BLOB) continue;
        expect(DEMO_ASSETS[att.blobId as keyof typeof DEMO_ASSETS], `${e.id} -> ${att.name}`).toBeDefined();
      }
    }
  });

  it('every portrait exists and is small', () => {
    for (const p of PORTRAITS) {
      const file = path.join(PUBLIC, 'demo', 'portraits', `${p.portrait}.jpg`);
      expect(fs.existsSync(file), `${p.name}: ${file}`).toBe(true);
      expect(fs.statSync(file).size).toBeLessThan(30_000);
    }
  });

  it('contact photos are served locally, not from a third party', () => {
    for (const c of work.contacts) {
      for (const m of Object.values(c.media ?? {})) expect(m.uri).toMatch(/^\/demo\/portraits\//);
    }
  });
});

describe('demo fixtures: features the screenshots show', () => {
  const client = new DemoJMAPClient('work');

  it('derives sender authentication from the headers: legit mail passes, the phishing mail fails', async () => {
    const legit = (await client.getEmail('demo-email-sarah-invoice'))!;
    expect(legit.authenticationResults?.dmarc?.result).toBe('pass');
    expect(getSenderVerification(legit.authenticationResults, legit.from![0].email)).toBeNull();

    const phish = (await client.getEmail('demo-email-spam-phish'))!;
    expect(getSenderVerification(phish.authenticationResults, phish.from![0].email)?.status).toBe('failed');
    expect(phish.spamScore).toBeGreaterThan(5);
    expect(phish.spamLLM?.verdict).toBe('SPAM');
  });

  it('newsletters carry a one-click unsubscribe the viewer can act on', async () => {
    const nl = (await client.getEmail('demo-email-techdigest'))!;
    const list = extractListHeaders(nl.headers!);
    expect(list.listUnsubscribe?.http).toMatch(/^https:\/\//);
    expect(list.listUnsubscribe?.mailto).toContain('@');
    expect(list.listUnsubscribe?.preferred).toBe('http');
  });

  it('the launch plan asks for a read receipt', async () => {
    const e = (await client.getEmail('demo-email-launch-plan'))!;
    expect(e.headers?.['Disposition-Notification-To']).toContain('michael.torres@');
  });

  it('the GitHub mail shows a verification-code chip', async () => {
    const e = (await client.getEmail('demo-email-github-code'))!;
    expect(findVerificationCode(e.subject, e.preview)).toBe('482913');
    expect(Date.now() - new Date(e.receivedAt).getTime()).toBeLessThan(60 * 60 * 1000);
  });

  it('Alice mentions Nora and Bob with links the viewer turns into chips', async () => {
    const e = (await client.getEmail('demo-email-rollback-1'))!;
    const html = e.bodyValues![e.htmlBody![0].partId].value;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const mentions = [...doc.querySelectorAll('a')].map((a) => mentionFromLink(a as HTMLElement)).filter(Boolean);
    expect(mentions).toEqual([
      { label: 'Nora', email: NORA.email },
      { label: 'Bob', email: BOB.email },
    ]);
  });

  it('the go/no-go mail is an invitation Nora can answer', async () => {
    const e = (await client.getEmail('demo-email-gonogo-invite'))!;
    const att = findCalendarAttachment(e);
    expect(att?.blobId).toBe(GONOGO_INVITE_BLOB);

    const ics = createGoNoGoInvitationIcs();
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain(`UID:${GONOGO_UID}`);
    expect(await (await client.fetchBlob(GONOGO_INVITE_BLOB)).text()).toBe(ics);

    const [parsed] = await client.parseCalendarEvents('demo-account', GONOGO_INVITE_BLOB);
    expect(parsed.uid).toBe(GONOGO_UID);
    const me = Object.values(parsed.participants!).find((p) => p.email === NORA.email)!;
    expect(me.participationStatus).toBe('needs-action');
    expect(Object.values(parsed.participants!).some((p) => p.roles.owner && p.email === ALICE.email)).toBe(true);
    // The event is already on the calendar, waiting for the answer.
    expect((await client.queryCalendarEvents({ uid: GONOGO_UID }))[0]?.id).toBe(GONOGO_EVENT_ID);
  });

  it('an RSVP arrives as a JSON-pointer patch and lands on the participant', async () => {
    const fresh = new DemoJMAPClient('work');
    const event = (await fresh.getCalendarEvent(GONOGO_EVENT_ID))!;
    const [key] = Object.entries(event.participants!).find(([, p]) => p.email === NORA.email)!;
    await fresh.updateCalendarEvent(GONOGO_EVENT_ID, { [`participants/${key}/participationStatus`]: 'accepted' } as never);
    expect((await fresh.getCalendarEvent(GONOGO_EVENT_ID))!.participants![key].participationStatus).toBe('accepted');
    expect(Object.keys((await fresh.getCalendarEvent(GONOGO_EVENT_ID))!)).not.toContain(`participants/${key}/participationStatus`);
  });

  it('the Support mailbox is listed as a shared account next to the work folders', async () => {
    const all = await client.getAllMailboxes();
    const shared = all.filter((m) => m.isShared);
    expect(shared.map((m) => m.id)).toContain(`${SUPPORT_ACCOUNT_ID}:${SMB.inbox}`);
    expect(shared.every((m) => m.accountId === SUPPORT_ACCOUNT_ID && m.accountName === 'Support')).toBe(true);
    const inbox = shared.find((m) => m.originalId === SMB.inbox)!;
    expect(inbox.unreadEmails).toBeGreaterThan(0);
    // Queried the way the store does it: by the bare id and the owner account.
    const { emails } = await client.getEmails(SMB.inbox, SUPPORT_ACCOUNT_ID);
    expect(emails.length).toBe(inbox.totalEmails);
    expect(client.getSharedAccounts().map((a) => a.id)).toEqual(['demo-account', SUPPORT_ACCOUNT_ID]);
  });

  it('folder counts come from the mail, including nested folders', async () => {
    const mailboxes = await client.getMailboxes();
    for (const mb of mailboxes) {
      const inFolder = work.emails.filter((e) => e.mailboxIds[mb.id]);
      expect(mb.totalEmails, mb.name).toBe(inFolder.length);
      expect(mb.unreadEmails, mb.name).toBe(inFolder.filter((e) => !e.keywords.$seen).length);
    }
    expect(mailboxes.find((m) => m.id === MB.beacon)?.parentId).toBe(MB.projects);
    expect(mailboxes.find((m) => m.id === MB.archive2025)?.parentId).toBe(MB.archive);
  });

  it('the personal account is a separate mail-only login', async () => {
    const second = new DemoJMAPClient('personal');
    expect(second.getAccountId()).not.toBe(client.getAccountId());
    expect(second.getUsername()).not.toBe(client.getUsername());
    expect(second.supportsCalendars()).toBe(false);
    expect(second.supportsContacts()).toBe(false);
    expect((await second.getMailboxes()).find((m) => m.role === 'inbox')?.unreadEmails).toBeGreaterThan(0);
  });

  it('"recent mail" on a contact card finds mail to and from that person', async () => {
    const { emails } = await client.advancedSearchEmails({ operator: 'OR', conditions: [{ from: ALICE.email }, { to: ALICE.email }] });
    expect(emails.length).toBeGreaterThan(2);
    expect(emails.every((e) => [...(e.from ?? []), ...(e.to ?? [])].some((a) => a.email === ALICE.email))).toBe(true);
  });

  it('a scheduled message is waiting in Drafts', async () => {
    const { emails } = await client.getScheduledEmails();
    expect(emails.map((e) => e.id)).toContain('demo-email-scheduled-prep');
    expect(new Date(emails[0].scheduledSendAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('demo fixtures: calendar times', () => {
  it('utcStart matches the local wall-clock start of every timed event', () => {
    for (const ev of work.calendarEvents) {
      if (ev.showWithoutTime || !ev.utcStart) continue;
      const local = new Date(ev.start);
      expect(new Date(ev.utcStart).getTime(), `${ev.title}: ${ev.start} vs ${ev.utcStart}`).toBe(local.getTime());
    }
  });

  it('a quarter-hour standup lasts fifteen minutes', () => {
    const standup = work.calendarEvents.find((e) => e.id === 'demo-event-standup')!;
    expect(standup.duration).toBe('PT15M');
    expect(new Date(standup.utcEnd!).getTime() - new Date(standup.utcStart!).getTime()).toBe(15 * 60 * 1000);
  });
});

describe('demo client: account scope', () => {
  it('a query for the shared Support account returns only its mail, and the primary account never returns it', async () => {
    const client = new DemoJMAPClient('work');
    const support = await client.searchEmails('Beacon', undefined, SUPPORT_ACCOUNT_ID);
    expect(support.emails.length).toBeGreaterThan(0);
    expect(support.emails.every((e) => Object.keys(e.mailboxIds).some((id) => id.startsWith('demo-support-')))).toBe(true);
    const own = await client.searchEmails('Beacon');
    expect(own.emails.some((e) => Object.keys(e.mailboxIds).some((id) => id.startsWith('demo-support-')))).toBe(false);
    // The two scopes together cover every match exactly once.
    const all = [...own.emails, ...support.emails].map((e) => e.id);
    expect(new Set(all).size).toBe(all.length);
    const { emails: inbox } = await client.getEmails(undefined, SUPPORT_ACCOUNT_ID);
    expect(inbox.every((e) => Object.keys(e.mailboxIds).some((id) => id.startsWith('demo-support-')))).toBe(true);
  });
});
