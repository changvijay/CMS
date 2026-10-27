import { describe, it, expect, beforeEach } from 'vitest';
import { processPayload } from '../services/automationEngine.js';

const IG = '17841400000000000';
const account = { id: 1, page_id: IG, access_token: 't' };
const baseRule = { id: 1, is_active: true, triggers: ['comment', 'dm'], keywords: ['link'], match_type: 'contains', media_id: null, reply_text: 'Here: {{link}}', link_url: 'https://changtechs.com/', comment_reply_text: null, disclose_automation: false, cooldown_hours: 24 };

/** In-memory stand-in for automationDb.js with the same semantics. */
function fakeDb(rules = [baseRule]) {
  const events = [];
  return {
    events,
    getAccountByIgId: async (id) => (id === IG ? account : null),
    getActiveRules: async () => rules,
    claimEvent: async (e) => {
      if (events.some((x) => x.source === e.source && x.eventKey === e.eventKey)) return null;
      events.push({ id: events.length + 1, ...e, status: 'processing' });
      return events.length;
    },
    sentRecently: async ({ ruleId, senderId }) => events.some((x) => x.ruleId === ruleId && x.senderId === senderId && ['sent', 'dry_run'].includes(x.status)),
    finishEvent: async (id, patch) => Object.assign(events[id - 1], patch),
  };
}

function fakeSender({ failWith } = {}) {
  const calls = [];
  const ok = (kind) => async (acct, to, text) => {
    calls.push({ kind, to, text });
    return failWith && kind !== 'public' ? { error: failWith } : { data: { message_id: `mid-${calls.length}` } };
  };
  return {
    calls,
    sendDirectMessage: ok('dm'),
    sendPrivateReply: ok('private'),
    replyToComment: async (acct, id, text) => { calls.push({ kind: 'public', to: id, text }); return { data: { id: 'r1' } }; },
  };
}

const commentPayload = (over = {}, key = 'c1') => ({ entry: [{ id: IG, field: 'comments', value: { id: key, from: { id: '555', username: 'asha' }, text: 'link please', media: { id: '1789' }, ...over } }] });
const dmPayload = (text = 'link', mid = 'm1', sender = '555') => ({ entry: [{ id: IG, messaging: [{ sender: { id: sender }, recipient: { id: IG }, message: { mid, text } }] }] });

describe('processPayload', () => {
  let db;
  let sender;
  beforeEach(() => {
    db = fakeDb();
    sender = fakeSender();
  });

  it('answers a DM keyword with the link', async () => {
    const [r] = await processPayload(dmPayload('Link!'), { db, sender });
    expect(r.status).toBe('sent');
    expect(sender.calls).toEqual([{ kind: 'dm', to: '555', text: 'Here: https://changtechs.com/' }]);
    expect(db.events[0]).toMatchObject({ status: 'sent', messageId: 'mid-1' });
  });

  it('answers a comment keyword with a private reply (not a DM to an id)', async () => {
    const [r] = await processPayload(commentPayload(), { db, sender });
    expect(r.status).toBe('sent');
    expect(sender.calls).toEqual([{ kind: 'private', to: 'c1', text: 'Here: https://changtechs.com/' }]);
  });

  it('also replies publicly, but only after the DM succeeded', async () => {
    db = fakeDb([{ ...baseRule, comment_reply_text: 'Check your DMs! 📩' }]);
    await processPayload(commentPayload(), { db, sender });
    expect(sender.calls.map((c) => c.kind)).toEqual(['private', 'public']);

    const failing = fakeSender({ failWith: { code: 10, message: 'Permission denied' } });
    db = fakeDb([{ ...baseRule, comment_reply_text: 'Check your DMs! 📩' }]);
    const [r] = await processPayload(commentPayload(), { db, sender: failing });
    expect(r.status).toBe('failed');
    expect(failing.calls.map((c) => c.kind)).toEqual(['private']);
  });

  it('records Meta errors with their code instead of hiding them', async () => {
    const failing = fakeSender({ failWith: { code: 200, message: 'Permissions error' } });
    const [r] = await processPayload(dmPayload(), { db, sender: failing });
    expect(r).toMatchObject({ status: 'failed', error: { code: 200 } });
    expect(db.events[0]).toMatchObject({ status: 'failed', errorCode: 200, errorMessage: 'Permissions error' });
  });

  it('handles a retried webhook only once', async () => {
    await processPayload(dmPayload('link', 'm1'), { db, sender });
    const [again] = await processPayload(dmPayload('link', 'm1'), { db, sender });
    expect(again).toMatchObject({ status: 'ignored', reason: 'duplicate' });
    expect(sender.calls).toHaveLength(1);
  });

  it('does not message the same person again inside the cooldown', async () => {
    await processPayload(dmPayload('link', 'm1'), { db, sender });
    const [second] = await processPayload(dmPayload('link', 'm2'), { db, sender });
    expect(second).toMatchObject({ status: 'skipped', reason: 'cooldown' });
    expect(sender.calls).toHaveLength(1);
    // someone else is unaffected
    const [other] = await processPayload(dmPayload('link', 'm3', '777'), { db, sender });
    expect(other.status).toBe('sent');
  });

  it('a cooldown of 0 answers every time', async () => {
    db = fakeDb([{ ...baseRule, cooldown_hours: 0 }]);
    await processPayload(dmPayload('link', 'm1'), { db, sender });
    await processPayload(dmPayload('link', 'm2'), { db, sender });
    expect(sender.calls).toHaveLength(2);
  });

  it('never replies to non-matching text, unknown accounts or things it must never answer, and logs only the no-match', async () => {
    expect((await processPayload(dmPayload('hello there'), { db, sender }))[0]).toMatchObject({ reason: 'no_match' });
    expect((await processPayload({ entry: [{ id: '999', messaging: [{ sender: { id: '5' }, message: { mid: 'x', text: 'link' } }] }] }, { db, sender }))[0]).toMatchObject({ reason: 'unknown_account' });
    expect((await processPayload(dmPayload('link', 'e1', IG), { db, sender }))[0]).toMatchObject({ reason: 'own_message' });
    expect((await processPayload(commentPayload({ parent_id: 'c0' }, 'c2'), { db, sender }))[0]).toMatchObject({ reason: 'reply_comment' });
    expect((await processPayload(commentPayload({ from: { id: IG, username: 'me' } }, 'c3'), { db, sender }))[0]).toMatchObject({ reason: 'own_comment' });
    expect(sender.calls).toHaveLength(0);
    expect(db.events).toHaveLength(1); // only the non-matching text is logged, so the Activity page shows the webhook arrived
    expect(db.events[0]).toMatchObject({ status: 'ignored', skipReason: 'no_match', ruleId: null });
  });

  it('dry run records the message but sends nothing', async () => {
    const [r] = await processPayload(dmPayload(), { db, sender, dryRun: true });
    expect(r).toMatchObject({ status: 'dry_run', messageText: 'Here: https://changtechs.com/' });
    expect(sender.calls).toHaveLength(0);
    expect(db.events[0].status).toBe('dry_run');
  });

  it('one failing event does not stop the next', async () => {
    const boom = { ...db, getActiveRules: async () => { throw new Error('db down'); } };
    const [r] = await processPayload(dmPayload(), { db: boom, sender });
    expect(r).toMatchObject({ status: 'failed', error: { code: 500, message: 'db down' } });

    const payload = { entry: [{ id: IG, messaging: [
      { sender: { id: '1' }, message: { mid: 'a', text: 'link' } },
      { sender: { id: '2' }, message: { mid: 'b', text: 'link' } },
    ] }] };
    const results = await processPayload(payload, { db, sender });
    expect(results.map((x) => x.status)).toEqual(['sent', 'sent']);
  });
});

describe('reel-wise and post-wise rules', () => {
  const reelComment = (mediaId, productType, key) => ({
    entry: [{ id: IG, field: 'comments', value: { id: key, from: { id: `u${key}`, username: `user${key}` }, text: 'link', media: { id: mediaId, media_product_type: productType } } }],
  });

  const rules = [
    { ...baseRule, id: 1, link_url: 'https://example.com/general', reply_text: 'general {{link}}' },
    { ...baseRule, id: 2, scope: 'reels', triggers: ['comment'], link_url: 'https://example.com/all-reels', reply_text: 'reels {{link}}' },
    { ...baseRule, id: 3, scope: 'posts', triggers: ['comment'], link_url: 'https://example.com/all-posts', reply_text: 'posts {{link}}' },
    { ...baseRule, id: 4, scope: 'specific', media_id: '17900000000000001', triggers: ['comment'], link_url: 'https://example.com/ipo-reel', reply_text: 'ipo {{link}}' },
  ];

  it('sends each reel and post its own link', async () => {
    const db = fakeDb(rules);
    const sender = fakeSender();
    await processPayload(reelComment('17900000000000001', 'REELS', 'a'), { db, sender }); // the IPO reel
    await processPayload(reelComment('17900000000000002', 'REELS', 'b'), { db, sender }); // some other reel
    await processPayload(reelComment('17900000000000003', 'FEED', 'c'), { db, sender });  // a feed post
    await processPayload(dmPayload('link', 'm9'), { db, sender });                        // a plain DM
    expect(sender.calls.map((c) => c.text)).toEqual([
      'ipo https://example.com/ipo-reel',
      'reels https://example.com/all-reels',
      'posts https://example.com/all-posts',
      'general https://example.com/general',
    ]);
  });

  it('stays quiet on content no rule covers', async () => {
    const db = fakeDb([rules[3]]);
    const sender = fakeSender();
    const [r] = await processPayload(reelComment('17900000000000099', 'REELS', 'z'), { db, sender });
    expect(r).toMatchObject({ status: 'ignored', reason: 'no_match' });
    expect(sender.calls).toHaveLength(0);
  });
});

