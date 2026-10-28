import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ContextMenu, ContextMenuSubMenu, ContextMenuItem } from '../context-menu';

// jsdom can't match `pointer: coarse`, so this checks the rule is on the rows:
// 44px on a touch screen (R7), the desktop's own height elsewhere.
describe('ContextMenu rows on a touch screen', () => {
  it('gives items and submenu entries a 44px minimum height under a coarse pointer only', () => {
    render(
      <ContextMenu isOpen position={{ x: 10, y: 10 }} onClose={() => {}}>
        <ContextMenuItem label="Reply" onClick={() => {}} />
        <ContextMenuSubMenu label="Move to" testId="sub">
          <ContextMenuItem label="Archive" onClick={() => {}} />
        </ContextMenuSubMenu>
      </ContextMenu>,
    );
    const item = screen.getByRole('menuitem', { name: 'Reply' });
    const sub = screen.getByTestId('sub');
    for (const row of [item, sub]) {
      expect(row.className).toContain('pointer-coarse:min-h-11');
      expect(row.className).toContain('py-1.5');
      expect(row.className).not.toMatch(/(^|\s)min-h-11/);
    }
  });

  it('hides key hints under a coarse pointer only (R8)', () => {
    render(
      <ContextMenu isOpen position={{ x: 10, y: 10 }} onClose={() => {}}>
        <ContextMenuItem label="Rename" shortcut="F2" onClick={() => {}} />
      </ContextMenu>,
    );
    const hint = screen.getByText('F2');
    expect(hint.className).toContain('pointer-coarse:hidden');
    expect(hint.className).not.toMatch(/(^|\s)hidden/);
  });
});
