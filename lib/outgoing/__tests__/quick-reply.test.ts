import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareQuickReply } from '@/lib/outgoing/quick-reply';
import { registerOutgoingFinalizer, registerPreSendCheck, resetSendPipeline } from '@/lib/outgoing/send-pipeline';
import type { Identity } from '@/lib/jmap/types';

vi.mock('@/lib/debug', () => ({ debug: { log: () => {}, warn: () => {}, error: () => {} } }));

// Quick reply goes through the same checks and finalisers as the composer,
// so the disclaimer and the external-recipient confirm reach it too.

const html = { id: 'i', name: 'Me', email: 'me@example.com', htmlSignature: '<b>Me</b>', textSignature: '' } as Identity;
const text = { id: 'i', name: 'Me', email: 'me@example.com', htmlSignature: '', textSignature: 'Me' } as Identity;
const input = (signatureIdentity: Identity) => ({
  body: 'Thanks <3', signatureIdentity, separator: true, to: ['bob@example.com'], fromEmail: 'me@example.com', identityId: 'i',
});

afterEach(() => resetSendPipeline());

describe('prepareQuickReply', () => {
  it('builds the text and, for an HTML signature, an escaped HTML body', async () => {
    const withHtml = await prepareQuickReply(input(html));
    expect(withHtml?.html).toContain('<div>Thanks &lt;3</div>');
    expect(withHtml?.html).toContain('<b>Me</b>');
    expect(withHtml?.text).toContain('Thanks <3');
    const plain = await prepareQuickReply(input(text));
    expect(plain?.html).toBeUndefined();
    expect(plain?.text).toMatch(/Thanks <3[\s\S]*-- \nMe$/);
  });

  it('runs the finalisers with a reply context', async () => {
    const contexts: unknown[] = [];
    registerOutgoingFinalizer('f', 10, (bodies, context) => {
      contexts.push(context);
      return { html: bodies.html, text: `${bodies.text}\nFooter` };
    });
    const out = await prepareQuickReply(input(text));
    expect(out?.text).toMatch(/\nFooter$/);
    expect(contexts).toEqual([expect.objectContaining({ surface: 'quick-reply', mode: 'reply', to: ['bob@example.com'], plainText: true })]);
  });

  it('sends nothing when a check says no', async () => {
    registerPreSendCheck('no', 10, () => false);
    expect(await prepareQuickReply(input(text))).toBeNull();
  });
});
