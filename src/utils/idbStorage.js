/**
 * Lightweight IndexedDB wrapper to store large binary/file blobs (e.g., student documents)
 * safely outside localStorage to prevent QuotaExceededError.
 * Documents are also saved to the backend so they are available on other devices;
 * IndexedDB acts as a local cache.
 */
import { api } from './api';
import { scopedDocKey, legacyDocAllowed, isMemoryOnly } from './tenantCache';
// Issue #2: local copies are stored per library (`t:<tenantId>:<key>`); the server copy is already tenant-scoped.

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

export async function saveDocumentBlob(key, dataUrlOrBlob, { server = true } = {}) {
  if (server && typeof dataUrlOrBlob === 'string') {
    api.saveDocument(key, dataUrlOrBlob).catch(err => console.warn(`[API] Could not upload document "${key}":`, err.message));
  }
  if (isMemoryOnly()) return false; // read-only drill-in never writes a local cache
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(dataUrlOrBlob, scopedDocKey(key));
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error(`[IDB] Failed to save blob for key "${key}":`, err);
    return false;
  }
}

/** Await both the local cache and the tenant-scoped server upload (issue #3/#22 bounded client). */
export async function saveDocumentBlobNow(key, dataUrl, meta = {}) {
  await api.saveDocument(key, dataUrl, meta);
  if (!isMemoryOnly()) {
    try { await saveDocumentBlob(key, dataUrl, { server: false }); } catch { /* server copy is authoritative */ }
  }
  return { ok: true, key };
}

export async function getDocumentBlob(key, { studentId } = {}) {
  if (!isMemoryOnly()) {
    const local = (await getLocalDocumentBlob(scopedDocKey(key))) || (legacyDocAllowed() && scopedDocKey(key) !== key ? await getLocalDocumentBlob(key) : null);
    if (local) return local;
  }
  try {
    return studentId ? await api.getStudentDocument(studentId, key) : await api.getDocument(key);
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
  if (isMemoryOnly()) return false;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(scopedDocKey(key));
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  } catch (err) {
    console.error(`[IDB] Failed to delete blob for key "${key}":`, err);
    return false;
  }
}
