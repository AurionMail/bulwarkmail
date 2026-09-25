import { describe, expect, it } from 'vitest';
import { RequestTimeoutError, ScheduleTooLateError, SubmissionQuotaError } from '../jmap/client';
import { sendFailureMessage } from '../send-failure-message';

// Keys of the `email_composer` namespace, returned as-is so the test sees
// which message was chosen.
const t = (key: string) => `email_composer.${key}`;

describe('sendFailureMessage', () => {
  it('explains a full submission quota instead of showing the server text on Stalwart 1.0', () => {
    const error = new SubmissionQuotaError('There are too many email submissions, please delete some before adding a new one.');

    expect(sendFailureMessage(error, t)).toBe('email_composer.submission_quota');
  });

  it('points at Sent after a timeout and names the hold limit', () => {
    expect(sendFailureMessage(new RequestTimeoutError(30_000), t)).toBe('email_composer.send_timeout');
    expect(sendFailureMessage(new ScheduleTooLateError(604800), t)).toBe('email_composer.schedule_send_too_late');
  });

  it("shows other errors' own text, and a generic message when there is none", () => {
    expect(sendFailureMessage(new Error('Envelope mailFrom does not match identity email address. [forbiddenFrom]'), t))
      .toBe('Envelope mailFrom does not match identity email address. [forbiddenFrom]');
    expect(sendFailureMessage(new Error(''), t)).toBe('email_composer.send_failed');
    expect(sendFailureMessage('nope', t)).toBe('email_composer.send_failed');
  });
});
