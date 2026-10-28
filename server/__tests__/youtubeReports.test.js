import { describe, it, expect } from 'vitest';
import { classifyContentType, reportDefinitions } from '../services/youtubeReports.js';

const range = { startDate: '2026-01-01', endDate: '2026-01-28' };

describe('classifyContentType', () => {
  it('calls videos up to 3 minutes Shorts and longer ones regular videos', () => {
    expect(classifyContentType({ contentDetails: { duration: 'PT45S' } })).toBe('SHORTS');
    expect(classifyContentType({ contentDetails: { duration: 'PT3M' } })).toBe('SHORTS');
    expect(classifyContentType({ contentDetails: { duration: 'PT3M1S' } })).toBe('VIDEO_ON_DEMAND');
    expect(classifyContentType({ contentDetails: { duration: 'PT1H2M' } })).toBe('VIDEO_ON_DEMAND');
  });

  it('recognises live streams whatever their length', () => {
    expect(classifyContentType({ liveStreamingDetails: {}, contentDetails: { duration: 'PT1H' } })).toBe('LIVE_STREAM');
  });

  it('returns null when nothing is known', () => {
    expect(classifyContentType(undefined)).toBeNull();
    expect(classifyContentType({ contentDetails: {} })).toBeNull();
  });
});

describe('report definitions', () => {
  // YouTube Analytics answers 400 "The query is not supported" for these; checked against the live API.
  it('never pairs creatorContentType with playlist metrics', () => {
    const all = Object.values(reportDefinitions(range)).flatMap((group) => Object.values(group));
    for (const report of all.filter((r) => String(r.dimensions ?? '').includes('creatorContentType'))) {
      expect(report.metrics).not.toMatch(/Playlists/);
    }
  });
});

describe('fetchYoutubeComments', () => {
  const comment = { snippet: { topLevelComment: { snippet: { textDisplay: 'What camera do you use?', likeCount: 3, authorDisplayName: 'a' } }, totalReplyCount: 0 } };

  it('reads comments with the API key alone when YOUTUBE_API_KEY is set', async () => {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), headers: init?.headers }); return new Response(JSON.stringify({ items: [comment] }), { status: 200 }); };
    try {
      const { fetchYoutubeComments } = await import('../services/youtubeReports.js');
      const result = await fetchYoutubeComments({ access_token: 'unused' }, 'AO6fpSkqwsU', { YOUTUBE_API_KEY: ' test-key ' });
      expect(result.sample_size).toBe(1);
      expect(calls).toHaveLength(1); // no Google token exchange
      expect(calls[0].url).toContain('commentThreads');
      expect(calls[0].url).toContain('key=test-key');
      expect(calls[0].headers.Authorization).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});
