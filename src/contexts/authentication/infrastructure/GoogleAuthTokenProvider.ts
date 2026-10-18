import { GoogleAuth } from 'google-auth-library';

import type { AccessTokenProvider } from '@/contexts/authentication/domain/AccessTokenProvider.js';
import { CredentialsUnavailableError } from '@/contexts/authentication/domain/errors.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/bigquery',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
];

export interface GoogleAuthTokenProviderOptions {
  // Service account or authorized_user JSON. Omit to use Application Default Credentials.
  keyFile?: string;
}

export class GoogleAuthTokenProvider implements AccessTokenProvider {
  private readonly auth: GoogleAuth;

  constructor(opts: GoogleAuthTokenProviderOptions = {}) {
    this.auth = new GoogleAuth({
      scopes: GOOGLE_SCOPES,
      ...(opts.keyFile ? { keyFile: opts.keyFile } : {}),
    });
  }

  async getAccessToken(): Promise<string> {
    try {
      const token = await this.auth.getAccessToken();
      if (!token) throw new Error('empty access token');
      return token;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      throw new CredentialsUnavailableError(error.message, error);
    }
  }

  async describeIdentity(): Promise<string | null> {
    try {
      const credentials = await this.auth.getCredentials();
      if (credentials.client_email) return credentials.client_email;
      const token = await this.getAccessToken();
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const info = (await res.json()) as { email?: string };
      return info.email ?? null;
    } catch {
      return null;
    }
  }
}
