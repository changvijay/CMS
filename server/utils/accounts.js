import { getInstagramAccountsByUserId, getLinkedInAccountsByUserId, getYoutubeAccountsByUserId } from '../db.js';

const LOADERS = {
  instagram: getInstagramAccountsByUserId,
  youtube: getYoutubeAccountsByUserId,
  linkedin: getLinkedInAccountsByUserId,
};

/** The user's selected account for a platform, or their first one; null when they have none. */
export async function pickAccount(platform, userId, accountId) {
  const accounts = await LOADERS[platform](userId);
  if (!accounts?.length) return null;
  return accounts.find((a) => String(a.id) === String(accountId)) || accounts[0];
}
