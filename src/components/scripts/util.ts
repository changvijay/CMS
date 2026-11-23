import type { ScriptGoal, ScriptStatus, ScriptTodo, Priority } from '../../services/scriptsApi';
import { listCategories, listFolders, listGoals, getAiSettings, localToday } from '../../services/scriptsApi';
import { invalidateLiveCache, useLive } from '../workspace/useLive';

export const STATUS_LABEL: Record<ScriptStatus, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
export const STATUSES: ScriptStatus[] = ['not_started', 'in_progress', 'completed'];
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const PRIORITIES: Priority[] = ['high', 'medium', 'low'];

/** Every Scripts request is cached under this prefix, so one call refreshes all views after a change. */
export const KEY = 'scripts:';
export const refreshScripts = () => invalidateLiveCache(KEY);

export const useCategories = (token: string) => useLive(() => listCategories(token), `${KEY}categories`);
export const useGoals = (token: string) => useLive(() => listGoals(token), `${KEY}goals`);
export const useFolders = (token: string) => useLive(() => listFolders(token), `${KEY}folders`);
export const useAiSettings = (token: string) => useLive(() => getAiSettings(token), `${KEY}ai-settings`);

const parseDay = (d: string) => new Date(`${d}T00:00:00`);
const DAY_MS = 86_400_000;

/** Whole days from today to the date (negative = past). */
export function daysUntil(date: string, today = localToday()): number {
  return Math.round((parseDay(date).getTime() - parseDay(today).getTime()) / DAY_MS);
}

export const isOverdue = (date: string | null, done: boolean) => Boolean(date) && !done && daysUntil(date as string) < 0;

export function formatDay(date: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return parseDay(date).toLocaleDateString([], opts);
}

/** "Overdue", "Today", "Tomorrow", "In 3 days" or "Nov 19". */
export function deadlineLabel(date: string, done = false): string {
  const n = daysUntil(date);
  if (n < 0 && !done) return `Overdue · ${formatDay(date)}`;
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n > 1 && n <= 7) return `In ${n} days`;
  return formatDay(date, { day: 'numeric', month: 'short', year: n > 300 || n < -300 ? 'numeric' : undefined });
}

export const goalPercent = (g: ScriptGoal) => Math.min(1, g.current_progress / Math.max(1, g.target_value));

/** Bar color by how far along the goal is (as in ScriptVault). */
export function goalTone(g: ScriptGoal): string {
  if (g.completed) return 'done';
  const p = goalPercent(g);
  if (p >= 0.75) return 'high';
  if (p >= 0.4) return 'mid';
  return 'low';
}

const RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** Open first, then high → low priority, then earliest due date (undated last). */
export function sortTodos(list: ScriptTodo[]): ScriptTodo[] {
  return [...list].sort((a, b) =>
    Number(a.completed) - Number(b.completed)
    || RANK[a.priority] - RANK[b.priority]
    || (a.due_date && b.due_date ? a.due_date.localeCompare(b.due_date) : a.due_date ? -1 : b.due_date ? 1 : 0));
}

/** Groups for the to-do list, in display order. */
export type TodoGroup = 'overdue' | 'today' | 'week' | 'later' | 'someday' | 'done';
export const TODO_GROUP_LABEL: Record<TodoGroup, string> = {
  overdue: 'Overdue', today: 'Today', week: 'Next 7 days', later: 'Later', someday: 'No date', done: 'Done',
};
export function todoGroup(t: ScriptTodo): TodoGroup {
  if (t.completed) return 'done';
  if (!t.due_date) return 'someday';
  const n = daysUntil(t.due_date);
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  return n <= 7 ? 'week' : 'later';
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} day${Math.round(s / 86400) > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

// ----- In-app feedback (toasts and confirm dialogs), shown by <FeedbackHost /> in ScriptsPage.
export type ToastTone = 'ok' | 'error' | 'info';
export interface ToastEvent { id: number; text: string; tone: ToastTone; action?: { label: string; run: () => void } }
export interface ConfirmEvent { title: string; body?: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void }

let toastId = 0;
export function toast(text: string, tone: ToastTone = 'ok', action?: ToastEvent['action']) {
  window.dispatchEvent(new CustomEvent<ToastEvent>('sv-toast', { detail: { id: ++toastId, text, tone, action } }));
}

/** A promise that resolves true when the person confirms in the dialog. */
export function confirmDialog(opts: Omit<ConfirmEvent, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent<ConfirmEvent>('sv-confirm', { detail: { ...opts, resolve } })));
}

const LIBRARY_VIEW_KEY = 'sv-library-view';
export function readLibraryView(): 'board' | 'list' {
  try { return localStorage.getItem(LIBRARY_VIEW_KEY) === 'list' ? 'list' : 'board'; } catch { return 'board'; }
}
export function saveLibraryView(v: 'board' | 'list') {
  try { localStorage.setItem(LIBRARY_VIEW_KEY, v); } catch { /* private mode */ }
}
