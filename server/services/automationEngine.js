import { pickRule, renderMessage } from './automationMatcher.js';
import { extractEvents } from './webhookEvents.js';

/**
 * Handles one webhook delivery: finds events worth answering, picks a rule, and sends the reply.
 * `db` and `sender` are injected (see automationDb.js / instagramMessaging.js) so this is testable offline.
 * One event failing never stops the others. Returns a result per event for logging.
 */
export async function processPayload(payload, { db, sender, dryRun = false }) {
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
      const picked = pickRule(await db.getActiveRules(account.id), event);
      if (!picked) {
        results.push({ ...base, status: 'ignored', reason: 'no_match' });
        continue;
      }
      const { rule } = picked;

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

      const messageText = renderMessage(rule, { username: event.username });
      if (dryRun) {
        await db.finishEvent(eventId, { status: 'dry_run', messageText, note: rule.comment_reply_text ? `Would also reply publicly: ${rule.comment_reply_text}` : null });
        results.push({ ...base, status: 'dry_run', ruleId: rule.id, messageText });
        continue;
      }

      const sent = event.source === 'comment'
        ? await sender.sendPrivateReply(account, event.commentId, messageText)
        : await sender.sendDirectMessage(account, event.senderId, messageText);

      if (sent.error) {
        await db.finishEvent(eventId, { status: 'failed', errorCode: sent.error.code, errorMessage: sent.error.message, messageText });
        results.push({ ...base, status: 'failed', ruleId: rule.id, error: sent.error });
        continue;
      }

      // The public "check your DMs" reply only goes out after the DM succeeded, so it is never misleading.
      let note = null;
      if (event.source === 'comment' && rule.comment_reply_text) {
        const pub = await sender.replyToComment(account, event.commentId, rule.comment_reply_text);
        if (pub.error) note = `Public reply failed (error ${pub.error.code}): ${pub.error.message}`;
      }
      await db.finishEvent(eventId, { status: 'sent', messageId: sent.data?.message_id ?? null, messageText, note });
      results.push({ ...base, status: 'sent', ruleId: rule.id });
    } catch (err) {
      if (eventId !== null) {
        await db.finishEvent(eventId, { status: 'failed', errorCode: 500, errorMessage: err.message }).catch(() => {});
      }
      results.push({ ...base, status: 'failed', error: { code: 500, message: err.message } });
    }
  }
  return results;
}
