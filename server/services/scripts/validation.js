/** Validation for the Scripts workspace. Each validator returns { errors, value } with `value` normalised for SQL. */

export const SCRIPT_STATUSES = ['not_started', 'in_progress', 'completed'];
export const PRIORITIES = ['low', 'medium', 'high'];
export const CATEGORY_COLORS = ['#EF4444', '#F97316', '#F59E0B', '#84CC16', '#10B981', '#14B8A6', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#64748B', '#78716C'];
export const DEFAULT_CATEGORIES = [
  { name: 'Work', color: '#3B82F6' },
  { name: 'Personal', color: '#10B981' },
  { name: 'Creative', color: '#8B5CF6' },
];

export const SCRIPT_FIELDS = ['title', 'notes', 'reference', 'status', 'deadline', 'goal_id', 'folder_id', 'category_ids'];
export const FOLDER_FIELDS = ['name', 'color', 'description'];
export const GOAL_FIELDS = ['title', 'target_value', 'current_progress', 'deadline'];
export const TODO_FIELDS = ['text', 'completed', 'priority', 'due_date'];
export const NICHE_FIELDS = ['title', 'language', 'description'];

const str = (v) => (v === undefined || v === null ? '' : String(v));
const isId = (v) => /^\d{1,18}$/.test(String(v));

/** A real calendar date as "YYYY-MM-DD", or null for empty. Returns undefined when invalid. */
export function normaliseDate(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? undefined : s;
}

export function validateScript(input) {
  const errors = [];
  const title = str(input.title).trim();
  if (!title) errors.push('Title is required.');
  if (title.length > 200) errors.push('Title must be 200 characters or fewer.');
  const notes = str(input.notes);
  if (notes.length > 100_000) errors.push('Notes are too long (100,000 characters max).');
  const reference = str(input.reference).trim();
  if (reference.length > 2000) errors.push('Reference is too long.');
  const status = input.status ?? 'not_started';
  if (!SCRIPT_STATUSES.includes(status)) errors.push('Status must be not_started, in_progress or completed.');
  const deadline = normaliseDate(input.deadline);
  if (deadline === undefined) errors.push('Deadline must be a date (YYYY-MM-DD).');
  const goalId = input.goal_id === undefined || input.goal_id === null || input.goal_id === '' ? null : input.goal_id;
  if (goalId !== null && !isId(goalId)) errors.push('Linked goal is not valid.');
  const folderId = input.folder_id === undefined || input.folder_id === null || input.folder_id === '' ? null : input.folder_id;
  if (folderId !== null && !isId(folderId)) errors.push('Folder is not valid.');
  const categoryIds = input.category_ids ?? [];
  if (!Array.isArray(categoryIds) || !categoryIds.every(isId)) errors.push('Categories are not valid.');
  return {
    errors,
    value: { title, notes, reference, status, deadline: deadline ?? null, goal_id: goalId === null ? null : String(goalId), folder_id: folderId === null ? null : String(folderId), category_ids: Array.isArray(categoryIds) ? [...new Set(categoryIds.map(String))] : [] },
  };
}

export function validateGoal(input) {
  const errors = [];
  const title = str(input.title).trim();
  if (!title) errors.push('Title is required.');
  if (title.length > 200) errors.push('Title must be 200 characters or fewer.');
  const target = input.target_value === undefined || input.target_value === '' || input.target_value === null ? 1 : Number(input.target_value);
  if (!Number.isInteger(target) || target < 1 || target > 1_000_000) errors.push('Target must be a whole number of at least 1.');
  const progress = input.current_progress === undefined || input.current_progress === '' || input.current_progress === null ? 0 : Number(input.current_progress);
  if (!Number.isInteger(progress) || progress < 0 || progress > 1_000_000) errors.push('Progress must be a whole number of 0 or more.');
  const deadline = normaliseDate(input.deadline);
  if (deadline === undefined) errors.push('Deadline must be a date (YYYY-MM-DD).');
  return { errors, value: { title, target_value: target, current_progress: progress, deadline: deadline ?? null, completed: progress >= target } };
}

export function validateTodo(input) {
  const errors = [];
  const text = str(input.text).trim();
  if (!text) errors.push('Task text is required.');
  if (text.length > 500) errors.push('Task must be 500 characters or fewer.');
  const priority = input.priority ?? 'medium';
  if (!PRIORITIES.includes(priority)) errors.push('Priority must be low, medium or high.');
  const dueDate = normaliseDate(input.due_date);
  if (dueDate === undefined) errors.push('Due date must be a date (YYYY-MM-DD).');
  return { errors, value: { text, priority, due_date: dueDate ?? null, completed: Boolean(input.completed) } };
}

export function validateCategory(input) {
  const errors = [];
  const name = str(input.name).trim();
  if (!name) errors.push('Name is required.');
  if (name.length > 60) errors.push('Name must be 60 characters or fewer.');
  const color = str(input.color).toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(color)) errors.push('Color must be a hex value like #3B82F6.');
  return { errors, value: { name, color } };
}

export function validateFolder(input) {
  const errors = [];
  const name = str(input.name).trim();
  if (!name) errors.push('Folder name is required.');
  if (name.length > 80) errors.push('Folder name must be 80 characters or fewer.');
  const color = str(input.color || '#6366F1').toUpperCase();
  if (!CATEGORY_COLORS.includes(color)) errors.push('Pick one of the folder colours.');
  const description = str(input.description).trim();
  if (description.length > 1000) errors.push('Description must be 1,000 characters or fewer.');
  return { errors, value: { name, color, description } };
}

export function validateNiche(input) {
  const errors = [];
  const title = str(input.title).trim();
  if (!title) errors.push('Niche title is required.');
  if (title.length > 120) errors.push('Niche title must be 120 characters or fewer.');
  const language = str(input.language).trim() || 'English';
  if (language.length > 40) errors.push('Language must be 40 characters or fewer.');
  const description = str(input.description).trim()
    || `Content focused on ${title}. Tailored for the target audience with engaging hooks and culturally relevant trends.`;
  if (description.length > 2000) errors.push('Description must be 2,000 characters or fewer.');
  return { errors, value: { title, language, description } };
}

/** Copy only the allowed fields that were sent onto the existing row, for PATCH. */
export const mergeFields = (existing, body, fields) => ({
  ...existing,
  ...Object.fromEntries(fields.filter((f) => body?.[f] !== undefined).map((f) => [f, body[f]])),
});
