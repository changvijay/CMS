import ExcelJS from 'exceljs';
import { SCRIPT_STATUSES, normaliseDate } from './validation.js';

/** Excel backup, template and import for the Scripts workspace (same columns as ScriptVault, without attachments). */

export const SCRIPT_COLUMNS = [
  { header: 'Folder', key: 'folder', width: 22 },
  { header: 'Title', key: 'title', width: 28 },
  { header: 'Notes', key: 'notes', width: 42 },
  { header: 'Reference', key: 'reference', width: 26 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Categories', key: 'categories', width: 26 },
  { header: 'Goal', key: 'goal', width: 22 },
  { header: 'Deadline', key: 'deadline', width: 16 },
  { header: 'Created', key: 'created', width: 16 },
  { header: 'Modified', key: 'modified', width: 16 },
];

export const MAX_IMPORT_ROWS = 2000;

const styleHeader = (sheet) => {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
};

const isoDay = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');

/** Workbook with Scripts, To-Dos and Goals sheets (a folder export passes only scripts). Scripts carry `category_names` and `goal_title`. */
export async function buildExport({ scripts, todos, goals }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CMS Scripts';
  const s = wb.addWorksheet('Scripts');
  s.columns = SCRIPT_COLUMNS;
  for (const x of scripts) {
    s.addRow({
      folder: x.folder_name ?? '', title: x.title, notes: x.notes, reference: x.reference, status: x.status,
      categories: (x.category_names ?? []).join(', '), goal: x.goal_title ?? '', deadline: x.deadline ?? '',
      created: isoDay(x.created_at), modified: isoDay(x.modified_at),
    });
  }
  styleHeader(s);
  if (!todos && !goals) return Buffer.from(await wb.xlsx.writeBuffer());

  const t = wb.addWorksheet('To-Dos');
  t.columns = [{ header: 'Task', key: 'text', width: 40 }, { header: 'Priority', key: 'priority', width: 12 }, { header: 'Due Date', key: 'due_date', width: 14 }, { header: 'Done', key: 'completed', width: 8 }];
  for (const x of todos ?? []) t.addRow({ text: x.text, priority: x.priority, due_date: x.due_date ?? '', completed: x.completed ? 'Yes' : 'No' });
  styleHeader(t);

  const g = wb.addWorksheet('Goals');
  g.columns = [{ header: 'Goal', key: 'title', width: 36 }, { header: 'Target', key: 'target_value', width: 10 }, { header: 'Progress', key: 'current_progress', width: 10 }, { header: 'Deadline', key: 'deadline', width: 14 }, { header: 'Completed', key: 'completed', width: 11 }];
  for (const x of goals ?? []) g.addRow({ title: x.title, target_value: x.target_value, current_progress: x.current_progress, deadline: x.deadline ?? '', completed: x.completed ? 'Yes' : 'No' });
  styleHeader(g);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A sample sheet with dropdowns for status, the user's categories and goals, and date checks. */
export async function buildTemplate({ categories, goals, folders = [] }) {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Scripts');
  s.columns = SCRIPT_COLUMNS;
  const today = new Date().toISOString().slice(0, 10);
  const cat = categories[0]?.name ?? '';
  const folder = folders[0]?.name ?? 'Movie 1';
  s.addRow({ folder, title: 'Opening scene', notes: 'Hook: ...\nBody: ...\nCTA: Follow for more', reference: 'https://example.com', status: 'not_started', categories: cat, goal: goals[0]?.title ?? '', deadline: today });
  s.addRow({ folder, title: 'Interval twist', notes: 'Outline the three key points', reference: '', status: 'in_progress', categories: categories[1]?.name ?? cat, goal: '', deadline: '' });
  styleHeader(s);

  // Lists for the dropdowns live on a hidden sheet, so names with commas still work.
  const lists = wb.addWorksheet('Lists', { state: 'hidden' });
  SCRIPT_STATUSES.forEach((v, i) => { lists.getCell(i + 1, 1).value = v; });
  categories.forEach((c, i) => { lists.getCell(i + 1, 2).value = c.name; });
  goals.forEach((g, i) => { lists.getCell(i + 1, 3).value = g.title; });
  folders.forEach((f, i) => { lists.getCell(i + 1, 4).value = f.name; });
  const listRef = (col, n) => [`Lists!$${col}$1:$${col}$${Math.max(1, n)}`];

  for (let r = 2; r <= 100; r += 1) {
    // Folder: a dropdown of existing folders, but a new name is allowed (it is created on import).
    if (folders.length) s.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: listRef('D', folders.length), showErrorMessage: false };
    s.getCell(`E${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: listRef('A', SCRIPT_STATUSES.length) };
    if (categories.length) s.getCell(`F${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: listRef('B', categories.length), showErrorMessage: false };
    if (goals.length) s.getCell(`G${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: listRef('C', goals.length) };
    for (const c of ['H', 'I', 'J']) {
      s.getCell(`${c}${r}`).numFmt = 'yyyy-mm-dd';
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The plain text of a cell, whatever exceljs gives back (rich text, hyperlink, formula result...). */
export function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return cellText(v.text);
    if ('result' in v) return cellText(v.result);
    return '';
  }
  return String(v);
}

/** Excel stores dates as days since 1899-12-30. */
function cellDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (v < 1 || v > 2958465) return undefined;
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  if (typeof v === 'object' && 'result' in v) return cellDate(v.result);
  const s = cellText(v).trim();
  if (!s) return null;
  const direct = normaliseDate(s);
  if (direct) return direct;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

/**
 * Reads the first sheet. Errors block the import; warnings mean a row (duplicate) or a value (unknown category/goal)
 * is skipped, or a folder will be created. Returns rows ready to insert with category ids and goal id resolved, each
 * with its `folder_name`, plus `newFolders` (names in the file that don't exist yet).
 * A duplicate is the same title in the same folder; `existing` is [{ title, folder }] (`existingTitles` = unfiled).
 */
export async function parseImport(buffer, { existing = [], existingTitles = [], categories = [], goals = [], folders = [], intoFolder = null }) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return { rows: [], errors: ['This file could not be read. Upload an .xlsx file (Excel or Google Sheets → Download → .xlsx).'], warnings: [], newFolders: [] };
  }
  const sheet = wb.worksheets[0];
  if (!sheet) return { rows: [], errors: ['The file has no sheets.'], warnings: [], newFolders: [] };

  const header = {};
  sheet.getRow(1).eachCell((cell, col) => { header[cellText(cell.value).trim().toLowerCase()] = col; });
  if (!header.title) return { rows: [], errors: ['The first row must have a "Title" column.'], warnings: [], newFolders: [] };

  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), String(c.id)]));
  const goalByTitle = new Map(goals.map((g) => [g.title.toLowerCase(), String(g.id)]));
  const dupKey = (folder, title) => `${(folder ?? '').toLowerCase()}\u0000${title.toLowerCase()}`;
  const seen = new Set([...existing.map((e) => dupKey(e.folder, e.title)), ...existingTitles.map((t) => dupKey('', t))]);
  const folderNames = new Map(folders.map((f) => [f.name.toLowerCase(), f.name]));
  const newFolders = new Map();
  const rows = [];
  const errors = [];
  const warnings = [];

  const get = (row, name) => (header[name] ? row.getCell(header[name]).value : null);

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const title = cellText(get(row, 'title')).trim();
    const anyValue = Object.values(header).some((col) => cellText(row.getCell(col).value).trim() !== '');
    if (!anyValue) continue;
    if (!title) { errors.push(`Row ${r}: Title is empty.`); continue; }
    if (title.length > 200) { errors.push(`Row ${r}: Title is longer than 200 characters.`); continue; }

    const rawStatus = cellText(get(row, 'status')).trim().toLowerCase().replace(/\s+/g, '_');
    const status = rawStatus || 'not_started';
    if (!SCRIPT_STATUSES.includes(status)) { errors.push(`Row ${r}: Status "${rawStatus}" must be not_started, in_progress or completed.`); continue; }

    const deadline = cellDate(get(row, 'deadline'));
    if (deadline === undefined) { errors.push(`Row ${r}: Deadline is not a valid date.`); continue; }

    // Importing into a folder puts every row there, whatever the Folder column says.
    let folderName = intoFolder ?? (cellText(get(row, 'folder')).trim().slice(0, 80) || null);
    if (folderName && !intoFolder) {
      const known = folderNames.get(folderName.toLowerCase()) ?? newFolders.get(folderName.toLowerCase());
      if (known) folderName = known;
      else newFolders.set(folderName.toLowerCase(), folderName);
    }
    const key = dupKey(folderName, title);
    if (seen.has(key)) { warnings.push(`Row ${r}: "${title}" already exists${folderName ? ` in ${folderName}` : ''}, skipped.`); continue; }
    seen.add(key);

    const categoryIds = [];
    for (const name of cellText(get(row, 'categories')).split(',').map((n) => n.trim()).filter(Boolean)) {
      const id = catByName.get(name.toLowerCase());
      if (id) categoryIds.push(id);
      else warnings.push(`Row ${r}: category "${name}" not found, left out.`);
    }
    const goalTitle = cellText(get(row, 'goal')).trim();
    let goalId = null;
    if (goalTitle) {
      goalId = goalByTitle.get(goalTitle.toLowerCase()) ?? null;
      if (!goalId) warnings.push(`Row ${r}: goal "${goalTitle}" not found, left out.`);
    }

    rows.push({
      folder_name: folderName,
      title,
      notes: cellText(get(row, 'notes')).slice(0, 100_000),
      reference: cellText(get(row, 'reference')).trim().slice(0, 2000),
      status,
      deadline,
      goal_id: goalId,
      category_ids: [...new Set(categoryIds)],
    });
    if (rows.length > MAX_IMPORT_ROWS) {
      errors.push(`The file has more than ${MAX_IMPORT_ROWS} scripts. Split it into smaller files.`);
      break;
    }
  }
  // Only create folders that still have a script to hold after duplicates are skipped.
  const used = new Set(rows.map((r) => r.folder_name?.toLowerCase()).filter(Boolean));
  const created = [...newFolders.values()].filter((n) => used.has(n.toLowerCase()));
  for (const n of created) warnings.push(`New folder "${n}" will be created.`);
  if (!rows.length && !errors.length && !warnings.length) errors.push('No scripts found in the file.');
  return { rows, errors, warnings, newFolders: created };
}
