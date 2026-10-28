import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The phone header cluster (⋮ with notifications and the command palette,
// then the account avatar) that every app shows at phone width.

const media = vi.hoisted(() => ({ mobile: true, desktop: false }));
vi.mock('@/hooks/use-media-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-media-query')>()),
  useIsMobile: () => media.mobile,
  useIsDesktop: () => media.desktop,
}));

const { PhoneHeaderActions, PhoneAppHeader } = await import('../phone-header-actions');
const { ContactList } = await import('@/components/contacts/contact-list');
const { ContextMenuItem } = await import('@/components/ui/context-menu');

beforeEach(() => {
  media.mobile = true;
  media.desktop = false;
});

describe('PhoneHeaderActions', () => {
  it('shows the menu and the account avatar on a phone', () => {
    render(<PhoneHeaderActions />);
    expect(screen.getByRole('button', { name: 'switch_account' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    // Notifications and the command palette (both "title" as keys in tests).
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['title', 'title']);
  });

  it('opens the command palette from the menu', () => {
    const opened = vi.fn();
    window.addEventListener('bulwark:command-palette', opened);
    render(<PhoneHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    fireEvent.click(screen.getAllByRole('menuitem')[1]);
    expect(opened).toHaveBeenCalled();
    window.removeEventListener('bulwark:command-palette', opened);
  });

  it('lists the app entries first and closes the menu when one is picked', () => {
    const run = vi.fn();
    render(
      <PhoneHeaderActions
        menuItems={(close) => <ContextMenuItem label="Import" onClick={() => { close(); run(); }} />}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Import');
    fireEvent.click(items[0]);
    expect(run).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('draws nothing where the rail holds these controls', () => {
    media.desktop = true;
    media.mobile = false;
    const { container } = render(<PhoneHeaderActions />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws nothing on a tablet for an app that keeps the rail there', () => {
    media.mobile = false;
    const { container } = render(<PhoneHeaderActions below="md" />);
    expect(container).toBeEmptyDOMElement();
    render(<PhoneHeaderActions />);
    expect(screen.getByRole('button', { name: 'more' })).toBeInTheDocument();
  });
});

describe('PhoneAppHeader', () => {
  it('gives a screen without a header a title and the cluster', () => {
    render(<PhoneAppHeader title="Kanban" below="md" />);
    expect(screen.getByRole('heading', { name: 'Kanban' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'more' })).toBeInTheDocument();
  });
});

describe('apps use it', () => {
  it('puts the cluster in the Contacts list header on a phone', () => {
    render(
      <ContactList
        contacts={[]}
        selectedContactId={null}
        searchQuery=""
        onSearchChange={vi.fn()}
        onSelectContact={vi.fn()}
        onCreateNew={vi.fn()}
        selectedContactIds={new Set<string>()}
        onToggleSelection={vi.fn()}
        onSelectRangeContacts={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkAddToGroup={vi.fn()}
        onBulkExport={vi.fn()}
        onEditContact={vi.fn()}
        onDeleteContact={vi.fn()}
        onAddContactToGroup={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'more' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'switch_account' })).toBeInTheDocument();
  });
});
