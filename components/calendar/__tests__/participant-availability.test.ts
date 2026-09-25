import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { availabilityFor, ParticipantAvailability } from '../participant-availability';
import { JMAPClient } from '@/lib/jmap/client';
import { useAuthStore } from '@/stores/auth-store';
import type { BusyPeriod } from '@/lib/jmap/types';

const period = (utcStart: string, utcEnd: string, busyStatus: BusyPeriod['busyStatus'] = 'confirmed'): BusyPeriod => ({
  utcStart,
  utcEnd,
  busyStatus,
});

const start = new Date('2026-09-01T10:00:00Z');
const end = new Date('2026-09-01T11:00:00Z');

describe('availabilityFor', () => {
  it('is free without an overlapping busy period', () => {
    expect(availabilityFor([], start, end)).toBe('free');
    // Adjacent periods do not overlap.
    expect(availabilityFor([period('2026-09-01T09:00:00Z', '2026-09-01T10:00:00Z'), period('2026-09-01T11:00:00Z', '2026-09-01T12:00:00Z')], start, end)).toBe('free');
  });

  it('is busy on any confirmed or unclassified overlap', () => {
    expect(availabilityFor([period('2026-09-01T10:30:00Z', '2026-09-01T10:45:00Z')], start, end)).toBe('busy');
    expect(availabilityFor([period('2026-09-01T09:00:00Z', '2026-09-01T12:00:00Z', null)], start, end)).toBe('busy');
    expect(availabilityFor([period('2026-09-01T09:00:00Z', '2026-09-01T12:00:00Z', 'unavailable')], start, end)).toBe('busy');
  });

  it('reports tentative unless a firm conflict exists too', () => {
    expect(availabilityFor([period('2026-09-01T10:30:00Z', '2026-09-01T10:45:00Z', 'tentative')], start, end)).toBe('tentative');
    expect(
      availabilityFor(
        [period('2026-09-01T10:30:00Z', '2026-09-01T10:45:00Z', 'tentative'), period('2026-09-01T10:50:00Z', '2026-09-01T11:30:00Z')],
        start,
        end,
      ),
    ).toBe('busy');
  });
});

type Call = [string, Record<string, unknown>, string];
type MethodResponse = [string, Record<string, unknown>, string];

const DIRECTORY = [
  { id: 'me', type: 'individual', name: 'me@example.com', description: 'Me', email: 'me@example.com' },
  { id: 'anna', type: 'individual', name: 'anna@example.com', description: 'Anna', email: 'anna@example.com' },
];

// The user's own principal as each server version returns it for
// properties ["id", "capabilities"].
const OWN_PRINCIPAL_1_0_DIRECTORY_OFF: MethodResponse = ['Principal/get', { accountId: 'me', state: 'n', list: [{
  id: 'me',
  capabilities: {
    'urn:ietf:params:jmap:mail': {},
    'urn:ietf:params:jmap:contacts': {},
    'urn:ietf:params:jmap:filenode': {},
    'urn:ietf:params:jmap:principals': {},
    'urn:ietf:params:jmap:calendars': { accountId: 'me', mayGetAvailability: false, mayShareWith: false, calendarAddress: 'mailto:me@example.com' },
  },
}], notFound: [] }, '0'];

const OWN_PRINCIPAL_0_16: MethodResponse = ['Principal/get', { accountId: 'me', state: 'n', list: [{
  id: 'me',
  capabilities: {
    'urn:ietf:params:jmap:mail': {},
    'urn:ietf:params:jmap:contacts': {},
    'urn:ietf:params:jmap:calendars': {},
    'urn:ietf:params:jmap:filenode': {},
    'urn:ietf:params:jmap:principals': {},
  },
}], notFound: [] }, '0'];

const NOT_AUTHORIZED: MethodResponse = ['error', { type: 'forbidden', description: 'You are not authorized to perform this action' }, '0'];
const DIRECTORY_QUERIES_OFF: MethodResponse = ['error', { type: 'forbidden', description: 'The administrator has disabled directory queries.' }, '0'];
const RATE_LIMITED: MethodResponse = ['error', { type: 'rateLimit', description: 'Too many availability requests, please try again later' }, '0'];

interface ServerScript {
  ownPrincipal: MethodResponse;
  /** Answer to the paged Principal/query + Principal/get; throws for an HTTP failure. */
  directory?: () => MethodResponse[];
  /** Answer to one Principal/getAvailability call; throws for an HTTP failure. */
  availability?: (principalId: string, callId: string) => MethodResponse;
}

function http500(): never {
  throw new Error('Request failed: 500 - Internal Server Error');
}

function makeClient(script: ServerScript) {
  const client = new JMAPClient('https://jmap.example.com', 'me@example.com', 'pass');
  Object.assign(client, {
    accountId: 'me',
    capabilities: {
      'urn:ietf:params:jmap:core': { maxObjectsInGet: 500, maxCallsInRequest: 16 },
      'urn:ietf:params:jmap:principals': {},
      'urn:ietf:params:jmap:principals:availability': { maxAvailabilityDuration: 'P365D' },
    },
    session: {
      accounts: {
        me: { name: 'me@example.com', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:principals': { currentUserPrincipalId: 'me' } } },
      },
    },
  });
  const requests: Call[][] = [];
  vi.spyOn(client as unknown as { request: (c: Call[]) => Promise<unknown> }, 'request')
    .mockImplementation(async (calls: Call[]) => {
      requests.push(calls);
      const [method, args] = calls[0];
      if (method === 'Principal/get') return { methodResponses: [script.ownPrincipal] };
      if (method === 'Principal/query') {
        return { methodResponses: script.directory ? script.directory() : [
          ['Principal/query', { ids: DIRECTORY.map((p) => p.id) }, '0'],
          ['Principal/get', { list: DIRECTORY, notFound: [] }, '1'],
        ] };
      }
      if (method === 'Principal/getAvailability') {
        return { methodResponses: calls.map(([, a, callId]) => script.availability!(a.id as string, callId)) };
      }
      throw new Error(`unexpected ${method} ${JSON.stringify(args)}`);
    });
  return { client, requests };
}

const methodsOf = (requests: Call[][]) => requests.map((calls) => calls.map((c) => c[0]).join('+'));

const attendees = [
  { name: 'Anna', email: 'anna@example.com' },
  { name: '', email: 'outsider@elsewhere.org' },
];

function renderFor(client: JMAPClient) {
  useAuthStore.setState({ client } as never);
  return render(createElement(ParticipantAvailability, { attendees, start, end }));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

describe('ParticipantAvailability', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    useAuthStore.setState({ client: null } as never);
    vi.restoreAllMocks();
  });

  it('stays hidden on Stalwart 1.0 with directory queries off, without looking anyone up', async () => {
    const { client, requests } = makeClient({ ownPrincipal: OWN_PRINCIPAL_1_0_DIRECTORY_OFF });
    renderFor(client);
    // Nothing shows while the server is asked, either.
    expect(screen.queryByTestId('participant-availability')).toBeNull();

    await waitFor(() => expect(requests).toHaveLength(1));
    await settle();

    expect(screen.queryByTestId('participant-availability')).toBeNull();
    expect(methodsOf(requests)).toEqual(['Principal/get']);
    expect(requests[0][0]).toEqual(['Principal/get', { accountId: 'me', ids: ['me'], properties: ['id', 'capabilities'] }, '0']);
  });

  it('checks attendees on Stalwart 0.16, whose principal capabilities are empty', async () => {
    const { client } = makeClient({
      ownPrincipal: OWN_PRINCIPAL_0_16,
      availability: (id, callId) => ['Principal/getAvailability', {
        list: id === 'anna' ? [{ utcStart: '2026-09-01T10:30:00Z', utcEnd: '2026-09-01T11:30:00Z', busyStatus: 'confirmed' }] : [],
      }, callId],
    });
    renderFor(client);

    // The i18n test mock renders the translation key.
    await waitFor(() => expect(screen.getByText('busy')).toBeInTheDocument(), { timeout: 2000 });
    // Found nowhere in a complete directory listing.
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });

  it('hides the block once getAvailability is refused with forbidden, and stays hidden', async () => {
    const { client, requests } = makeClient({
      ownPrincipal: OWN_PRINCIPAL_0_16,
      availability: () => DIRECTORY_QUERIES_OFF,
    });
    const first = renderFor(client);
    await waitFor(() => expect(methodsOf(requests)).toContain('Principal/getAvailability'), { timeout: 2000 });
    await waitFor(() => expect(screen.queryByTestId('participant-availability')).toBeNull());
    first.unmount();

    const calls = requests.length;
    renderFor(client);
    await settle();
    expect(screen.queryByTestId('participant-availability')).toBeNull();
    expect(requests).toHaveLength(calls);
  });

  it('stays hidden when the role may not read principals', async () => {
    const { client, requests } = makeClient({ ownPrincipal: NOT_AUTHORIZED });
    renderFor(client);

    await waitFor(() => expect(requests).toHaveLength(1));
    await settle();

    expect(screen.queryByTestId('participant-availability')).toBeNull();
    expect(methodsOf(requests)).toEqual(['Principal/get']);
  });

  it('says it could not check, not that the attendee is unknown, on rateLimit (1.0)', async () => {
    const { client } = makeClient({ ownPrincipal: OWN_PRINCIPAL_0_16, availability: () => RATE_LIMITED });
    renderFor(client);

    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.getByTestId('participant-availability')).toBeInTheDocument();
  });

  it('says it could not check on an HTTP 500', async () => {
    const { client } = makeClient({ ownPrincipal: OWN_PRINCIPAL_0_16, availability: http500 });
    renderFor(client);

    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument(), { timeout: 2000 });
  });

  it('calls no one "not a user" when the directory listing failed', async () => {
    const { client } = makeClient({
      ownPrincipal: OWN_PRINCIPAL_0_16,
      directory: http500,
      availability: (_id, callId) => ['Principal/getAvailability', { list: [] }, callId],
    });
    renderFor(client);

    await waitFor(() => expect(screen.getAllByText('error')).toHaveLength(2), { timeout: 2000 });
    expect(screen.queryByText('unknown')).toBeNull();
  });
});
