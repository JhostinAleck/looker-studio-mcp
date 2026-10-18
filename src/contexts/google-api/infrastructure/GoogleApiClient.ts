import type { AccessTokenProvider } from '@/contexts/authentication/domain/AccessTokenProvider.js';
import { GoogleApiError } from '@/contexts/google-api/domain/GoogleApiError.js';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface GoogleApiClientOptions {
  tokens: AccessTokenProvider;
  fetchFn?: FetchFn;
  // Retries for 429 and 5xx answers.
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface GoogleErrorBody {
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string }>; status?: string };
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// Small JSON client shared by every Google REST API the server calls.
export class GoogleApiClient {
  private readonly fetchFn: FetchFn;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: GoogleApiClientOptions) {
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.maxRetries = opts.maxRetries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get<T>(url: string): Promise<T> {
    return this.request<T>('GET', url);
  }

  post<T>(url: string, body: unknown): Promise<T> {
    return this.request<T>('POST', url, body);
  }

  delete(url: string): Promise<void> {
    return this.request<void>('DELETE', url);
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.opts.tokens.getAccessToken();
      const res = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        await this.sleep(500 * 2 ** attempt);
        continue;
      }
      throw await toError(res);
    }
  }
}

async function toError(res: Response): Promise<GoogleApiError> {
  let parsed: GoogleErrorBody = {};
  try {
    parsed = (await res.json()) as GoogleErrorBody;
  } catch {
    // Non-JSON error page.
  }
  const reason = parsed.error?.errors?.[0]?.reason ?? parsed.error?.status ?? 'unknown';
  const message = parsed.error?.message ?? `${res.status} ${res.statusText}`;
  return new GoogleApiError(res.status, reason, message);
}
