import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemesSettings } from '../themes-settings';
import { useThemeStore } from '@/stores/theme-store';

// The gallery shows one row of cards until "Show all", keeps the active theme
// in that row, and opens when a search result points at a hidden theme.
// vitest.setup.ts renders labels as their raw keys; the built-in themes are
// the store's own.

function cardNames(): string[] {
  // Cards only: the embedded wrapper carries the section's own search label.
  return Array.from(document.querySelectorAll('[data-search-label].relative'))
    .map((el) => el.getAttribute('data-search-label') ?? '');
}

describe('ThemesSettings collapse', () => {
  beforeEach(() => {
    act(() => { useThemeStore.setState({ activeThemeId: null }); });
  });

  it('shows three cards and a Show all button', () => {
    render(<ThemesSettings embedded />);
    const total = useThemeStore.getState().installedThemes.length + 1;
    expect(total).toBeGreaterThan(3);
    expect(cardNames()).toHaveLength(3);
    expect(cardNames()[0]).toBe('default_name');
    expect(cardNames()).not.toContain('title');
    const button = screen.getByTestId('themes-show-all');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(cardNames()).toHaveLength(total);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    expect(cardNames()).toHaveLength(3);
  });

  it('keeps the active theme in the collapsed row', () => {
    const last = useThemeStore.getState().installedThemes.at(-1)!;
    act(() => { useThemeStore.setState({ activeThemeId: last.id }); });
    render(<ThemesSettings embedded />);
    expect(cardNames()).toHaveLength(3);
    expect(cardNames()).toContain(last.name);
  });

  it('opens for a search result that names a hidden theme', () => {
    const last = useThemeStore.getState().installedThemes.at(-1)!;
    render(<ThemesSettings embedded />);
    expect(cardNames()).not.toContain(last.name);
    act(() => { window.dispatchEvent(new CustomEvent('settings-reveal', { detail: { label: last.name } })); });
    expect(cardNames()).toContain(last.name);
  });
});
