import { browser } from './compat.js';
import { getSettingsCached } from './storage.js';

const MAX_LOGS = 1000;

const logBuffer = [];

let logSeq = 0;

const PERSIST_CATEGORIES = new Set(['youtube', 'api', 'translate']);
const PERSIST_KEY = 'yt_debug_log';
const PERSIST_MAX = 100;

const ANOMALY_KEY = 'anomaly_log';
const ANOMALY_MAX = 30;
let _pendingAnomaly = [];

let _persistQueue = Promise.resolve();
let _pendingPersist = [];
let _persistFlushTimer = null;
const PERSIST_FLUSH_MS = 300;

function flushPersistLogs() {
  _persistFlushTimer = null;
  if (_pendingPersist.length === 0 && _pendingAnomaly.length === 0) return;
  const batch = _pendingPersist;
  _pendingPersist = [];
  const anomalyBatch = _pendingAnomaly;
  _pendingAnomaly = [];
  _persistQueue = _persistQueue.then(async () => {
    try {
      const result = await browser.storage.local.get(PERSIST_KEY);
      const logs = result[PERSIST_KEY] || [];
      logs.push(...batch);
      if (logs.length > PERSIST_MAX) logs.splice(0, logs.length - PERSIST_MAX);
      await browser.storage.local.set({ [PERSIST_KEY]: logs });
    } catch (_) {   }
    if (anomalyBatch.length === 0) return;
    try {
      const result = await browser.storage.local.get(ANOMALY_KEY);
      const logs = result[ANOMALY_KEY] || [];
      logs.push(...anomalyBatch);
      if (logs.length > ANOMALY_MAX) logs.splice(0, logs.length - ANOMALY_MAX);
      await browser.storage.local.set({ [ANOMALY_KEY]: logs });
    } catch (_) {   }
  });
}

function persistLog(entry) {
  if (entry.data && entry.data._anomaly === true) {
    _pendingAnomaly.push(entry);
    if (_pendingAnomaly.length > ANOMALY_MAX) {
      _pendingAnomaly.splice(0, _pendingAnomaly.length - ANOMALY_MAX);
    }
    if (!_persistFlushTimer) {
      _persistFlushTimer = setTimeout(flushPersistLogs, PERSIST_FLUSH_MS);
    }
  }
  if (!PERSIST_CATEGORIES.has(entry.category)) return;
  _pendingPersist.push(entry);
  if (_pendingPersist.length > PERSIST_MAX) {
    _pendingPersist.splice(0, _pendingPersist.length - PERSIST_MAX);
  }
  if (!_persistFlushTimer) {
    _persistFlushTimer = setTimeout(flushPersistLogs, PERSIST_FLUSH_MS);
  }
}

export async function getPersistedLogs() {
  if (_persistFlushTimer) { clearTimeout(_persistFlushTimer); }
  flushPersistLogs();
  await _persistQueue;
  const result = await browser.storage.local.get(PERSIST_KEY);
  return result[PERSIST_KEY] || [];
}

export async function getAnomalyLogs() {
  if (_persistFlushTimer) { clearTimeout(_persistFlushTimer); }
  flushPersistLogs();
  await _persistQueue;
  const result = await browser.storage.local.get(ANOMALY_KEY);
  return result[ANOMALY_KEY] || [];
}

export async function clearPersistedLogs() {
  _pendingPersist = [];
  _pendingAnomaly = [];
  if (_persistFlushTimer) { clearTimeout(_persistFlushTimer); _persistFlushTimer = null; }
  await _persistQueue;
  await browser.storage.local.remove(PERSIST_KEY);
  await browser.storage.local.remove(ANOMALY_KEY);
}

export function debugLog(level, category, message, data) {
  const entry = {
    seq: ++logSeq,
    t: new Date().toISOString(),
    level,
    category: category || 'system',
    message,
    data: sanitize(data),
  };

  logBuffer.push(entry);
  while (logBuffer.length > MAX_LOGS) logBuffer.shift();

  persistLog(entry);

  getSettingsCached().then(settings => {
    if (settings.debugLog) {
      const tag = `[Transit][${category}]`;
      if (level === 'error') console.error(tag, message, data);
      else if (level === 'warn') console.warn(tag, message, data);
      else console.log(tag, message, data);
    }
  }).catch(() => {
  });
}

export function getLogs(afterSeq = 0) {
  const filtered = afterSeq > 0
    ? logBuffer.filter(e => e.seq > afterSeq)
    : logBuffer.slice();
  return {
    logs: filtered,
    latestSeq: logSeq,
  };
}

export function clearLogs() {
  logBuffer.length = 0;
}

function sanitize(data) {
  if (data == null) return undefined;
  try {
    const s = JSON.stringify(data);
    if (s.length > 3000) return { _truncated: true, originalLength: s.length, preview: s.slice(0, 3000) };
    return JSON.parse(s);
  } catch {
    return String(data);
  }
}
