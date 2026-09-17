import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      json: async () => data,
      status: init?.status ?? 200,
    }),
  },
}));

const getStalwartCredentials = vi.fn();
vi.mock('@/lib/stalwart/credentials', () => ({
  getStalwartCredentials: (...args: unknown[]) => getStalwartCredentials(...args),
}));

function mockRequest(body: unknown): unknown {
  return {
    json: async () => body,
    headers: { get: () => null },
    nextUrl: { searchParams: { get: () => null } },
  };
}

async function callRoute(body: unknown) {
  const { POST } = await import('@/app/api/translate/route');
  const res = (await POST(mockRequest(body) as Parameters<typeof POST>[0])) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

describe('translate route authentication (#903)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns 401 without a session and never contacts a backend', async () => {
    getStalwartCredentials.mockResolvedValue(null);

    const { status, body } = await callRoute({ text: 'Hallo Welt', target: 'en' });

    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Not authenticated' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps validating the body once a session is present', async () => {
    getStalwartCredentials.mockResolvedValue({ serverUrl: 'https://mail.example.com', authHeader: 'Basic x' });

    const { status } = await callRoute({ text: '   ', target: 'en' });

    expect(status).toBe(400);
  });

  it('translates through MyMemory for an authenticated caller', async () => {
    getStalwartCredentials.mockResolvedValue({ serverUrl: 'https://mail.example.com', authHeader: 'Basic x' });
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'Hello world' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { status, body } = await callRoute({ text: 'Hallo Welt', target: 'en', source: 'de' });

    expect(status).toBe(200);
    expect(body.translatedText).toBe('Hello world');
    expect(fetchSpy).toHaveBeenCalled();
  });
});
