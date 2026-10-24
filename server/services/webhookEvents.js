import crypto from 'node:crypto';

/** True when `header` ("sha256=<hex>") is the HMAC-SHA256 of the raw request body made with the app secret. */
export function verifySignature(rawBody, header, secret) {
  if (!secret || !header || !rawBody) return false;
  const [scheme, signature] = String(header).split('=');
  if (scheme !== 'sha256' || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * Normalises an Instagram webhook payload into events we may act on.
 * Events we must never answer (our own messages, echoes, replies to comments) carry `ignore` with the reason.
 */
export function extractEvents(payload) {
  const events = [];
  if (!payload || !Array.isArray(payload.entry)) return events;

  for (const entry of payload.entry) {
    const igAccountId = String(entry.id ?? '');
    if (!igAccountId) continue;

    // Comments arrive as { field, value } (Instagram Login) or inside changes[] (Facebook-style payloads)
    const changes = Array.isArray(entry.changes) ? entry.changes : entry.field ? [{ field: entry.field, value: entry.value }] : [];
    for (const change of changes) {
      if (change.field !== 'comments' && change.field !== 'live_comments') continue;
      const v = change.value || {};
      const commentId = String(v.id ?? v.comment_id ?? '');
      const senderId = String(v.from?.id ?? '');
      const text = typeof v.text === 'string' ? v.text : '';
      let ignore = null;
      if (!commentId) ignore = 'no_comment_id';
      else if (senderId && senderId === igAccountId) ignore = 'own_comment';
      else if (v.parent_id) ignore = 'reply_comment';
      else if (!text.trim()) ignore = 'no_text';
      events.push({
        source: 'comment', igAccountId, eventKey: commentId, commentId, messageId: null,
        senderId, username: v.from?.username ?? null, text, mediaId: v.media?.id ? String(v.media.id) : null,
        mediaProductType: v.media?.media_product_type ?? null, ignore,
      });
    }

    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const message = m.message;
      if (!message) continue; // postbacks, reactions, read receipts: nothing to answer
      const senderId = String(m.sender?.id ?? '');
      let ignore = null;
      if (message.is_echo) ignore = 'echo';
      else if (message.is_self) ignore = 'self_message';
      else if (senderId === igAccountId) ignore = 'own_message';
      else if (typeof message.text !== 'string' || !message.text.trim()) ignore = 'no_text';
      events.push({
        source: 'dm', igAccountId, eventKey: String(message.mid ?? ''), commentId: null, messageId: message.mid ? String(message.mid) : null,
        senderId, username: null, text: message.text ?? '', mediaId: null, mediaProductType: null, ignore: message.mid ? ignore : ignore ?? 'no_message_id',
      });
    }
  }
  return events;
}
