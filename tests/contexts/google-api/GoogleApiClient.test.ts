import { describe, expect, it, vi } from 'vitest';

import { GoogleApiError } from '@/contexts/google-api/domain/GoogleApiError.js';
import { GoogleApiClient } from '@/contexts/google-api/infrastructure/GoogleApiClient.js';

const tokens = { getAccessToken: async () => 'tok', describeIdentity: async () => null };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('GoogleApiClient', () => {
  it('sends the bearer token and JSON body', async () => {
    const fetchFn = vi.fn(async () => json(200, { ok: true }));
    const api = new GoogleApiClient({ tokens, fetchFn });

    expect(await api.post('https://x/y', { a: 1 })).toEqual({ ok: true });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(init.body).toBe('{"a":1}');
  });

  it('retries 503 and then succeeds', async () => {
    const answers = [json(503, {}), json(200, { n: 2 })];
    const fetchFn = vi.fn(async () => answers.shift()!);
    const sleep = vi.fn(async () => undefined);
    const api = new GoogleApiClient({ tokens, fetchFn, sleep });

    expect(await api.get('https://x')).toEqual({ n: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('turns an error body into a GoogleApiError', async () => {
    const fetchFn = vi.fn(async () =>
      json(403, { error: { message: 'Access Denied', errors: [{ reason: 'accessDenied' }] } }),
    );
    const api = new GoogleApiClient({ tokens, fetchFn });

    const err = await api.get('https://x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ status: 403, reason: 'accessDenied', message: 'Access Denied' });
  });

  it('returns undefined for an empty 204 answer', async () => {
    const api = new GoogleApiClient({
      tokens,
      fetchFn: async () => new Response(null, { status: 204 }),
    });
    await expect(api.delete('https://x')).resolves.toBeUndefined();
  });
});
