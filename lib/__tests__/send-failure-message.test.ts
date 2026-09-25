import { describe, expect, it } from 'vitest';
import { NoLongerScheduledError, RequestTimeoutError, ScheduleTooLateError, SubmissionQuotaError } from '../jmap/client';
import { SendCancelledCleanupError, cancelFailureToast, rescheduleFailureToast, sendFailureMessage } from '../send-failure-message';

// Keys of a namespace, returned with their values so the test sees which
// message was chosen and what went into it.
const translator = (namespace: string) => (key: string, values?: Record<string, string>) =>
  values ? `${namespace}.${key} ${JSON.stringify(values)}` : `${namespace}.${key}`;
const t = translator('email_composer');
const tViewer = translator('email_viewer');

const STALWART_QUOTA = 'There are too many email submissions, please delete some before adding a new one.';

describe('sendFailureMessage', () => {
  it('explains a full submission quota instead of showing the server text on Stalwart 1.0', () => {
    const error = new SubmissionQuotaError(STALWART_QUOTA, true);

    expect(sendFailureMessage(error, t)).toBe('email_composer.submission_quota');
  });

  it("gives another server's overQuota its own description, not Stalwart's explanation", () => {
    expect(sendFailureMessage(new SubmissionQuotaError('Daily sending limit exceeded'), t))
      .toBe('email_composer.submission_limit {"reason":"Daily sending limit exceeded"}');
    expect(sendFailureMessage(new SubmissionQuotaError(undefined, false), t))
      .toBe('email_composer.submission_limit {"reason":"overQuota"}');
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

describe('rescheduleFailureToast', () => {
  it('says the message is still scheduled, and when, at a full quota on Stalwart 1.0', () => {
    const error = new SubmissionQuotaError(STALWART_QUOTA, true);

    expect(rescheduleFailureToast(error, tViewer, t, 'Sep 26, 10:00')).toEqual({
      title: 'email_viewer.still_scheduled_at {"date":"Sep 26, 10:00"}',
      message: 'email_composer.submission_quota',
    });
    expect(rescheduleFailureToast(error, tViewer, t).title).toBe('email_viewer.still_scheduled');
  });

  it('says the message went out, or is no longer scheduled, when the original left the queue meanwhile', () => {
    expect(rescheduleFailureToast(new NoLongerScheduledError(true), tViewer, t, 'Sep 26, 10:00'))
      .toEqual({ title: 'email_viewer.already_sent' });
    expect(rescheduleFailureToast(new NoLongerScheduledError(false), tViewer, t))
      .toEqual({ title: 'email_viewer.no_longer_scheduled' });
  });

  it('falls back to the send failure message otherwise', () => {
    expect(rescheduleFailureToast(new RequestTimeoutError(30_000), tViewer, t, 'Sep 26, 10:00'))
      .toEqual({ title: 'email_composer.send_timeout' });
    expect(rescheduleFailureToast(new Error('cannotUnsend'), tViewer, t)).toEqual({ title: 'cannotUnsend' });
  });
});

describe('cancelFailureToast', () => {
  it('reports a failed cancel with its reason: the mail may still go out', () => {
    expect(cancelFailureToast(new Error('The requested message is no longer in the queue.'), tViewer, 'Undo send failed'))
      .toEqual({ title: 'Undo send failed', message: 'The requested message is no longer in the queue.' });
  });

  it('says the send was cancelled when only a step after the cancel failed', () => {
    expect(cancelFailureToast(new SendCancelledCleanupError('restore', new Error('503')), tViewer, 'Undo send failed'))
      .toEqual({ title: 'email_viewer.send_cancelled_restore_failed' });
    expect(cancelFailureToast(new SendCancelledCleanupError('remove', new Error('503')), tViewer, 'Undo send failed'))
      .toEqual({ title: 'email_viewer.send_cancelled_remove_failed' });
  });
});
