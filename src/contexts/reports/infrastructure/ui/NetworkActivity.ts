// The editor keeps two Firestore WebChannel streams open (a hanging GET on
// Listen/channel and one on Write/channel), so Playwright's 'networkidle'
// never comes and a wait on it always ran to its timeout. "Quiet" instead
// means no request in flight and none started or finished for a while,
// counting only the requests the editor waits on: its data, saves (the
// channels' POSTs) and code. Fonts, images and pings sometimes never finish
// and change nothing on the canvas.
const COUNTED_TYPES = new Set(['document', 'script', 'fetch', 'xhr']);
// Pings and side lists seen hanging for the whole wait: analytics, the
// connectivity check pixel, the Apps Script add-on gallery.
const IGNORED =
  /\/g\/collect\b|google-analytics\.com|doubleclick\.net|play\.google\.com\/log\b|\/cleardot\.gif|getAppsScriptAddonGallery/;

export function isLongLived(url: string, method = 'GET'): boolean {
  return method === 'GET' && /firestore\.googleapis\.com\/.*\/(Listen|Write)\/channel/.test(url);
}

export function counts(url: string, method: string, resourceType: string): boolean {
  return COUNTED_TYPES.has(resourceType) && !isLongLived(url, method) && !IGNORED.test(url);
}

export class NetworkActivity<R = unknown> {
  private readonly inflight = new Set<R>();
  private last: number;

  constructor(now = Date.now()) {
    this.last = now;
  }

  started(
    request: R,
    info: { url: string; method: string; resourceType: string },
    now = Date.now(),
  ): void {
    if (!counts(info.url, info.method, info.resourceType)) return;
    this.inflight.add(request);
    this.last = now;
  }

  // Finished or failed; requests that were never counted are ignored.
  ended(request: R, now = Date.now()): void {
    if (this.inflight.delete(request)) this.last = now;
  }

  isQuiet(quietMs: number, now = Date.now()): boolean {
    return this.inflight.size === 0 && now - this.last >= quietMs;
  }
}
