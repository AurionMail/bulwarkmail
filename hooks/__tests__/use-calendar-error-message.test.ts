import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useCalendarErrorMessage } from '../use-calendar-error-message';
import { jmapSetError } from '@/lib/jmap/jmap-error';

describe('useCalendarErrorMessage', () => {
  it('names the participant limit when Stalwart 1.0 refused a change for it', () => {
    const { result } = renderHook(() => useCalendarErrorMessage());
    const refusal = jmapSetError('An event cannot have more than 20 participants.', {
      type: 'invalidProperties', properties: ['participants'],
    });
    // next-intl is mocked to answer with the key.
    expect(result.current(refusal, 'Failed to save event')).toBe('participant_limit');
  });

  it('falls back for any other failure', () => {
    const { result } = renderHook(() => useCalendarErrorMessage());
    expect(result.current(new Error('Request failed: 503'), 'Failed to save event')).toBe('Failed to save event');
  });
});
