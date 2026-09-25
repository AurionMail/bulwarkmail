import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContactForm } from '../contact-form';
import type { ContactCard, ContactMedia } from '@/lib/jmap/types';
import { useAuthStore } from '@/stores/auth-store';
import { clearContactPhotoCache } from '@/lib/contact-photo-cache';

const existingContact: ContactCard = {
  id: '1',
  addressBookIds: {},
  name: { components: [{ kind: 'given', value: 'Alice' }, { kind: 'surname', value: 'Smith' }], isOrdered: true },
  emails: { e0: { address: 'alice@example.com' } },
  phones: { p0: { number: '+33612345678' } },
  organizations: { o0: { name: 'Acme Corp' } },
  notes: { n0: { note: 'VIP' } },
};

describe('ContactForm', () => {
  it('renders create form with empty fields', () => {
    render(<ContactForm onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('create_title')).toBeInTheDocument();
    const inputs = screen.getAllByRole('textbox');
    const emptyInputs = inputs.filter(i => (i as HTMLInputElement).value === '');
    expect(emptyInputs.length).toBeGreaterThan(0);
  });

  it('renders edit form with pre-populated data', () => {
    render(<ContactForm contact={existingContact} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('edit_title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Smith')).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ContactForm onSave={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows error on submit with empty name', async () => {
    const onSave = vi.fn();
    render(<ContactForm onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.submit(screen.getByText('save').closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('name_required')).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('adds email entry when add button is clicked', () => {
    render(<ContactForm onSave={vi.fn()} onCancel={vi.fn()} />);
    const emailInputsBefore = screen.getAllByPlaceholderText('email_placeholder');
    fireEvent.click(screen.getByText('add_email'));
    const emailInputsAfter = screen.getAllByPlaceholderText('email_placeholder');
    expect(emailInputsAfter.length).toBe(emailInputsBefore.length + 1);
  });

  it('adds phone entry when add button is clicked', () => {
    render(<ContactForm onSave={vi.fn()} onCancel={vi.fn()} />);
    const phoneBefore = screen.queryAllByPlaceholderText('phone_placeholder');
    fireEvent.click(screen.getByText('add_phone'));
    const phoneAfter = screen.getAllByPlaceholderText('phone_placeholder');
    expect(phoneAfter.length).toBe(phoneBefore.length + 1);
  });

  it('sends media: null when an existing photo is removed', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const contactWithPhoto: ContactCard = {
      ...existingContact,
      media: {
        photo: { kind: 'photo', uri: 'data:image/png;base64,AAAA', mediaType: 'image/png' },
      },
    };
    render(<ContactForm contact={contactWithPhoto} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText('remove_photo'));
    fireEvent.submit(screen.getByText('save').closest('form')!);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });

    const savedData = onSave.mock.calls[0][0];
    expect(savedData.media).toBeNull();
  });

  describe('photos (P0-3)', () => {
    // The same PHOTO as ContactCard/get returns it on each version.
    const photo0_16_23: ContactMedia = { kind: 'photo', uri: 'data:image/jpeg;base64,/9j/', mediaType: 'image/jpeg' };
    const photo0_16_0: ContactMedia = { kind: 'photo', uri: 'data:base64,/9j/' };
    const photo1_0: ContactMedia = { kind: 'photo', blobId: 'dbcX', mediaType: 'image/jpeg' };
    const logo1_0: ContactMedia = { kind: 'logo', blobId: 'dbcLogo', mediaType: 'image/png' };
    const fetchBlob = vi.fn(async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));

    beforeEach(() => {
      clearContactPhotoCache();
      fetchBlob.mockClear();
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:preview');
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      useAuthStore.setState({ client: { fetchBlob } as never });
    });

    afterEach(() => {
      useAuthStore.setState({ client: null });
      clearContactPhotoCache();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const withMedia = (media: Record<string, ContactMedia>): ContactCard => ({ ...existingContact, media });

    async function submitPhoneChange(contact: ContactCard) {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<ContactForm contact={contact} onSave={onSave} onCancel={vi.fn()} />);
      fireEvent.change(screen.getByDisplayValue('+33612345678'), { target: { value: '+33699999999' } });
      fireEvent.submit(screen.getByText('save').closest('form')!);
      await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      return onSave;
    }

    it('leaves media out when only the phone changes on Stalwart 1.0', async () => {
      const onSave = await submitPhoneChange(withMedia({ photo: photo1_0, logo: logo1_0 }));
      expect('media' in onSave.mock.calls[0][0]).toBe(false);
      expect(onSave.mock.calls[0]).toHaveLength(1);
    });

    it.each([
      ['0.16.23', photo0_16_23],
      ['0.16.0', photo0_16_0],
    ])('leaves media out when only the phone changes on Stalwart %s', async (_version, photo) => {
      const onSave = await submitPhoneChange(withMedia({ m0: photo }));
      expect('media' in onSave.mock.calls[0][0]).toBe(false);
    });

    it('shows a Stalwart 1.0 photo in the preview by downloading it', async () => {
      render(<ContactForm contact={withMedia({ photo: photo1_0 })} onSave={vi.fn()} onCancel={vi.fn()} />);

      await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:preview'));
      expect(fetchBlob).toHaveBeenCalledWith('dbcX', 'photo', 'image/jpeg', undefined);
      expect(screen.getByText('remove_photo')).toBeInTheDocument();
    });

    it('keeps the logo when the Stalwart 1.0 photo is removed', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<ContactForm contact={withMedia({ photo: photo1_0, logo: logo1_0 })} onSave={onSave} onCancel={vi.fn()} />);

      fireEvent.click(screen.getByText('remove_photo'));
      fireEvent.submit(screen.getByText('save').closest('form')!);

      await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      expect(onSave.mock.calls[0][0].media).toEqual({ logo: logo1_0 });
    });

    it('sends media: null when the only Stalwart 1.0 photo is removed', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<ContactForm contact={withMedia({ photo: photo1_0 })} onSave={onSave} onCancel={vi.fn()} />);

      fireEvent.click(screen.getByText('remove_photo'));
      expect(screen.queryByText('remove_photo')).not.toBeInTheDocument();
      fireEvent.submit(screen.getByText('save').closest('form')!);

      await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      expect(onSave.mock.calls[0][0].media).toBeNull();
    });

    it('puts a new photo under the old key as a data: URI, keeps the logo and names it for the upload', async () => {
      // processImageFile draws the picked file onto a canvas.
      vi.stubGlobal('Image', class {
        width = 1024;
        height = 768;
        onload: (() => void) | null = null;
        set src(_value: string) { setTimeout(() => this.onload?.(), 0); }
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/NEW');
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { container } = render(
        <ContactForm contact={withMedia({ photo: photo1_0, logo: logo1_0 })} onSave={onSave} onCancel={vi.fn()} />,
      );
      await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:preview'));

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(['jpeg'], 'me.jpg', { type: 'image/jpeg' })] } });
      await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/NEW'));
      fireEvent.submit(screen.getByText('save').closest('form')!);

      await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      const [saved, options] = onSave.mock.calls[0];
      expect(saved.media).toEqual({
        photo: { kind: 'photo', uri: 'data:image/jpeg;base64,/9j/NEW', mediaType: 'image/jpeg' },
        logo: logo1_0,
      });
      expect(options).toEqual({ photoKey: 'photo' });
      // The downloaded preview is an object URL; it must never be written back.
      expect(JSON.stringify(saved)).not.toContain('blob:');
    });

    it('gives a first photo a key no other entry uses', async () => {
      vi.stubGlobal('Image', class {
        width = 10;
        height = 10;
        onload: (() => void) | null = null;
        set src(_value: string) { setTimeout(() => this.onload?.(), 0); }
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,/9j/NEW');
      const onSave = vi.fn().mockResolvedValue(undefined);
      const { container } = render(
        <ContactForm contact={withMedia({ photo: logo1_0 })} onSave={onSave} onCancel={vi.fn()} />,
      );

      fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
        target: { files: [new File(['jpeg'], 'me.jpg', { type: 'image/jpeg' })] },
      });
      await waitFor(() => expect(screen.getByText('remove_photo')).toBeInTheDocument());
      fireEvent.submit(screen.getByText('save').closest('form')!);

      await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      expect(onSave.mock.calls[0][0].media).toEqual({
        photo: logo1_0,
        photo1: { kind: 'photo', uri: 'data:image/jpeg;base64,/9j/NEW', mediaType: 'image/jpeg' },
      });
      expect(onSave.mock.calls[0][1]).toEqual({ photoKey: 'photo1' });
    });
  });

  it('submits form data correctly', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ContactForm onSave={onSave} onCancel={vi.fn()} />);

    const _inputs = screen.getAllByRole('textbox');
    const givenNameInput = screen.getByPlaceholderText('given_name');
    fireEvent.change(givenNameInput, { target: { value: 'Jane' } });

    fireEvent.submit(screen.getByText('save').closest('form')!);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });

    const savedData = onSave.mock.calls[0][0];
    expect(savedData.name.components).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'given', value: 'Jane' })])
    );
  });

  it('sets name.full from the name components so exported vCards carry FN (#430)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ContactForm onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('given_name'), { target: { value: 'ABTest' } });
    fireEvent.change(screen.getByPlaceholderText('surname'), { target: { value: 'Web' } });
    fireEvent.submit(screen.getByText('save').closest('form')!);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });

    expect(onSave.mock.calls[0][0].name.full).toBe('ABTest Web');
  });

  it('saves an organization-only card when the organization type is selected', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ContactForm onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText('type_organization'));
    fireEvent.change(screen.getByPlaceholderText('organization_placeholder'), { target: { value: 'Acme Corp' } });
    fireEvent.submit(screen.getByText('save').closest('form')!);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });

    const savedData = onSave.mock.calls[0][0];
    expect(savedData.kind).toBe('org');
    expect(savedData.organizations.o0.name).toBe('Acme Corp');
    // No personal name components; the org name carries the display name instead.
    expect(savedData.name.components).toBeUndefined();
    expect(savedData.name.full).toBe('Acme Corp');
  });

  it('hides the personal name fields in organization mode', () => {
    render(<ContactForm onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByPlaceholderText('given_name')).toBeInTheDocument();

    fireEvent.click(screen.getByText('type_organization'));

    expect(screen.queryByPlaceholderText('given_name')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('surname')).not.toBeInTheDocument();
    // The organization field moves into the identity section, so it appears once.
    expect(screen.getAllByPlaceholderText('organization_placeholder')).toHaveLength(1);
  });

  it('still requires a name in organization mode', async () => {
    const onSave = vi.fn();
    render(<ContactForm onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText('type_organization'));
    fireEvent.submit(screen.getByText('save').closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('name_required')).toBeInTheDocument();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('accepts an organization instead of a personal name in person mode', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ContactForm onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText('section_work'));
    fireEvent.change(screen.getByPlaceholderText('organization_placeholder'), { target: { value: 'Acme Corp' } });
    fireEvent.submit(screen.getByText('save').closest('form')!);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });
    expect(onSave.mock.calls[0][0].name.full).toBe('Acme Corp');
  });

  it('opens an existing org card in organization mode', () => {
    const orgContact: ContactCard = {
      id: '2',
      addressBookIds: {},
      kind: 'org',
      name: { full: 'Acme Corp' },
      organizations: { o0: { name: 'Acme Corp' } },
    };
    render(<ContactForm contact={orgContact} onSave={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByPlaceholderText('given_name')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme Corp')).toBeInTheDocument();
  });

  it('switches an org card back to a person', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const orgContact: ContactCard = {
      id: '2',
      addressBookIds: {},
      kind: 'org',
      name: { full: 'Acme Corp' },
      organizations: { o0: { name: 'Acme Corp' } },
    };
    render(<ContactForm contact={orgContact} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText('type_person'));
    fireEvent.change(screen.getByPlaceholderText('given_name'), { target: { value: 'Jane' } });
    fireEvent.submit(screen.getByText('save').closest('form')!);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });
    expect(onSave.mock.calls[0][0].kind).toBe('individual');
  });
});
