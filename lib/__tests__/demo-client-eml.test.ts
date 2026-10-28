import { describe, expect, it } from 'vitest';
import { DemoJMAPClient } from '@/lib/demo/demo-client';

// Export as .eml, View source and Forward as attachment need the message's
// raw blob. The demo has no server to keep one, so it builds the .eml from
// the message; without a blob id those entries were greyed out in the demo.
describe('DemoJMAPClient raw messages', () => {
  it('gives every fixture message a blob that holds its .eml', async () => {
    const client = new DemoJMAPClient();
    const { emails } = await client.getEmails(undefined, undefined, 500);
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((e) => !!e.blobId)).toBe(true);

    const email = emails.find((e) => e.from?.[0]?.name && e.subject)!;
    const blob = await client.fetchBlob(email.blobId!);
    expect(blob.type).toBe('message/rfc822');
    const eml = await blob.text();
    expect(eml).toContain(`Subject: ${email.subject}`);
    expect(eml).toContain(`<${email.from![0].email}>`);
    expect(eml).toContain('MIME-Version: 1.0');
    // Headers and body are split by an empty line.
    expect(eml).toMatch(/\r\n\r\n/);
  });

  it('gives a saved draft a blob too', async () => {
    const client = new DemoJMAPClient();
    const id = await client.createDraft(['a@example.com'], 'Draft for export', 'Body text');
    const draft = await client.getEmail(id);
    expect(draft?.blobId).toBeTruthy();
    expect(await (await client.fetchBlob(draft!.blobId!)).text()).toContain('Subject: Draft for export');
  });
});

// A server sends a new object on every fetch. The app stamps the scheduled
// send onto the message it opens; with the demo's own object, a cancelled
// send kept its Scheduled badge in Drafts.
describe('DemoJMAPClient getEmail', () => {
  it('returns a copy that the caller may change', async () => {
    const client = new DemoJMAPClient();
    const { emails } = await client.getEmails(undefined, undefined, 1);
    const opened = (await client.getEmail(emails[0].id))!;
    opened.isScheduled = true;
    opened.scheduledSendAt = '2030-01-01T08:00:00Z';
    const again = (await client.getEmail(emails[0].id))!;
    expect(again.isScheduled).toBeUndefined();
    expect(again.scheduledSendAt).toBeUndefined();
    const { emails: listed } = await client.getEmails(undefined, undefined, 500);
    expect(listed.find((e) => e.id === emails[0].id)!.isScheduled).toBeUndefined();
  });
});
