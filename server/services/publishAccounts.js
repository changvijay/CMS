import { getInstagramAccountsByUserId, pool } from '../db.js';
import { refreshInstagramToken } from './instagramAuth.js';
import { canUpload, getGoogleAccessTokenFromRefreshToken } from './googleAuth.js';
import { fbGet } from './facebookApi.js';
import { igGet } from './instagramApi.js';
import { getWorkingLinkedInToken } from './linkedinAuth.js';

/**
 * The accounts a user can publish to, per platform, with a live token check.
 * Every row is normalised to { id, platform, name, handle, avatar, type, tokenStatus, tokenMessage, reconnect }.
 */
export const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'youtube'];

const QUERIES = {
  facebook: 'SELECT * FROM facebook_pages WHERE user_id = $1 ORDER BY created_at DESC',
  linkedin: 'SELECT * FROM linkedin_accounts WHERE user_id = $1 AND member_id <> \'self\' ORDER BY account_type DESC, created_at DESC',
  youtube: 'SELECT id, channel_name, playlist_id, access_token, scope, channel_id, picture_url, created_at FROM Youtube_accounts WHERE user_id = $1 ORDER BY created_at DESC',
};

export async function loadRows(platform, userId) {
  // Instagram goes through the shared loader so tokens due for renewal are renewed first.
  if (platform === 'instagram') return getInstagramAccountsByUserId(userId);
  const { rows } = await pool.query(QUERIES[platform], [userId]);
  return rows;
}

/** Which platforms have at least one connected account. */
export async function availablePlatforms(userId) {
  const counts = await Promise.all(PLATFORMS.map(async (p) => [p, (await loadRows(p, userId)).length]));
  return counts.filter(([, n]) => n > 0).map(([p, n]) => ({ platform: p, accounts: n }));
}

// Token checks are cached for 5 minutes so stepping back and forth in the wizard stays fast.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
const cacheKey = (platform, row) => `${platform}:${row.id}:${String(row.access_token || row.page_access_token || '').slice(-12)}`;
export const clearAccountCache = () => cache.clear();

const ok = (extra) => ({ tokenStatus: 'ok', tokenMessage: null, ...extra });
const bad = (tokenStatus, tokenMessage, extra) => ({ tokenStatus, tokenMessage, ...extra });

async function checkInstagram(row) {
  const fields = { fields: 'user_id,username,name,profile_picture_url,account_type' };
  let me = await igGet(row, 'me', fields);
  if (me.error) {
    // Try renewing the token once; only call it expired when that fails too.
    const renewed = await refreshInstagramToken(row);
    if (renewed.last_refresh_error) return bad('expired', `${me.error.message} (automatic renewal also failed: ${renewed.last_refresh_error})`, { reconnect: 'instagram' });
    me = await igGet(renewed, 'me', fields);
    if (me.error) return bad('expired', me.error.message, { reconnect: 'instagram' });
  }
  if (me.data.user_id && !row.ig_user_id) await pool.query('UPDATE instagram_accounts SET ig_user_id = $2 WHERE id = $1', [row.id, String(me.data.user_id)]).catch(() => {});
  return ok({ handle: me.data.username ? `@${me.data.username}` : null, avatar: me.data.profile_picture_url || null, type: me.data.account_type === 'MEDIA_CREATOR' ? 'Creator' : 'Business' });
}

async function checkFacebook(row) {
  const me = await fbGet('me', row.page_access_token, { fields: 'id,name' });
  if (me.error) return bad('expired', me.error.message, { reconnect: 'facebook' });
  const perms = await fbGet('me/permissions', row.page_access_token);
  const granted = perms.data?.data?.filter((p) => p.status === 'granted').map((p) => p.permission);
  if (granted && !granted.includes('pages_manage_posts')) return bad('missing_scope', 'Posting permission (pages_manage_posts) was not granted. Reconnect Facebook and allow it.', { reconnect: 'facebook' });
  return ok({});
}

async function checkLinkedIn(row) {
  const kind = row.account_type === 'person' ? 'linkedin_person' : 'linkedin';
  // Renews when due, checks the token with a real call, and on a 401 renews once more before giving up.
  let fresh;
  try {
    fresh = await getWorkingLinkedInToken(row);
  } catch (err) {
    return bad('expired', err.message, { reconnect: kind });
  }
  const need = row.account_type === 'person' ? 'w_member_social' : 'w_organization_social';
  if (fresh.scope && !String(fresh.scope).split(/[\s,]+/).includes(need)) {
    return bad('missing_scope', `Posting permission (${need}) was not granted. Reconnect LinkedIn to allow it.`, { reconnect: kind });
  }
  return ok({});
}

async function checkYoutube(row) {
  try {
    await getGoogleAccessTokenFromRefreshToken(row.access_token, { fresh: true });
  } catch (err) {
    return bad('expired', err.message, { reconnect: 'youtube' });
  }
  const upload = canUpload(row.scope);
  if (upload === false) return bad('missing_scope', 'This channel was connected without upload permission. Reconnect YouTube.', { reconnect: 'youtube' });
  // A hand-pasted token has no recorded scope; it may still work, so it is allowed with a warning.
  return ok({ tokenMessage: upload === null ? 'Upload permission unknown for this token. If publishing fails, reconnect YouTube.' : null });
}

const CHECKS = { instagram: checkInstagram, facebook: checkFacebook, linkedin: checkLinkedIn, youtube: checkYoutube };

function base(platform, row) {
  if (platform === 'instagram') return { name: row.page_name, handle: null, avatar: null, type: 'Business' };
  if (platform === 'facebook') return { name: row.name, handle: null, avatar: row.picture_url, type: 'Page', igLinked: Boolean(row.ig_user_id) };
  if (platform === 'linkedin') {
    return { name: row.name, handle: row.vanity_name ? `linkedin.com/company/${row.vanity_name}` : null, avatar: row.picture_url, type: row.account_type === 'person' ? 'Personal' : 'Company page' };
  }
  return { name: row.channel_name, handle: row.channel_id || null, avatar: row.picture_url, type: 'Channel' };
}

/** Accounts for one platform, each with a token check. One account failing its check never hides the others. */
export async function listAccounts(platform, userId) {
  const rows = await loadRows(platform, userId);
  return Promise.all(rows.map(async (row) => {
    const key = cacheKey(platform, row);
    const hit = cache.get(key);
    let check = hit && Date.now() - hit.at < CACHE_MS ? hit.value : null;
    if (!check) {
      check = await CHECKS[platform](row).catch((err) => bad('error', err.message, {}));
      cache.set(key, { at: Date.now(), value: check });
    }
    // Live values from the check (handle, avatar) win over what is stored, but never blank them out.
    const live = Object.fromEntries(Object.entries(check).filter(([, v]) => v !== null && v !== undefined));
    return { id: String(row.id), platform, ...base(platform, row), ...live, tokenMessage: check.tokenMessage ?? null };
  }));
}

/** Everything a publisher needs to post with one account (fresh tokens included). Throws when it is gone. */
export async function loadCredentials(platform, userId, accountId) {
  const row = (await loadRows(platform, userId)).find((r) => String(r.id) === String(accountId));
  if (!row) throw Object.assign(new Error(`That ${platform} account is no longer connected.`), { code: 404 });

  if (platform === 'instagram') {
    const { rows } = await pool.query('SELECT * FROM facebook_pages WHERE user_id = $1 AND ig_user_id IS NOT NULL AND ig_user_id = $2 LIMIT 1', [userId, row.ig_user_id || row.page_id]);
    return { account: row, fbPage: rows[0] || null };
  }
  if (platform === 'facebook') return { page: row };
  if (platform === 'linkedin') {
    try {
      const fresh = await getWorkingLinkedInToken(row);
      return { account: fresh, accessToken: fresh.access_token };
    } catch (err) {
      throw Object.assign(err, { code: 401 });
    }
  }
  return { account: row, accessToken: await getGoogleAccessTokenFromRefreshToken(row.access_token) };
}
