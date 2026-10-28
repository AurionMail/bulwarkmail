import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContactForm } from '../contact-form';
import { ContactGroupDetail } from '../contact-group-detail';
import { ContactList } from '../contact-list';
import { FilePreviewModal } from '@/components/files/file-preview-modal';
import type { ContactCard } from '@/lib/jmap/types';

vi.mock('@/lib/standalone-display', () => ({ canOpenUrlInNewWindow: () => false }));

// Every button says what it does to a screen reader (R1): aria-label, or text.
function unnamedButtons(): HTMLElement[] {
  return screen.getAllByRole('button').filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim()));
}

const alice: ContactCard = {
  id: '1',
  addressBookIds: {},
  name: { components: [{ kind: 'given', value: 'Alice' }], isOrdered: true },
  emails: { e0: { address: 'alice@example.com' }, e1: { address: 'a@example.org' } },
  phones: { p0: { number: '+1 555' } },
  addresses: { a0: { street: 'Main St' } },
  keywords: { Friends: true },
};
const bob: ContactCard = { id: '2', addressBookIds: {}, name: { full: 'Bob' } };

describe('icon buttons in Contacts and Files have names', () => {
  it('in the contact form', () => {
    render(<ContactForm contact={alice} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(unnamedButtons()).toEqual([]);
  });

  it('on a group page', () => {
    const group = { id: 'g', kind: 'group', addressBookIds: {}, name: { full: 'Team' } } as ContactCard;
    render(<ContactGroupDetail group={group} members={[alice, bob]} onEdit={vi.fn()} onDelete={vi.fn()} onRemoveMember={vi.fn()} onSelectMember={vi.fn()} />);
    expect(unnamedButtons()).toEqual([]);
  });

  it('in the contact list while selecting', () => {
    render(
      <ContactList
        contacts={[alice, bob]} selectedContactId={null} searchQuery="" onSearchChange={vi.fn()} onSelectContact={vi.fn()}
        onCreateNew={vi.fn()} selectedContactIds={new Set(['1'])} onToggleSelection={vi.fn()} onSelectRangeContacts={vi.fn()}
        onSelectAll={vi.fn()} onClearSelection={vi.fn()} onBulkDelete={vi.fn()} onBulkAddToGroup={vi.fn()} onBulkExport={vi.fn()}
        onEditContact={vi.fn()} onDeleteContact={vi.fn()} onAddContactToGroup={vi.fn()} onMenuClick={vi.fn()}
      />,
    );
    expect(unnamedButtons()).toEqual([]);
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(2);
  });

  it('in the file preview', () => {
    render(<FilePreviewModal name="a.txt" onClose={vi.fn()} onDownload={vi.fn()} getFileContent={() => new Promise(() => {})} />);
    expect(unnamedButtons()).toEqual([]);
  });
});
