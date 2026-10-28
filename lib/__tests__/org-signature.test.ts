import { describe, it, expect } from 'vitest';
import {
  buildOrgSignature,
  effectiveSignatureIdentity,
  fillHtmlTemplate,
  fillTextTemplate,
  placeholdersIn,
  sanitizeSignatureDetails,
  signatureFieldsToAsk,
  signatureFieldsUsed,
  signatureValuesFor,
} from '@/lib/org-signature';
import type { Identity } from '@/lib/jmap/types';

const FULL = signatureValuesFor(
  { name: 'Alex Example', email: 'alex@Example.org' },
  { title: 'CEO', department: 'Sales', phone: '+49 30 1', mobile: '+49 170 2' },
  'ACME Ltd',
);
const NO_DETAILS = signatureValuesFor({ name: 'Alex Example', email: 'alex@example.org' }, null, 'ACME Ltd');

describe('placeholder values', () => {
  it('derives identity, domain and company from the identity and the config', () => {
    expect(FULL).toMatchObject({
      name: 'Alex Example',
      email: 'alex@Example.org',
      identity: 'Alex Example <alex@Example.org>',
      domain: 'example.org',
      company: 'ACME Ltd',
      title: 'CEO',
    });
    expect(signatureValuesFor({ name: '', email: 'x@y.test' }, null, '').identity).toBe('x@y.test');
  });

  it('finds the placeholders a template uses, and the user fields among them', () => {
    expect(placeholdersIn('{name} {phone} {unknown} {phone}')).toEqual(['name', 'phone']);
    expect(signatureFieldsUsed({ html: '<p>{mobile}</p>', text: '{title}' })).toEqual(['title', 'mobile']);
    expect(signatureFieldsToAsk({ html: '{phone}', text: '', fields: ['department'] })).toEqual(['department', 'phone']);
  });
});

describe('fillTextTemplate', () => {
  it('fills in every placeholder and leaves unknown braces alone', () => {
    expect(fillTextTemplate('{name}, {title}\n{company} ({domain}) {other}', FULL))
      .toBe('Alex Example, CEO\nACME Ltd (example.org) {other}');
  });

  it('drops a line whose placeholders are all empty, and keeps one with some value', () => {
    const template = '{name}\n{title}, {department}\nPhone: {phone}\nMobile: {mobile}\nACME Ltd';
    expect(fillTextTemplate(template, NO_DETAILS)).toBe('Alex Example\nACME Ltd');
    expect(fillTextTemplate(template, { ...NO_DETAILS, department: 'Sales' }))
      .toBe('Alex Example\n, Sales\nACME Ltd');
  });

  it('does not escape in plain text', () => {
    expect(fillTextTemplate('{name}', { name: 'A & <B>' })).toBe('A & <B>');
  });
});

describe('fillHtmlTemplate', () => {
  it('HTML-escapes the values, in text and in attributes', () => {
    const html = fillHtmlTemplate('<p>{name}</p><a href="tel:{phone}">call</a>', {
      name: '<img src=x onerror=alert(1)> & co',
      phone: '1" onclick="x',
    });
    expect(html).toContain('<p>&lt;img src=x onerror=alert(1)&gt; &amp; co</p>');
    expect(html).toContain('href="tel:1&quot; onclick=&quot;x"');
    expect(html).not.toContain('<img');
  });

  it('drops lines between <br>s whose placeholders are all empty, with their line break', () => {
    const template = '<p><b>{name}</b><br>{title}<br>Phone: {phone}<br>Mobile: {mobile}</p><p>ACME Ltd</p>';
    expect(fillHtmlTemplate(template, FULL))
      .toBe('<p><b>Alex Example</b><br>CEO<br>Phone: +49 30 1<br>Mobile: +49 170 2</p><p>ACME Ltd</p>');
    expect(fillHtmlTemplate(template, NO_DETAILS)).toBe('<p><b>Alex Example</b></p><p>ACME Ltd</p>');
    expect(fillHtmlTemplate(template, { ...NO_DETAILS, mobile: '9' }))
      .toBe('<p><b>Alex Example</b><br>Mobile: 9</p><p>ACME Ltd</p>');
  });

  it('drops a paragraph and a table row whose placeholders are all empty', () => {
    const template = '<p>{name}</p><p>Phone: {phone}</p><table><tbody><tr><td>Mobile</td><td>{mobile}</td></tr>'
      + '<tr><td>Web</td><td>example.org</td></tr></tbody></table>';
    expect(fillHtmlTemplate(template, NO_DETAILS))
      .toBe('<p>Alex Example</p><table><tbody><tr><td>Web</td><td>example.org</td></tr></tbody></table>');
  });

  it('drops a line whose only placeholder is in a link', () => {
    expect(fillHtmlTemplate('{name}<br><a href="tel:{phone}">Call me</a>', NO_DETAILS)).toBe('Alex Example');
  });

  it('keeps lines and blocks without placeholders, empty ones included', () => {
    expect(fillHtmlTemplate('<p>{mobile}</p><p><br></p><hr><p>Static</p>', NO_DETAILS))
      .toBe('<p><br></p><hr><p>Static</p>');
  });
});

describe('buildOrgSignature', () => {
  it('is null without a template, and fills both templates otherwise', () => {
    expect(buildOrgSignature({ html: ' ', text: '' }, FULL)).toBeNull();
    expect(buildOrgSignature({ html: '<p>{name}</p>', text: '' }, FULL)).toEqual({ html: '<p>Alex Example</p>', text: '' });
    expect(buildOrgSignature({ html: '', text: '{name}' }, FULL)).toEqual({ html: '', text: 'Alex Example' });
  });
});

describe('effectiveSignatureIdentity', () => {
  const ME = { id: 'me', name: 'Me', email: 'me@example.org', mayDelete: true, htmlSignature: '<b>Mine</b>', textSignature: 'Mine' } as Identity;
  const TEAM = { id: 'team', name: 'Team', email: 'team@example.org', mayDelete: true } as Identity;
  const ORG = { html: '<p>Org</p>', text: 'Org' };
  const NONE = { locked: false, hidden: false };

  it('changes nothing without an organisation signature', () => {
    expect(effectiveSignatureIdentity(ME, ME, null, { locked: true, hidden: false })).toBe(ME);
  });

  it('is the default for an identity without its own signature', () => {
    expect(effectiveSignatureIdentity(ME, ME, ORG, NONE)).toBe(ME);
    expect(effectiveSignatureIdentity(TEAM, TEAM, ORG, NONE)).toEqual({ ...TEAM, htmlSignature: '<p>Org</p>', textSignature: 'Org' });
  });

  it('replaces every signature when locked or hidden, as the sending identity', () => {
    expect(effectiveSignatureIdentity(ME, TEAM, ORG, { locked: true, hidden: false }))
      .toEqual({ ...TEAM, htmlSignature: '<p>Org</p>', textSignature: 'Org' });
    expect(effectiveSignatureIdentity(ME, ME, ORG, { locked: false, hidden: true })?.htmlSignature).toBe('<p>Org</p>');
  });
});

describe('sanitizeSignatureDetails', () => {
  it('keeps the four fields as strings and drops the rest', () => {
    expect(sanitizeSignatureDetails({ title: 'CEO', phone: 5, mobile: 'x'.repeat(300), extra: 'y' }))
      .toEqual({ title: 'CEO', department: '', phone: '', mobile: 'x'.repeat(200) });
    expect(sanitizeSignatureDetails('nope')).toEqual({ title: '', department: '', phone: '', mobile: '' });
  });
});
