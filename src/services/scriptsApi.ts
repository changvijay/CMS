import { sendJson } from './api';

/** Client for the Scripts workspace (server/routes/scripts.js). */

export type ScriptStatus = 'not_started' | 'in_progress' | 'completed';
export type Priority = 'low' | 'medium' | 'high';
export type ProviderKey = 'gemini' | 'claude' | 'groq' | 'openrouter';

export interface Script {
  id: string;
  title: string;
  notes: string;
  reference: string;
  status: ScriptStatus;
  deadline: string | null;
  goal_id: string | null;
  folder_id: string | null;
  category_ids: string[];
  created_at: string;
  modified_at: string;
}

export type ScriptInput = Partial<Pick<Script, 'title' | 'notes' | 'reference' | 'status' | 'deadline' | 'goal_id' | 'folder_id' | 'category_ids'>>;

export interface ScriptFolder {
  id: string;
  name: string;
  color: string;
  description: string;
  script_count: number;
  done_count: number;
  in_progress_count: number;
  overdue_count: number;
  next_deadline: string | null;
  /** Earliest deadline of a script not yet completed, overdue ones included. */
  earliest_deadline: string | null;
  last_modified: string | null;
  created_at: string;
}

export interface FolderList {
  folders: ScriptFolder[];
  unfiled: { script_count: number; done_count: number };
  colors: string[];
}

export interface ScriptPage {
  scripts: Script[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
}

export interface ScriptCategory {
  id: string;
  name: string;
  color: string;
  script_count: number;
}

export interface ScriptGoal {
  id: string;
  title: string;
  target_value: number;
  current_progress: number;
  deadline: string | null;
  completed: boolean;
  created_at: string;
}

export type GoalInput = Partial<Pick<ScriptGoal, 'title' | 'target_value' | 'current_progress' | 'deadline'>>;

export interface ScriptTodo {
  id: string;
  text: string;
  completed: boolean;
  priority: Priority;
  due_date: string | null;
  created_at: string;
}

export type TodoInput = Partial<Pick<ScriptTodo, 'text' | 'completed' | 'priority' | 'due_date'>>;

export interface Dashboard {
  today: string;
  counts: {
    scripts_total: number; scripts_done: number; scripts_in_progress: number; scripts_overdue: number; scripts_due_week: number;
    todos_total: number; todos_done: number; todos_overdue: number; todos_high: number; niches_total: number;
  };
  goals: ScriptGoal[];
  due_this_week: Script[];
  recent: Script[];
}

export interface CalendarData {
  scripts: Omit<Script, 'notes'>[];
  todos: ScriptTodo[];
}

export interface ProviderMeta {
  key: ProviderKey;
  name: string;
  color: string;
  defaultModel: string;
  keyUrl: string;
  models: { id: string; label: string }[];
}

export interface ActionMeta {
  key: string;
  label: string;
  emoji: string;
  description: string;
}

export interface CustomPrompt {
  id: string;
  label: string;
  emoji: string;
  prompt: string;
}

export interface ActionPrefs {
  order: string[];
  hidden: string[];
  custom_prompts: CustomPrompt[];
}

export interface AiSettings {
  providers: Record<ProviderKey, { enabled: boolean; model: string; configured: boolean; last4: string }>;
  active_provider: ProviderKey | null;
  ready_providers: ProviderKey[];
  action_prefs: ActionPrefs;
  active_niche_id: string | null;
  catalog: { providers: Record<ProviderKey, ProviderMeta>; actions: Record<string, ActionMeta>; default_order: string[] };
}

export interface Niche {
  id: string;
  title: string;
  language: string;
  description: string;
}

export interface DailyIdea {
  id: string;
  niche_id: string;
  date: string;
  title: string;
  description: string;
  hook_mechanism?: string;
  retention_strategy?: string;
  niche: string;
  language: string;
  captions: string[];
  accepted_script_id: string | null;
}

export interface ImportSummary {
  count: number;
  imported: number;
  errors: string[];
  error_count: number;
  warnings: string[];
  warning_count: number;
}

/** "YYYY-MM-DD" for today in the browser's time zone. */
export function localToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// Scripts
export const listScripts = (token: string, f: { q?: string; status?: string; category?: string; folder?: string; page?: number; pageSize?: number }) =>
  sendJson<ScriptPage>(token, 'GET', `scripts/items${qs(f)}`);
export const getScript = async (token: string, id: string) => (await sendJson<{ script: Script }>(token, 'GET', `scripts/items/${id}`)).script;
export const createScript = async (token: string, input: ScriptInput) => (await sendJson<{ script: Script }>(token, 'POST', 'scripts/items', input)).script;
export const updateScript = async (token: string, id: string, input: ScriptInput) => (await sendJson<{ script: Script }>(token, 'PATCH', `scripts/items/${id}`, input)).script;
export const deleteScript = (token: string, id: string) => sendJson<void>(token, 'DELETE', `scripts/items/${id}`);
export const bulkDeleteScripts = (token: string, ids: string[]) => sendJson<{ deleted: number }>(token, 'POST', 'scripts/items/bulk-delete', { ids });
export const bulkMoveScripts = (token: string, ids: string[], folderId: string | null) =>
  sendJson<{ moved: number }>(token, 'POST', 'scripts/items/bulk-move', { ids, folder_id: folderId });

// Folders
export const listFolders = (token: string) => sendJson<FolderList>(token, 'GET', `scripts/folders${qs({ today: localToday() })}`);
export const getFolder = async (token: string, id: string) => (await sendJson<{ folder: ScriptFolder }>(token, 'GET', `scripts/folders/${id}`)).folder;
export const saveFolder = async (token: string, input: { name: string; color: string; description: string }, id?: string) =>
  (await sendJson<{ folder: ScriptFolder }>(token, id ? 'PATCH' : 'POST', id ? `scripts/folders/${id}` : 'scripts/folders', input)).folder;
export const deleteFolder = (token: string, id: string, withScripts: boolean) =>
  sendJson<{ deleted_scripts: number }>(token, 'DELETE', `scripts/folders/${id}${withScripts ? '?scripts=delete' : ''}`);

// Categories
export const listCategories = (token: string) => sendJson<{ categories: ScriptCategory[]; colors: string[] }>(token, 'GET', 'scripts/categories');
export const saveCategory = (token: string, input: { name: string; color: string }, id?: string) =>
  sendJson<{ category: ScriptCategory }>(token, id ? 'PATCH' : 'POST', id ? `scripts/categories/${id}` : 'scripts/categories', input);
export const deleteCategory = (token: string, id: string) => sendJson<void>(token, 'DELETE', `scripts/categories/${id}`);

// Goals
export const listGoals = async (token: string) => (await sendJson<{ goals: ScriptGoal[] }>(token, 'GET', 'scripts/goals')).goals;
export const saveGoal = (token: string, input: GoalInput, id?: string) =>
  sendJson<{ goal: ScriptGoal }>(token, id ? 'PATCH' : 'POST', id ? `scripts/goals/${id}` : 'scripts/goals', input);
export const incrementGoal = (token: string, id: string) => sendJson<{ goal: ScriptGoal }>(token, 'POST', `scripts/goals/${id}/increment`);
export const deleteGoal = (token: string, id: string) => sendJson<void>(token, 'DELETE', `scripts/goals/${id}`);

// To-dos
export const listTodos = async (token: string) => (await sendJson<{ todos: ScriptTodo[] }>(token, 'GET', 'scripts/todos')).todos;
export const saveTodo = (token: string, input: TodoInput, id?: string) =>
  sendJson<{ todo: ScriptTodo }>(token, id ? 'PATCH' : 'POST', id ? `scripts/todos/${id}` : 'scripts/todos', input);
export const deleteTodo = (token: string, id: string) => sendJson<void>(token, 'DELETE', `scripts/todos/${id}`);
export const clearDoneTodos = (token: string) => sendJson<{ deleted: number }>(token, 'POST', 'scripts/todos/clear-done');

// Dashboard & calendar
export const getDashboard = (token: string) => sendJson<Dashboard>(token, 'GET', `scripts/dashboard${qs({ today: localToday() })}`);
export const getCalendar = (token: string, from: string, to: string) => sendJson<CalendarData>(token, 'GET', `scripts/calendar${qs({ from, to })}`);

// AI
export const getAiSettings = (token: string) => sendJson<AiSettings>(token, 'GET', 'scripts/ai/settings');
export const updateAiSettings = (token: string, input: { active_provider?: ProviderKey; action_prefs?: ActionPrefs; active_niche_id?: string | null }) =>
  sendJson<AiSettings>(token, 'PUT', 'scripts/ai/settings', input);
export const saveProvider = (token: string, key: ProviderKey, input: { api_key?: string; enabled: boolean; model: string }) =>
  sendJson<AiSettings>(token, 'PUT', `scripts/ai/providers/${key}`, input);
export const testProvider = (token: string, key: ProviderKey, apiKey?: string) =>
  sendJson<{ ok: boolean }>(token, 'POST', `scripts/ai/providers/${key}/test`, { api_key: apiKey || undefined });
export const removeProvider = (token: string, key: ProviderKey) => sendJson<AiSettings>(token, 'DELETE', `scripts/ai/providers/${key}`);
export const runAi = (token: string, input: { action?: string; prompt?: string; content: string; provider?: ProviderKey }) =>
  sendJson<{ text: string; provider: ProviderKey; model: string }>(token, 'POST', 'scripts/ai/run', input);

export const listNiches = async (token: string) => (await sendJson<{ niches: Niche[] }>(token, 'GET', 'scripts/ai/niches')).niches;
export const saveNiche = (token: string, input: Partial<Omit<Niche, 'id'>>, id?: string) =>
  sendJson<{ niche: Niche }>(token, id ? 'PATCH' : 'POST', id ? `scripts/ai/niches/${id}` : 'scripts/ai/niches', input);
export const deleteNiche = (token: string, id: string) => sendJson<void>(token, 'DELETE', `scripts/ai/niches/${id}`);
export const addDefaultNiches = async (token: string) => (await sendJson<{ niches: Niche[] }>(token, 'POST', 'scripts/ai/niches/defaults')).niches;

export const getDailyIdea = (token: string, nicheId?: string, refresh = false) =>
  sendJson<{ idea: DailyIdea | null; reason?: 'no_niche' | 'no_ai' }>(token, 'GET', `scripts/ai/daily-idea${qs({ nicheId, today: localToday(), refresh: refresh ? 1 : undefined })}`);
export const acceptDailyIdea = (token: string, id: string) => sendJson<{ script_id: string }>(token, 'POST', `scripts/ai/daily-idea/${id}/accept`);

// Excel
async function download(token: string, path: string, fallbackName: string) {
  const res = await fetch(`/api/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Error ${res.status}: ${data.error || 'Download failed'}`);
  }
  const cd = res.headers.get('Content-Disposition') ?? '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
  const name = utf8 ? decodeURIComponent(utf8) : /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const folderQs = (folderId?: string) => (folderId ? `?folder=${encodeURIComponent(folderId)}` : '');
/** With a folder id, only that folder's scripts. */
export const downloadExport = (token: string, folderId?: string) => download(token, `scripts/export.xlsx${folderQs(folderId)}`, 'Scripts_Export.xlsx');
export const downloadTemplate = (token: string, folderId?: string) => download(token, `scripts/template.xlsx${folderQs(folderId)}`, 'Scripts_Sample_Template.xlsx');

/** Without `commit` the server only checks the file and reports what would happen. With a folder id every row goes into that folder. */
export async function importScripts(token: string, file: File, commit: boolean, folderId?: string): Promise<ImportSummary> {
  const params = new URLSearchParams();
  if (commit) params.set('commit', '1');
  if (folderId) params.set('folder', folderId);
  const res = await fetch(`/api/scripts/import${params.size ? `?${params}` : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 400 && Array.isArray(data.errors)) return data as ImportSummary;
  if (!res.ok) throw new Error(`Error ${res.status}: ${data.error || 'Import failed'}`);
  return data as ImportSummary;
}
