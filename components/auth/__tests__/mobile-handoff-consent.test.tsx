import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.username ? `${key}:${values.username}` : key,
}));

import { MobileHandoffConsent } from '../mobile-handoff-consent';

// A sign-in started with `mobile_redirect_uri` used to navigate to the app
// link the moment it succeeded, password or tokens in the fragment. The user
// must confirm first, and nothing navigates until they do.

const URL_TO_APP = 'bulwarkmobile://auth/callback#flow=password&password=secret';

let replaced: string[];

beforeEach(() => {
  replaced = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, replace: (url: string) => { replaced.push(url); } },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MobileHandoffConsent', () => {
  it('shows what will happen and navigates only on confirmation', () => {
    render(<MobileHandoffConsent url={URL_TO_APP} username="alice@example.org" onCancel={() => {}} />);
    expect(screen.getByText('mobile_handoff.title')).toBeTruthy();
    expect(screen.getByText('mobile_handoff.description:alice@example.org')).toBeTruthy();
    expect(replaced).toEqual([]);

    fireEvent.click(screen.getByText('mobile_handoff.confirm'));
    expect(replaced).toEqual([URL_TO_APP]);
  });

  it('keeps the user in the webmail when they decline', () => {
    const onCancel = vi.fn();
    render(<MobileHandoffConsent url={URL_TO_APP} username="alice@example.org" onCancel={onCancel} />);
    fireEvent.click(screen.getByText('mobile_handoff.cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(replaced).toEqual([]);
  });

  it('renders nothing without a pending handoff', () => {
    render(<MobileHandoffConsent url={null} username="" onCancel={() => {}} />);
    expect(screen.queryByText('mobile_handoff.title')).toBeNull();
  });
});
