import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComposerToolbarMenu, ComposerToolbarMenuItem, ComposerToolbarMenuCheckItem } from '../composer-toolbar-menu';
import { Paperclip } from '@/components/icons';

describe('ComposerToolbarMenu', () => {
  it('names the button with its label and shows how many options are on', () => {
    render(
      <ComposerToolbarMenu icon={Paperclip} label="Options" activeCount={2} testId="menu">
        {() => null}
      </ComposerToolbarMenu>
    );
    const button = screen.getByTestId('menu');
    expect(button).toHaveAccessibleName('Options');
    expect(button).toHaveTextContent('Options');
    expect(button).toHaveTextContent('2');
  });

  it('keeps the menu open while toggling options and closes on Escape or outside click', () => {
    const onToggle = vi.fn();
    render(
      <div>
        <button data-testid="outside">x</button>
        <ComposerToolbarMenu icon={Paperclip} label="Options" testId="menu">
          {() => (
            <ComposerToolbarMenuCheckItem checked={false} onToggle={onToggle} description="hint" testId="opt">
              Plain text
            </ComposerToolbarMenuCheckItem>
          )}
        </ComposerToolbarMenu>
      </div>
    );
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByTestId('menu'));
    expect(screen.getByTestId('menu')).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByTestId('opt'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByTestId('opt')).toHaveAttribute('aria-checked', 'false');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByTestId('menu'));
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes after picking a plain action item', () => {
    const onSelect = vi.fn();
    render(
      <ComposerToolbarMenu icon={Paperclip} label="Templates" testId="menu">
        {(close) => (
          <ComposerToolbarMenuItem onSelect={() => { close(); onSelect(); }} testId="item">
            Insert template
          </ComposerToolbarMenuItem>
        )}
      </ComposerToolbarMenu>
    );
    fireEvent.click(screen.getByTestId('menu'));
    fireEvent.click(screen.getByTestId('item'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
