import { InfrastructureError } from '@/shared-kernel/errors/InfrastructureError.js';

export class GoogleApiError extends InfrastructureError {
  readonly code: string;

  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.code = `GOOGLE_API_${status}`;
  }
}
