import { debugLog } from './logger.js';
import { codedError } from './bg-error.js';
import { sleep } from './llm-common.js';
import { TARGET_LANGUAGES } from './storage.js';

const SEP = '\n\u2063\u2063\u2063\n';

const MAX_URL_ENCODED_CHARS = 5500;

const SUPPORTED_TL = new Set(TARGET_LANGUAGES);

const RETRY_SKIP_THRESHOLD = 20;
const RETRY_DELAY_MS = 150;

function _normalizeTl(targetLanguage) {
  return SUPPORTED_TL.has(targetLanguage) ? targetLanguage : 'zh-TW';
}

function dominantScript(text) {
  let cjk = 0, latin = 0;
  for (const ch of text || '') {
    const c = ch.codePointAt(0);
    if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF)) {
      cjk++;
    } else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) {
      latin++;
    }
  }
  if (cjk + latin === 0) return 'cjk';
  return cjk >= latin ? 'cjk' : 'latin';
}

export async function translateGoogleBatch(texts, targetLanguage = 'zh-TW') {
  if (!texts || texts.length === 0) return { translations: [], chars: 0 };

  const tl = _normalizeTl(targetLanguage);

  const totalChars = texts.reduce((s, t) => s + (t?.length || 0), 0);
  const result = new Array(texts.length).fill('');

  const byScript = { cjk: [], latin: [] };
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i] || '';
    byScript[dominantScript(t)].push({ idx: i, text: t });
  }

  const groups = [];
  const encodedSep = encodeURIComponent(SEP).length;
  for (const script of ['cjk', 'latin']) {
    const items = byScript[script];
    if (items.length === 0) continue;
    let cur = [];
    let curEncodedLen = 0;
    for (const item of items) {
      const eLen = encodeURIComponent(item.text).length + encodedSep;
      if (eLen > MAX_URL_ENCODED_CHARS) {
        if (cur.length > 0) { groups.push(cur); cur = []; curEncodedLen = 0; }
        const solo = [item];
        solo.long = true;
        groups.push(solo);
        continue;
      }
      if (cur.length > 0 && curEncodedLen + eLen > MAX_URL_ENCODED_CHARS) {
        groups.push(cur);
        cur = [];
        curEncodedLen = 0;
      }
      cur.push(item);
      curEncodedLen += eLen;
    }
    if (cur.length > 0) groups.push(cur);
  }

  const needsRetry = [];
  let hadSepLoss = false;
  let anyGroupOk = false;
  let lastGroupErr = null;
  for (const group of groups) {
    if (group.long) {
      const g = group[0];
      try {
        result[g.idx] = await _translateLongText(g.text, tl);
        anyGroupOk = true;
      } catch (err) {
        lastGroupErr = err;
        await debugLog('warn', 'api', 'google long segment fetch failed — keep source text', {
          chars: g.text.length, error: err?.message || String(err),
        });
        result[g.idx] = g.text;
      }
      continue;
    }
    const joined = group.map(g => g.text).join(SEP);
    let parts;
    try {
      parts = await _fetchTranslate(joined, tl);
      anyGroupOk = true;
    } catch (err) {
      lastGroupErr = err;
      await debugLog('warn', 'api', 'google group fetch failed — whole group to retry', {
        size: group.length, error: err?.message || String(err),
      });
      hadSepLoss = true;
      for (const g of group) {
        result[g.idx] = g.text;
        needsRetry.push(g);
      }
      continue;
    }
    if (parts.length !== group.length) {
      await debugLog('warn', 'api', 'google batch SEP boundary lost — whole group to retry', {
        expected: group.length, got: parts.length,
      });
      hadSepLoss = true;
      for (const g of group) {
        result[g.idx] = g.text;
        needsRetry.push(g);
      }
      continue;
    }
    group.forEach((g, j) => {
      const tr = parts[j];
      if (tr == null) {
        result[g.idx] = g.text;
        needsRetry.push(g);
      } else if (tr.trim() === (g.text || '').trim()) {
        result[g.idx] = tr;
        needsRetry.push(g);
      } else {
        result[g.idx] = tr;
      }
    });
  }

  const allEcho = !hadSepLoss && needsRetry.length === texts.length;
  if (needsRetry.length > RETRY_SKIP_THRESHOLD && allEcho) {
    await debugLog('info', 'api', 'google batch retry skipped — whole page already in target', {
      echoed: needsRetry.length,
    });
  } else if (needsRetry.length > 0) {
    let recoveredCount = 0;
    for (let ri = 0; ri < needsRetry.length; ri++) {
      const g = needsRetry[ri];
      try {
        const single = await _fetchTranslate(g.text, tl);
        const tr = single[0];
        if (tr != null && tr.trim() !== (g.text || '').trim()) {
          result[g.idx] = tr;
          recoveredCount++;
        }
      } catch (_) {
      }
      if (ri < needsRetry.length - 1) await sleep(RETRY_DELAY_MS);
    }
    await debugLog('info', 'api', 'google batch retry done', {
      attempted: needsRetry.length,
      recovered: recoveredCount,
    });
    if (!anyGroupOk && recoveredCount === 0 && lastGroupErr) {
      throw lastGroupErr;
    }
  } else if (!anyGroupOk && lastGroupErr) {
    throw lastGroupErr;
  }

  return { translations: result, chars: totalChars };
}

async function _translateLongText(text, tl) {
  const pieces = _splitForUrlLimit(text, MAX_URL_ENCODED_CHARS);
  const out = [];
  for (const piece of pieces) {
    const parts = await _fetchTranslate(piece, tl);
    out.push(parts.join(''));
  }
  await debugLog('info', 'api', 'google long segment translated in pieces', {
    chars: text.length, pieces: pieces.length,
  });
  return out.join('');
}

function _splitForUrlLimit(text, maxEncoded) {
  const sentences = String(text).match(/[^\n.!?。！？]*[.!?。！？]+["'”’)]*\s*|[^\n]+\n?|\n/g) || [text];
  const pieces = [];
  let cur = '';
  const encLen = (s) => encodeURIComponent(s).length;
  const pushCur = () => { if (cur) { pieces.push(cur); cur = ''; } };
  for (const sent of sentences) {
    if (encLen(sent) > maxEncoded) {
      pushCur();
      let buf = '';
      for (const ch of sent) {
        if (buf && encLen(buf + ch) > maxEncoded) { pieces.push(buf); buf = ''; }
        buf += ch;
      }
      if (buf) pieces.push(buf);
      continue;
    }
    if (cur && encLen(cur + sent) > maxEncoded) pushCur();
    cur += sent;
  }
  pushCur();
  return pieces.length > 0 ? pieces : [text];
}

const FETCH_TIMEOUT_MS = 15_000;

async function _fetchTranslate(text, tl) {
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=` +
    encodeURIComponent(text);

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let data;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`Google Translate HTTP ${resp.status}`);
    data = await resp.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw codedError('gtTimeout', { ms: FETCH_TIMEOUT_MS }, `Google Translate 逾時(${FETCH_TIMEOUT_MS}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(abortTimer);
  }
  const full = (data[0] || [])
    .filter(Array.isArray)
    .map(chunk => chunk[0] || '')
    .join('');

  return full.split(SEP);
}
