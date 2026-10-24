import express from 'express';
import { pool, isDbReady, getInstagramAccountsByUserId } from '../db.js';
import { describeMedia, pickRule, renderMessage, validateRule } from '../services/automationMatcher.js';
import { igGet } from '../services/instagramApi.js';
import { checkToken, getSubscriptions, subscribeAccount } from '../services/instagramMessaging.js';

const WEBHOOK_FIELDS = 'comments,messages';
const RULE_FIELDS = ['name', 'is_active', 'triggers', 'keywords', 'match_type', 'scope', 'media_id', 'media_label', 'media_permalink', 'reply_text', 'link_url', 'comment_reply_text', 'disclose_automation', 'cooldown_hours'];
const MEDIA_PICKER_FIELDS = 'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp';

const toError = (e) => ({ code: e?.code ?? 500, message: e?.message ?? 'Unknown error', reason: e?.reason });

export function createAutomationRouter(authenticateToken, { env = process.env } = {}) {
  const router = express.Router();
  router.use('/automation', authenticateToken, (req, res, next) => (isDbReady() ? next() : res.status(503).json({ error: 'Database is not connected.' })));

  const ownedAccount = async (userId, accountId) => (await getInstagramAccountsByUserId(userId)).find((a) => String(a.id) === String(accountId)) ?? null;

  const ownedRule = async (userId, id) => {
    const { rows } = await pool.query('SELECT * FROM automation_rules WHERE id = $1 AND user_id = $2', [id, userId]);
    return rows[0] ?? null;
  };

  router.get('/automation/rules', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT r.*, a.page_name AS account_name,
                (SELECT COUNT(*) FROM automation_events e WHERE e.rule_id = r.id AND e.status = 'sent')::int AS sent_count
           FROM automation_rules r JOIN instagram_accounts a ON a.id = r.account_id
          WHERE r.user_id = $1 ORDER BY r.id`, [req.user.userId]);
      res.json({ rules: rows });
    } catch (error) {
      console.error('List rules error:', error.message);
      res.status(500).json({ error: 'Failed to load rules.' });
    }
  });

  router.post('/automation/rules', async (req, res) => {
    try {
      const account = await ownedAccount(req.user.userId, req.body?.account_id);
      if (!account) return res.status(404).json({ error: 'Choose one of your connected Instagram accounts.' });
      const { errors, value: v } = validateRule(req.body ?? {});
      if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
      const { rows } = await pool.query(
        `INSERT INTO automation_rules (user_id, account_id, name, is_active, triggers, keywords, match_type, scope, media_id, media_label, media_permalink, reply_text, link_url, comment_reply_text, disclose_automation, cooldown_hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [req.user.userId, account.id, v.name, v.is_active, v.triggers, v.keywords, v.match_type, v.scope, v.media_id, v.media_label, v.media_permalink, v.reply_text, v.link_url, v.comment_reply_text, v.disclose_automation, v.cooldown_hours]
      );
      res.status(201).json({ rule: rows[0] });
    } catch (error) {
      console.error('Create rule error:', error.message);
      res.status(500).json({ error: 'Failed to save the rule.' });
    }
  });

  router.patch('/automation/rules/:id', async (req, res) => {
    try {
      const existing = await ownedRule(req.user.userId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Rule not found.' });
      const merged = { ...existing, ...Object.fromEntries(RULE_FIELDS.filter((f) => req.body?.[f] !== undefined).map((f) => [f, req.body[f]])) };
      const { errors, value: v } = validateRule(merged);
      if (errors.length) return res.status(400).json({ error: errors.join(' '), errors });
      const { rows } = await pool.query(
        `UPDATE automation_rules SET name=$2, is_active=$3, triggers=$4, keywords=$5, match_type=$6, scope=$7, media_id=$8, media_label=$9,
                media_permalink=$10, reply_text=$11, link_url=$12, comment_reply_text=$13, disclose_automation=$14, cooldown_hours=$15, updated_at=NOW()
          WHERE id=$1 RETURNING *`,
        [existing.id, v.name, v.is_active, v.triggers, v.keywords, v.match_type, v.scope, v.media_id, v.media_label, v.media_permalink, v.reply_text, v.link_url, v.comment_reply_text, v.disclose_automation, v.cooldown_hours]
      );
      res.json({ rule: rows[0] });
    } catch (error) {
      console.error('Update rule error:', error.message);
      res.status(500).json({ error: 'Failed to update the rule.' });
    }
  });

  router.delete('/automation/rules/:id', async (req, res) => {
    try {
      const result = await pool.query('DELETE FROM automation_rules WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
      if (!result.rowCount) return res.status(404).json({ error: 'Rule not found.' });
      res.status(204).end();
    } catch (error) {
      console.error('Delete rule error:', error.message);
      res.status(500).json({ error: 'Failed to delete the rule.' });
    }
  });

  // Your recent reels and posts, for choosing what a rule applies to (live from Instagram)
  router.get('/automation/media', async (req, res) => {
    const account = await ownedAccount(req.user.userId, req.query.accountId);
    if (!account) return res.status(404).json({ error: 'Choose one of your connected Instagram accounts.' });
    const result = await igGet(account, 'me/media', { fields: MEDIA_PICKER_FIELDS, limit: 50 });
    if (result.error) return res.status(result.error.code >= 400 && result.error.code < 600 ? result.error.code : 502).json({ error_details: toError(result.error) });
    res.json({ media: (result.data?.data ?? []).map(describeMedia).filter((m) => m.type !== 'story') });
  });

  router.get('/automation/log', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const { rows } = await pool.query(
        `SELECT e.id, e.source, e.status, e.skip_reason, e.error_code, e.error_message, e.sender_username, e.sender_id, e.trigger_text,
                e.message_text, e.note, e.created_at, r.name AS rule_name, a.page_name AS account_name
           FROM automation_events e
           JOIN instagram_accounts a ON a.id = e.account_id
           LEFT JOIN automation_rules r ON r.id = e.rule_id
          WHERE a.user_id = $1 ORDER BY e.created_at DESC LIMIT $2`, [req.user.userId, limit]);
      res.json({ events: rows });
    } catch (error) {
      console.error('Log error:', error.message);
      res.status(500).json({ error: 'Failed to load the activity log.' });
    }
  });

  // Is everything needed for live replies in place? Real Meta errors are passed through.
  router.get('/automation/status', async (req, res) => {
    try {
      const base = env.PUBLIC_BASE_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
      const accounts = await getInstagramAccountsByUserId(req.user.userId);
      const perAccount = await Promise.all(accounts.map(async (a) => {
        const [token, subs] = await Promise.all([checkToken(a), getSubscriptions(a)]);
        const fields = subs.data?.data?.[0]?.subscribed_fields ?? [];
        return {
          id: a.id,
          name: a.page_name,
          token_ok: !!token.data,
          token_error: token.error ? toError(token.error) : null,
          subscribed: WEBHOOK_FIELDS.split(',').every((f) => fields.includes(f)),
          subscribed_fields: fields,
          subscription_error: subs.error ? toError(subs.error) : null,
        };
      }));
      res.json({
        app_secret_configured: Boolean(env.META_APP_SECRET),
        verify_token_configured: Boolean(env.WEBHOOK_VERIFY_TOKEN),
        dry_run: env.AUTOMATION_DRY_RUN === 'true',
        callback_url: `${base}/api/webhooks/instagram`,
        is_https: base.startsWith('https://'),
        fields: WEBHOOK_FIELDS,
        accounts: perAccount,
      });
    } catch (error) {
      console.error('Status error:', error.message);
      res.status(500).json({ error: 'Failed to check the automation setup.' });
    }
  });

  router.post('/automation/subscribe', async (req, res) => {
    const account = await ownedAccount(req.user.userId, req.body?.accountId);
    if (!account) return res.status(404).json({ error: 'Choose one of your connected Instagram accounts.' });
    const result = await subscribeAccount(account, WEBHOOK_FIELDS);
    if (result.error) return res.status(result.error.code >= 400 && result.error.code < 600 ? result.error.code : 502).json({ error_details: toError(result.error) });
    res.json({ success: true });
  });

  // "What would happen if someone wrote this?" Nothing is sent and nothing is logged.
  router.post('/automation/test', async (req, res) => {
    try {
      const account = await ownedAccount(req.user.userId, req.body?.accountId);
      if (!account) return res.status(404).json({ error: 'Choose one of your connected Instagram accounts.' });
      const source = req.body?.source === 'dm' ? 'dm' : 'comment';
      const { rows } = await pool.query('SELECT * FROM automation_rules WHERE account_id = $1 AND is_active = TRUE ORDER BY id', [account.id]);
      const picked = pickRule(rows, {
        source,
        text: String(req.body?.text ?? ''),
        mediaId: req.body?.mediaId ? String(req.body.mediaId) : null,
        mediaProductType: req.body?.mediaProductType ? String(req.body.mediaProductType) : null,
      });
      if (!picked) return res.json({ matched: false });
      res.json({
        matched: true,
        rule_id: picked.rule.id,
        rule_name: picked.rule.name,
        scope: picked.rule.scope,
        media_label: picked.rule.media_label,
        keyword: picked.keyword,
        message: renderMessage(picked.rule, { username: req.body?.username || 'example_user' }),
        public_reply: source === 'comment' ? picked.rule.comment_reply_text : null,
      });
    } catch (error) {
      console.error('Test error:', error.message);
      res.status(500).json({ error: 'Test failed.' });
    }
  });

  return router;
}
