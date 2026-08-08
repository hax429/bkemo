const DB_NAME = 'bkemo-obsidian';
const STORE = 'audio';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

export async function putAudioBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key));
  } finally {
    db.close();
  }
}

export async function getAudioBlob(key: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    const value = await idbRequest(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
    return value instanceof Blob ? value : null;
  } finally {
    db.close();
  }
}

export async function deleteAudioBlob(key: string): Promise<void> {
  const db = await openDb();
  try {
    await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
  } finally {
    db.close();
  }
}

export async function clearAudioBlobs(): Promise<void> {
  const db = await openDb();
  try {
    await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
  } finally {
    db.close();
  }
}
