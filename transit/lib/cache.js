import { browser } from './compat.js';
import { debugLog } from './logger.js';

const KEY_PREFIX = 'tc_';
const GLOSSARY_PREFIX = 'gloss_';
const SCAN_PREFIX = 'scanr_';
const VERSION_KEY = '__cacheVersion';

const CACHE_QUOTA_BYTES = 9.5 * 1024 * 1024;
const EVICTION_TARGET_BYTES = 1 * 1024 * 1024;

let lastEvictionCheckTime = 0;
const EVICTION_CHECK_INTERVAL_MS = 30_000;

const pendingTouches = {};
let touchFlushTimer = null;
const TOUCH_FLUSH_DELAY_MS = 5000;

function scheduleTouchFlush() {
  if (touchFlushTimer) return;
  touchFlushTimer = setTimeout(flushTouches, TOUCH_FLUSH_DELAY_MS);
}

async function flushTouches() {
  touchFlushTimer = null;
  const snapshot = { ...pendingTouches };
  const keys = Object.keys(snapshot);
  if (!keys.length) return;
  for (const k of keys) delete pendingTouches[k];
  try {
    const current = await browser.storage.local.get(keys);
    const updates = {};
    for (const k of keys) {
      const cur = current[k];
      if (cur == null) continue;
      const curV = extractValue(cur);
      const wantV = snapshot[k]?.v;
      if (curV !== wantV) continue;
      updates[k] = { v: curV, t: Date.now() };
    }
    if (Object.keys(updates).length) {
      browser.storage.local.set(updates).catch(() => {});
    }
  } catch (_) {   }
}

const _hashCache = new Map();
const _HASH_CACHE_MAX = 500;

async function hashText(text) {
  const cached = _hashCache.get(text);
  if (cached !== undefined) {
    _hashCache.delete(text);
    _hashCache.set(text, cached);
    return cached;
  }
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  _hashCache.set(text, hex);
  if (_hashCache.size > _HASH_CACHE_MAX) {
    _hashCache.delete(_hashCache.keys().next().value);
  }
  return hex;
}

function estimateUtf8Bytes(str) {
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    bytes += str.charCodeAt(i) > 0x7f ? 3 : 1;
  }
  return bytes;
}

function estimateEntrySize(key, value) {
  const valStr = typeof value === 'string' ? value : JSON.stringify(value);
  return estimateUtf8Bytes(key) + estimateUtf8Bytes(valStr);
}

function extractValue(stored) {
  if (stored == null) return null;
  if (typeof stored === 'string') return stored;
  if (typeof stored === 'object' && stored.v != null) return stored.v;
  return null;
}

function wrapValue(translation) {
  return { v: translation, t: Date.now() };
}

function extractTimestamp(stored) {
  if (stored != null && typeof stored === 'object' && typeof stored.t === 'number') {
    return stored.t;
  }
  return 0;
}

async function evictOldest(targetBytes, preFetchedAll = null) {
  const all = preFetchedAll || await browser.storage.local.get(null);
  const cacheEntries = [];
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(KEY_PREFIX) || key.startsWith(GLOSSARY_PREFIX) || key.startsWith(SCAN_PREFIX)) {
      cacheEntries.push({
        key,
        size: estimateEntrySize(key, value),
        t: extractTimestamp(value),
      });
    }
  }
  cacheEntries.sort((a, b) => a.t - b.t);

  let freed = 0;
  const candidates = [];
  for (const entry of cacheEntries) {
    if (freed >= targetBytes) break;
    candidates.push(entry);
    freed += entry.size;
  }

  if (candidates.length === 0) {
    return { removed: 0, freedBytes: 0 };
  }

  const candidateKeys = candidates.map(c => c.key);
  let confirmed = candidateKeys;
  let confirmedFreed = freed;
  try {
    const fresh = await browser.storage.local.get(candidateKeys);
    confirmed = [];
    confirmedFreed = 0;
    for (const c of candidates) {
      const cur = fresh[c.key];
      if (cur == null) continue;
      if (extractTimestamp(cur) !== c.t) continue;
      confirmed.push(c.key);
      confirmedFreed += c.size;
    }
  } catch (_) {
    confirmed = candidateKeys;
    confirmedFreed = freed;
  }

  if (confirmed.length > 0) {
    await browser.storage.local.remove(confirmed);
    debugLog('info', 'cache', 'LRU eviction', { removed: confirmed.length, freedKB: +(confirmedFreed / 1024).toFixed(1) });
  }
  return { removed: confirmed.length, freedBytes: confirmedFreed };
}

async function getCacheUsageBytes() {
  if (typeof browser.storage.local.getBytesInUse === 'function') {
    return browser.storage.local.getBytesInUse(null);
  }
  const all = await browser.storage.local.get(null);
  let bytes = 0;
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(KEY_PREFIX) || key.startsWith(GLOSSARY_PREFIX) || key.startsWith(SCAN_PREFIX)) {
      bytes += estimateEntrySize(key, value);
    }
  }
  return bytes;
}

async function safeStorageSet(updates) {
  try {
    await browser.storage.local.set(updates);
  } catch (err) {
    const msg = err?.message || '';
    if (msg.includes('QUOTA_BYTES') || msg.toLowerCase().includes('quota')) {
      debugLog('warn', 'cache', 'storage quota exceeded, triggering LRU eviction');
      await evictOldest(EVICTION_TARGET_BYTES);
      try {
        await browser.storage.local.set(updates);
      } catch (retryErr) {
        debugLog('error', 'cache', 'storage write failed after eviction', { error: retryErr.message });
      }
    } else {
      debugLog('error', 'cache', 'storage write failed', { error: msg });
    }
  }
}

async function proactiveEvictionCheck() {
  const now = Date.now();
  if (now - lastEvictionCheckTime < EVICTION_CHECK_INTERVAL_MS) return;
  lastEvictionCheckTime = now;
  try {
    const usage = await getCacheUsageBytes();
    if (usage > CACHE_QUOTA_BYTES * 0.9) {
      debugLog('info', 'cache', 'proactive eviction triggered', { usageMB: +(usage / 1024 / 1024).toFixed(2) });
      await evictOldest(EVICTION_TARGET_BYTES);
    }
  } catch (err) {
    debugLog('warn', 'cache', 'proactive eviction check failed', { error: err.message });
  }
}

function resolveKeySuffix(arg) {
  return (typeof arg === 'string') ? arg : '';
}

export async function hashForbiddenTerms(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return '';
  const sorted = [...terms]
    .filter(t => t && t.forbidden)
    .sort((a, b) => String(a.forbidden).localeCompare(String(b.forbidden)));
  if (sorted.length === 0) return '';
  const canonical = JSON.stringify(
    sorted.map(t => ({ forbidden: String(t.forbidden), replacement: String(t.replacement || '') })),
  );
  const full = await hashText(canonical);
  return full.slice(0, 12);
}

export async function getBatch(texts, keySuffix = '') {
  if (!texts.length) return [];
  const suffix = resolveKeySuffix(keySuffix);
  const hashes = await Promise.all(texts.map(hashText));
  const keys = hashes.map(h => KEY_PREFIX + h + suffix);
  const stored = await browser.storage.local.get(keys);
  const results = keys.map(k => {
    if (!(k in stored)) return null;
    const val = extractValue(stored[k]);
    if (val != null) {
      pendingTouches[k] = wrapValue(val);
    }
    return val;
  });
  if (Object.keys(pendingTouches).length > 0) {
    scheduleTouchFlush();
  }
  return results;
}

export async function setBatch(texts, translations, keySuffix = '') {
  if (!texts.length) return;
  const suffix = resolveKeySuffix(keySuffix);
  const hashes = await Promise.all(texts.map(hashText));
  const updates = {};
  for (let i = 0; i < texts.length; i++) {
    if (translations[i]) {
      updates[KEY_PREFIX + hashes[i] + suffix] = wrapValue(translations[i]);
    }
  }
  if (Object.keys(updates).length) {
    await safeStorageSet(updates);
    proactiveEvictionCheck().catch(() => {});
  }
}

export async function getGlossary(inputHash, suffix = '') {
  const key = GLOSSARY_PREFIX + inputHash + suffix;
  const stored = await browser.storage.local.get(key);
  if (!(key in stored)) return null;
  const entry = stored[key];
  if (Array.isArray(entry)) return entry;
  if (entry && typeof entry === 'object' && Array.isArray(entry.v)) {
    safeStorageSet({ [key]: { v: entry.v, t: Date.now() } }).catch(() => {});
    return entry.v;
  }
  return null;
}

export async function setGlossary(inputHash, glossary, suffix = '') {
  const key = GLOSSARY_PREFIX + inputHash + suffix;
  await safeStorageSet({ [key]: { v: glossary, t: Date.now() } });
}

export async function getScanRenderings(inputHash) {
  const key = SCAN_PREFIX + inputHash;
  const stored = await browser.storage.local.get(key);
  const entry = stored[key];
  if (entry && typeof entry === 'object' && Array.isArray(entry.v)) {
    safeStorageSet({ [key]: { v: entry.v, t: Date.now() } }).catch(() => {});
    return entry.v;
  }
  return null;
}

export async function setScanRenderings(inputHash, renderings) {
  const key = SCAN_PREFIX + inputHash;
  await safeStorageSet({ [key]: { v: renderings, t: Date.now() } });
}

export { hashText };

export async function clearAll() {
  const all = await browser.storage.local.get(null);
  const toRemove = Object.keys(all).filter(k => k.startsWith(KEY_PREFIX) || k.startsWith(GLOSSARY_PREFIX) || k.startsWith(SCAN_PREFIX));
  if (toRemove.length) {
    await browser.storage.local.remove(toRemove);
  }
  return toRemove.length;
}

export async function stats() {
  const area = browser.storage.local;
  if (typeof area.getKeys === 'function' && typeof area.getBytesInUse === 'function') {
    try {
      const keys = await area.getKeys();
      const tcEntries = keys.filter(k => k.startsWith(KEY_PREFIX));
      const glossEntries = keys.filter(k => k.startsWith(GLOSSARY_PREFIX));
      const [bytes, glossaryBytes] = await Promise.all([
        tcEntries.length ? area.getBytesInUse(tcEntries) : 0,
        glossEntries.length ? area.getBytesInUse(glossEntries) : 0,
      ]);
      return { count: tcEntries.length, bytes, glossaryCount: glossEntries.length, glossaryBytes };
    } catch (_) {
    }
  }
  const all = await area.get(null);
  const tcEntries = Object.keys(all).filter(k => k.startsWith(KEY_PREFIX));
  const glossEntries = Object.keys(all).filter(k => k.startsWith(GLOSSARY_PREFIX));
  let bytes = 0;
  for (const k of tcEntries) {
    bytes += estimateEntrySize(k, all[k]);
  }
  let glossaryBytes = 0;
  for (const k of glossEntries) {
    glossaryBytes += estimateEntrySize(k, all[k]);
  }
  return {
    count: tcEntries.length,
    bytes,
    glossaryCount: glossEntries.length,
    glossaryBytes,
  };
}

export async function clearDocTranslationCache() {
  const all = await browser.storage.local.get(null);
  const docKeys = Object.keys(all).filter((k) =>
    /^tc_[0-9a-f]{40}(?:_oc)?_doc(?:_|$)/.test(k) || k.startsWith('bookgloss_'));
  if (docKeys.length > 0) {
    await browser.storage.local.remove(docKeys);
  }
  return docKeys.length;
}

export async function checkVersionAndClear(currentVersion) {
  const stored = await browser.storage.local.get(VERSION_KEY);
  if (stored[VERSION_KEY] !== currentVersion) {
    await browser.storage.local.set({ [VERSION_KEY]: currentVersion });
    return { cleared: false, changed: true, oldVersion: stored[VERSION_KEY] };
  }
  return { cleared: false, changed: false };
}
