import type { VacationResponse } from '@/lib/jmap/types';
import { demoDate } from '../demo-utils';

/** Prepared for the Lisbon trip, not switched on yet. */
export function createDemoVacationResponse(): VacationResponse {
  return {
    id: 'singleton',
    isEnabled: false,
    fromDate: demoDate(9, 0),
    toDate: demoDate(13, 0),
    subject: 'Out of office: back next week',
    textBody: 'Thank you for your mail. I am at Infra Summit in Lisbon and reading mail slowly until next week.\n\nFor anything about the Beacon launch, Alice Johnson (alice.johnson@meridianlabs.example) has the plan. For customer questions, support@meridianlabs.example answers within a business day.\n\nNora',
    htmlBody: '<p>Thank you for your mail. I am at Infra Summit in Lisbon and reading mail slowly until next week.</p><p>For anything about the Beacon launch, <a href="mailto:alice.johnson@meridianlabs.example">Alice Johnson</a> has the plan. For customer questions, <a href="mailto:support@meridianlabs.example">support@meridianlabs.example</a> answers within a business day.</p><p>Nora</p>',
  };
}
