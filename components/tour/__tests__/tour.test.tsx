import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The tour on a phone, where the rail's anchors are not rendered, and its
// keyboard handling.

const tour = vi.hoisted(() => ({
  currentStep: 0,
  nextStep: vi.fn(),
  prevStep: vi.fn(),
  stopTour: vi.fn(),
}));

vi.mock('../tour-provider', () => ({
  useTour: () => ({
    currentStep: tour.currentStep,
    totalSteps: 3,
    steps: [
      { id: 'one', target: '[data-tour="one"]', titleKey: 'one', descriptionKey: 'one_desc', placement: 'right' },
      { id: 'two', target: '[data-tour="two"]', titleKey: 'two', descriptionKey: 'two_desc', placement: 'right' },
      { id: 'three', target: '[data-tour="three"]', titleKey: 'three', descriptionKey: 'three_desc', placement: 'right' },
    ],
    nextStep: tour.nextStep,
    prevStep: tour.prevStep,
    stopTour: tour.stopTour,
  }),
}));

const { TourOverlay, findTourTarget } = await import('../tour-overlay');
const { getTourSteps } = await import('../tour-steps');

/** jsdom lays nothing out: give the elements marked `data-size` a box. */
const realRect = HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  vi.useFakeTimers();
  tour.currentStep = 0;
  tour.nextStep.mockClear();
  tour.prevStep.mockClear();
  tour.stopTour.mockClear();
  HTMLElement.prototype.getBoundingClientRect = function () {
    const sized = this.hasAttribute('data-size');
    return { top: 10, left: 10, width: sized ? 40 : 0, height: sized ? 40 : 0, right: 50, bottom: 50, x: 10, y: 10, toJSON: () => ({}) } as DOMRect;
  };
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  HTMLElement.prototype.getBoundingClientRect = realRect;
  hosts.splice(0).forEach((h) => h.remove());
  document.documentElement.removeAttribute('dir');
});

const hosts: HTMLElement[] = [];
function anchors(html: string) {
  const host = document.createElement('div');
  hosts.push(host);
  host.innerHTML = html;
  document.body.appendChild(host);
}

describe('tour targets', () => {
  it('points at the copy of an anchor that is on screen', () => {
    anchors('<a data-tour="one" id="rail"></a><a data-tour="one" id="tabbar" data-size></a>');
    expect(findTourTarget('[data-tour="one"]')?.id).toBe('tabbar');
  });

  it('skips a step whose target is in the page but not shown, instead of leaving the user behind the overlay', () => {
    anchors('<a data-tour="one"></a>');
    render(<TourOverlay />);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(tour.nextStep).toHaveBeenCalledTimes(1);
  });

  it('shows a step whose target is on screen', () => {
    anchors('<a data-tour="one" data-size></a>');
    render(<TourOverlay />);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(tour.nextStep).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'one' })).toBeInTheDocument();
  });

  it('leaves out the shortcuts step on a touch screen and contacts when they are off', () => {
    const ids = (o: Partial<Parameters<typeof getTourSteps>[0]>) =>
      getTourSteps({ isDemoMode: false, supportsCalendar: true, supportsWebDAV: true, ...o }).map((s) => s.id);
    expect(ids({})).toContain('shortcuts');
    expect(ids({ touch: true })).not.toContain('shortcuts');
    expect(ids({})).toContain('nav-contacts');
    expect(ids({ supportsContacts: false })).not.toContain('nav-contacts');
  });
});

describe('tour keyboard', () => {
  function showStep() {
    anchors('<a data-tour="one" data-size></a>');
    render(<TourOverlay />);
    act(() => { vi.advanceTimersByTime(400); });
  }

  it('lets Enter press the focused Skip button instead of going to the next step', () => {
    showStep();
    const skip = screen.getByRole('button', { name: 'tour.skip' });
    skip.focus();
    act(() => { fireEvent.keyDown(skip, { key: 'Enter' }); });
    expect(tour.nextStep).not.toHaveBeenCalled();
  });

  it('still goes on with Enter when no button has the focus', () => {
    showStep();
    act(() => { fireEvent.keyDown(document.body, { key: 'Enter' }); });
    expect(tour.nextStep).toHaveBeenCalledTimes(1);
  });

  it('leaves Enter and the arrows to a field being typed in', () => {
    showStep();
    const field = document.createElement('input');
    hosts[0].appendChild(field);
    act(() => { fireEvent.keyDown(field, { key: 'Enter' }); });
    act(() => { fireEvent.keyDown(field, { key: 'ArrowRight' }); });
    expect(tour.nextStep).not.toHaveBeenCalled();
  });

  it('mirrors the arrows in right-to-left languages', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    showStep();
    act(() => { fireEvent.keyDown(document.body, { key: 'ArrowLeft' }); });
    expect(tour.nextStep).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.keyDown(document.body, { key: 'ArrowRight' }); });
    expect(tour.prevStep).toHaveBeenCalledTimes(1);
  });
});
