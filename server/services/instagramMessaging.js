import { toApiError } from './instagramApi.js';

const BASE = 'https://graph.instagram.com/v24.0';

/** POST/GET to the Instagram API with the account's token. Returns { data } or { error }; never throws. */
async function call(account, method, path, { body, params } = {}) {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
  try {
    const res = await fetch(`${BASE}/${path}${qs}`, {
      method,
      headers: { Authorization: `Bearer ${account.access_token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok || json.error) return { error: toApiError(json, res.status) };
    return { data: json };
  } catch (err) {
    return { error: { code: 502, message: `Failed to reach the Instagram API: ${err.message}` } };
  }
}

/** A direct message to someone who messaged us (inside Instagram's 24-hour window). */
export const sendDirectMessage = (account, recipientId, text) =>
  call(account, 'POST', `${account.page_id}/messages`, { body: { recipient: { id: recipientId }, message: { text } } });

/** The one private message allowed per comment, within 7 days of the comment. */
export const sendPrivateReply = (account, commentId, text) =>
  call(account, 'POST', `${account.page_id}/messages`, { body: { recipient: { comment_id: commentId }, message: { text } } });

/** A public reply under a comment. */
export const replyToComment = (account, commentId, text) =>
  call(account, 'POST', `${commentId}/replies`, { body: { message: text } });

export const subscribeAccount = (account, fields = 'comments,messages') =>
  call(account, 'POST', `${account.page_id}/subscribed_apps`, { params: { subscribed_fields: fields } });

export const getSubscriptions = (account) => call(account, 'GET', `${account.page_id}/subscribed_apps`);

/** A cheap call that proves the token still works. */
export const checkToken = (account) => call(account, 'GET', 'me', { params: { fields: 'user_id,username' } });

export const sender = { sendDirectMessage, sendPrivateReply, replyToComment };
