// React's onFocus/onBlur listen to focusin/focusout — RTL's fireEvent fires both.
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { SearchBox } from '../search-box';
import { useSearchHistoryStore } from '@/stores/search-history-store';

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ name, email }: { name?: string; email?: string }) => (
    React.createElement('span', { 'data-testid': 'avatar' }, name || email)
  ),
}));

vi.mock('@/stores/contact-store', () => {
  const state = {
    contacts: [],
    recentRecipients: [],
    directoryPrincipals: [],
    getAutocomplete: (query: string) => {
      const all = [
        { name: 'Mustafa Kemal', email: 'mustafa@example.com' },
        { name: 'Mustafa Sandal', email: 'sandal@example.com' },
        { name: 'Marketing', email: '', group: { id: 'g1', memberCount: 3 } },
        { name: 'Alice Doe', email: 'alice@example.com' },
      ];
      const q = query.toLowerCase();
      return all.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    },
  };
  const hook = (sel?: (s: typeof state) => unknown) => (typeof sel === 'function' ? sel(state) : state);
  hook.getState = () => state;
  hook.setState = (p: Partial<typeof state>) => Object.assign(state, p);
  return { useContactStore: hook };
});

function Harness(props: Partial<React.ComponentProps<typeof SearchBox>> & { initial?: string }) {
  const [value, setValue] = React.useState(props.initial ?? '');
  return (
    <SearchBox
      value={value}
      onChange={(v) => { setValue(v); props.onChange?.(v); }}
      onSubmit={props.onSubmit ?? (() => {})}
      onClear={props.onClear ?? (() => {})}
      onSelectContact={props.onSelectContact ?? (() => {})}
      disabled={props.disabled}
    />
  );
}

function input() {
  return screen.getByRole('combobox') as HTMLInputElement;
}

describe('SearchBox suggestions (#845)', () => {
  beforeEach(() => {
    useSearchHistoryStore.setState({ recentSearches: [] });
  });

  it('shows nothing on focus when there is no history and no query', () => {
    render(<Harness />);
    fireEvent.focus(input());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows recent searches on focus with an empty query', () => {
    useSearchHistoryStore.setState({ recentSearches: ['invoice', 'q3 report'] });
    render(<Harness />);
    fireEvent.focus(input());
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['invoice', 'q3 report']);
    expect(screen.getByText('suggestions_recent')).toBeInTheDocument();
  });

  it('lists matching contacts while typing, without groups, with the match highlighted', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'musta' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Mustafa Kemal');
    expect(options[0]).toHaveTextContent('<mustafa@example.com>');
    expect(options[1]).toHaveTextContent('Mustafa Sandal');
    expect(screen.queryByText(/Marketing/)).toBeNull();
    const marks = options[0].querySelectorAll('mark');
    // "Musta" in the name and "musta" in the address are both emphasised.
    expect(Array.from(marks).map((m) => m.textContent)).toEqual(['Musta', 'musta']);
    expect(screen.getByText('suggestions_people')).toBeInTheDocument();
  });

  it('clicking a contact runs a from: search and closes the dropdown', () => {
    const onSelectContact = vi.fn();
    render(<Harness onSelectContact={onSelectContact} />);
    fireEvent.change(input(), { target: { value: 'sandal' } });
    fireEvent.mouseDown(screen.getByRole('option'));
    expect(onSelectContact).toHaveBeenCalledWith({ name: 'Mustafa Sandal', email: 'sandal@example.com' }, 'from');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('the "to" action runs a to: search for the contact', () => {
    const onSelectContact = vi.fn();
    render(<Harness onSelectContact={onSelectContact} />);
    fireEvent.change(input(), { target: { value: 'alice' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: 'suggestions_to' }));
    expect(onSelectContact).toHaveBeenCalledWith({ name: 'Alice Doe', email: 'alice@example.com' }, 'to');
  });

  it('navigates with the arrow keys and picks with Enter', () => {
    const onSelectContact = vi.fn();
    const onSubmit = vi.fn();
    useSearchHistoryStore.setState({ recentSearches: ['mustafa invoice'] });
    render(<Harness onSelectContact={onSelectContact} onSubmit={onSubmit} />);
    const el = input();
    fireEvent.change(el, { target: { value: 'musta' } });
    // recent, Mustafa Kemal, Mustafa Sandal
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(el).toHaveAttribute('aria-expanded', 'true');
    expect(el).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    const options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(el).toHaveAttribute('aria-activedescendant', options[1].id);

    // Does not run past the last entry.
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(el, { key: 'ArrowUp' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onSelectContact).toHaveBeenCalledWith({ name: 'Mustafa Kemal', email: 'mustafa@example.com' }, 'from');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Enter with a highlighted recent search submits that query', () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    useSearchHistoryStore.setState({ recentSearches: ['mustafa invoice'] });
    render(<Harness onSubmit={onSubmit} onChange={onChange} />);
    const el = input();
    fireEvent.change(el, { target: { value: 'musta' } });
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('mustafa invoice');
    expect(onSubmit).toHaveBeenCalledWith('mustafa invoice');
    expect(el.value).toBe('mustafa invoice');
  });

  it('Enter with nothing highlighted submits the typed text', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const el = input();
    fireEvent.change(el, { target: { value: 'musta' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.submit(el.closest('form')!);
    expect(onSubmit).toHaveBeenCalledWith('musta');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape closes the dropdown and ArrowDown reopens it', () => {
    render(<Harness />);
    const el = input();
    fireEvent.change(el, { target: { value: 'musta' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(el).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('blur closes the dropdown', () => {
    render(<Harness />);
    const el = input();
    fireEvent.change(el, { target: { value: 'musta' } });
    fireEvent.blur(el, { relatedTarget: null });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('removing a recent search updates the list without closing it', () => {
    useSearchHistoryStore.setState({ recentSearches: ['invoice', 'q3 report'] });
    render(<Harness />);
    fireEvent.focus(input());
    const remove = screen.getAllByRole('button', { name: 'suggestions_remove_recent' });
    act(() => { fireEvent.mouseDown(remove[0]); });
    expect(useSearchHistoryStore.getState().recentSearches).toEqual(['q3 report']);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['q3 report']);
  });

  it('never opens while disabled', () => {
    useSearchHistoryStore.setState({ recentSearches: ['invoice'] });
    render(<Harness disabled />);
    fireEvent.focus(input());
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('SearchBox and password managers', () => {
  it('is a search field, which Bitwarden never offers to fill', () => {
    // data-bwignore only works when the user opted in to it in Bitwarden.
    render(<Harness />);
    expect(input()).toHaveAttribute('type', 'search');
  });
});
