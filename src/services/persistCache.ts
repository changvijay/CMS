/**
 * Keeps `useLive` results in IndexedDB so a reload shows the last data at once instead of spinners.
 * Every entry belongs to one user; signing out or switching user wipes the store.
 * All calls fail quietly: without IndexedDB (private mode, old browser) the app just works from memory.
 */
const DB_NAME = 'cms-cache';
const STORE = 'live';
const VERSION = 1;

export interface PersistedEntry {
  id: string; // `${owner}\u0000${key}`
  owner: string;
  key: string;
  data: unknown;
  at: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('owner', 'owner');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run(mode: IDBTransactionMode, work: (store: IDBObjectStore) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) return resolve();
        try {
          const tx = db.transaction(STORE, mode);
          work(tx.objectStore(STORE));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      }),
  );
}

/** All entries saved for `owner`, oldest first. */
export function readAll(owner: string): Promise<PersistedEntry[]> {
  return openDb().then(
    (db) =>
      new Promise<PersistedEntry[]>((resolve) => {
        if (!db) return resolve([]);
        try {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('owner').getAll(owner);
          req.onsuccess = () => resolve((req.result as PersistedEntry[]).sort((a, b) => a.at - b.at));
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      }),
  );
}

export function writeEntry(owner: string, key: string, data: unknown, at: number): Promise<void> {
  return run('readwrite', (s) => s.put({ id: `${owner}\u0000${key}`, owner, key, data, at } satisfies PersistedEntry));
}

export function deleteEntries(owner: string, keys: string[]): Promise<void> {
  if (!keys.length) return Promise.resolve();
  return run('readwrite', (s) => keys.forEach((k) => s.delete(`${owner}\u0000${k}`)));
}

export function clearAll(): Promise<void> {
  return run('readwrite', (s) => s.clear());
}
