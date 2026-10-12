import { describe, it, expect } from 'vitest';
import { mountainViewHoverActions } from '../email-hover-actions';

describe('mountainViewHoverActions', () => {
  it("uses Gmail's actions in Gmail's order while the defaults are untouched", () => {
    expect(mountainViewHoverActions(['delete', 'star', 'markRead', 'archive'])).toEqual(['archive', 'delete', 'markRead']);
  });

  it("keeps the user's own choice, minus the star the row already has", () => {
    expect(mountainViewHoverActions(['star', 'tag', 'delete'])).toEqual(['tag', 'delete']);
  });
});
