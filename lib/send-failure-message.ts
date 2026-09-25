import { RequestTimeoutError, ScheduleTooLateError, SubmissionQuotaError } from '@/lib/jmap/client';

/**
 * What to tell the user about a send (or reschedule) that failed, from the
 * `email_composer` messages. Most errors carry the server's own description;
 * these are the ones it would misrepresent or leave unexplained:
 * - a full submission quota: Stalwart asks the user to "delete some", but
 *   the client has already removed every record it may, so only an
 *   administrator can help;
 * - a timeout, which is not a clean failure: the submission may have reached
 *   the server and gone out, with only the answer lost. Saying "send failed"
 *   would invite a re-send and a duplicate, so point at Sent instead (#702);
 * - a hold beyond the server's limit.
 */
export function sendFailureMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof SubmissionQuotaError) return t('submission_quota');
  if (error instanceof RequestTimeoutError) return t('send_timeout');
  if (error instanceof ScheduleTooLateError) return t('schedule_send_too_late');
  return error instanceof Error && error.message ? error.message : t('send_failed');
}
