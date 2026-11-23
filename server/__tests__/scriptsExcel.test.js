import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildExport, buildTemplate, parseImport } from '../services/scripts/excel.js';

const categories = [{ id: '1', name: 'Work' }, { id: '2', name: 'Creative' }];
const goals = [{ id: '7', title: 'Ten reels' }];

async function sheetWith(rows) {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Anything');
  rows.forEach((r) => s.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('scripts Excel', () => {
  it('re-imports its own export (and flags the duplicates)', async () => {
    const buf = await buildExport({
      scripts: [{ title: 'Reel A', notes: 'n', reference: 'https://x.y', status: 'in_progress', category_names: ['Work', 'Creative'], goal_title: 'Ten reels', deadline: '2026-12-01', created_at: new Date(), modified_at: new Date() }],
      todos: [{ text: 't', priority: 'high', due_date: null, completed: false }],
      goals: [{ title: 'Ten reels', target_value: 10, current_progress: 1, deadline: null, completed: false }],
    });
    const fresh = await parseImport(buf, { categories, goals });
    expect(fresh.errors).toEqual([]);
    expect(fresh.rows[0]).toMatchObject({ title: 'Reel A', status: 'in_progress', deadline: '2026-12-01', goal_id: '7', category_ids: ['1', '2'] });

    const again = await parseImport(buf, { existingTitles: ['reel a'], categories, goals });
    expect(again.rows).toEqual([]);
    expect(again.warnings[0]).toMatch(/already exists/);
  });

  it('errors on a bad status or date, warns on unknown category, reads Excel date numbers', async () => {
    const buf = await sheetWith([
      ['Title', 'Status', 'Deadline', 'Categories'],
      ['One', 'Done', '', ''],
      ['Two', '', 'not a date', ''],
      ['Three', 'In Progress', 46357, 'Work, Food'],
    ]);
    const out = await parseImport(buf, { categories, goals });
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0]).toMatch(/Row 2: Status/);
    expect(out.errors[1]).toMatch(/Row 3: Deadline/);
    expect(out.rows[0]).toMatchObject({ title: 'Three', status: 'in_progress', deadline: '2026-12-01', category_ids: ['1'] });
    expect(out.warnings[0]).toMatch(/category "Food"/);
  });

  it('needs a Title column and rejects files that are not xlsx', async () => {
    expect((await parseImport(await sheetWith([['Name'], ['x']]), {})).errors[0]).toMatch(/Title/);
    expect((await parseImport(Buffer.from('hello'), {})).errors[0]).toMatch(/could not be read/);
  });

  it('builds a template with the user lists', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTemplate({ categories, goals }));
    expect(wb.getWorksheet('Scripts').getRow(1).getCell(1).value).toBe('Folder');
    expect(wb.getWorksheet('Scripts').getRow(1).getCell(2).value).toBe('Title');
    expect(wb.getWorksheet('Lists').getCell('B2').value).toBe('Creative');
  });

  it('keeps folders: duplicates count per folder, missing folders are created', async () => {
    const buf = await buildExport({
      scripts: [
        { title: 'Scene 1', notes: '', reference: '', status: 'not_started', category_names: [], goal_title: null, folder_name: 'Movie A', deadline: null, created_at: new Date(), modified_at: new Date() },
        { title: 'Scene 1', notes: '', reference: '', status: 'not_started', category_names: [], goal_title: null, folder_name: 'Movie B', deadline: null, created_at: new Date(), modified_at: new Date() },
        { title: 'Loose idea', notes: '', reference: '', status: 'not_started', category_names: [], goal_title: null, folder_name: null, deadline: null, created_at: new Date(), modified_at: new Date() },
      ],
      todos: [], goals: [],
    });
    const out = await parseImport(buf, { existing: [{ title: 'scene 1', folder: 'movie a' }], folders: [{ id: '1', name: 'Movie A' }] });
    expect(out.errors).toEqual([]);
    expect(out.rows.map((r) => [r.folder_name, r.title])).toEqual([['Movie B', 'Scene 1'], [null, 'Loose idea']]);
    expect(out.newFolders).toEqual(['Movie B']);
    expect(out.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/already exists in Movie A/), 'New folder "Movie B" will be created.']));
  });

  it('folder import puts every row in that folder; folder export has only the scripts sheet', async () => {
    const buf = await sheetWith([
      ['Folder', 'Title'],
      ['Some other folder', 'Scene 1'],
      ['', 'Scene 2'],
      ['', 'Scene 3'],
    ]);
    const out = await parseImport(buf, { existing: [{ title: 'Scene 3', folder: 'Movie A' }], folders: [{ id: '1', name: 'Movie A' }], intoFolder: 'Movie A' });
    expect(out.errors).toEqual([]);
    expect(out.rows.map((r) => [r.folder_name, r.title])).toEqual([['Movie A', 'Scene 1'], ['Movie A', 'Scene 2']]);
    expect(out.newFolders).toEqual([]);
    expect(out.warnings[0]).toMatch(/Scene 3" already exists in Movie A/);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildExport({ scripts: [{ title: 'Scene 1', notes: '', reference: '', status: 'not_started', category_names: [], folder_name: 'Movie A', created_at: new Date(), modified_at: new Date() }] }));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Scripts']);
  });
});
