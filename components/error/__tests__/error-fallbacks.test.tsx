import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One error fallback everywhere: the same "Try again", a way back to the
// inbox outside mail, and each app has a boundary of its own that keeps the
// navigation on screen.

vi.mock('@/components/layout/navigation-rail', () => ({
  NavigationRail: ({ orientation }: { orientation?: string }) => <nav aria-label={`rail-${orientation ?? 'vertical'}`} />,
}));

const { AppErrorBoundary } = await import('../app-error-boundary');
const { ErrorBoundary } = await import('../error-boundary');
const { EmailListErrorFallback, SidebarErrorFallback, SettingsErrorFallback } = await import('../error-fallbacks');

let broken = true;
function Flaky() {
  if (broken) throw new Error('boom');
  return <p>calendar works</p>;
}

beforeEach(() => {
  broken = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('app error boundary', () => {
  it('shows the fallback next to the navigation and recovers on Try again', () => {
    render(<AppErrorBoundary><Flaky /></AppErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('page_error_title');
    expect(screen.getByRole('navigation', { name: 'rail-vertical' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'go_home' })).toBeInTheDocument();

    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'try_again' }));
    expect(screen.getByText('calendar works')).toBeInTheDocument();
  });
});

describe('section fallbacks', () => {
  it.each([
    ['message list', EmailListErrorFallback],
    ['folder sidebar', SidebarErrorFallback],
    ['settings', SettingsErrorFallback],
  ])('the %s offers the same "Try again"', (_name, fallback) => {
    render(<ErrorBoundary fallback={fallback}><Flaky /></ErrorBoundary>);
    expect(screen.getByRole('button', { name: 'try_again' })).toBeInTheDocument();
  });

  it('inside mail, does not offer to go to the inbox it is already in', () => {
    render(<ErrorBoundary fallback={EmailListErrorFallback}><Flaky /></ErrorBoundary>);
    expect(screen.queryByRole('link', { name: 'go_home' })).toBeNull();
  });
});
