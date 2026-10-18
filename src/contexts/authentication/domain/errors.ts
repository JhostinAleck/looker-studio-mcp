import { DomainError } from '@/shared-kernel/errors/DomainError.js';

export class NotSignedInError extends DomainError {
  readonly code = 'NOT_SIGNED_IN';
  readonly userMessage =
    'The Looker Studio browser profile is not signed in. Run `looker-studio-mcp login` and sign in with your Google account.';
}

export class CredentialsUnavailableError extends DomainError {
  readonly code = 'CREDENTIALS_UNAVAILABLE';
  readonly userMessage: string;

  constructor(detail: string, cause?: Error) {
    super(detail, cause);
    this.userMessage = `Google credentials are not available: ${detail}. Set auth.credentials in ~/.looker-studio-mcp/config.yaml or run \`looker-studio-mcp auth --test\`.`;
  }
}
