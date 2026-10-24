/** Database access for the auto-reply engine. Kept separate so the engine can be tested with a fake. */
export function createAutomationDb(pool) {
  return {
    async getAccountByIgId(igId) {
      const { rows } = await pool.query('SELECT id, user_id, page_name, page_id, access_token FROM instagram_accounts WHERE page_id = $1 LIMIT 1', [String(igId)]);
      return rows[0] ?? null;
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

    async finishEvent(id, { status, skipReason = null, errorCode = null, errorMessage = null, messageId = null, messageText = null, note = null }) {
      await pool.query(
        `UPDATE automation_events
            SET status=$2, skip_reason=$3, error_code=$4, error_message=$5, message_id=$6, message_text=$7, note=$8
          WHERE id=$1`,
        [id, status, skipReason, errorCode, errorMessage, messageId, messageText, note]
      );
    },
  };
}
