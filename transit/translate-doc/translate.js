import { TRANSLATABLE_TYPES } from './block-types.js';
import { normalizeNameSeparators } from './epub-engine.js';
import { getSettings } from '../lib/storage.js';
import { detectOutputLangMismatch as detectDocBatchLangMismatch } from '../lib/system-instruction.js';

const bgErrMsg = (response) => {
  const i18n = window.__SK?.i18n;
  if (i18n && typeof i18n.bgErrorMessage === 'function') return i18n.bgErrorMessage(response);
  return (response && response.error) || '';
};

export const DOC_CHUNK_SIZE = 20;

export { detectOutputLangMismatch as detectDocBatchLangMismatch } from '../lib/system-instruction.js';

export async function sha1Hex(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function clearTcCacheForTexts(texts) {
  const prefixes = new Set(await Promise.all(
    (texts || []).filter(Boolean).map(async (t) => 'tc_' + (await sha1Hex(t))),
  ));
  if (prefixes.size === 0) return 0;
  const allKeys = (typeof chrome.storage.local.getKeys === 'function')
    ? await chrome.storage.local.getKeys()
    : Object.keys(await chrome.storage.local.get(null));
  const matched = allKeys.filter((k) => k.startsWith('tc_') && prefixes.has(k.slice(0, 43)));
  if (matched.length > 0) await chrome.storage.local.remove(matched);
  return matched.length;
}

export function collectGlossaryInputParts(doc, maxChars, pageFilter = null) {
  const parts = [];
  let acc = 0;
  for (const page of doc.pages) {
    if (pageFilter && !pageFilter(page)) continue;
    for (const b of page.blocks) {
      if (!TRANSLATABLE_TYPES.has(b.type)) continue;
      const t = b.plainText && b.plainText.trim();
      if (!t) continue;
      const room = maxChars - acc;
      if (room <= 0) break;
      if (t.length > room) {
        parts.push(t.slice(0, room));
        acc = maxChars;
        break;
      }
      parts.push(t);
      acc += t.length + 1;
    }
    if (acc >= maxChars) break;
  }
  return parts;
}

export async function translateDocument(doc, options = {}) {
  const {
    modelOverride, glossary, signal, onProgress = () => {}, engine = 'gemini',
    blockFilter, filterGlossary,
    extraForbiddenTerms = null,
    extraPrompt = null,
    batchSize = null,
  } = options;
  const chunkSize = (Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 100)
    ? batchSize : DOC_CHUNK_SIZE;
  if (engine === 'google') {
    throw new Error('translate-doc: Google Translate engine 不支援文件翻譯');
  }
  const startTime = Date.now();

  let targetLanguage = 'zh-TW';
  try {
    targetLanguage = (await getSettings()).targetLanguage || 'zh-TW';
  } catch (_) {   }

  const queue = [];
  for (const page of doc.pages) {
    for (const block of page.blocks) {
      if (TRANSLATABLE_TYPES.has(block.type) && block.plainText && block.plainText.trim().length > 0) {
        if (blockFilter && !blockFilter(block, page)) continue;
        queue.push(block);
        snapshotDoneBlock(block);
        block.translationStatus = 'pending';
        block.translation = null;
        block.translationError = null;
      }
    }
  }

  const totalBlocks = queue.length;
  let translatedBlocks = 0;
  let failedBlocks = 0;
  let cacheHits = 0;
  let cumulativeInputTokens = 0;
  let cumulativeBilledInputTokens = 0;
  let cumulativeOutputTokens = 0;
  let cumulativeCostUSD = 0;
  const batchTimes = [];

  console.log('[Transit] translateDocument start', {
    filename: doc.meta?.filename,
    totalBlocks,
    chunks: Math.ceil(totalBlocks / chunkSize),
    chunkSize,
    modelOverride: modelOverride || '(default)',
    pages: doc.pages.length,
  });

  emit();

  const messageType = engine === 'openai-compat' ? 'TRANSLATE_DOC_BATCH_CUSTOM' : 'TRANSLATE_DOC_BATCH';

  const accountUsage = (usage = {}) => {
    cumulativeInputTokens += usage.inputTokens ?? usage.billedInputTokens ?? 0;
    cumulativeBilledInputTokens += usage.billedInputTokens ?? usage.inputTokens ?? 0;
    cumulativeOutputTokens += usage.outputTokens ?? 0;
    cumulativeCostUSD += usage.billedCostUSD ?? usage.costUSD ?? 0;
    cacheHits += usage.cacheHits || 0;
  };

  const markBlocksFailed = (blocks, msg) => {
    blocks.forEach((b) => {
      if (restoreDoneBlock(b)) {
        b.translationError = msg;
        return;
      }
      b.translationStatus = 'failed';
      b.translationError = msg;
    });
    failedBlocks += blocks.length;
    translatedBlocks += blocks.length;
    emit();
  };

  const markBlocksCancelled = (blocks) => {
    blocks.forEach((b) => {
      if (restoreDoneBlock(b)) return;
      b.translationStatus = 'cancelled';
    });
  };

  const applyBlockResults = (blocks, result) => {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const tr = typeof result[i] === 'string'
        ? alignTrailingPeriodWithSource(b.plainText, repairDocLlmArtifacts(result[i]))
        : result[i];
      if (typeof tr === 'string' && tr.length > 0) {
        if (b.epubSerializedText != null) {
          const norm = normalizeNameSeparators(tr);
          b.translationRaw = norm;
          b.translation = stripPlaceholderTokens(norm);
          b.editedHtml = null;
          b.translationStatus = 'done';
          delete b._skPrevDone;
          translatedBlocks++;
          continue;
        }
        const parsed = parseMarkedTranslation(tr, b.linkUrls || []);
        b.translationSegments = parsed.segments;
        b.translation = parsed.plainText;
        b.translationStatus = 'done';
        delete b._skPrevDone;
      } else if (restoreDoneBlock(b)) {
        b.translationError = 'empty translation';
        failedBlocks++;
      } else {
        b.translation = null;
        b.translationSegments = null;
        b.translationStatus = 'failed';
        b.translationError = 'empty translation';
        failedBlocks++;
      }
      translatedBlocks++;
    }
    emit();
  };

  const BISECTABLE_CODES = new Set([
    'timeout', 'readTimeout',
    'blocked', 'emptyContent', 'emptySafety', 'emptyRecitation', 'emptyMaxTokens', 'emptyOther',
    'customEmptyContent',
  ]);

  async function translateSubChunk(blocks, depth) {
    if (signal?.aborted) {
      markBlocksCancelled(blocks);
      emit();
      return;
    }
    const texts = blocks.map((b) => buildMarkedText(b));
    blocks.forEach((b) => { b.translationStatus = 'translating'; });
    emit();

    const chunkGlossary = filterGlossary
      ? filterGlossaryForTexts(glossary, texts)
      : glossary;
    const payload = { texts, modelOverride, glossary: chunkGlossary, preferArticleGlossary: true, extraForbiddenTerms, docBatchSize: chunkSize, extraPrompt };

    const t0 = Date.now();
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: messageType, payload });
    } catch (err) {
      markBlocksFailed(blocks, (err && err.message) || String(err));
      return;
    }
    batchTimes.push(Date.now() - t0);

    if (!response || !Array.isArray(response.result)) {
      const code = response && response.errorCode;
      if (blocks.length >= 2 && BISECTABLE_CODES.has(code)) {
        console.warn('[Transit] chunk failed — bisect retry', { code, size: blocks.length, depth });
        const mid = Math.ceil(blocks.length / 2);
        await translateSubChunk(blocks.slice(0, mid), depth + 1);
        await translateSubChunk(blocks.slice(mid), depth + 1);
        return;
      }
      markBlocksFailed(blocks, bgErrMsg(response) || 'no response');
      return;
    }
    accountUsage(response.usage);

    if (detectDocBatchLangMismatch(response.result, targetLanguage)) {
      console.warn('[Transit] chunk output language mismatch, retrying once', { size: blocks.length, targetLanguage });
      await clearTcCacheForTexts(texts);
      if (signal?.aborted) {
        markBlocksCancelled(blocks);
        emit();
        return;
      }
      let retryResp = null;
      try {
        retryResp = await chrome.runtime.sendMessage({ type: messageType, payload });
      } catch { retryResp = null; }
      if (retryResp && Array.isArray(retryResp.result)) accountUsage(retryResp.usage);
      if (retryResp && Array.isArray(retryResp.result)
          && !detectDocBatchLangMismatch(retryResp.result, targetLanguage)) {
        response = retryResp;
      } else {
        await clearTcCacheForTexts(texts);
        const i18n = window.__SK?.i18n;
        markBlocksFailed(blocks, (i18n && typeof i18n.t === 'function')
          ? i18n.t('doc.translate.outputLangMismatch')
          : 'output language does not match target language');
        return;
      }
    }

    const usage = response.usage || {};
    console.log('[Transit] chunk done', {
      chunkSize: blocks.length,
      depth,
      batchMs: Date.now() - t0,
      usage: {
        billedInputTokens: usage.billedInputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        cacheHits: usage.cacheHits || 0,
        billedCostUSD: Number((usage.billedCostUSD || 0).toFixed(6)),
      },
    });

    applyBlockResults(blocks, response.result);
  }

  for (let start = 0; start < queue.length; start += chunkSize) {
    if (signal?.aborted) {
      markBlocksCancelled(queue.slice(start));
      break;
    }
    await translateSubChunk(queue.slice(start, start + chunkSize), 0);
  }

  const durationMs = Date.now() - startTime;

  console.log('[Transit] translateDocument done', {
    totalBlocks,
    translatedBlocks,
    failedBlocks,
    cacheHits,
    cumulativeInputTokens,
    cumulativeBilledInputTokens,
    cumulativeOutputTokens,
    cumulativeCostUSD: Number(cumulativeCostUSD.toFixed(6)),
    durationMs,
    cancelled: !!signal?.aborted,
  });

  try {
    const filename = (doc.meta && doc.meta.filename) || 'unknown.pdf';
    const urlScheme = ['epub', 'txt', 'md', 'html', 'subtitle'].includes(doc.kind) ? doc.kind : 'pdf';
    await chrome.runtime.sendMessage({
      type: 'LOG_USAGE',
      payload: {
        url: `${urlScheme}://${filename}`,
        title: filename,
        inputTokens: cumulativeInputTokens,
        outputTokens: cumulativeOutputTokens,
        cachedTokens: 0,
        billedInputTokens: cumulativeBilledInputTokens,
        billedCostUSD: cumulativeCostUSD,
        segments: totalBlocks,
        cacheHits,
        durationMs,
        timestamp: Date.now(),
        engine: engine || 'gemini',
        model: modelOverride || null,
        source: 'translate-doc',
      },
    });
  } catch (err) {
    console.warn('[Transit] LOG_USAGE 失敗', err && err.message);
  }

  return {
    totalBlocks,
    translatedBlocks,
    failedBlocks,
    cacheHits,
    cumulativeInputTokens,
    cumulativeBilledInputTokens,
    cumulativeOutputTokens,
    cumulativeCostUSD,
    durationMs,
    cancelled: !!signal?.aborted,
  };

  function emit() {
    const avgBatchMs = batchTimes.length > 0
      ? batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length
      : 0;
    const remainingChunks = Math.max(0, Math.ceil((totalBlocks - translatedBlocks) / chunkSize));
    const estimatedRemainingSec = avgBatchMs > 0
      ? Math.round((remainingChunks * avgBatchMs) / 1000)
      : 0;
    onProgress({
      totalBlocks,
      translatedBlocks,
      failedBlocks,
      estimatedRemainingSec,
      cumulativeInputTokens,
      cumulativeOutputTokens,
      cumulativeCostUSD,
    });
  }
}

export async function translateSingleBlock(block, options = {}) {
  const { modelOverride, glossary, engine = 'gemini', extraPrompt = null } = options;
  if (engine === 'google') {
    return { ok: false, error: 'translate-doc: Google Translate engine 不支援文件翻譯' };
  }
  if (!block || !block.plainText) return { ok: false, error: 'no plainText' };

  console.log('[Transit] retry block', block.blockId, 'modelOverride=', modelOverride || '(default)');

  block.translationStatus = 'translating';
  block.translationError = null;
  const startTime = Date.now();

  let response;
  try {
    const messageType = engine === 'openai-compat' ? 'TRANSLATE_DOC_BATCH_CUSTOM' : 'TRANSLATE_DOC_BATCH';
    response = await chrome.runtime.sendMessage({
      type: messageType,
      payload: { texts: [buildMarkedText(block)], modelOverride, glossary, preferArticleGlossary: true, extraPrompt },
    });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    block.translationStatus = 'failed';
    block.translationError = msg;
    console.warn('[Transit] retry sendMessage 失敗', block.blockId, msg);
    return { ok: false, error: msg };
  }

  if (!response || !Array.isArray(response.result) || response.result.length === 0) {
    const msg = bgErrMsg(response) || 'no response';
    block.translationStatus = 'failed';
    block.translationError = msg;
    console.warn('[Transit] retry response 異常', block.blockId, msg);
    return { ok: false, error: msg };
  }

  const usage = response.usage || {};
  try {
    await chrome.runtime.sendMessage({
      type: 'LOG_USAGE',
      payload: {
        url: 'pdf://retry',
        title: `(retry ${block.blockId})`,
        inputTokens: usage.inputTokens ?? usage.billedInputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cachedTokens: 0,
        billedInputTokens: usage.billedInputTokens ?? usage.inputTokens ?? 0,
        billedCostUSD: usage.billedCostUSD ?? 0,
        segments: 1,
        cacheHits: usage.cacheHits || 0,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        engine: engine || 'gemini',
        model: modelOverride || null,
        source: 'translate-doc-retry',
      },
    });
  } catch (_) {   }

  const tr = typeof response.result[0] === 'string'
    ? alignTrailingPeriodWithSource(block.plainText, repairDocLlmArtifacts(response.result[0]))
    : response.result[0];
  if (typeof tr === 'string' && tr.length > 0) {
    const parsed = parseMarkedTranslation(tr, block.linkUrls || []);
    block.translationSegments = parsed.segments;
    block.translation = parsed.plainText;
    block.translationStatus = 'done';
    block.translationError = null;
    console.log('[Transit] retry block done', block.blockId, 'tr=', parsed.plainText.slice(0, 40));
    return { ok: true };
  } else {
    block.translation = null;
    block.translationSegments = null;
    block.translationStatus = 'failed';
    block.translationError = 'empty translation';
    console.warn('[Transit] retry empty translation', block.blockId);
    return { ok: false, error: 'empty translation' };
  }
}

export function repairMangledPlaceholders(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  return s.replace(/⟦(\*?\/?\d+|\/?[bi]|l:\d+|\/l)(?:[»›❱》〉≫]|(?=[^⟧0-9])|$)/g, '⟦$1⟧');
}

export function stripTrailingSeparatorGarbage(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  return s
    .replace(/\s*[<«]{1,6}\s*TRZX_SEP\s*[>»]{1,6}\s*/gi, ' ')
    .replace(/\s*<{3,}(?:(?!>{3})[^\s㐀-鿿぀-ヿ]){0,24}$/, '')
    .trim();
}

const CJK_RE = '[\\u3400-\\u9fff\\uf900-\\ufaff\\u3000-\\u303f\\uff00-\\uffef]';
const PH_TOKEN_RE = '⟦[*\\/]?\\d+⟧';
export function collapseCjkPlaceholderSpaces(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  const strip = (run) => run.replace(/[ \t]+/g, '');
  s = s.replace(
    new RegExp('(' + CJK_RE + ')((?:[ \\t]*(?:' + PH_TOKEN_RE + '))+[ \\t]*)(?=' + CJK_RE + ')', 'g'),
    (m, a, run) => a + strip(run),
  );
  s = s.replace(
    new RegExp('^((?:[ \\t]*(?:' + PH_TOKEN_RE + '))+[ \\t]*)(?=' + CJK_RE + ')'),
    (m, run) => strip(run),
  );
  s = s.replace(
    new RegExp('(' + CJK_RE + ')((?:[ \\t]*(?:' + PH_TOKEN_RE + '))+[ \\t]*)$'),
    (m, a, run) => a + strip(run),
  );
  return s;
}

export function collapseCjkAsciiSpaces(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  return s.replace(new RegExp('(' + CJK_RE + ')[ \\t]+(?=' + CJK_RE + ')', 'g'), '$1');
}

export function collapseDoubledTitleMarks(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  let prev;
  do {
    prev = s;
    s = s.replace(/《《([^《》]*)》》/g, '《$1》');
  } while (s !== prev);
  return s;
}

export function repairDocLlmArtifacts(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  return collapseDoubledTitleMarks(collapseCjkAsciiSpaces(
    collapseCjkPlaceholderSpaces(stripTrailingSeparatorGarbage(repairMangledPlaceholders(s))),
  ));
}

const TERMINAL_PUNCT_RE = /[。．.！!？?…‥]/;
const TRAILING_SHELL_RE = /(?:[」』”’〉》】）)\]]|⟦[^⟦⟧]{1,8}⟧|\s)+$/;
export function alignTrailingPeriodWithSource(source, target) {
  if (typeof source !== 'string' || typeof target !== 'string' || target.length === 0) return target;
  const sCore = source.replace(TRAILING_SHELL_RE, '');
  if (!sCore) return target;
  if (TERMINAL_PUNCT_RE.test(sCore[sCore.length - 1])) return target;
  const m = target.match(TRAILING_SHELL_RE);
  const shell = m ? m[0] : '';
  const tCore = m ? target.slice(0, target.length - shell.length) : target;
  if (tCore.endsWith('。')) return tCore.slice(0, -1) + shell;
  return target;
}

export function snapshotDoneBlock(block) {
  if (!block || block.translationStatus !== 'done') return false;
  block._skPrevDone = {
    translation: block.translation ?? null,
    translationRaw: block.translationRaw ?? null,
    translationSegments: block.translationSegments ?? null,
    editedHtml: block.editedHtml ?? null,
  };
  return true;
}

export function restoreDoneBlock(block) {
  const prev = block && block._skPrevDone;
  if (!prev) return false;
  block.translation = prev.translation;
  block.translationRaw = prev.translationRaw;
  block.translationSegments = prev.translationSegments;
  block.editedHtml = prev.editedHtml;
  block.translationStatus = 'done';
  block.translationError = null;
  delete block._skPrevDone;
  return true;
}

export function stripPlaceholderTokens(s) {
  const repaired = repairDocLlmArtifacts(s || '');
  const SK = (typeof window !== 'undefined' && window.__SK) || null;
  if (SK && typeof SK.stripStrayPlaceholderMarkers === 'function') {
    return collapseCjkAsciiSpaces(SK.stripStrayPlaceholderMarkers(repaired).replace(/\s{2,}/g, ' ').trim());
  }
  return collapseCjkAsciiSpaces(
    repaired.replace(/⟦\*?\/?\d+⟧/g, '').replace(/[⟦⟧❰❱]/g, '').replace(/\s{2,}/g, ' ').trim(),
  );
}

export function filterGlossaryForTexts(glossary, texts) {
  if (!Array.isArray(glossary) || glossary.length === 0) return glossary;
  const haystack = texts.join('\n').toLowerCase();
  const hit = glossary.filter((e) => {
    const src = (e && e.source || '').toLowerCase().trim();
    if (!src) return false;
    if (haystack.includes(src)) return true;
    const words = src.split(/\s+/);
    if (words.length >= 2) {
      const last = words[words.length - 1];
      if (last.length >= 3 && haystack.includes(last)) return true;
    }
    return false;
  });
  return hit.length > 0 ? hit : null;
}

const MARKER_TAG_RE = /⟦(?:b|i|l:\d+|\/b|\/i|\/l)⟧/g;

export function buildMarkedText(block) {
  if (!block) return '';
  if (block.epubSerializedText != null) return block.epubSerializedText;
  const segs = block.styleSegments;
  const linkUrls = block.linkUrls || [];
  if (!Array.isArray(segs) || segs.length === 0) {
    return block.plainText || '';
  }
  let out = '';
  for (const s of segs) {
    let t = s.text;
    if (s.linkUrl) {
      const idx = linkUrls.indexOf(s.linkUrl) + 1;
      if (idx > 0) t = `⟦l:${idx}⟧${t}⟦/l⟧`;
    }
    if (s.isItalic) t = `⟦i⟧${t}⟦/i⟧`;
    if (s.isBold) t = `⟦b⟧${t}⟦/b⟧`;
    out += t;
  }
  return out;
}

export function parseMarkedTranslation(text, linkUrls) {
  const fallback = () => {
    const cleaned = (text || '')
      .replace(MARKER_TAG_RE, '')
      .replace(/⟦\/?[*bil0-9:]{0,4}[»›❱》〉≫]?/g, '');
    return {
      segments: [{ text: cleaned, isBold: false, isItalic: false, linkUrl: null }],
      plainText: cleaned,
    };
  };
  if (typeof text !== 'string' || text.length === 0) {
    return { segments: [], plainText: '' };
  }

  const stack = [];
  const segments = [];
  const tagRe = /⟦(\/?[bi]|l:(\d+)|\/l)⟧/g;
  let lastIndex = 0;

  function flushPlain(plain) {
    if (!plain) return;
    let isBold = false, isItalic = false, linkUrl = null;
    for (const e of stack) {
      if (e === 'b') isBold = true;
      else if (e === 'i') isItalic = true;
      else if (e && e.type === 'l') linkUrl = e.url;
    }
    const last = segments[segments.length - 1];
    if (last && last.isBold === isBold && last.isItalic === isItalic && last.linkUrl === linkUrl) {
      last.text += plain;
    } else {
      segments.push({ text: plain, isBold, isItalic, linkUrl });
    }
  }

  let m;
  while ((m = tagRe.exec(text)) !== null) {
    const plain = text.slice(lastIndex, m.index);
    flushPlain(plain);
    lastIndex = tagRe.lastIndex;
    const tag = m[1];
    if (tag === 'b' || tag === 'i') {
      stack.push(tag);
    } else if (tag === '/b' || tag === '/i') {
      const want = tag === '/b' ? 'b' : 'i';
      const top = stack[stack.length - 1];
      if (top !== want) return fallback();
      stack.pop();
    } else if (m[2] !== undefined) {
      const idx = parseInt(m[2], 10) - 1;
      if (idx < 0 || idx >= linkUrls.length) return fallback();
      stack.push({ type: 'l', url: linkUrls[idx] });
    } else if (tag === '/l') {
      const top = stack[stack.length - 1];
      if (!top || top.type !== 'l') return fallback();
      stack.pop();
    }
  }
  flushPlain(text.slice(lastIndex));
  if (stack.length !== 0) return fallback();

  return {
    segments,
    plainText: segments.map((s) => s.text).join(''),
  };
}

export function segmentsToMarkdown(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  return segments.map((s) => {
    let t = s.text || '';
    if (s.linkUrl) t = `[${t}](${s.linkUrl})`;
    if (s.isItalic) t = `*${t}*`;
    if (s.isBold) t = `**${t}**`;
    return t;
  }).join('');
}

export function markdownToSegments(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { segments: [], linkUrls: [] };
  }
  const segments = [];
  const linkUrls = [];
  let isBold = false;
  let isItalic = false;
  let buffer = '';
  let i = 0;

  function pushSeg(t, b, ital, url) {
    if (!t) return;
    const last = segments[segments.length - 1];
    if (last && last.isBold === b && last.isItalic === ital && last.linkUrl === url) {
      last.text += t;
    } else {
      segments.push({ text: t, isBold: b, isItalic: ital, linkUrl: url });
    }
  }
  function flush() {
    if (buffer.length === 0) return;
    pushSeg(buffer, isBold, isItalic, null);
    buffer = '';
  }

  while (i < text.length) {
    if (text.slice(i, i + 2) === '**') {
      flush();
      isBold = !isBold;
      i += 2;
      continue;
    }
    if (text[i] === '*') {
      flush();
      isItalic = !isItalic;
      i += 1;
      continue;
    }
    if (text[i] === '[') {
      const close = text.indexOf(']', i + 1);
      if (close > i && text[close + 1] === '(') {
        const closeP = text.indexOf(')', close + 2);
        if (closeP > close + 1) {
          flush();
          const linkText = text.slice(i + 1, close);
          const url = text.slice(close + 2, closeP);
          pushSeg(linkText, isBold, isItalic, url);
          if (!linkUrls.includes(url)) linkUrls.push(url);
          i = closeP + 1;
          continue;
        }
      }
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return { segments, linkUrls };
}

