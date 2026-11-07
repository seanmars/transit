const DB_NAME = 'transit-usage';
const DB_VERSION = 1;
const STORE_NAME = 'translations';

let _dbPromise = null;
let _db = null;
function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      _db = db;
      db.onclose = () => { if (_db === db) { _db = null; _dbPromise = null; } };
      db.onversionchange = () => {
        try { db.close(); } catch (_) {   }
        if (_db === db) { _db = null; _dbPromise = null; }
      };
      resolve(db);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };
  });
  return _dbPromise;
}

export async function logTranslation(record) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function upsertYouTubeUsage(record, mergeWindowMs = 3600000) {
  const videoId = record?.videoId;
  const model = record?.model;
  if (!videoId || !model) {
    return logTranslation(record);
  }
  const now = record.timestamp || Date.now();
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const range = IDBKeyRange.lowerBound(now - mergeWindowMs);
    const req = index.openCursor(range, 'prev');
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const v = cursor.value;
        if (v.source === record.source && v.videoId === videoId && v.model === model) {
          const merged = {
            ...v,
            inputTokens:       (v.inputTokens       || 0) + (record.inputTokens       || 0),
            outputTokens:      (v.outputTokens      || 0) + (record.outputTokens      || 0),
            cachedTokens:      (v.cachedTokens      || 0) + (record.cachedTokens      || 0),
            billedInputTokens: (v.billedInputTokens || 0) + (record.billedInputTokens || 0),
            billedCostUSD:     (v.billedCostUSD     || 0) + (record.billedCostUSD     || 0),
            segments:          (v.segments          || 0) + (record.segments          || 0),
            cacheHits:         (v.cacheHits         || 0) + (record.cacheHits         || 0),
            durationMs:        (v.durationMs        || 0) + (record.durationMs        || 0),
            timestamp:         now,
            title:             record.title || v.title,
            url:               record.url   || v.url,
          };
          const putReq = cursor.update(merged);
          putReq.onsuccess = () => resolve(v.id);
          putReq.onerror = () => reject(putReq.error);
          return;
        }
        cursor.continue();
      } else {
        const addReq = store.add(record);
        addReq.onsuccess = () => resolve(addReq.result);
        addReq.onerror = () => reject(addReq.error);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function upsertGoogleUsage(record, mergeWindowMs = 180000) {
  const url = record?.url;
  if (!url || record?.engine !== 'google') {
    return logTranslation(record);
  }
  const now = record.timestamp || Date.now();
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const range = IDBKeyRange.lowerBound(now - mergeWindowMs);
    const req = index.openCursor(range, 'prev');
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const v = cursor.value;
        if (v.engine === 'google' && v.url === url) {
          const merged = {
            ...v,
            chars:     (v.chars     || 0) + (record.chars     || 0),
            segments:  (v.segments  || 0) + (record.segments  || 0),
            cacheHits: (v.cacheHits || 0) + (record.cacheHits || 0),
            durationMs:(v.durationMs|| 0) + (record.durationMs|| 0),
            timestamp: now,
            title:     record.title || v.title || '',
          };
          const putReq = cursor.update(merged);
          putReq.onsuccess = () => resolve(v.id);
          putReq.onerror = () => reject(putReq.error);
          return;
        }
        cursor.continue();
      } else {
        const addReq = store.add(record);
        addReq.onsuccess = () => resolve(addReq.result);
        addReq.onerror = () => reject(addReq.error);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function upsertPageUsage(record, mergeWindowMs = 180000) {
  const url = record?.url;
  const engine = record?.engine;
  const model = record?.model;
  if (!url || !engine || !model) {
    return shouldSkipUsageRecord(record) ? null : logTranslation(record);
  }
  const now = record.timestamp || Date.now();
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const range = IDBKeyRange.lowerBound(now - mergeWindowMs);
    const req = index.openCursor(range, 'prev');
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const v = cursor.value;
        if (!v.source && v.url === url && v.engine === engine && v.model === model) {
          const merged = {
            ...v,
            inputTokens:       (v.inputTokens       || 0) + (record.inputTokens       || 0),
            outputTokens:      (v.outputTokens      || 0) + (record.outputTokens      || 0),
            cachedTokens:      (v.cachedTokens      || 0) + (record.cachedTokens      || 0),
            billedInputTokens: (v.billedInputTokens || 0) + (record.billedInputTokens || 0),
            billedCostUSD:     (v.billedCostUSD     || 0) + (record.billedCostUSD     || 0),
            segments:          (v.segments          || 0) + (record.segments          || 0),
            cacheHits:         (v.cacheHits         || 0) + (record.cacheHits         || 0),
            durationMs:        (v.durationMs        || 0) + (record.durationMs        || 0),
            timestamp:         now,
            title:             record.title || v.title || '',
          };
          const putReq = cursor.update(merged);
          putReq.onsuccess = () => resolve(v.id);
          putReq.onerror = () => reject(putReq.error);
          return;
        }
        cursor.continue();
      } else if (shouldSkipUsageRecord(record)) {
        resolve(null);
      } else {
        const addReq = store.add(record);
        addReq.onsuccess = () => resolve(addReq.result);
        addReq.onerror = () => reject(addReq.error);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function query({ from, to } = {}) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const lower = from ?? 0;
    const upper = to ?? Date.now();
    const range = IDBKeyRange.bound(lower, upper);
    const results = [];
    const req = index.openCursor(range, 'prev');
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getStats({ from, to } = {}) {
  const records = await query({ from, to });
  return statsFromRecords(records);
}

export function statsFromRecords(records) {
  const stats = {
    count: records.length,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalBilledInputTokens: 0,
    totalBilledCostUSD: 0,
    totalSegments: 0,
    byModel: {},
  };
  for (const r of records) {
    stats.totalInputTokens += r.inputTokens || 0;
    stats.totalOutputTokens += r.outputTokens || 0;
    stats.totalBilledInputTokens += r.billedInputTokens || 0;
    stats.totalBilledCostUSD += r.billedCostUSD || 0;
    stats.totalSegments += r.segments || 0;
    const m = r.model || 'unknown';
    if (!stats.byModel[m]) stats.byModel[m] = { count: 0, billedCostUSD: 0 };
    stats.byModel[m].count++;
    stats.byModel[m].billedCostUSD += r.billedCostUSD || 0;
  }
  return stats;
}

export async function getAggregated({ from, to, groupBy = 'day' } = {}) {
  const records = await query({ from, to });
  return aggregateRecords(records, { from, to, groupBy });
}

export function aggregateRecords(records, { from, to, groupBy = 'day' } = {}) {
  const buckets = new Map();

  for (const r of records) {
    const d = new Date(r.timestamp);
    let period;
    if (groupBy === 'day') {
      period = fmtDate(d);
    } else if (groupBy === 'week') {
      period = fmtWeekStart(d);
    } else {
      period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    if (!buckets.has(period)) {
      buckets.set(period, { period, totalTokens: 0, billedCostUSD: 0, count: 0 });
    }
    const b = buckets.get(period);
    b.totalTokens += (r.billedInputTokens || 0) + (r.outputTokens || 0);
    b.billedCostUSD += r.billedCostUSD || 0;
    b.count++;
  }

  const result = fillGaps(buckets, from, to, groupBy);
  return result;
}

export async function queryUsagePage({ from, to, groupBy = 'day' } = {}) {
  const records = await query({ from, to });
  return {
    records,
    stats: statsFromRecords(records),
    data: aggregateRecords(records, { from, to, groupBy }),
  };
}

export async function exportCSV({ from, to } = {}) {
  const records = await query({ from, to });
  records.reverse();
  const header = '時間,網站標題,URL,模型,輸入 tokens,輸出 tokens,計費輸入 tokens,費用（USD）,段落數,本地快取命中,耗時（秒）';
  const rows = records.map(r => {
    const time = new Date(r.timestamp).toLocaleString('zh-TW', { hour12: false });
    const title = csvEscape(r.title || '');
    const url = csvEscape(r.url || '');
    const model = r.model || '';
    const duration = r.durationMs ? (r.durationMs / 1000).toFixed(1) : '';
    const cost = r.billedCostUSD ? r.billedCostUSD.toFixed(6) : '0';
    return `${time},${title},${url},${model},${r.inputTokens || 0},${r.outputTokens || 0},${r.billedInputTokens || 0},${cost},${r.segments || 0},${r.cacheHits || 0},${duration}`;
  });
  return '\uFEFF' + header + '\n' + rows.join('\n');
}

export async function clearBefore(beforeTimestamp) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const range = IDBKeyRange.upperBound(beforeTimestamp);
    let count = 0;
    const req = index.openCursor(range);
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        count++;
        cursor.continue();
      } else {
        resolve(count);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtWeekStart(d) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return fmtDate(monday);
}

function fillGaps(buckets, fromTs, toTs, groupBy) {
  const result = [];
  let fromMs = fromTs ?? null;
  if (fromMs === null) {
    let minKey = null;
    for (const key of buckets.keys()) { if (minKey === null || key < minKey) minKey = key; }
    if (minKey !== null) {
      const [y, m, d] = minKey.split('-').map(Number);
      fromMs = new Date(y, (m || 1) - 1, d || 1).getTime();
    } else {
      fromMs = Date.now() - 30 * 86400000;
    }
  }
  const from = new Date(fromMs);
  const to = new Date(toTs ?? Date.now());

  if (groupBy === 'day') {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    while (d <= to) {
      const key = fmtDate(d);
      result.push(buckets.get(key) || { period: key, totalTokens: 0, billedCostUSD: 0, count: 0 });
      d.setDate(d.getDate() + 1);
    }
  } else if (groupBy === 'week') {
    const d = new Date(from);
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    while (d <= to) {
      const key = fmtDate(d);
      result.push(buckets.get(key) || { period: key, totalTokens: 0, billedCostUSD: 0, count: 0 });
      d.setDate(d.getDate() + 7);
    }
  } else {
    const d = new Date(from.getFullYear(), from.getMonth(), 1);
    while (d <= to) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push(buckets.get(key) || { period: key, totalTokens: 0, billedCostUSD: 0, count: 0 });
      d.setMonth(d.getMonth() + 1);
    }
  }
  return result;
}

function csvEscape(str) {
  let s = str;
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function shouldSkipUsageRecord(record) {
  if (!record) return true;
  if (record.source === 'youtube-subtitle' || record.source === 'drive-subtitle' || record.source === 'x-subtitle') return false;
  const ip = Number(record.inputTokens) || 0;
  const op = Number(record.outputTokens) || 0;
  const ch = Number(record.chars) || 0;
  const cost = Number(record.billedCostUSD) || 0;
  return ip === 0 && op === 0 && ch === 0 && cost === 0;
}
