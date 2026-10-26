import type { EmailTemplate } from '@/lib/template-types';
import { demoDate } from '../demo-utils';

/** Templates seeded into the (device-local) template store on demo login. */
export function createDemoTemplates(): EmailTemplate[] {
  return [
    {
      id: 'demo-template-followup',
      name: 'Meeting follow-up',
      subject: 'Follow-up: {{subject}}',
      body: '<p>Hi {{recipient_name}},</p><p>Thanks for your time today. What we agreed:</p><ul><li></li><li></li></ul><p>Next step is on my side; I\'ll come back to you by {{date}}.</p><p>Nora</p>',
      isHTML: true,
      category: 'Work',
      isFavorite: true,
      createdAt: demoDate(-90),
      updatedAt: demoDate(-20),
    },
    {
      id: 'demo-template-webhook',
      name: 'Support: webhook signature help',
      subject: 'Re: Webhook signature verification',
      body: '<p>Hi {{recipient_name}},</p><p>The two things that usually go wrong with signature verification:</p><ol><li>Sign the raw request body, not the decoded JSON.</li><li>The timestamp in <code>X-Beacon-Timestamp</code> is in seconds and the tolerance is five minutes.</li></ol><p>If that does not fix it, send me one failing request (headers and body) and I\'ll look at it with you.</p><p>{{sender_name}}, for Meridian Support</p>',
      isHTML: true,
      category: 'Support',
      identityId: 'demo-identity-support',
      isFavorite: false,
      createdAt: demoDate(-40),
      updatedAt: demoDate(-2),
    },
    {
      id: 'demo-template-handover',
      name: 'Handover before leave',
      subject: 'Handover: {{day_of_week}} to next week',
      body: '<p>Hi all,</p><p>I\'m out from {{date}}. While I\'m away:</p><ul><li>Launch questions: Alice</li><li>Customer questions: support@meridianlabs.example</li><li>Anything on fire: call me, don\'t mail</li></ul><p>Nora</p>',
      isHTML: true,
      category: 'Work',
      defaultRecipients: { to: ['alice.johnson@meridianlabs.example'], cc: ['bob.chen@meridianlabs.example'] },
      isFavorite: false,
      createdAt: demoDate(-200),
      updatedAt: demoDate(-200),
    },
  ];
}
