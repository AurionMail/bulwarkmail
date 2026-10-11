import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// On a phone the banner said "Press c to compose" and pointed at a sidebar
// that the phone layout does not have.

const device = vi.hoisted(() => ({ isMobile: false }));
vi.mock('@/hooks/use-media-query', () => ({
  useDeviceDetection: () => ({ isMobile: device.isMobile, isTablet: false, isDesktop: !device.isMobile }),
}));
vi.mock('@/components/tour/tour-provider', () => ({ useTour: () => ({ startTour: vi.fn() }) }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { WelcomeBanner } = await import('../welcome-banner');
const { useSettingsStore } = await import('@/stores/settings-store');

describe('WelcomeBanner tips', () => {
  beforeEach(() => {
    useSettingsStore.setState({ onboardingCompleted: false });
  });

  it('gives keyboard tips on a desktop', () => {
    device.isMobile = false;
    render(<WelcomeBanner />);
    expect(screen.getByText('tip_compose')).toBeInTheDocument();
    expect(screen.getByText('tip_shortcuts')).toBeInTheDocument();
  });

  it('gives touch tips on a phone', () => {
    device.isMobile = true;
    render(<WelcomeBanner />);
    expect(screen.getByText('tip_compose_touch')).toBeInTheDocument();
    expect(screen.getByText('tip_sidebar_touch')).toBeInTheDocument();
    expect(screen.queryByText('tip_shortcuts')).toBeNull();
  });
});
