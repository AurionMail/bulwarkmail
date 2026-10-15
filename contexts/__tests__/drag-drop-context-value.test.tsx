import { memo, useState } from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DragDropProvider, useDragDropContext } from '../drag-drop-context';

// The provider sits in the mail view and re-renders with it on every open.
// Message rows and folders read the context, so a value that changes
// identity on each of those renders re-rendered all of them.

describe('DragDropProvider', () => {
  it('keeps the context value while no drag starts or ends', () => {
    let consumerRenders = 0;
    const Consumer = memo(function Consumer() {
      useDragDropContext();
      consumerRenders++;
      return null;
    });
    let rerenderParent!: () => void;
    function Parent() {
      const [, setTick] = useState(0);
      rerenderParent = () => setTick((t) => t + 1);
      return (
        <DragDropProvider>
          <Consumer />
        </DragDropProvider>
      );
    }

    render(<Parent />);
    const mounted = consumerRenders;
    act(() => rerenderParent());
    act(() => rerenderParent());
    expect(consumerRenders).toBe(mounted);
  });

  it('still tells consumers when a drag starts', () => {
    let seen: boolean[] = [];
    let start!: () => void;
    function Consumer() {
      const ctx = useDragDropContext();
      seen.push(ctx.isDragging);
      start = () => ctx.startDrag([], 'inbox');
      return null;
    }
    render(<DragDropProvider><Consumer /></DragDropProvider>);
    seen = [];
    act(() => start());
    expect(seen).toContain(true);
  });
});
