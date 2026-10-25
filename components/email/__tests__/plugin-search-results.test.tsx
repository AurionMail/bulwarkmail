import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { DEFAULT_SEARCH_FILTERS } from '@/lib/jmap/search-utils';
import { setActionDispatcher } from '@/lib/plugin-sandbox/actions';
import type { ProvidedSearchResult } from '@/lib/plugin-search-results';
import { useEmailStore } from '@/stores/email-store';
import { usePluginStore } from '@/stores/plugin-store';
import { PluginSearchResults } from '../plugin-search-results';

// The block above a search's message list with the entries plugins returned
// from onProvideSearchResults; a click goes back to the plugin as onAction.

const result = (pluginId: string, key: string, source?: string): ProvidedSearchResult =>
  ({ pluginId, key, title: `Title ${key}`, snippet: `Snippet ${key}`, ...(source ? { source } : {}) });

const dispatch = vi.fn(async () => {});

beforeEach(() => {
  setActionDispatcher(dispatch);
  usePluginStore.setState({ plugins: [{ id: 'chat', name: 'Team chat' }] } as never);
  useEmailStore.setState({ searchFilters: { ...DEFAULT_SEARCH_FILTERS } });
});

afterEach(() => {
  setActionDispatcher(null);
  dispatch.mockClear();
});

describe('PluginSearchResults', () => {
  it('shows nothing outside a search', () => {
    useEmailStore.setState({ searchQuery: '', externalSearchResults: [result('crm', 'a', 'CRM')] });
    const { container } = render(<PluginSearchResults surface="search-results" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the entries of a search by filters alone', () => {
    useEmailStore.setState({
      searchQuery: '',
      searchFilters: { ...DEFAULT_SEARCH_FILTERS, from: 'bob@x.test' },
      externalSearchResults: [result('crm', 'a', 'CRM')],
    });
    render(<PluginSearchResults surface="search-results" />);
    expect(screen.getByRole('region', { name: 'CRM' })).toHaveTextContent('Title a');
  });

  it('groups the entries by source, the plugin\'s name without one', () => {
    useEmailStore.setState({
      searchQuery: 'resolution',
      externalSearchResults: [result('crm', 'a', 'CRM'), result('chat', 'b'), result('crm', 'c', 'CRM')],
    });
    render(<PluginSearchResults surface="search-results" />);

    expect(screen.getByRole('region', { name: 'CRM' })).toHaveTextContent('Title a');
    expect(screen.getByRole('region', { name: 'CRM' })).toHaveTextContent('Title c');
    expect(screen.getByRole('region', { name: 'Team chat' })).toHaveTextContent('Snippet b');
  });

  it('sends a click to the plugin that gave the entry, with the query', () => {
    useEmailStore.setState({ searchQuery: 'resolution', externalSearchResults: [result('crm', 'mail-123', 'CRM')] });
    render(<PluginSearchResults surface="search-results" />);

    fireEvent.click(screen.getByRole('button', { name: /Title mail-123/ }));

    expect(dispatch).toHaveBeenCalledWith('crm', 'search-results', 'mail-123', { query: 'resolution' });
  });

  it('folds a group', () => {
    useEmailStore.setState({ searchQuery: 'resolution', externalSearchResults: [result('crm', 'a', 'CRM')] });
    render(<PluginSearchResults surface="search-results" />);

    const heading = screen.getByRole('button', { name: /^CRM/ });
    expect(heading).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(heading);

    expect(screen.queryByText('Title a')).toBeNull();
    expect(heading).toHaveAttribute('aria-expanded', 'false');
  });
});
