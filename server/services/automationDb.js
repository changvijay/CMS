/** Database access for the auto-reply engine. Kept separate so the engine can be tested with a fake. */
const ACCOUNT_COLUMNS = 'id, user_id, page_name, page_id, ig_user_id, access_token';

/**
 * `checkToken(account)` (optional) asks Instagram who the token belongs to; it lets a webhook for an account that has no
 * ig_user_id stored yet be matched, since webhooks carry the user_id while page_id holds the API's own `id`.
 */
export function createAutomationDb(pool, { checkToken } = {}) {
  const findAccount = async (igId) => {
    const { rows } = await pool.query(`SELECT ${ACCOUNT_COLUMNS} FROM instagram_accounts WHERE ig_user_id = $1 OR page_id = $1 LIMIT 1`, [String(igId)]);
    return rows[0] ?? null;
  };

  const backfillIgUserIds = async () => {
    const { rows } = await pool.query(`SELECT ${ACCOUNT_COLUMNS} FROM instagram_accounts WHERE ig_user_id IS NULL`);
    let filled = 0;
    for (const account of rows) {
      const me = await checkToken(account);
      const userId = me.data?.user_id;
      if (!userId) continue;
      await pool.query('UPDATE instagram_accounts SET ig_user_id = $2 WHERE id = $1', [account.id, String(userId)]);
      filled += 1;
    }
    return filled;
  };

  return {
    async getAccountByIgId(igId) {
      const found = await findAccount(igId);
      if (found || !checkToken) return found;
      return (await backfillIgUserIds()) ? findAccount(igId) : null;
    },

    async getActiveRules(accountId) {
      const { rows } = await pool.query('SELECT * FROM automation_rules WHERE account_id = $1 AND is_active = TRUE ORDER BY id', [accountId]);
      return rows;
    },

    /** Inserts the event; returns its id, or null when this comment/message was already handled (a retry). */
    async claimEvent({ accountId, ruleId, source, eventKey, senderId, username, text }) {
      const { rows } = await pool.query(
        `INSERT INTO automation_events (account_id, rule_id, source, event_key, sender_id, sender_username, trigger_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (account_id, source, event_key) DO NOTHING
         RETURNING id`,
        [accountId, ruleId, source, eventKey, senderId || null, username || null, (text || '').slice(0, 500)]
      );
      return rows[0]?.id ?? null;
    },

    async sentRecently({ ruleId, senderId, hours }) {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM automation_events
          WHERE rule_id = $1 AND sender_id = $2 AND status IN ('sent','dry_run')
            AND created_at > NOW() - ($3 || ' hours')::interval LIMIT 1`,
        [ruleId, senderId, String(hours)]
      );
      return rowCount > 0;
    },

    async finishEvent(id, {
      status, skipReason = null, errorCode = null, errorMessage = null, messageId = null, messageText = null, note = null,
      keywordMatched = null, publicReplyText = null, retryAt = null, commentId = null,
    }) {
      await pool.query(
        `UPDATE automation_events
            SET status=$2, skip_reason=$3, error_code=$4, error_message=$5, message_id=$6, message_text=$7, note=$8,
                keyword_matched=COALESCE($9, keyword_matched), public_reply_text=$10, retry_at=$11, comment_id=COALESCE($12, comment_id),
                attempts = attempts + CASE WHEN $2 = 'queued' OR status = 'queued' THEN 1 ELSE 0 END
          WHERE id=$1`,
        [id, status, skipReason, errorCode, errorMessage, messageId, messageText, note, keywordMatched, publicReplyText, retryAt, commentId]
      );
    },

    /** An active rule of this account (used when someone taps "I followed"). */
    async getRule(id, accountId) {
      if (!/^\d+$/.test(String(id))) return null;
      const { rows } = await pool.query('SELECT * FROM automation_rules WHERE id = $1 AND account_id = $2 AND is_active = TRUE', [id, accountId]);
      return rows[0] ?? null;
    },

    /** Rate-limited replies whose retry time has come, with their rule and account. */
    async listQueued(now = Date.now()) {
      const { rows } = await pool.query(
        `SELECT e.*, row_to_json(r) AS rule, row_to_json(a) AS account
           FROM automation_events e
           JOIN automation_rules r ON r.id = e.rule_id
           JOIN (SELECT ${ACCOUNT_COLUMNS} FROM instagram_accounts) a ON a.id = e.account_id
          WHERE e.status = 'queued' AND e.retry_at <= $1
          ORDER BY e.retry_at LIMIT 50`,
        [new Date(now)]
      );
      return rows;
    },
  };
}
