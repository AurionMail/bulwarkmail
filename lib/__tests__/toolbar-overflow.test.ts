import { describe, expect, it } from 'vitest';
import { itemsToHide, type MeasuredToolbarItem } from '../toolbar-overflow';

// The viewer toolbar hides its least important items until it fits. It used
// to hide one item, re-read the layout, and repeat; itemsToHide decides the
// same from one measurement. The reference below is that loop, run against a
// flex-row model (a group is its visible items plus a gap between each two).

type Item = MeasuredToolbarItem;

function groupWidth(items: Item[], hidden: Set<number>, group: string, gap: number): number {
  const shown = items.filter((it, i) => it.group === group && it.width > 0 && !hidden.has(i));
  return shown.reduce((sum, it) => sum + it.width, 0) + Math.max(0, shown.length - 1) * gap;
}

function hideOneByOne(items: Item[], fixed: Record<string, number>, gaps: Record<string, number>, available: number): number[] {
  const hidden = new Set<number>();
  const width = () => Object.keys(fixed).reduce((sum, g) => sum + fixed[g] + groupWidth(items, hidden, g, gaps[g]), 0);
  for (let i = 0; i < items.length; i++) {
    if (width() <= available) break;
    if (items[i].width === 0) continue;
    hidden.add(i);
  }
  return [...hidden];
}

function decideAtOnce(items: Item[], fixed: Record<string, number>, gaps: Record<string, number>, available: number): number[] {
  const width = Object.keys(fixed).reduce((sum, g) => sum + fixed[g] + groupWidth(items, new Set(), g, gaps[g]), 0);
  return itemsToHide(items, width - available, gaps);
}

describe('itemsToHide', () => {
  const gaps: Record<string, number> = { left: 4, right: 8 };
  const fixed: Record<string, number> = { left: 0, right: 0 };
  const items: Item[] = [
    { width: 32, group: 'right' },
    { width: 0, group: 'right' },   // hidden by CSS
    { width: 90, group: 'left' },
    { width: 32, group: 'right' },
    { width: 60, group: 'left' },
    { width: 32, group: 'right' },
  ];

  it('hides nothing when the toolbar fits', () => {
    expect(itemsToHide(items, 0, gaps)).toEqual([]);
    expect(itemsToHide(items, -40, gaps)).toEqual([]);
  });

  it('skips items CSS already hides', () => {
    expect(itemsToHide(items, 50, gaps)).toEqual([0, 2]);
  });

  it('agrees with hiding one item at a time and re-measuring', () => {
    const full = Object.keys(fixed).reduce((sum, g) => sum + groupWidth(items, new Set(), g, gaps[g]), 0);
    for (let available = 0; available <= full + 10; available++) {
      expect(decideAtOnce(items, fixed, gaps, available)).toEqual(hideOneByOne(items, fixed, gaps, available));
    }
  });
});
