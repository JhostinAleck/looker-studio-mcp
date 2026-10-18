// A signed-in browser for the parts of Looker Studio that have no API
// (creating reports and charts). The page type stays opaque to the domain.
export interface BrowserSession<TPage = unknown> {
  // Runs `work` on a fresh tab and always closes it afterwards.
  withPage<T>(work: (page: TPage) => Promise<T>): Promise<T>;
  // True when the saved profile is still signed in to Google.
  isSignedIn(): Promise<boolean>;
  close(): Promise<void>;
}
