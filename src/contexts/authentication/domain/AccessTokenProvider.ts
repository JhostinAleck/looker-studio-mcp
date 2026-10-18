// Supplies a short-lived OAuth access token for Google APIs (BigQuery).
export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
  // Who the token belongs to, for check_auth. Null when the credential does not say.
  describeIdentity(): Promise<string | null>;
}
