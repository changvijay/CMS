import { FOLLOW_PAYLOAD, buildMessage, followGateMessage, pickPublicReply, pickRule, renderMessage } from './automationMatcher.js';
import { extractEvents } from './webhookEvents.js';
import { isRetryable } from './facebookApi.js';

export const RETRY_DELAY_MS = 5 * 60 * 1000;
export const MAX_RETRIES = 3;

/** The DM a rule sends, as an Instagram message object. */
function dmFor(rule, username, { gate }) {
  if (gate) return followGateMessage(rule);
  const text = renderMessage(rule, { username });
  const rich = (rule.dm_buttons || []).length || (rule.quick_replies || []).length;
  return rich ? buildMessage(text, { buttons: rule.dm_buttons, quickReplies: rule.quick_replies }) : text;
}

/**
 * Sends a rule's replies for one comment or message and returns how to finish the event.
 * Order: the DM first, then the public reply. A public "check your DMs" reply only goes out after the DM
 * succeeded, so it is never misleading. Rules with DMs turned off only post the public reply.
 */
export async function deliver({ rule, account, event, sender, random }) {
  const messageText = renderMessage(rule, { username: event.username });
  const publicText = event.source === 'comment' ? pickPublicReply(rule, { username: event.username, random }) : null;
  const sendDm = rule.send_dm !== false;
  let messageId = null;

  if (sendDm) {
    const gate = Boolean(rule.require_follow) && event.source === 'comment';
    const message = dmFor(rule, event.username, { gate });
    const sent = event.source === 'comment'
      ? await sender.sendPrivateReply(account, event.commentId, message)
      : await sender.sendDirectMessage(account, event.senderId, message);
    if (sent.error) {
      const retry = isRetryable(sent.error.code);
      return { status: retry ? 'queued' : 'failed', errorCode: sent.error.code, errorMessage: sent.error.message, messageText, retry };
    }
    messageId = sent.data?.message_id ?? null;
  } else if (!publicText) {
    return { status: 'skipped', skipReason: 'nothing_to_send', messageText: null };
  }

  let note = null;
  if (publicText) {
    const pub = await sender.replyToComment(account, event.commentId, publicText);
    if (pub.error) note = `Public reply failed (error ${pub.error.code}): ${pub.error.message}`;
  }
  return { status: 'sent', messageId, messageText: sendDm ? messageText : null, publicReplyText: publicText, note };
}

/** Someone tapped "I followed" on a follow-first DM: check they follow, then send the real message. */
async function handleFollowConfirm(event, account, { db, sender, dryRun }) {
  const ruleId = event.quickReplyPayload.slice(FOLLOW_PAYLOAD.length);
  const rule = db.getRule ? await db.getRule(ruleId, account.id) : null;
  if (!rule) return { status: 'ignored', reason: 'rule_gone' };
  const eventId = await db.claimEvent({ accountId: account.id, ruleId: rule.id, source: 'dm', eventKey: event.eventKey, senderId: event.senderId, username: null, text: event.text });
  if (eventId === null) return { status: 'ignored', reason: 'duplicate' };

  const profile = await sender.getUserProfile(account, event.senderId);
  const username = profile.data?.username ?? null;
  if (profile.data && profile.data.is_user_follow_business === false) {
    const again = followGateMessage({ ...rule, follow_prompt: 'It looks like you are not following yet. Follow us, then tap the button again 👇' });
    if (!dryRun) await sender.sendDirectMessage(account, event.senderId, again);
    await db.finishEvent(eventId, { status: 'skipped', skipReason: 'not_following' });
    return { status: 'skipped', reason: 'not_following' };
  }
  const messageText = renderMessage(rule, { username });
  if (dryRun) {
    await db.finishEvent(eventId, { status: 'dry_run', messageText });
    return { status: 'dry_run', ruleId: rule.id };
  }
  const sent = await sender.sendDirectMessage(account, event.senderId, buildMessage(messageText, { buttons: rule.dm_buttons, quickReplies: rule.quick_replies }));
  if (sent.error) {
    await db.finishEvent(eventId, { status: 'failed', errorCode: sent.error.code, errorMessage: sent.error.message, messageText });
    return { status: 'failed', error: sent.error };
  }
  await db.finishEvent(eventId, { status: 'sent', messageId: sent.data?.message_id ?? null, messageText, note: 'Sent after follow check' });
  return { status: 'sent', ruleId: rule.id };
}

/**
 * Handles one webhook delivery: finds events worth answering, picks a rule, and sends the reply.
 * `db` and `sender` are injected (see automationDb.js / instagramMessaging.js) so this is testable offline.
 * One event failing never stops the others. Returns a result per event for logging.
 */
export async function processPayload(payload, { db, sender, dryRun = false, now = Date.now(), random = Math.random }) {
  const results = [];

  for (const event of extractEvents(payload)) {
    const base = { source: event.source, eventKey: event.eventKey };
    if (event.ignore) {
      results.push({ ...base, status: 'ignored', reason: event.ignore });
      continue;
    }

    let eventId = null;
    try {
      const account = await db.getAccountByIgId(event.igAccountId);
      if (!account) {
        results.push({ ...base, status: 'ignored', reason: 'unknown_account' });
        continue;
      }
      if (event.source === 'dm' && event.quickReplyPayload?.startsWith(FOLLOW_PAYLOAD)) {
        results.push({ ...base, ...(await handleFollowConfirm(event, account, { db, sender, dryRun })) });
        continue;
      }
      const picked = pickRule(await db.getActiveRules(account.id), { ...event, now });
      if (!picked) {
        // Recorded so the Activity log shows the webhook arrived but no rule fit it.
        const noMatchId = await db.claimEvent({
          accountId: account.id, ruleId: null, source: event.source, eventKey: event.eventKey,
          senderId: event.senderId, username: event.username, text: event.text,
        });
        if (noMatchId !== null) await db.finishEvent(noMatchId, { status: 'ignored', skipReason: 'no_match' });
        results.push({ ...base, status: 'ignored', reason: 'no_match' });
        continue;
      }
      const { rule, keyword } = picked;

      eventId = await db.claimEvent({
        accountId: account.id, ruleId: rule.id, source: event.source, eventKey: event.eventKey,
        senderId: event.senderId, username: event.username, text: event.text,
      });
      if (eventId === null) {
        results.push({ ...base, status: 'ignored', reason: 'duplicate' });
        continue;
      }

      if (rule.cooldown_hours > 0 && await db.sentRecently({ ruleId: rule.id, senderId: event.senderId, hours: rule.cooldown_hours })) {
        await db.finishEvent(eventId, { status: 'skipped', skipReason: 'cooldown' });
        results.push({ ...base, status: 'skipped', reason: 'cooldown' });
        continue;
      }

      const keywordMatched = keyword || null;
      if (dryRun) {
        const messageText = rule.send_dm === false ? null : renderMessage(rule, { username: event.username });
        const publicText = event.source === 'comment' ? pickPublicReply(rule, { username: event.username, random }) : null;
        await db.finishEvent(eventId, { status: 'dry_run', messageText, keywordMatched, publicReplyText: publicText, note: publicText ? `Would also reply publicly: ${publicText}` : null });
        results.push({ ...base, status: 'dry_run', ruleId: rule.id, messageText });
        continue;
      }

      const outcome = await deliver({ rule, account, event, sender, random });
      await db.finishEvent(eventId, {
        ...outcome, keywordMatched, commentId: event.commentId,
        retryAt: outcome.status === 'queued' ? new Date(now + RETRY_DELAY_MS) : null,
      });
      results.push({ ...base, status: outcome.status, ruleId: rule.id, ...(outcome.errorCode ? { error: { code: outcome.errorCode, message: outcome.errorMessage } } : {}) });
    } catch (err) {
      if (eventId !== null) {
        await db.finishEvent(eventId, { status: 'failed', errorCode: 500, errorMessage: err.message }).catch(() => {});
      }
      results.push({ ...base, status: 'failed', error: { code: 500, message: err.message } });
    }
  }
  return results;
}

/**
 * Re-sends replies that hit Instagram's rate limit. Each queued event is retried up to MAX_RETRIES times,
 * 5 minutes apart. The event row is reused, so a comment still never gets two replies.
 */
export async function retryQueued({ db, sender, now = Date.now(), random = Math.random }) {
  const results = [];
  for (const q of await db.listQueued(now)) {
    const event = { source: q.source, commentId: q.comment_id, senderId: q.sender_id, username: q.sender_username };
    const outcome = await deliver({ rule: q.rule, account: q.account, event, sender, random }).catch((err) => ({ status: 'failed', errorCode: 500, errorMessage: err.message }));
    const attempts = Number(q.attempts || 0) + 1;
    const giveUp = outcome.status === 'queued' && attempts >= MAX_RETRIES;
    await db.finishEvent(q.id, {
      ...outcome,
      status: giveUp ? 'failed' : outcome.status,
      keywordMatched: q.keyword_matched,
      commentId: q.comment_id,
      retryAt: outcome.status === 'queued' && !giveUp ? new Date(now + RETRY_DELAY_MS * attempts) : null,
      note: giveUp ? `Gave up after ${attempts} rate-limited attempts.` : outcome.note,
    });
    results.push({ id: q.id, status: giveUp ? 'failed' : outcome.status });
  }
  return results;
}
