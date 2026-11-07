import { debugLog } from './logger.js';
import { codedError } from './bg-error.js';
import { SEP_RE, realignByMarkers, detectOutputLangMismatch } from './system-instruction.js';

export const MAX_BACKOFF_MS = 8000;
export const RETRY_AFTER_CAP_MS = 30_000;
export const FETCH_TIMEOUT_MS = 15_000;

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
}

export function addUsage(a, b) {
  const x = a || {};
  const y = b || {};
  return {
    inputTokens: (x.inputTokens || 0) + (y.inputTokens || 0),
    outputTokens: (x.outputTokens || 0) + (y.outputTokens || 0),
    cachedTokens: (x.cachedTokens || 0) + (y.cachedTokens || 0),
  };
}

export function attachUsage(err, base) {
  if (err && typeof err === 'object') {
    err.usage = addUsage(base, err.usage);
  }
  return err;
}

export async function fetchWithRetry(url, body, {
  maxRetries = 3,
  headers = {},
  timeoutMs = FETCH_TIMEOUT_MS,
  timeoutRetries = null,
  logPrefix = 'llm',
  classify429 = null,
} = {}) {
  const timeoutRetryCap = (typeof timeoutRetries === 'number') ? timeoutRetries : maxRetries;
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let resp;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        const isTimeout = err.name === 'AbortError';
        const errMsg = isTimeout ? `逾時(${timeoutMs}ms)` : err.message;
        await debugLog('error', 'api', isTimeout ? `${logPrefix} fetch timeout` : `${logPrefix} fetch network error`, { error: err.message, attempt, timeoutMs: isTimeout ? timeoutMs : undefined });
        if (attempt >= (isTimeout ? timeoutRetryCap : maxRetries)) {
          throw isTimeout
            ? codedError('timeout', { ms: timeoutMs }, '網路錯誤：' + errMsg)
            : codedError('network', { msg: err.message }, '網路錯誤：' + errMsg);
        }
        await sleep(Math.min(MAX_BACKOFF_MS, 500 * Math.pow(2, attempt)));
        attempt += 1;
        continue;
      }

      if (resp.status >= 500 && resp.status < 600) {
        await debugLog('warn', 'api', `${logPrefix} ${resp.status} server error`, { status: resp.status, attempt });
        if (attempt >= maxRetries) {
          let errMsg = `HTTP ${resp.status}`;
          try { const j = await resp.json(); errMsg = j?.error?.message || errMsg; } catch {   }
          throw new Error(errMsg);
        }
        await sleep(Math.min(MAX_BACKOFF_MS, 500 * Math.pow(2, attempt)));
        attempt += 1;
        continue;
      }

      if (resp.status !== 429) {
        let bodyText;
        try {
          bodyText = await resp.text();
        } catch (err) {
          const isTimeout = err.name === 'AbortError';
          const errMsg = isTimeout ? `回應讀取逾時(${timeoutMs}ms)` : err.message;
          await debugLog('error', 'api', isTimeout ? `${logPrefix} body read timeout` : `${logPrefix} body read error`, { error: err.message, attempt });
          if (attempt >= (isTimeout ? timeoutRetryCap : maxRetries)) {
            throw isTimeout
              ? codedError('readTimeout', { ms: timeoutMs }, '網路錯誤：' + errMsg)
              : codedError('network', { msg: err.message }, '網路錯誤：' + errMsg);
          }
          await sleep(Math.min(MAX_BACKOFF_MS, 500 * Math.pow(2, attempt)));
          attempt += 1;
          continue;
        }
        return new Response(bodyText || null, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
      }

      let bodyJson = null;
      try { bodyJson = await resp.clone().json(); } catch {   }
      const cls = (typeof classify429 === 'function') ? (classify429(bodyJson) || {}) : {};
      const dim = cls.dimension || null;
      const retryAfterHeader = resp.headers.get('retry-after');
      const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;

      await debugLog('warn', 'api', `${logPrefix} 429 rate limit`, {
        dimension: dim,
        retryAfter: retryAfterHeader,
        attempt,
        error: bodyJson?.error?.message,
      });

      if (cls.fatal) throw cls.fatal;

      if (attempt >= maxRetries) {
        const apiMsg = bodyJson?.error?.message;
        if (apiMsg) throw new Error(apiMsg);
        throw codedError('http429', { dim: dim || 'unknown' }, `HTTP 429(${dim || '未知維度'})`);
      }

      const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min(retryAfterSec * 1000 + 100, RETRY_AFTER_CAP_MS)
        : Math.min(MAX_BACKOFF_MS, 500 * Math.pow(2, attempt));
      await sleep(waitMs);
      attempt += 1;
    } finally {
      clearTimeout(abortTimer);
    }
  }
}

export async function readJsonBody(resp, { t0, logPrefix, errorCode, message }) {
  let rawBody = '';
  try {
    rawBody = await resp.text();
    return JSON.parse(rawBody);
  } catch (parseErr) {
    const rawPreview = rawBody.slice(0, 200);
    await debugLog('error', 'api', `${logPrefix} response body is not JSON`, {
      status: resp.status, elapsed: Date.now() - t0, parseError: parseErr.message, rawPreview,
    });
    throw codedError(errorCode, { status: resp.status, preview: rawPreview || 'N/A' }, message(resp.status, rawPreview));
  }
}

export const EMPTY_REASON_CODES = {
  SAFETY: 'emptySafety',
  RECITATION: 'emptyRecitation',
  MAX_TOKENS: 'emptyMaxTokens',
  OTHER: 'emptyOther',
};

export const EMPTY_REASON_MESSAGES = {
  SAFETY: '內容被 Gemini 安全過濾器擋下。可能是原文含有敏感內容，請嘗試跳過此段落。',
  RECITATION: 'Gemini 偵測到輸出與已知作品高度重複（recitation filter），請嘗試縮短段落。',
  MAX_TOKENS: '輸出超過 maxOutputTokens 上限。請到設定頁提高上限，或減少每批段落數。',
  OTHER: 'Gemini 回傳空內容（finishReason: OTHER），原因不明。請稍後重試。',
};

export function normalizeMessageContent(content) {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part && typeof part.text === 'string' ? part.text : '')))
      .join('');
  }
  return String(content);
}

export function emptyContentError(finishReason, usage, {
  codes = EMPTY_REASON_CODES,
  messages = EMPTY_REASON_MESSAGES,
  fallbackCode = 'emptyContent',
  fallbackMessage = `Gemini 回傳空內容（finishReason: ${finishReason}）。`,
} = {}) {
  const err = codedError(codes[finishReason] || fallbackCode, { reason: finishReason }, messages[finishReason] || fallbackMessage);
  err.usage = { ...usage };
  return err;
}

export async function alignAndFallback({
  texts, text, marker, chunkUsage, finishReason, truncatedFinishReason,
  makeTruncatedError, translateOne, targetLanguage, elapsedMs, logPrefix,
}) {
  const parts = text.split(SEP_RE).map(s => s.trim().replace(marker.re, ''));

  const perSegmentFallback = async () => {
    const aligned = [];
    let aggUsage = { ...chunkUsage };
    const tFallback0 = Date.now();
    for (let fi = 0; fi < texts.length; fi++) {
      const tSeg0 = Date.now();
      let r;
      try {
        r = await translateOne(texts[fi]);
      } catch (err) {
        throw attachUsage(err, aggUsage);
      }
      await debugLog('info', 'api', `${logPrefix} fallback segment ${fi + 1}/${texts.length}`, { elapsed: Date.now() - tSeg0 });
      aligned.push(r.parts[0] || '');
      aggUsage = addUsage(aggUsage, r.usage);
    }
    await debugLog('warn', 'api', `${logPrefix} fallback complete`, { segments: texts.length, fallbackElapsed: Date.now() - tFallback0, originalElapsed: elapsedMs });
    return { parts: aligned, usage: aggUsage, hadMismatch: true };
  };

  if (finishReason === truncatedFinishReason) {
    if (texts.length > 1) {
      await debugLog('warn', 'api', `${logPrefix} output truncated (${finishReason}) — fallback to per-segment`, {
        segments: texts.length, elapsed: elapsedMs, textLength: text.length,
      });
      return perSegmentFallback();
    }
    const err = makeTruncatedError();
    err.usage = { ...chunkUsage };
    throw err;
  }

  let aligned = parts;
  if (parts.length !== texts.length) {
    if (texts.length === 1) {
      const joinedSingle = parts.filter(Boolean).join('\n') || text.trim();
      return { parts: [joinedSingle], usage: chunkUsage, hadMismatch: false };
    }
    const realigned = realignByMarkers(text, texts.length, marker);
    if (!realigned) {
      await debugLog('warn', 'api', `${logPrefix} segment count mismatch — fallback to per-segment`, {
        expected: texts.length, got: parts.length, elapsed: elapsedMs, rawHead: text.slice(0, 6000),
      });
      return perSegmentFallback();
    }
    await debugLog('info', 'api', `${logPrefix} segment count mismatch — realigned via seq markers`, {
      expected: texts.length, got: parts.length, elapsed: elapsedMs,
    });
    aligned = realigned;
  }

  if (texts.length > 1 && detectOutputLangMismatch(aligned, targetLanguage)) {
    await debugLog('warn', 'api', `${logPrefix} chunk output language mismatch — fallback to per-segment`, {
      segments: texts.length, elapsed: elapsedMs, targetLanguage,
    });
    return perSegmentFallback();
  }

  return { parts: aligned, usage: chunkUsage, hadMismatch: false };
}

export async function runChunkedBatch(texts, settings, translateChunk, packChunks) {
  if (!texts?.length) return { translations: [], usage: emptyUsage(), hadMismatch: false };
  const out = new Array(texts.length);
  let usage = emptyUsage();
  let hadMismatch = false;
  const chunks = packChunks(texts, {
    maxUnits: settings?.maxUnitsPerBatch,
    maxChars: settings?.maxCharsPerBatch,
  });
  for (const { start, end } of chunks) {
    const slice = texts.slice(start, end);
    let result;
    try {
      result = await translateChunk(slice);
    } catch (err) {
      throw attachUsage(err, usage);
    }
    for (let j = 0; j < result.parts.length; j++) out[start + j] = result.parts[j];
    usage = addUsage(usage, result.usage);
    if (result.hadMismatch) hadMismatch = true;
  }
  return { translations: out, usage, hadMismatch };
}

export function parseLlmJson(rawText) {
  let jsonStr = (rawText || '').trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    const firstBracket = jsonStr.search(/[\[{]/);
    const lastBracket = Math.max(jsonStr.lastIndexOf(']'), jsonStr.lastIndexOf('}'));
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      jsonStr = jsonStr.slice(firstBracket, lastBracket + 1);
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (error) {
    return { ok: false, error };
  }
  let entries = null;
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const arrKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]));
    entries = arrKey ? parsed[arrKey] : null;
  }
  return { ok: true, parsed, entries };
}
