import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { extractEvents, verifySignature } from '../services/webhookEvents.js';

const sign = (body, secret) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

describe('verifySignature', () => {
  const body = Buffer.from('{"object":"instagram"}');
  it('accepts a correct signature', () => {
    expect(verifySignature(body, sign(body, 's3cret'), 's3cret')).toBe(true);
  });
  it('rejects a wrong secret, a tampered body, a missing header or a missing secret', () => {
    expect(verifySignature(body, sign(body, 'other'), 's3cret')).toBe(false);
    expect(verifySignature(Buffer.from('{"object":"x"}'), sign(body, 's3cret'), 's3cret')).toBe(false);
    expect(verifySignature(body, undefined, 's3cret')).toBe(false);
    expect(verifySignature(body, sign(body, 's3cret'), '')).toBe(false);
  });
  it('rejects malformed headers without throwing', () => {
    expect(verifySignature(body, 'sha1=abcd', 's3cret')).toBe(false);
    expect(verifySignature(body, 'sha256=zzzz', 's3cret')).toBe(false);
    expect(verifySignature(body, 'sha256=', 's3cret')).toBe(false);
  });
});

const comment = (over = {}) => ({
  object: 'instagram',
  entry: [{ id: '17841400000000000', time: 1, field: 'comments', value: { id: 'c1', from: { id: '555', username: 'asha' }, text: 'link', media: { id: '1789', media_product_type: 'REELS' }, ...over } }],
});

const dm = (message, senderId = '555') => ({
  object: 'instagram',
  entry: [{ id: '17841400000000000', time: 1, messaging: [{ sender: { id: senderId }, recipient: { id: '17841400000000000' }, timestamp: 1, message }] }],
});

describe('extractEvents: comments', () => {
  it('normalises a comment', () => {
    const [e] = extractEvents(comment());
    expect(e).toMatchObject({ source: 'comment', igAccountId: '17841400000000000', eventKey: 'c1', commentId: 'c1', senderId: '555', username: 'asha', text: 'link', mediaId: '1789', mediaProductType: 'REELS', ignore: null });
  });
  it('also reads the changes[] shape', () => {
    const p = { entry: [{ id: '1', changes: [{ field: 'comments', value: { comment_id: 'c9', from: { id: '5' }, text: 'link', media: { id: '7' } } }] }] };
    expect(extractEvents(p)[0]).toMatchObject({ eventKey: 'c9', ignore: null });
  });
  it('ignores our own comments, replies to comments and empty comments', () => {
    expect(extractEvents(comment({ from: { id: '17841400000000000', username: 'me' } }))[0].ignore).toBe('own_comment');
    expect(extractEvents(comment({ parent_id: 'c0' }))[0].ignore).toBe('reply_comment');
    expect(extractEvents(comment({ text: '  ' }))[0].ignore).toBe('no_text');
  });
});

describe('extractEvents: messages', () => {
  it('normalises a text message', () => {
    const [e] = extractEvents(dm({ mid: 'm1', text: 'link' }));
    expect(e).toMatchObject({ source: 'dm', eventKey: 'm1', messageId: 'm1', senderId: '555', text: 'link', ignore: null });
  });
  it('ignores echoes, self messages, our own messages and attachments without text', () => {
    expect(extractEvents(dm({ mid: 'm2', text: 'hi', is_echo: true }, '17841400000000000'))[0].ignore).toBe('echo');
    expect(extractEvents(dm({ mid: 'm3', text: 'hi', is_self: true }))[0].ignore).toBe('self_message');
    expect(extractEvents(dm({ mid: 'm4', text: 'hi' }, '17841400000000000'))[0].ignore).toBe('own_message');
    expect(extractEvents(dm({ mid: 'm5', attachments: [{ type: 'image' }] }))[0].ignore).toBe('no_text');
  });
  it('skips postbacks and other non-message events', () => {
    const p = { entry: [{ id: '1', messaging: [{ sender: { id: '2' }, postback: { payload: 'x' } }] }] };
    expect(extractEvents(p)).toEqual([]);
  });
});

describe('extractEvents: robustness', () => {
  it('returns nothing for junk', () => {
    expect(extractEvents(null)).toEqual([]);
    expect(extractEvents({})).toEqual([]);
    expect(extractEvents({ entry: 'x' })).toEqual([]);
    expect(extractEvents({ entry: [{}] })).toEqual([]);
  });
  it('handles batched entries', () => {
    const p = { entry: [...comment().entry, ...dm({ mid: 'm1', text: 'link' }).entry] };
    expect(extractEvents(p).map((e) => e.source)).toEqual(['comment', 'dm']);
  });
});
