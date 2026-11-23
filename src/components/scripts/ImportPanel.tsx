import { useRef, useState, type DragEvent } from 'react';
import { CheckCircle, DownloadSimple, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import { downloadTemplate, importScripts, type ImportSummary } from '../../services/scriptsApi';
import { errorMessage } from '../../utils/errors';
import { SkeletonRows } from './shared';
import { refreshScripts, toast } from './util';

/**
 * Choose an .xlsx, see what would be imported (errors block, notes explain skips), then confirm.
 * With `folderId` every row goes into that folder and the template is that folder's.
 */
export default function ImportPanel({ token, folderId, folderName, onDone }: { token: string; folderId?: string; folderName?: string; onDone?: (imported: number) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (err) { toast(errorMessage(err, 'Something went wrong.'), 'error'); } finally { setBusy(false); }
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { toast('Choose an .xlsx file. In Google Sheets use File, Download, Microsoft Excel.', 'error'); return; }
    setFile(f);
    setCheck(null);
    run(async () => setCheck(await importScripts(token, f, false, folderId)));
  };

  const commit = () => file && run(async () => {
    const r = await importScripts(token, file, true, folderId);
    toast(`Imported ${r.imported} script${r.imported === 1 ? '' : 's'}${folderName ? ` into ${folderName}` : ''}`);
    setCheck(null);
    setFile(null);
    if (input.current) input.current.value = '';
    refreshScripts();
    onDone?.(r.imported);
  });

  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); choose(e.dataTransfer.files?.[0]); };

  return (
    <div className="sv-form">
      <label className={`sv-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <UploadSimple size={28} weight="duotone" aria-hidden="true" />
        <span className="title-4">{file ? file.name : 'Drop an .xlsx file here, or click to choose'}</span>
        <span className="caption-5 sv-soft">{folderName ? `Every row goes into ${folderName}. ` : ''}Needs a Title column. Up to 5 MB.</span>
        <input ref={input} type="file" className="sr-only" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => choose(e.target.files?.[0])} />
      </label>
      <button type="button" className="sv-link caption-3" disabled={busy} onClick={() => run(() => downloadTemplate(token, folderId))}>
        <DownloadSimple size={14} aria-hidden="true" /> Download {folderName ? 'a template for this folder' : 'the sample template'}
      </button>
      {busy && !check && <SkeletonRows rows={1} />}
      {check && (
        <div className="sv-import-check">
          {check.error_count > 0 ? (
            <div className="sv-banner error" role="alert">
              <WarningCircle size={18} weight="fill" aria-hidden="true" />
              <div><b className="body-4">Fix {check.error_count} problem{check.error_count > 1 ? 's' : ''} in the file, then choose it again</b>
                <ul>{check.errors.map((e) => <li key={e} className="body-6">{e}</li>)}</ul></div>
            </div>
          ) : check.count > 0 ? (
            <div className="sv-banner ok"><CheckCircle size={18} weight="fill" aria-hidden="true" /><span className="body-5">Ready to import <b>{check.count}</b> script{check.count === 1 ? '' : 's'}{folderName ? ` into ${folderName}` : ''}.</span></div>
          ) : (
            <div className="sv-banner warn"><WarningCircle size={18} weight="fill" aria-hidden="true" /><span className="body-5">Nothing new to import. Every row is already here.</span></div>
          )}
          {check.warning_count > 0 && (
            <details className="sv-warnings" open={check.error_count === 0}>
              <summary className="body-4">{check.warning_count} note{check.warning_count > 1 ? 's' : ''}</summary>
              <ul>{check.warnings.map((w) => <li key={w} className="body-6">{w}</li>)}</ul>
            </details>
          )}
          {check.error_count === 0 && check.count > 0 && (
            <button type="button" className="sv-btn sv-btn-primary" disabled={busy} onClick={commit}>
              {busy ? 'Importing…' : `Import ${check.count} script${check.count === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
