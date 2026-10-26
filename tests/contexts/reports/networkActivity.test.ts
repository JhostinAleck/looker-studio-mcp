import { describe, expect, it } from 'vitest';

import {
  NetworkActivity,
  counts,
  isLongLived,
} from '@/contexts/reports/infrastructure/ui/NetworkActivity.js';

const CHANNEL = 'https://firestore.googleapis.com/google.firestore.v1.Firestore';
const LISTEN = `${CHANNEL}/Listen/channel?gsessionid=a&VER=8`;
const WRITE = `${CHANNEL}/Write/channel?gsessionid=b&VER=8`;
const fetch = (url: string, method = 'POST') => ({ url, method, resourceType: 'fetch' });

describe('NetworkActivity', () => {
  it('is quiet once nothing is in flight for the quiet time', () => {
    const n = new NetworkActivity<string>(0);
    expect(n.isQuiet(500, 499)).toBe(false);
    expect(n.isQuiet(500, 500)).toBe(true);
  });

  it('waits for requests in flight and counts from the last one to end', () => {
    const n = new NetworkActivity<string>(0);
    n.started('a', fetch('https://lookerstudio.google.com/batchedDataV2'), 1000);
    n.started('b', fetch(WRITE), 1100);
    expect(n.isQuiet(500, 5000)).toBe(false);
    n.ended('a', 1200);
    expect(n.isQuiet(500, 5000)).toBe(false);
    n.ended('b', 2000);
    expect(n.isQuiet(500, 2400)).toBe(false);
    expect(n.isQuiet(500, 2500)).toBe(true);
  });

  it("leaves out the Firestore channels' hanging GETs, which never end", () => {
    expect(isLongLived(LISTEN, 'GET')).toBe(true);
    expect(isLongLived(WRITE, 'GET')).toBe(true);
    expect(isLongLived(WRITE, 'POST')).toBe(false);
    expect(isLongLived(`${CHANNEL}/Commit`, 'GET')).toBe(false);
    const n = new NetworkActivity<string>(0);
    n.started('listen', fetch(LISTEN, 'GET'), 100);
    n.started('write', fetch(WRITE, 'GET'), 100);
    expect(n.isQuiet(500, 500)).toBe(true);
  });

  it('leaves out fonts, images and analytics, which sometimes never end', () => {
    expect(counts('https://fonts.googleapis.com/css?family=Roboto', 'GET', 'stylesheet')).toBe(
      false,
    );
    expect(counts('https://www.google.com/images/cleardot.gif', 'GET', 'image')).toBe(false);
    expect(counts('https://www.google.com/g/collect?v=2&tid=G-1', 'POST', 'fetch')).toBe(false);
    expect(counts('https://play.google.com/log?format=json', 'POST', 'xhr')).toBe(false);
    expect(counts('https://www.google.com/images/cleardot.gif', 'GET', 'fetch')).toBe(false);
    expect(
      counts('https://datastudio.google.com/getAppsScriptAddonGallery?hl=en', 'POST', 'xhr'),
    ).toBe(false);
    expect(counts('https://lookerstudio.google.com/static/panel.js', 'GET', 'script')).toBe(true);
    expect(counts('https://lookerstudio.google.com/u/0/batchedDataV2', 'POST', 'xhr')).toBe(true);
  });

  it('ignores the end of a request it never counted', () => {
    const n = new NetworkActivity<string>(0);
    n.ended('before tracking', 400);
    expect(n.isQuiet(500, 500)).toBe(true);
  });
});
