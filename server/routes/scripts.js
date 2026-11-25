import express from 'express';
import { pool, isDbReady } from '../db.js';
import { istDateString, addDays } from '../utils/dates.js';
import { open, resolveKey, seal } from '../utils/secretBox.js';
import {
  CATEGORY_COLORS, DEFAULT_CATEGORIES, FOLDER_FIELDS, GOAL_FIELDS, NICHE_FIELDS, SCRIPT_FIELDS, SCRIPT_STATUSES, TODO_FIELDS,
  mergeFields, normaliseDate, validateCategory, validateFolder, validateGoal, validateNiche, validateScript, validateTodo,
} from '../services/scripts/validation.js';
import { applyGoalChanges, goalLinkChanges } from '../services/scripts/goalProgress.js';
import { PROVIDER_META, isKnownModel, isProviderKey } from '../services/scripts/aiProviders.js';
import { createAiClient } from '../services/scripts/aiClient.js';
import {
  DEFAULT_ACTION_ORDER, DEFAULT_NICHES, actionSystemPrompt, customSystemPrompt, dailyIdeaPrompt, dailyIdeaUserMessage,
  ideaToNotes, isAction, parseDailyIdea,
} from '../services/scripts/aiPrompts.js';
import { buildExport, buildTemplate, parseImport } from '../services/scripts/excel.js';

/**
 * The Scripts workspace (ScriptVault in the browser): scripts, categories, goals, to-dos, and an AI assistant that
 * calls the user's own provider with their own key (stored encrypted, never sent back).
 */

const SCRIPT_SELECT = `
  SELECT s.id, s.title, s.notes, s.reference, s.status, to_char(s.deadline, 'YYYY-MM-DD') AS deadline, s.goal_id, s.folder_id,
         s.created_at, s.modified_at,
         COALESCE(array_agg(l.category_id::text ORDER BY l.category_id) FILTER (WHERE l.category_id IS NOT NULL), '{}') AS category_ids
    FROM scripts s LEFT JOIN script_category_links l ON l.script_id = s.id`;

const GOAL_SELECT = `SELECT id, title, target_value, current_progress, to_char(deadline, 'YYYY-MM-DD') AS deadline, completed, created_at FROM script_goals`;
const TODO_SELECT = `SELECT id, text, completed, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, created_at FROM script_todos`;
const NICHE_SELECT = 'SELECT id, title, language, description, created_at FROM script_niches';

const MAX_PAGE_SIZE = 100;
const MAX_CUSTOM_PROMPTS = 30;

const asId = (v) => (/^\d{1,18}$/.test(String(v ?? '')) ? String(v) : null);
/** The browser's own "today", so overdue matches what the user sees; IST when it is missing. */
const todayFrom = (req) => normaliseDate(req.query?.today ?? req.body?.today) || istDateString();

export function createScriptsRouter(authenticateToken, { env = process.env, fetchImpl = globalThis.fetch, aiLimiter } = {}) {
  const router = express.Router();
  const ai = createAiClient({ env, fetchImpl, ...(aiLimiter ? { limiter: aiLimiter } : {}) });
  const { providers, loadSettings, loadKeys, listNiches, aiState, generate, activeNicheOf, aiAllowed } = ai;

  router.use('/scripts', authenticateToken, (req, res, next) => (isDbReady() ? next() : res.status(503).json({ error: 'Database is not connected.' })));

  /** Errors we raised on purpose (4xx, or `expose` such as a provider's answer) keep their message; anything else is generic. */
  const fail = (res, err, message) => {
    const shown = err?.status && (err.status < 500 || err.expose);
    if (!shown) console.error(message, err?.message ?? err);
    res.status(shown ? err.status : 500).json({ error: shown ? err.message : message });
  };
  const bad = (res, errors) => res.status(400).json({ error: errors.join(' '), errors });

  const withTx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };


  // ---------------------------------------------------------------- settings row
  const ensureSettingsRow = (db, userId) => db.query('INSERT INTO script_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);

  // ---------------------------------------------------------------- scripts
  const getScript = async (db, userId, id) => {
    const { rows } = await db.query(`${SCRIPT_SELECT} WHERE s.id = $1 AND s.user_id = $2 GROUP BY s.id`, [id, userId]);
    return rows[0] ?? null;
  };

  const ownedGoal = async (db, userId, goalId) => {
    if (!goalId) return true;
    const { rows } = await db.query('SELECT 1 FROM script_goals WHERE id = $1 AND user_id = $2', [goalId, userId]);
    return rows.length > 0;
  };

  const ownedFolder = async (db, userId, folderId) => {
    if (!folderId) return true;
    const { rows } = await db.query('SELECT 1 FROM script_folders WHERE id = $1 AND user_id = $2', [folderId, userId]);
    return rows.length > 0;
  };

  /** The goal and folder a script points at must both belong to the same user. */
  const checkLinks = async (userId, v) => {
    if (!(await ownedGoal(pool, userId, v.goal_id))) return 'Linked goal not found.';
    if (!(await ownedFolder(pool, userId, v.folder_id))) return 'Folder not found.';
    return null;
  };

  const setCategories = async (db, userId, scriptId, categoryIds) => {
    await db.query('DELETE FROM script_category_links WHERE script_id = $1', [scriptId]);
    if (categoryIds.length) {
      await db.query(
        `INSERT INTO script_category_links (script_id, category_id)
         SELECT $1, id FROM script_categories WHERE user_id = $2 AND id = ANY($3::bigint[]) ON CONFLICT DO NOTHING`,
        [scriptId, userId, categoryIds]
      );
    }
  };

  const insertScript = async (db, userId, v) => {
    const { rows } = await db.query(
      `INSERT INTO scripts (user_id, title, notes, reference, status, deadline, goal_id, folder_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [userId, v.title, v.notes, v.reference, v.status, v.deadline, v.goal_id, v.folder_id ?? null]
    );
    const id = rows[0].id;
    await setCategories(db, userId, id, v.category_ids);
    await applyGoalChanges(db, userId, goalLinkChanges(null, v.goal_id));
    return id;
  };

  router.get('/scripts/items', async (req, res) => {
    try {
      const userId = req.user.userId;
      const where = ['s.user_id = $1'];
      const params = [userId];
      const q = String(req.query.q ?? '').trim();
      if (q) {
        params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
        where.push(`(s.title ILIKE $${params.length} OR s.notes ILIKE $${params.length} OR s.reference ILIKE $${params.length})`);
      }
      const status = String(req.query.status ?? '');
      if (SCRIPT_STATUSES.includes(status)) {
        params.push(status);
        where.push(`s.status = $${params.length}`);
      } else if (status === 'open') {
        // Everything still to do: the list view's default, so finished scripts don't crowd it.
        where.push(`s.status <> 'completed'`);
      }
      const category = asId(req.query.category);
      if (category) {
        params.push(category);
        where.push(`EXISTS (SELECT 1 FROM script_category_links c WHERE c.script_id = s.id AND c.category_id = $${params.length})`);
      }
      if (req.query.folder === 'none') where.push('s.folder_id IS NULL');
      else if (asId(req.query.folder)) {
        params.push(asId(req.query.folder));
        where.push(`s.folder_id = $${params.length}`);
      }
      const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 5, 1), MAX_PAGE_SIZE);
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const whereSql = where.join(' AND ');
      const total = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM scripts s WHERE ${whereSql}`, params)).rows[0]?.n ?? 0);
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const current = Math.min(page, pages);
      const { rows } = await pool.query(
        // Deadline order: earliest (overdue) first, undated last; same day → most recently edited first.
        `${SCRIPT_SELECT} WHERE ${whereSql} GROUP BY s.id ORDER BY s.deadline ASC NULLS LAST, s.modified_at DESC, s.id DESC LIMIT ${pageSize} OFFSET ${(current - 1) * pageSize}`,
        params
      );
      res.json({ scripts: rows, total, page: current, pages, pageSize });
    } catch (err) {
      fail(res, err, 'Failed to load scripts.');
    }
  });

  router.get('/scripts/items/:id', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Script not found.' });
      const script = await getScript(pool, req.user.userId, req.params.id);
      if (!script) return res.status(404).json({ error: 'Script not found.' });
      res.json({ script });
    } catch (err) {
      fail(res, err, 'Failed to load the script.');
    }
  });

  router.post('/scripts/items', async (req, res) => {
    try {
      const userId = req.user.userId;
      const { errors, value } = validateScript(req.body ?? {});
      if (errors.length) return bad(res, errors);
      const linkError = await checkLinks(userId, value);
      if (linkError) return bad(res, [linkError]);
      const script = await withTx(async (db) => getScript(db, userId, await insertScript(db, userId, value)));
      res.status(201).json({ script });
    } catch (err) {
      fail(res, err, 'Failed to save the script.');
    }
  });

  router.patch('/scripts/items/:id', async (req, res) => {
    try {
      const userId = req.user.userId;
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Script not found.' });
      const existing = await getScript(pool, userId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Script not found.' });
      const { errors, value: v } = validateScript(mergeFields(existing, req.body, SCRIPT_FIELDS));
      if (errors.length) return bad(res, errors);
      const linkError = await checkLinks(userId, v);
      if (linkError) return bad(res, [linkError]);
      const script = await withTx(async (db) => {
        await db.query(
          `UPDATE scripts SET title=$3, notes=$4, reference=$5, status=$6, deadline=$7, goal_id=$8, folder_id=$9, modified_at=NOW() WHERE id=$1 AND user_id=$2`,
          [existing.id, userId, v.title, v.notes, v.reference, v.status, v.deadline, v.goal_id, v.folder_id]
        );
        if (req.body?.category_ids !== undefined) await setCategories(db, userId, existing.id, v.category_ids);
        await applyGoalChanges(db, userId, goalLinkChanges(existing.goal_id, v.goal_id));
        return getScript(db, userId, existing.id);
      });
      res.json({ script });
    } catch (err) {
      fail(res, err, 'Failed to update the script.');
    }
  });

  const deleteScripts = async (userId, ids) => withTx(async (db) => {
    const { rows } = await db.query('DELETE FROM scripts WHERE user_id = $1 AND id = ANY($2::bigint[]) RETURNING goal_id', [userId, ids]);
    for (const r of rows) await applyGoalChanges(db, userId, goalLinkChanges(r.goal_id, null));
    return rows.length;
  });

  router.delete('/scripts/items/:id', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Script not found.' });
      const n = await deleteScripts(req.user.userId, [req.params.id]);
      if (!n) return res.status(404).json({ error: 'Script not found.' });
      res.status(204).end();
    } catch (err) {
      fail(res, err, 'Failed to delete the script.');
    }
  });

  router.post('/scripts/items/bulk-delete', async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(asId).filter(Boolean) : [];
      if (!ids.length || ids.length > 500) return bad(res, ['Choose between 1 and 500 scripts.']);
      res.json({ deleted: await deleteScripts(req.user.userId, ids) });
    } catch (err) {
      fail(res, err, 'Failed to delete the scripts.');
    }
  });

  router.post('/scripts/items/bulk-move', async (req, res) => {
    try {
      const userId = req.user.userId;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(asId).filter(Boolean) : [];
      if (!ids.length || ids.length > 500) return bad(res, ['Choose between 1 and 500 scripts.']);
      const folderId = req.body?.folder_id === null || req.body?.folder_id === undefined || req.body?.folder_id === '' ? null : asId(req.body.folder_id);
      if (req.body?.folder_id && !folderId) return bad(res, ['Folder is not valid.']);
      if (!(await ownedFolder(pool, userId, folderId))) return bad(res, ['Folder not found.']);
      const { rowCount } = await pool.query(
        'UPDATE scripts SET folder_id = $3, modified_at = NOW() WHERE user_id = $1 AND id = ANY($2::bigint[])', [userId, ids, folderId]);
      res.json({ moved: rowCount });
    } catch (err) {
      fail(res, err, 'Failed to move the scripts.');
    }
  });

  // ---------------------------------------------------------------- folders
  /** Folder rows with their script counts. `t` is the placeholder number of "today" (overdue and next deadline). */
  const folderSelect = (t) => `
    SELECT f.id, f.name, f.color, f.description, f.created_at,
           COUNT(s.id)::int AS script_count,
           COUNT(s.id) FILTER (WHERE s.status = 'completed')::int AS done_count,
           COUNT(s.id) FILTER (WHERE s.status = 'in_progress')::int AS in_progress_count,
           COUNT(s.id) FILTER (WHERE s.status <> 'completed' AND s.deadline < $${t})::int AS overdue_count,
           to_char(MIN(s.deadline) FILTER (WHERE s.status <> 'completed' AND s.deadline >= $${t}), 'YYYY-MM-DD') AS next_deadline,
           to_char(MIN(s.deadline) FILTER (WHERE s.status <> 'completed'), 'YYYY-MM-DD') AS earliest_deadline,
           GREATEST(f.updated_at, MAX(s.modified_at)) AS last_modified
      FROM script_folders f LEFT JOIN scripts s ON s.folder_id = f.id`;

  const getFolder = async (userId, id, today = istDateString()) =>
    (await pool.query(`${folderSelect(3)} WHERE f.id = $1 AND f.user_id = $2 GROUP BY f.id`, [id, userId, today])).rows[0] ?? null;
  const duplicateFolder = (err) => err?.code === '23505';

  router.get('/scripts/folders', async (req, res) => {
    try {
      const userId = req.user.userId;
      const [folders, unfiled] = await Promise.all([
        pool.query(`${folderSelect(2)} WHERE f.user_id = $1 GROUP BY f.id ORDER BY last_modified DESC NULLS LAST, f.id DESC`, [userId, todayFrom(req)]),
        pool.query(
          `SELECT COUNT(*)::int AS script_count, COUNT(*) FILTER (WHERE status = 'completed')::int AS done_count
             FROM scripts WHERE user_id = $1 AND folder_id IS NULL`, [userId]),
      ]);
      res.json({ folders: folders.rows, unfiled: unfiled.rows[0] ?? { script_count: 0, done_count: 0 }, colors: CATEGORY_COLORS });
    } catch (err) {
      fail(res, err, 'Failed to load folders.');
    }
  });

  router.get('/scripts/folders/:id', async (req, res) => {
    try {
      const folder = asId(req.params.id) && (await getFolder(req.user.userId, req.params.id));
      if (!folder) return res.status(404).json({ error: 'Folder not found.' });
      res.json({ folder });
    } catch (err) {
      fail(res, err, 'Failed to load the folder.');
    }
  });

  router.post('/scripts/folders', async (req, res) => {
    try {
      const { errors, value: v } = validateFolder(req.body ?? {});
      if (errors.length) return bad(res, errors);
      const { rows } = await pool.query('INSERT INTO script_folders (user_id, name, color, description) VALUES ($1,$2,$3,$4) RETURNING id', [req.user.userId, v.name, v.color, v.description]);
      res.status(201).json({ folder: await getFolder(req.user.userId, rows[0].id) });
    } catch (err) {
      if (duplicateFolder(err)) return bad(res, ['You already have a folder with this name.']);
      fail(res, err, 'Failed to create the folder.');
    }
  });

  router.patch('/scripts/folders/:id', async (req, res) => {
    try {
      const userId = req.user.userId;
      const existing = asId(req.params.id) && (await getFolder(userId, req.params.id));
      if (!existing) return res.status(404).json({ error: 'Folder not found.' });
      const { errors, value: v } = validateFolder(mergeFields(existing, req.body, FOLDER_FIELDS));
      if (errors.length) return bad(res, errors);
      await pool.query('UPDATE script_folders SET name=$3, color=$4, description=$5, updated_at=NOW() WHERE id=$1 AND user_id=$2', [existing.id, userId, v.name, v.color, v.description]);
      res.json({ folder: await getFolder(userId, existing.id) });
    } catch (err) {
      if (duplicateFolder(err)) return bad(res, ['You already have a folder with this name.']);
      fail(res, err, 'Failed to update the folder.');
    }
  });

  /** ?scripts=delete also deletes the scripts inside; otherwise they stay, unfiled. */
  router.delete('/scripts/folders/:id', async (req, res) => {
    try {
      const userId = req.user.userId;
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Folder not found.' });
      const withScripts = req.query.scripts === 'delete';
      const result = await withTx(async (db) => {
        const { rows } = await db.query('SELECT id FROM script_folders WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, userId]);
        if (!rows.length) return null;
        let deletedScripts = 0;
        if (withScripts) {
          const gone = await db.query('DELETE FROM scripts WHERE user_id = $1 AND folder_id = $2 RETURNING goal_id', [userId, req.params.id]);
          for (const r of gone.rows) await applyGoalChanges(db, userId, goalLinkChanges(r.goal_id, null));
          deletedScripts = gone.rows.length;
        }
        await db.query('DELETE FROM script_folders WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
        return { deleted_scripts: deletedScripts };
      });
      if (!result) return res.status(404).json({ error: 'Folder not found.' });
      res.json(result);
    } catch (err) {
      fail(res, err, 'Failed to delete the folder.');
    }
  });

  // ---------------------------------------------------------------- categories
  const listCategories = async (userId) => {
    const settings = await loadSettings(pool, userId);
    if (!settings.categories_seeded) {
      await withTx(async (db) => {
        await ensureSettingsRow(db, userId);
        const { rows } = await db.query('UPDATE script_settings SET categories_seeded = TRUE WHERE user_id = $1 AND categories_seeded = FALSE RETURNING user_id', [userId]);
        if (!rows.length) return; // another request seeded them first
        for (const c of DEFAULT_CATEGORIES) {
          await db.query('INSERT INTO script_categories (user_id, name, color) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [userId, c.name, c.color]);
        }
      });
    }
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.color, (SELECT COUNT(*)::int FROM script_category_links l WHERE l.category_id = c.id) AS script_count
         FROM script_categories c WHERE c.user_id = $1 ORDER BY lower(c.name)`, [userId]);
    return rows;
  };

  router.get('/scripts/categories', async (req, res) => {
    try {
      res.json({ categories: await listCategories(req.user.userId), colors: CATEGORY_COLORS });
    } catch (err) {
      fail(res, err, 'Failed to load categories.');
    }
  });

  const duplicateName = (err) => err?.code === '23505';

  router.post('/scripts/categories', async (req, res) => {
    try {
      const { errors, value } = validateCategory(req.body ?? {});
      if (errors.length) return bad(res, errors);
      const { rows } = await pool.query('INSERT INTO script_categories (user_id, name, color) VALUES ($1,$2,$3) RETURNING id, name, color', [req.user.userId, value.name, value.color]);
      res.status(201).json({ category: { ...rows[0], script_count: 0 } });
    } catch (err) {
      if (duplicateName(err)) return bad(res, ['A category with this name already exists.']);
      fail(res, err, 'Failed to save the category.');
    }
  });

  router.patch('/scripts/categories/:id', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Category not found.' });
      const { rows: found } = await pool.query('SELECT id, name, color FROM script_categories WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
      if (!found.length) return res.status(404).json({ error: 'Category not found.' });
      const { errors, value } = validateCategory(mergeFields(found[0], req.body, ['name', 'color']));
      if (errors.length) return bad(res, errors);
      const { rows } = await pool.query('UPDATE script_categories SET name = $3, color = $4 WHERE id = $1 AND user_id = $2 RETURNING id, name, color', [req.params.id, req.user.userId, value.name, value.color]);
      res.json({ category: rows[0] });
    } catch (err) {
      if (duplicateName(err)) return bad(res, ['A category with this name already exists.']);
      fail(res, err, 'Failed to update the category.');
    }
  });

  router.delete('/scripts/categories/:id', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Category not found.' });
      const { rows } = await pool.query(
        `WITH d AS (DELETE FROM script_categories WHERE id = $1 AND user_id = $2 RETURNING id)
         SELECT (SELECT COUNT(*)::int FROM d) AS deleted`, [req.params.id, req.user.userId]);
      if (!rows[0]?.deleted) return res.status(404).json({ error: 'Category not found.' });
      res.status(204).end();
    } catch (err) {
      fail(res, err, 'Failed to delete the category.');
    }
  });

  // ---------------------------------------------------------------- goals
  router.get('/scripts/goals', async (req, res) => {
    try {
      const { rows } = await pool.query(`${GOAL_SELECT} WHERE user_id = $1 ORDER BY completed, created_at DESC`, [req.user.userId]);
      res.json({ goals: rows });
    } catch (err) {
      fail(res, err, 'Failed to load goals.');
    }
  });

  router.post('/scripts/goals', async (req, res) => {
    try {
      const { errors, value: v } = validateGoal(req.body ?? {});
      if (errors.length) return bad(res, errors);
      const { rows } = await pool.query(
        `INSERT INTO script_goals (user_id, title, target_value, current_progress, deadline, completed) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [req.user.userId, v.title, v.target_value, v.current_progress, v.deadline, v.completed]);
      const { rows: goal } = await pool.query(`${GOAL_SELECT} WHERE id = $1`, [rows[0].id]);
      res.status(201).json({ goal: goal[0] });
    } catch (err) {
      fail(res, err, 'Failed to save the goal.');
    }
  });

  router.patch('/scripts/goals/:id', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Goal not found.' });
      const { rows: found } = await pool.query(`${GOAL_SELECT} WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.userId]);
      if (!found.length) return res.status(404).json({ error: 'Goal not found.' });
      const { errors, value: v } = validateGoal(mergeFields(found[0], req.body, GOAL_FIELDS));
      if (errors.length) return bad(res, errors);
      await pool.query(
        `UPDATE script_goals SET title=$3, target_value=$4, current_progress=$5, deadline=$6, completed=$7, updated_at=NOW() WHERE id=$1 AND user_id=$2`,
        [req.params.id, req.user.userId, v.title, v.target_value, v.current_progress, v.deadline, v.completed]);
      const { rows } = await pool.query(`${GOAL_SELECT} WHERE id = $1`, [req.params.id]);
      res.json({ goal: rows[0] });
    } catch (err) {
      fail(res, err, 'Failed to update the goal.');
    }
  });

  router.post('/scripts/goals/:id/increment', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Goal not found.' });
      const { rowCount } = await pool.query(
        `UPDATE script_goals SET current_progress = current_progress + 1, completed = current_progress + 1 >= target_value, updated_at = NOW()
          WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.userId]);
      if (!rowCount) return res.status(404).json({ error: 'Goal not found.' });
      const { rows } = await pool.query(`${GOAL_SELECT} WHERE id = $1`, [req.params.id]);
      res.json({ goal: rows[0] });
    } catch (err) {
      fail(res, err, 'Failed to update the goal.');
    }
  });

  router.delete('/scripts/goals/:id', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Goal not found.' });
      const { rowCount } = await pool.query('DELETE FROM script_goals WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
      if (!rowCount) return res.status(404).json({ error: 'Goal not found.' });
      res.status(204).end();
    } catch (err) {
      fail(res, err, 'Failed to delete the goal.');
    }
  });

  // ---------------------------------------------------------------- to-dos
  router.get('/scripts/todos', async (req, res) => {
    try {
      const { rows } = await pool.query(`${TODO_SELECT} WHERE user_id = $1 ORDER BY created_at DESC`, [req.user.userId]);
      res.json({ todos: rows });
    } catch (err) {
      fail(res, err, 'Failed to load to-dos.');
    }
  });

  router.post('/scripts/todos', async (req, res) => {
    try {
      const { errors, value: v } = validateTodo(req.body ?? {});
      if (errors.length) return bad(res, errors);
      const { rows } = await pool.query(
        `INSERT INTO script_todos (user_id, text, priority, due_date, completed) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [req.user.userId, v.text, v.priority, v.due_date, v.completed]);
      const { rows: todo } = await pool.query(`${TODO_SELECT} WHERE id = $1`, [rows[0].id]);
      res.status(201).json({ todo: todo[0] });
    } catch (err) {
      fail(res, err, 'Failed to save the task.');
    }
  });

  router.patch('/scripts/todos/:id', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Task not found.' });
      const { rows: found } = await pool.query(`${TODO_SELECT} WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.userId]);
      if (!found.length) return res.status(404).json({ error: 'Task not found.' });
      const { errors, value: v } = validateTodo(mergeFields(found[0], req.body, TODO_FIELDS));
      if (errors.length) return bad(res, errors);
      await pool.query(
        `UPDATE script_todos SET text=$3, priority=$4, due_date=$5, completed=$6, updated_at=NOW() WHERE id=$1 AND user_id=$2`,
        [req.params.id, req.user.userId, v.text, v.priority, v.due_date, v.completed]);
      const { rows } = await pool.query(`${TODO_SELECT} WHERE id = $1`, [req.params.id]);
      res.json({ todo: rows[0] });
    } catch (err) {
      fail(res, err, 'Failed to update the task.');
    }
  });

  router.delete('/scripts/todos/:id', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Task not found.' });
      const { rowCount } = await pool.query('DELETE FROM script_todos WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
      if (!rowCount) return res.status(404).json({ error: 'Task not found.' });
      res.status(204).end();
    } catch (err) {
      fail(res, err, 'Failed to delete the task.');
    }
  });

  router.post('/scripts/todos/clear-done', async (req, res) => {
    try {
      const { rowCount } = await pool.query('DELETE FROM script_todos WHERE user_id = $1 AND completed', [req.user.userId]);
      res.json({ deleted: rowCount });
    } catch (err) {
      fail(res, err, 'Failed to clear finished tasks.');
    }
  });

  // ---------------------------------------------------------------- dashboard & calendar
  router.get('/scripts/dashboard', async (req, res) => {
    try {
      const userId = req.user.userId;
      const today = todayFrom(req);
      const weekEnd = addDays(today, 7);
      const [counts, goals, due, recent] = await Promise.all([
        pool.query(
          `SELECT
             (SELECT COUNT(*)::int FROM scripts WHERE user_id = $1) AS scripts_total,
             (SELECT COUNT(*)::int FROM scripts WHERE user_id = $1 AND status = 'completed') AS scripts_done,
             (SELECT COUNT(*)::int FROM scripts WHERE user_id = $1 AND status = 'in_progress') AS scripts_in_progress,
             (SELECT COUNT(*)::int FROM scripts WHERE user_id = $1 AND status <> 'completed' AND deadline < $2) AS scripts_overdue,
             (SELECT COUNT(*)::int FROM scripts WHERE user_id = $1 AND status <> 'completed' AND deadline >= $2 AND deadline <= $3) AS scripts_due_week,
             (SELECT COUNT(*)::int FROM script_todos WHERE user_id = $1) AS todos_total,
             (SELECT COUNT(*)::int FROM script_todos WHERE user_id = $1 AND completed) AS todos_done,
             (SELECT COUNT(*)::int FROM script_todos WHERE user_id = $1 AND NOT completed AND due_date < $2) AS todos_overdue,
             (SELECT COUNT(*)::int FROM script_todos WHERE user_id = $1 AND NOT completed AND priority = 'high') AS todos_high,
             (SELECT COUNT(*)::int FROM script_niches WHERE user_id = $1) AS niches_total,
             (SELECT COUNT(*)::int FROM scripts WHERE user_id = $1 AND status = 'not_started') AS scripts_not_started,
             (SELECT COUNT(*)::int FROM script_folders WHERE user_id = $1) AS folders_total,
             (SELECT COUNT(*)::int FROM script_goals WHERE user_id = $1) AS goals_total,
             (SELECT COUNT(*)::int FROM script_goals WHERE user_id = $1 AND completed) AS goals_done`,
          [userId, today, weekEnd]),
        pool.query(`${GOAL_SELECT} WHERE user_id = $1 AND NOT completed ORDER BY created_at DESC LIMIT 3`, [userId]),
        pool.query(`${SCRIPT_SELECT} WHERE s.user_id = $1 AND s.status <> 'completed' AND s.deadline >= $2 AND s.deadline <= $3 GROUP BY s.id ORDER BY s.deadline, s.id LIMIT 3`, [userId, today, weekEnd]),
        pool.query(`${SCRIPT_SELECT} WHERE s.user_id = $1 GROUP BY s.id ORDER BY s.modified_at DESC, s.id DESC LIMIT 3`, [userId]),
      ]);
      res.json({ today, counts: counts.rows[0], goals: goals.rows, due_this_week: due.rows, recent: recent.rows });
    } catch (err) {
      fail(res, err, 'Failed to load the dashboard.');
    }
  });

  router.get('/scripts/calendar', async (req, res) => {
    try {
      const from = normaliseDate(req.query.from);
      const to = normaliseDate(req.query.to);
      if (!from || !to || from > to || addDays(from, 62) < to) return bad(res, ['Give a from/to range of up to 62 days.']);
      const [scripts, todos] = await Promise.all([
        pool.query(`${SCRIPT_SELECT} WHERE s.user_id = $1 AND s.deadline BETWEEN $2 AND $3 GROUP BY s.id ORDER BY s.deadline, s.title`, [req.user.userId, from, to]),
        pool.query(`${TODO_SELECT} WHERE user_id = $1 AND due_date BETWEEN $2 AND $3 ORDER BY due_date, completed, text`, [req.user.userId, from, to]),
      ]);
      res.json({ scripts: scripts.rows.map(({ notes: _notes, ...s }) => s), todos: todos.rows });
    } catch (err) {
      fail(res, err, 'Failed to load the calendar.');
    }
  });

  // ---------------------------------------------------------------- AI settings & keys

  router.get('/scripts/ai/settings', async (req, res) => {
    try {
      res.json((await aiState(req.user.userId)).view);
    } catch (err) {
      fail(res, err, 'Failed to load AI settings.');
    }
  });

  const cleanPrefs = (prefs) => {
    const errors = [];
    const custom = Array.isArray(prefs?.custom_prompts) ? prefs.custom_prompts : [];
    if (custom.length > MAX_CUSTOM_PROMPTS) errors.push(`Keep up to ${MAX_CUSTOM_PROMPTS} saved prompts.`);
    const customPrompts = custom.slice(0, MAX_CUSTOM_PROMPTS).map((c) => ({
      id: /^custom_[a-z0-9]{1,24}$/i.test(String(c?.id)) ? String(c.id) : `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      label: String(c?.label ?? '').trim().slice(0, 40),
      emoji: String(c?.emoji ?? '✨').slice(0, 8),
      prompt: String(c?.prompt ?? '').trim().slice(0, 4000),
    }));
    if (customPrompts.some((c) => !c.label || !c.prompt)) errors.push('Each saved prompt needs a label and the prompt text.');
    const known = new Set([...DEFAULT_ACTION_ORDER, ...customPrompts.map((c) => c.id)]);
    const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((k) => known.has(k)))];
    return { errors, value: { order: ids(prefs?.order), hidden: ids(prefs?.hidden), custom_prompts: customPrompts } };
  };

  router.put('/scripts/ai/settings', async (req, res) => {
    try {
      const userId = req.user.userId;
      const body = req.body ?? {};
      const settings = await loadSettings(pool, userId);
      let activeProvider = settings.active_provider;
      let actionPrefs = settings.action_prefs ?? {};
      let activeNiche = settings.active_niche_id;
      if (body.active_provider !== undefined) {
        if (!isProviderKey(body.active_provider)) return bad(res, ['Unknown AI provider.']);
        activeProvider = body.active_provider;
      }
      if (body.action_prefs !== undefined) {
        const { errors, value } = cleanPrefs(body.action_prefs);
        if (errors.length) return bad(res, errors);
        actionPrefs = value;
      }
      if (body.active_niche_id !== undefined) {
        activeNiche = body.active_niche_id === null ? null : asId(body.active_niche_id);
        if (activeNiche && !(await pool.query('SELECT 1 FROM script_niches WHERE id = $1 AND user_id = $2', [activeNiche, userId])).rows.length) return bad(res, ['Niche not found.']);
      }
      await pool.query(
        `INSERT INTO script_settings (user_id, active_provider, action_prefs, active_niche_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET active_provider = $2, action_prefs = $3, active_niche_id = $4, updated_at = NOW()`,
        [userId, activeProvider, JSON.stringify(actionPrefs), activeNiche]);
      res.json((await aiState(userId)).view);
    } catch (err) {
      fail(res, err, 'Failed to save AI settings.');
    }
  });

  const keyError = (err) => Object.assign(new Error(`The key did not work: ${err?.message ?? 'unknown error'}`), { status: 400 });

  router.post('/scripts/ai/providers/:key/test', async (req, res) => {
    try {
      const provider = req.params.key;
      if (!isProviderKey(provider)) return res.status(404).json({ error: 'Unknown AI provider.' });
      if (!aiAllowed(req, res)) return;
      let apiKey = String(req.body?.api_key ?? '').trim();
      if (!apiKey) {
        const stored = (await loadKeys(req.user.userId))[provider];
        if (!stored) return bad(res, ['Enter an API key to test.']);
        apiKey = open(stored, resolveKey(env));
      }
      try {
        await providers[provider].test(apiKey);
      } catch (err) {
        return res.status(400).json({ ok: false, error: keyError(err).message });
      }
      res.json({ ok: true });
    } catch (err) {
      fail(res, err, 'Failed to test the key.');
    }
  });

  router.put('/scripts/ai/providers/:key', async (req, res) => {
    try {
      const userId = req.user.userId;
      const provider = req.params.key;
      if (!isProviderKey(provider)) return res.status(404).json({ error: 'Unknown AI provider.' });
      const body = req.body ?? {};
      const apiKey = String(body.api_key ?? '').trim();
      const model = body.model ?? PROVIDER_META[provider].defaultModel;
      if (!isKnownModel(provider, model)) return bad(res, ['Choose one of the listed models.']);
      if (apiKey.length > 500) return bad(res, ['That key is too long.']);
      const keys = await loadKeys(userId);
      if (!apiKey && !keys[provider] && body.enabled) return bad(res, ['Enter an API key.']);

      if (apiKey) {
        // A new key must work before it is saved (as in ScriptVault).
        if (!aiAllowed(req, res)) return;
        try {
          await providers[provider].test(apiKey);
        } catch (err) {
          return res.status(400).json({ error: keyError(err).message });
        }
        const sealed = seal(apiKey, resolveKey(env));
        await pool.query(
          `INSERT INTO script_ai_keys (user_id, provider, ciphertext, iv, tag, last4) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (user_id, provider) DO UPDATE SET ciphertext = $3, iv = $4, tag = $5, last4 = $6, updated_at = NOW()`,
          [userId, provider, sealed.ciphertext, sealed.iv, sealed.tag, apiKey.slice(-4)]);
      }
      const settings = await loadSettings(pool, userId);
      const nextProviders = { ...(settings.providers ?? {}), [provider]: { enabled: body.enabled !== false, model } };
      const active = settings.active_provider && nextProviders[settings.active_provider]?.enabled ? settings.active_provider : provider;
      await pool.query(
        `INSERT INTO script_settings (user_id, providers, active_provider) VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET providers = $2, active_provider = $3, updated_at = NOW()`,
        [userId, JSON.stringify(nextProviders), active]);
      res.json((await aiState(userId)).view);
    } catch (err) {
      fail(res, err, 'Failed to save the AI provider.');
    }
  });

  router.delete('/scripts/ai/providers/:key', async (req, res) => {
    try {
      const userId = req.user.userId;
      const provider = req.params.key;
      if (!isProviderKey(provider)) return res.status(404).json({ error: 'Unknown AI provider.' });
      await pool.query('DELETE FROM script_ai_keys WHERE user_id = $1 AND provider = $2', [userId, provider]);
      const settings = await loadSettings(pool, userId);
      const nextProviders = { ...(settings.providers ?? {}) };
      delete nextProviders[provider];
      await pool.query(
        `INSERT INTO script_settings (user_id, providers) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET providers = $2, updated_at = NOW()`,
        [userId, JSON.stringify(nextProviders)]);
      res.json((await aiState(userId)).view);
    } catch (err) {
      fail(res, err, 'Failed to remove the AI provider.');
    }
  });


  router.post('/scripts/ai/run', async (req, res) => {
    try {
      const userId = req.user.userId;
      const { action, prompt, content, provider } = req.body ?? {};
      const text = String(content ?? '');
      if (!text.trim()) return bad(res, ['The script is empty. Write something first.']);
      if (text.length > 100_000) return bad(res, ['The script is too long for the assistant.']);
      if (action !== undefined && !isAction(action)) return bad(res, ['Unknown AI action.']);
      const custom = String(prompt ?? '').trim();
      if (action === undefined && !custom) return bad(res, ['Choose an action or write an instruction.']);
      if (custom.length > 4000) return bad(res, ['The instruction is too long.']);
      if (!aiAllowed(req, res)) return;
      const niche = await activeNicheOf(userId);
      const system = action !== undefined ? actionSystemPrompt(action, niche) : customSystemPrompt(custom, niche);
      res.json(await generate(userId, provider, system, text));
    } catch (err) {
      fail(res, err, 'The AI request failed.');
    }
  });

  // ---------------------------------------------------------------- niches
  router.get('/scripts/ai/niches', async (req, res) => {
    try {
      res.json({ niches: await listNiches(req.user.userId) });
    } catch (err) {
      fail(res, err, 'Failed to load niches.');
    }
  });

  router.post('/scripts/ai/niches', async (req, res) => {
    try {
      const { errors, value: v } = validateNiche(req.body ?? {});
      if (errors.length) return bad(res, errors);
      const { rows } = await pool.query('INSERT INTO script_niches (user_id, title, language, description) VALUES ($1,$2,$3,$4) RETURNING id, title, language, description, created_at', [req.user.userId, v.title, v.language, v.description]);
      res.status(201).json({ niche: rows[0] });
    } catch (err) {
      fail(res, err, 'Failed to save the niche.');
    }
  });

  router.post('/scripts/ai/niches/defaults', async (req, res) => {
    try {
      const userId = req.user.userId;
      const existing = new Set((await listNiches(userId)).map((n) => n.title.toLowerCase()));
      for (const n of DEFAULT_NICHES.filter((d) => !existing.has(d.title.toLowerCase()))) {
        await pool.query('INSERT INTO script_niches (user_id, title, language, description) VALUES ($1,$2,$3,$4)', [userId, n.title, n.language, n.description]);
      }
      res.json({ niches: await listNiches(userId) });
    } catch (err) {
      fail(res, err, 'Failed to add the default niches.');
    }
  });

  router.patch('/scripts/ai/niches/:id', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Niche not found.' });
      const { rows: found } = await pool.query(`${NICHE_SELECT} WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.userId]);
      if (!found.length) return res.status(404).json({ error: 'Niche not found.' });
      const { errors, value: v } = validateNiche(mergeFields(found[0], req.body, NICHE_FIELDS));
      if (errors.length) return bad(res, errors);
      const { rows } = await pool.query('UPDATE script_niches SET title=$3, language=$4, description=$5 WHERE id=$1 AND user_id=$2 RETURNING id, title, language, description, created_at', [req.params.id, req.user.userId, v.title, v.language, v.description]);
      res.json({ niche: rows[0] });
    } catch (err) {
      fail(res, err, 'Failed to update the niche.');
    }
  });

  router.delete('/scripts/ai/niches/:id', async (req, res) => {
    try {
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Niche not found.' });
      const { rowCount } = await pool.query('DELETE FROM script_niches WHERE id = $1 AND user_id = $2', [req.params.id, req.user.userId]);
      if (!rowCount) return res.status(404).json({ error: 'Niche not found.' });
      res.status(204).end();
    } catch (err) {
      fail(res, err, 'Failed to delete the niche.');
    }
  });

  // ---------------------------------------------------------------- daily idea
  const ideaOut = (row) => ({ id: row.id, niche_id: row.niche_id, date: row.idea_date, accepted_script_id: row.accepted_script_id, ...row.payload });

  router.get('/scripts/ai/daily-idea', async (req, res) => {
    try {
      const userId = req.user.userId;
      const today = todayFrom(req);
      const { niches, view } = await aiState(userId);
      if (!niches.length) return res.json({ idea: null, reason: 'no_niche' });
      const niche = niches.find((n) => String(n.id) === String(req.query.nicheId)) ?? niches.find((n) => String(n.id) === view.active_niche_id) ?? niches[0];
      if (req.query.refresh !== '1') {
        const { rows } = await pool.query(
          `SELECT id, niche_id, to_char(idea_date, 'YYYY-MM-DD') AS idea_date, payload, accepted_script_id FROM script_daily_ideas
            WHERE user_id = $1 AND niche_id = $2 AND idea_date = $3`, [userId, niche.id, today]);
        if (rows.length) return res.json({ idea: ideaOut(rows[0]) });
      }
      if (!view.active_provider) return res.json({ idea: null, reason: 'no_ai' });
      if (!aiAllowed(req, res)) return;
      const { text } = await generate(userId, null, customSystemPrompt(dailyIdeaPrompt(niche, today), null), dailyIdeaUserMessage(niche));
      const payload = parseDailyIdea(text, niche.title, niche.language);
      const { rows } = await pool.query(
        `INSERT INTO script_daily_ideas (user_id, niche_id, idea_date, payload) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, niche_id, idea_date) DO UPDATE SET payload = $4, accepted_script_id = NULL, created_at = NOW()
         RETURNING id, niche_id, to_char(idea_date, 'YYYY-MM-DD') AS idea_date, payload, accepted_script_id`,
        [userId, niche.id, today, JSON.stringify(payload)]);
      res.json({ idea: ideaOut(rows[0]) });
    } catch (err) {
      fail(res, err, 'Could not generate today’s idea.');
    }
  });

  router.post('/scripts/ai/daily-idea/:id/accept', async (req, res) => {
    try {
      const userId = req.user.userId;
      if (!asId(req.params.id)) return res.status(404).json({ error: 'Idea not found.' });
      const { rows } = await pool.query(
        `SELECT id, niche_id, to_char(idea_date, 'YYYY-MM-DD') AS idea_date, payload, accepted_script_id FROM script_daily_ideas WHERE id = $1 AND user_id = $2`,
        [req.params.id, userId]);
      if (!rows.length) return res.status(404).json({ error: 'Idea not found.' });
      const row = rows[0];
      if (row.accepted_script_id) return res.json({ script_id: String(row.accepted_script_id) });
      const idea = row.payload;
      const { errors, value } = validateScript({ title: idea.title, notes: ideaToNotes(idea, row.idea_date), status: 'not_started' });
      if (errors.length) return bad(res, errors);
      const scriptId = await withTx(async (db) => {
        const id = await insertScript(db, userId, value);
        await db.query('UPDATE script_daily_ideas SET accepted_script_id = $2 WHERE id = $1', [row.id, id]);
        return id;
      });
      res.status(201).json({ script_id: String(scriptId) });
    } catch (err) {
      fail(res, err, 'Failed to add the idea to your scripts.');
    }
  });

  // ---------------------------------------------------------------- import / export
  const sendXlsx = (res, buf, name) => {
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // ASCII fallback plus the real (possibly Tamil) name, encoded per RFC 5987.
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    });
    res.send(buf);
  };

  const lookups = async (userId) => {
    const [categories, goals, folders] = await Promise.all([
      listCategories(userId),
      pool.query('SELECT id, title FROM script_goals WHERE user_id = $1 ORDER BY created_at', [userId]).then((r) => r.rows),
      pool.query('SELECT id, name FROM script_folders WHERE user_id = $1 ORDER BY lower(name)', [userId]).then((r) => r.rows),
    ]);
    return { categories, goals, folders };
  };

  /** ?folder=<id> limits export, template and import to one of the user's folders. Undefined = whole library, null = not found. */
  const folderFromQuery = async (req) => {
    if (req.query.folder === undefined || req.query.folder === '') return undefined;
    const id = asId(req.query.folder);
    if (!id) return null;
    const { rows } = await pool.query('SELECT id, name FROM script_folders WHERE id = $1 AND user_id = $2', [id, req.user.userId]);
    return rows[0] ?? null;
  };
  const fileSafe = (name) => String(name).replace(/[^\p{L}\p{M}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Folder';
  const stampNow = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  router.get('/scripts/export.xlsx', async (req, res) => {
    try {
      const userId = req.user.userId;
      const folder = await folderFromQuery(req);
      if (folder === null) return res.status(404).json({ error: 'Folder not found.' });
      if (folder) {
        const { rows } = await pool.query(
          `SELECT s.title, s.notes, s.reference, s.status, to_char(s.deadline, 'YYYY-MM-DD') AS deadline, s.created_at, s.modified_at, g.title AS goal_title, $3::text AS folder_name,
                  COALESCE(array_agg(c.name ORDER BY lower(c.name)) FILTER (WHERE c.id IS NOT NULL), '{}') AS category_names
             FROM scripts s
             LEFT JOIN script_goals g ON g.id = s.goal_id
             LEFT JOIN script_category_links l ON l.script_id = s.id
             LEFT JOIN script_categories c ON c.id = l.category_id
            WHERE s.user_id = $1 AND s.folder_id = $2 GROUP BY s.id, g.title ORDER BY s.created_at`, [userId, folder.id, folder.name]);
        return sendXlsx(res, await buildExport({ scripts: rows }), `${fileSafe(folder.name)}_${stampNow()}.xlsx`);
      }
      const [scripts, todos, goals] = await Promise.all([
        pool.query(
          `SELECT s.title, s.notes, s.reference, s.status, to_char(s.deadline, 'YYYY-MM-DD') AS deadline, s.created_at, s.modified_at, g.title AS goal_title, f.name AS folder_name,
                  COALESCE(array_agg(c.name ORDER BY lower(c.name)) FILTER (WHERE c.id IS NOT NULL), '{}') AS category_names
             FROM scripts s
             LEFT JOIN script_goals g ON g.id = s.goal_id
             LEFT JOIN script_folders f ON f.id = s.folder_id
             LEFT JOIN script_category_links l ON l.script_id = s.id
             LEFT JOIN script_categories c ON c.id = l.category_id
            WHERE s.user_id = $1 GROUP BY s.id, g.title, f.name ORDER BY f.name NULLS FIRST, s.modified_at DESC`, [userId]),
        pool.query(`${TODO_SELECT} WHERE user_id = $1 ORDER BY created_at`, [userId]),
        pool.query(`${GOAL_SELECT} WHERE user_id = $1 ORDER BY created_at`, [userId]),
      ]);
      sendXlsx(res, await buildExport({ scripts: scripts.rows, todos: todos.rows, goals: goals.rows }), `Scripts_Export_${stampNow()}.xlsx`);
    } catch (err) {
      fail(res, err, 'Failed to build the export.');
    }
  });

  router.get('/scripts/template.xlsx', async (req, res) => {
    try {
      const folder = await folderFromQuery(req);
      if (folder === null) return res.status(404).json({ error: 'Folder not found.' });
      const data = await lookups(req.user.userId);
      // A folder's template lists only that folder, so the sample rows already point at it.
      sendXlsx(res, await buildTemplate(folder ? { ...data, folders: [folder] } : data), folder ? `${fileSafe(folder.name)}_Template.xlsx` : 'Scripts_Sample_Template.xlsx');
    } catch (err) {
      fail(res, err, 'Failed to build the template.');
    }
  });

  router.post('/scripts/import', express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
    try {
      const userId = req.user.userId;
      if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, ['Choose an .xlsx file to import.']);
      const into = await folderFromQuery(req);
      if (into === null) return res.status(404).json({ error: 'Folder not found.' });
      const { categories, goals, folders } = await lookups(userId);
      const { rows: existing } = await pool.query(
        'SELECT s.title, f.name AS folder FROM scripts s LEFT JOIN script_folders f ON f.id = s.folder_id WHERE s.user_id = $1', [userId]);
      const parsed = await parseImport(req.body, { existing, categories, goals, folders, intoFolder: into?.name ?? null });
      const summary = { count: parsed.rows.length, errors: parsed.errors.slice(0, 10), error_count: parsed.errors.length, warnings: parsed.warnings.slice(0, 20), warning_count: parsed.warnings.length };
      if (parsed.errors.length || req.query.commit !== '1') return res.status(parsed.errors.length ? 400 : 200).json({ ...summary, imported: 0, ...(parsed.errors.length ? { error: parsed.errors[0] } : {}) });
      const imported = await withTx(async (db) => {
        // Folders named in the file that don't exist yet are created first.
        const folderIds = new Map(folders.map((f) => [f.name.toLowerCase(), String(f.id)]));
        for (const name of parsed.newFolders) {
          const { rows } = await db.query(
            `INSERT INTO script_folders (user_id, name) VALUES ($1, $2)
             ON CONFLICT (user_id, lower(name)) DO UPDATE SET updated_at = NOW() RETURNING id`, [userId, name]);
          folderIds.set(name.toLowerCase(), String(rows[0].id));
        }
        for (const row of parsed.rows) {
          await insertScript(db, userId, { ...row, folder_id: row.folder_name ? folderIds.get(row.folder_name.toLowerCase()) ?? null : null });
        }
        return parsed.rows.length;
      });
      res.json({ ...summary, imported });
    } catch (err) {
      fail(res, err, 'Failed to import the file.');
    }
  });

  return router;
}
