import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { iconForName } from '../named';

describe('icons by name', () => {
  it('draws the team inbox plugin\'s icons at once, without loading the whole set', () => {
    for (const name of ['user', 'check', 'user-check', 'user-x', 'circle-check', 'circle-dashed', 'arrow-back-up', 'user-plus']) {
      const Icon = iconForName(name)!;
      const { container, unmount } = render(<Icon data-testid="icon" />);
      // A curated icon draws its paths straight away; the lazy blank has none.
      expect(container.querySelector('svg path'), name).not.toBeNull();
      unmount();
    }
  });

  it('keeps the caller\'s attributes on the blank shown while an icon loads', () => {
    const Icon = iconForName('brand-mastodon')!;
    const { container } = render(<Icon data-testid="lazy" data-kind="x" className="w-3" size={12} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('data-testid')).toBe('lazy');
    expect(svg.getAttribute('data-kind')).toBe('x');
    expect(svg.getAttribute('class')).toBe('w-3');
    expect(svg.getAttribute('width')).toBe('12');
  });
});
