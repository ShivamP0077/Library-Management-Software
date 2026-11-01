/**
 * Lightweight IndexedDB wrapper to store large binary/file blobs (e.g., student documents)
 * safely outside localStorage to prevent QuotaExceededError.
 * Documents are also saved to the backend so they are available on other devices;
 * IndexedDB acts as a local cache.
 */
import { api } from './api';

const DB_NAME = 'LibraryManagementDB';
const DB_VERSION = 1;
const STORE_NAME = 'student_documents';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB not supported in this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function saveDocumentBlob(key, dataUrlOrBlob) {
  if (typeof dataUrlOrBlob === 'string') {
    api.saveDocument(key, dataUrlOrBlob).catch(err => console.warn(`[API] Could not upload document "${key}":`, err.message));
  }
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(dataUrlOrBlob, key);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error(`[IDB] Failed to save blob for key "${key}":`, err);
    return false;
  }
}

export async function getDocumentBlob(key) {
  const local = await getLocalDocumentBlob(key);
  if (local) return local;
  try {
    return await api.getDocument(key);
  } catch {
    return null;
  }
}

async function getLocalDocumentBlob(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error(`[IDB] Failed to get blob for key "${key}":`, err);
    return null;
  }
}

export async function deleteDocumentBlob(key) {
  api.deleteDocument(key).catch(() => {});
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error(`[IDB] Failed to delete blob for key "${key}":`, err);
    return false;
  }
}
