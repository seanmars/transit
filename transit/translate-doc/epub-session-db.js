import { repairDocLlmArtifacts, alignTrailingPeriodWithSource, stripPlaceholderTokens } from './translate.js';
import { editedHtmlToPlain } from './block-output.js';

const DB_NAME = 'transit-epub-sessions';
const STORE = 'sessions';
const BLOCKS_STORE = 'session-blocks';
const VERSION = 2;

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(BLOCKS_STORE)) db.createObjectStore(BLOCKS_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => { _dbPromise = null; };
      db.onversionchange = () => { db.close(); _dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { _dbPromise = null; reject(req.error); };
  });
  return _dbPromise;
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function blocksRange(bookHash) {
  return IDBKeyRange.bound([bookHash], [bookHash, []]);
}

export async function loadEpubSession(bookHash) {
  if (!bookHash) return null;
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, BLOCKS_STORE], 'readonly');
    const bstore = tx.objectStore(BLOCKS_STORE);
    const range = blocksRange(bookHash);
    const [meta, keys, vals] = await Promise.all([
      reqAsPromise(tx.objectStore(STORE).get(bookHash)),
      reqAsPromise(bstore.getAllKeys(range)),
      reqAsPromise(bstore.getAll(range)),
    ]);
    if (!meta && keys.length === 0) return null;
    const blocks = { ...((meta && meta.blocks) || {}) };
    for (let i = 0; i < keys.length; i++) blocks[keys[i][1]] = vals[i];
    return { ...(meta || {}), blocks };
  } catch (err) {
    console.warn('[Transit] epub session load failed', err && err.message);
    return null;
  }
}

export async function saveEpubSession(bookHash, meta, { changedBlocks = {}, removedBlockIds = [] } = {}) {
  if (!bookHash || !meta) return false;
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, BLOCKS_STORE], 'readwrite');
    const { blocks: _legacyEmbedded, ...metaOnly } = meta;
    tx.objectStore(STORE).put({ ...metaOnly, updatedAt: Date.now() }, bookHash);
    const bstore = tx.objectStore(BLOCKS_STORE);
    for (const [blockId, rec] of Object.entries(changedBlocks || {})) {
      bstore.put(rec, [bookHash, blockId]);
    }
    for (const blockId of removedBlockIds || []) {
      bstore.delete([bookHash, blockId]);
    }
    await txDone(tx);
    return true;
  } catch (err) {
    console.warn('[Transit] epub session save failed', err && err.message);
    return false;
  }
}

export async function deleteEpubSession(bookHash) {
  if (!bookHash) return false;
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, BLOCKS_STORE], 'readwrite');
    tx.objectStore(STORE).delete(bookHash);
    tx.objectStore(BLOCKS_STORE).delete(blocksRange(bookHash));
    await txDone(tx);
    return true;
  } catch (err) {
    console.warn('[Transit] epub session delete failed', err && err.message);
    return false;
  }
}

export function collectSessionBlocks(epubDoc) {
  const blocks = {};
  for (const ch of epubDoc.chapters) {
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'done') continue;
      blocks[b.blockId] = {
        raw: b.translationRaw ?? null,
        plain: b.translation ?? null,
        edited: b.editedHtml ?? null,
      };
    }
  }
  return blocks;
}

export function collectSessionFailures(epubDoc) {
  const failures = [];
  for (const ch of epubDoc.chapters) {
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'failed') continue;
      failures.push({
        blockId: b.blockId,
        chapterIndex: ch.index,
        chapterTitle: ch.title || '',
        error: b.translationError || '',
        source: b.plainText || '',
      });
    }
  }
  return failures;
}

function editedHtmlToText(html, fallbackPlain) {
  if (typeof html === 'string') return editedHtmlToPlain(html);
  return fallbackPlain ?? null;
}

function sanitizeEditedHtml(html) {
  if (typeof html !== 'string' || !html) return html;
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const div = document.createElement('div');
      div.innerHTML = html;
      for (const bad of div.querySelectorAll('script, style, template')) bad.remove();
      for (const el of div.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
          if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
        }
      }
      return div.innerHTML;
    }
  } catch (_) {   }
  return html
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

export function hydrateSessionBlocks(epubDoc, blocks) {
  if (!blocks) return 0;
  let restored = 0;
  for (const ch of epubDoc.chapters) {
    for (const b of ch.blocks) {
      const saved = blocks[b.blockId];
      if (!saved) continue;
      if (saved.raw == null && saved.plain == null && saved.edited == null) continue;
      const raw = typeof saved.raw === 'string'
        ? alignTrailingPeriodWithSource(b.plainText, repairDocLlmArtifacts(saved.raw))
        : (saved.raw ?? null);
      b.translationRaw = raw;
      b.editedHtml = typeof saved.edited === 'string' ? sanitizeEditedHtml(saved.edited) : (saved.edited ?? null);
      if (typeof b.editedHtml === 'string' && b.editedHtml.length > 0) {
        b.translation = editedHtmlToText(b.editedHtml, saved.plain);
      } else {
        b.translation = (typeof raw === 'string' && raw.length > 0)
          ? stripPlaceholderTokens(raw)
          : (saved.plain ?? null);
      }
      b.translationStatus = 'done';
      restored++;
    }
  }
  return restored;
}
