import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearLiveCache, invalidateLiveCache, loadShared, peekLiveCache, storedDataKeys } from './useLive';

describe('live cache', () => {
  beforeEach(() => clearLiveCache());

  it('shares one request between callers asking for the same key at once', async () => {
    let resolve!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const a = loadShared('history:youtube:1', load);
    const b = loadShared('history:youtube:1', load);
    resolve('data');
    expect(await Promise.all([a, b])).toEqual(['data', 'data']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(peekLiveCache('history:youtube:1')).toBe('data');
  });

  it('does not cache a failed request', async () => {
    await expect(loadShared('k', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(peekLiveCache('k')).toBeUndefined();
  });

  it('invalidates by prefix and leaves other keys', async () => {
    await loadShared('history:youtube:1:a', async () => 1);
    await loadShared('history:instagram:1:a', async () => 2);
    await loadShared('vids:1', async () => 3);
    invalidateLiveCache(...storedDataKeys('youtube'));
    expect(peekLiveCache('history:youtube:1:a')).toBeUndefined();
    expect(peekLiveCache('history:instagram:1:a')).toBe(2);
    expect(peekLiveCache('vids:1')).toBe(3);
  });

  it('does not store a result that was invalidated while it was loading', async () => {
    let resolve!: (v: string) => void;
    const pending = loadShared('overview:x', () => new Promise<string>((r) => { resolve = r; }));
    invalidateLiveCache('overview:');
    resolve('stale');
    await pending;
    expect(peekLiveCache('overview:x')).toBeUndefined();
  });

  it('names the stored-data keys a sync makes out of date', () => {
    expect(storedDataKeys('linkedin')).toEqual(['history:linkedin:', 'media:linkedin:', 'overview:']);
    expect(storedDataKeys()).toEqual(['history:', 'media:', 'overview:']);
  });
});
