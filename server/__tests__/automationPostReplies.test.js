import { describe, it, expect } from 'vitest';
import { processPayload, retryQueued } from '../services/automationEngine.js';
import { buildMessage, pickPublicReply, FOLLOW_PAYLOAD } from '../services/automationMatcher.js';

const IG = '17841400000000000';
const account = { id: 1, page_id: IG, access_token: 't' };
const now = Date.parse('2026-11-03T10:00:00Z');
const postRule = {
  id: 7, is_active: true, triggers: ['comment'], keywords: [], match_type: 'any', scope: 'specific', media_id: '1789',
  reply_text: 'Here you go {username}: {{link}}', link_url: 'https://changtechs.com/ipo', comment_reply_text: 'Sent!',
  public_reply_variants: ['Check your DMs {username}', 'Sent you a DM {username}'], send_dm: true, dm_buttons: [], quick_replies: [],
  require_follow: false, disclose_automation: false, cooldown_hours: 0, active_from: null, active_until: null,
};

function fakeDb(rules) {
  const events = [];
  return {
    events,
    getAccountByIgId: async (id) => (id === IG ? account : null),
    getActiveRules: async () => rules,
    getRule: async (id) => rules.find((r) => String(r.id) === String(id)) ?? null,
    claimEvent: async (e) => {
      if (events.some((x) => x.source === e.source && x.eventKey === e.eventKey)) return null;
      events.push({ id: events.length + 1, ...e, status: 'processing', attempts: 0 });
      return events.length;
    },
    sentRecently: async () => false,
    finishEvent: async (id, patch) => Object.assign(events[id - 1], patch),
    listQueued: async (at) => events.filter((e) => e.status === 'queued' && e.retryAt <= at)
      .map((e) => ({ id: e.id, source: e.source, comment_id: e.commentId, sender_id: e.senderId, sender_username: e.username, attempts: e.attempts, keyword_matched: e.keywordMatched, rule: rules[0], account })),
  };
}

function fakeSender({ dmError, follows = true } = {}) {
  const calls = [];
  return {
    calls,
    sendPrivateReply: async (a, to, message) => { calls.push({ kind: 'private', to, message }); return dmError ? { error: dmError } : { data: { message_id: 'm1' } }; },
    sendDirectMessage: async (a, to, message) => { calls.push({ kind: 'dm', to, message }); return { data: { message_id: 'm2' } }; },
    replyToComment: async (a, id, text) => { calls.push({ kind: 'public', to: id, text }); return { data: { id: 'r' } }; },
    getUserProfile: async () => ({ data: { username: 'asha', is_user_follow_business: follows } }),
  };
}

const comment = (key = 'c1', text = 'nice post', media = '1789') => ({ entry: [{ id: IG, field: 'comments', value: { id: key, from: { id: '555', username: 'asha' }, text, media: { id: media, media_product_type: 'REELS' } } }] });

describe('post auto-replies', () => {
  it('"any comment" answers every comment on that post, with a random public variant and {username}', async () => {
    const db = fakeDb([postRule]);
    const sender = fakeSender();
    const [r] = await processPayload(comment(), { db, sender, now, random: () => 0.9 });
    expect(r.status).toBe('sent');
    expect(sender.calls[0]).toEqual({ kind: 'private', to: 'c1', message: 'Here you go @asha: https://changtechs.com/ipo' });
    expect(sender.calls[1]).toEqual({ kind: 'public', to: 'c1', text: 'Sent you a DM @asha' });
    expect(db.events[0]).toMatchObject({ status: 'sent', publicReplyText: 'Sent you a DM @asha' });
  });

  it('ignores comments on other posts and outside the active window', async () => {
    expect((await processPayload(comment('c1', 'x', '999'), { db: fakeDb([postRule]), sender: fakeSender(), now }))[0].reason).toBe('no_match');
    const ended = { ...postRule, active_until: '2026-11-01T00:00:00Z' };
    expect((await processPayload(comment(), { db: fakeDb([ended]), sender: fakeSender(), now }))[0].reason).toBe('no_match');
  });

  it('can post only the public reply (DM off)', async () => {
    const sender = fakeSender();
    await processPayload(comment(), { db: fakeDb([{ ...postRule, send_dm: false }]), sender, now, random: () => 0 });
    expect(sender.calls.map((c) => c.kind)).toEqual(['public']);
  });

  it('sends link buttons as a button template', async () => {
    const sender = fakeSender();
    await processPayload(comment(), { db: fakeDb([{ ...postRule, dm_buttons: [{ title: 'Open', url: 'https://x.com' }] }]), sender, now });
    expect(sender.calls[0].message.attachment.payload).toMatchObject({ template_type: 'button', buttons: [{ type: 'web_url', url: 'https://x.com', title: 'Open' }] });
  });

  it('queues rate-limited DMs, skips the public reply, and retries later without double replies', async () => {
    const db = fakeDb([postRule]);
    const limited = fakeSender({ dmError: { code: 613, message: 'Calls to this api have exceeded the rate limit.' } });
    const [r] = await processPayload(comment(), { db, sender: limited, now });
    expect(r.status).toBe('queued');
    expect(limited.calls.map((c) => c.kind)).toEqual(['private']);

    // A webhook retry of the same comment is absorbed.
    expect((await processPayload(comment(), { db, sender: limited, now }))[0].reason).toBe('duplicate');

    const ok = fakeSender();
    expect(await retryQueued({ db, sender: ok, now: now + 6 * 60 * 1000, random: () => 0 })).toEqual([{ id: 1, status: 'sent' }]);
    expect(ok.calls.map((c) => c.kind)).toEqual(['private', 'public']);
  });

  it('follow-first: asks to follow, then sends the link after the "I followed" tap if they follow', async () => {
    const rule = { ...postRule, require_follow: true };
    const db = fakeDb([rule]);
    const sender = fakeSender();
    await processPayload(comment(), { db, sender, now });
    expect(sender.calls[0].message.quick_replies[0].payload).toBe(`${FOLLOW_PAYLOAD}7`);

    const tap = { entry: [{ id: IG, messaging: [{ sender: { id: '555' }, message: { mid: 'mid-tap', text: 'I followed ✅', quick_reply: { payload: `${FOLLOW_PAYLOAD}7` } } }] }] };
    const [r] = await processPayload(tap, { db, sender, now });
    expect(r.status).toBe('sent');
    expect(sender.calls.at(-1)).toEqual({ kind: 'dm', to: '555', message: { text: 'Here you go @asha: https://changtechs.com/ipo' } });

    const notFollowing = fakeSender({ follows: false });
    const tap2 = { entry: [{ id: IG, messaging: [{ sender: { id: '556' }, message: { mid: 'mid-tap-2', text: 'I followed ✅', quick_reply: { payload: `${FOLLOW_PAYLOAD}7` } } }] }] };
    expect((await processPayload(tap2, { db, sender: notFollowing, now }))[0].reason).toBe('not_following');
  });
});

describe('message helpers', () => {
  it('picks among variants and falls back to the single reply', () => {
    expect(pickPublicReply({ public_reply_variants: ['a', 'b', 'c'] }, { random: () => 0.5 })).toBe('b');
    expect(pickPublicReply({ comment_reply_text: 'Only {username}' }, { username: 'k' })).toBe('Only @k');
    expect(pickPublicReply({})).toBeNull();
  });

  it('adds quick replies to text messages', () => {
    expect(buildMessage('Hi', { quickReplies: [{ title: 'Yes' }] })).toEqual({ text: 'Hi', quick_replies: [{ content_type: 'text', title: 'Yes', payload: 'Yes' }] });
  });
});
