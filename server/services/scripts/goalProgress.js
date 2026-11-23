/**
 * A script linked to a goal counts once toward it (as in ScriptVault): moving the link takes one from the old goal
 * and adds one to the new goal. Returns the [goalId, delta] adjustments to apply.
 */
export function goalLinkChanges(oldGoalId, newGoalId) {
  const from = oldGoalId == null ? null : String(oldGoalId);
  const to = newGoalId == null ? null : String(newGoalId);
  if (from === to) return [];
  const changes = [];
  if (from) changes.push([from, -1]);
  if (to) changes.push([to, 1]);
  return changes;
}

/** Applies the adjustments; progress never goes below 0 and `completed` follows progress >= target. */
export async function applyGoalChanges(client, userId, changes) {
  for (const [goalId, delta] of changes) {
    await client.query(
      `UPDATE script_goals SET current_progress = GREATEST(0, current_progress + $3),
              completed = GREATEST(0, current_progress + $3) >= target_value, updated_at = NOW()
        WHERE id = $1 AND user_id = $2`,
      [goalId, userId, delta]
    );
  }
}
