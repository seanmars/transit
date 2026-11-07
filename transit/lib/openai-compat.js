import { debugLog } from './logger.js';
import { DELIMITER, MARKER_COMPACT, MARKER_STRONG, packChunks, buildEffectiveSystemInstruction, isValidGlossaryEntry } from './system-instruction.js';
import { buildThinkingPayload } from './openai-compat-thinking.js';
import { codedError } from './bg-error.js';

import {
  fetchWithRetry, readJsonBody, alignAndFallback, runChunkedBatch, emptyContentError, parseLlmJson, emptyUsage,
  normalizeMessageContent,
} from './llm-common.js';

const DEFAULT_FETCH_TIMEOUT_MS = 90_000;

function resolveChatCompletionsUrl(baseUrl) {
  if (!baseUrl) throw codedError('baseUrlMissing', null, 'customProvider.baseUrl 未設定');
  const trimmed = String(baseUrl).trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return trimmed + '/chat/completions';
}

export async function translateBatch(texts, settings, glossary, fixedGlossary, forbiddenTerms) {
  return runChunkedBatch(texts, settings,
    (slice) => translateChunk(slice, settings, glossary, fixedGlossary, forbiddenTerms), packChunks);
}

async function translateChunk(texts, settings, glossary, fixedGlossary, forbiddenTerms) {
  if (!texts?.length) return { parts: [], usage: emptyUsage() };
  const cp = settings.customProvider || {};
  const { baseUrl, model, systemPrompt, temperature, apiKey, thinkingLevel, extraBodyJson } = cp;

  const marker = (cp.useStrongSegMarker === false) ? MARKER_COMPACT : MARKER_STRONG;
  const useSeqMarkers = texts.length > 1;
  const markedTexts = useSeqMarkers
    ? texts.map((t, i) => marker.fmt(i + 1) + t)
    : texts;
  const joined = markedTexts.join(DELIMITER);

  const baseSystem = (typeof systemPrompt === 'string' && systemPrompt.trim())
    ? systemPrompt
    : '你是專業的英文 → 繁體中文（台灣慣用語）翻譯助理，僅輸出譯文不加任何說明。';
  const effectiveSystem = buildEffectiveSystemInstruction(baseSystem, texts, joined, glossary, fixedGlossary, forbiddenTerms, marker);

  const thinkingPayload = buildThinkingPayload({
    baseUrl, model,
    level: thinkingLevel || 'auto',
    extraBodyRaw: extraBodyJson || '',
    onWarn: (msg) => { debugLog('warn', 'api', `customProvider thinking config: ${msg}`); },
  });

  const body = {
    messages: [
      { role: 'system', content: effectiveSystem },
      { role: 'user', content: joined },
    ],
    stream: false,
    ...thinkingPayload,
  };
  if (temperature !== null) {
    body.temperature = typeof temperature === 'number' ? temperature : 0.7;
  }
  if (model) body.model = model;

  const url = resolveChatCompletionsUrl(baseUrl);
  const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};

  await debugLog('info', 'api', 'openai-compat request', {
    baseUrl, model, segments: texts.length, chars: joined.length,
    inputPreview: joined.slice(0, 300),
    glossaryCount: glossary?.length || 0,
    fixedGlossaryCount: fixedGlossary?.length || 0,
    forbiddenTermsCount: forbiddenTerms?.length || 0,
  });

  const t0 = Date.now();
  const maxRetries = typeof settings?.maxRetries === 'number' ? settings.maxRetries : 3;
  const fetchTimeoutSec = cp.fetchTimeoutSec;
  const timeoutMs = (typeof fetchTimeoutSec === 'number' && fetchTimeoutSec > 0)
    ? fetchTimeoutSec * 1000
    : DEFAULT_FETCH_TIMEOUT_MS;
  const fetchOpts = { maxRetries, timeoutMs, headers, logPrefix: 'openai-compat' };
  const resp = await fetchWithRetry(url, body, fetchOpts);

  const badResponseOpts = {
    t0, logPrefix: 'openai-compat', errorCode: 'customBadResponse',
    message: (status, preview) => `自訂 Provider 回應格式異常（非 JSON）：HTTP ${status}。${preview ? '前 200 字：' + preview : ''}`,
  };
  let json = await readJsonBody(resp, badResponseOpts);
  const ms = Date.now() - t0;

  if (!resp.ok) {
    const errMsg = json?.error?.message || `HTTP ${resp.status}`;
    if (resp.status === 400 && ('temperature' in body) && /temperature/i.test(errMsg)) {
      await debugLog('warn', 'api', 'openai-compat 400 mentions temperature — retry once without it', {
        model, error: errMsg,
      });
      delete body.temperature;
      const retryResp = await fetchWithRetry(url, body, fetchOpts);
      json = await readJsonBody(retryResp, badResponseOpts);
      if (!retryResp.ok) {
        const retryErrMsg = json?.error?.message || `HTTP ${retryResp.status}`;
        await debugLog('error', 'api', 'openai-compat error (after temperature retry)', {
          status: retryResp.status, error: retryErrMsg,
        });
        throw new Error(retryErrMsg);
      }
    } else {
      await debugLog('error', 'api', 'openai-compat error', { status: resp.status, elapsed: ms, error: errMsg });
      throw new Error(errMsg);
    }
  }

  const choice = json?.choices?.[0];
  const finishReason = choice?.finish_reason || 'unknown';
  const text = normalizeMessageContent(choice?.message?.content);

  const chunkUsage = parseOpenAiUsage(json?.usage);

  if (!text) {
    await debugLog('error', 'api', 'openai-compat empty content', {
      elapsed: ms, finishReason, choicesLength: json?.choices?.length || 0,
    });
    throw emptyContentError(finishReason, chunkUsage, {
      codes: {}, messages: {},
      fallbackCode: 'customEmptyContent',
      fallbackMessage: `自訂 Provider 回傳空內容（finish_reason: ${finishReason}）。`,
    });
  }

  await debugLog('info', 'api', 'openai-compat response', {
    elapsed: ms,
    segments: texts.length,
    inputTokens: chunkUsage.inputTokens,
    outputTokens: chunkUsage.outputTokens,
    cachedTokens: chunkUsage.cachedTokens,
    finishReason,
    outputPreview: text.slice(0, 300),

  });

  return alignAndFallback({
    texts, text, marker, chunkUsage, finishReason,
    truncatedFinishReason: 'length',
    makeTruncatedError: () => codedError('customTruncated', { reason: finishReason },
      '自訂 Provider 輸出被截斷（finish_reason: length）。請減少每批段落數，或在進階 JSON 提高 max_tokens。'),
    translateOne: (t) => translateChunk([t], settings, glossary, fixedGlossary, forbiddenTerms),
    targetLanguage: settings.targetLanguage,
    elapsedMs: ms,
    logPrefix: 'openai-compat',
  });
}

function parseOpenAiUsage(u) {
  const x = u || {};
  return {
    inputTokens: x.prompt_tokens || 0,
    outputTokens: x.completion_tokens || 0,
    cachedTokens: x.prompt_tokens_details?.cached_tokens || x.cached_tokens || 0,
  };
}

export async function extractGlossary(compressedText, settings) {
  const cp = settings.customProvider || {};
  const { baseUrl, model, apiKey } = cp;
  if (!baseUrl) {
    return { glossary: [], usage: emptyUsage(), _diag: 'customProvider.baseUrl 未設定' };
  }
  const gc = settings.glossary || {};
  const glossaryPrompt = gc.prompt || '';
  const temperature = gc.temperature ?? 0.1;
  const maxTerms = gc.maxTerms ?? 200;
  const fetchTimeoutMs = gc.fetchTimeoutMs ?? 15_000;

  const body = {
    messages: [
      { role: 'system', content: glossaryPrompt },
      { role: 'user', content: compressedText },
    ],
    stream: false,
  };
  if (cp.temperature !== null) body.temperature = temperature;
  if (model) body.model = model;

  const url = resolveChatCompletionsUrl(baseUrl);
  const headers = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};

  await debugLog('info', 'glossary', 'openai-compat glossary extraction request', {
    baseUrl, model, chars: compressedText.length, fetchTimeoutMs,
  });

  const t0 = Date.now();
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(abortTimer);
    const reason = err.name === 'AbortError' ? `fetch timeout (${fetchTimeoutMs}ms)` : 'network error';
    await debugLog('error', 'glossary', `openai-compat glossary extraction failed (${reason})`, { error: err.message, elapsed: Date.now() - t0 });
    return { glossary: [], usage: emptyUsage(), _diag: `${reason}: ${err.message}` };
  }
  let json;
  try {
    json = await resp.json();
  } catch (parseErr) {
    await debugLog('error', 'glossary', 'openai-compat glossary response body parse failed', { status: resp.status, error: parseErr.message });
    return { glossary: [], usage: emptyUsage(), _diag: `resp.json() failed: ${parseErr.message}` };
  } finally {
    clearTimeout(abortTimer);
  }
  const ms = Date.now() - t0;
  const u = json?.usage || {};
  const usage = parseOpenAiUsage(u);

  if (!resp.ok) {
    const errMsg = json?.error?.message || `HTTP ${resp.status}`;
    await debugLog('error', 'glossary', 'openai-compat glossary extraction failed (API)', { status: resp.status, error: errMsg, elapsed: ms });
    return { glossary: [], usage, _diag: `API error ${resp.status}: ${errMsg}` };
  }

  const choice = json?.choices?.[0];
  const finishReason = choice?.finish_reason || 'unknown';
  const rawText = normalizeMessageContent(choice?.message?.content);
  await debugLog('info', 'glossary', 'openai-compat glossary extraction response', {
    elapsed: ms, usage: u, rawChars: rawText.length, finishReason,
  });

  const parsedJson = parseLlmJson(rawText);
  if (!parsedJson.ok) {
    await debugLog('warn', 'glossary', 'openai-compat glossary JSON parse failed', {
      error: parsedJson.error.message, finishReason, preview: rawText.slice(0, 500),
    });
    return { glossary: [], usage, _diag: `JSON parse error (finishReason=${finishReason}): ${parsedJson.error.message}, preview: ${rawText.slice(0, 300)}` };
  }
  const { entries } = parsedJson;

  if (!entries) {
    return { glossary: [], usage, _diag: `no array in response (rawText first 500): ${rawText.slice(0, 500)}` };
  }
  if (entries.length === 0) {
    return { glossary: [], usage, _diag: `entries array is empty (rawText first 500): ${rawText.slice(0, 500)}` };
  }

  const glossary = entries
    .filter(isValidGlossaryEntry)
    .slice(0, maxTerms);

  if (entries.length > 0 && glossary.length === 0) {
    const sampleDiag = JSON.stringify(entries.slice(0, 3)).slice(0, 500);
    return { glossary: [], usage, _diag: `entries=${entries.length} but 0 valid (missing source/target?). samples: ${sampleDiag}` };
  }

  await debugLog('info', 'glossary', 'openai-compat glossary extraction done', {
    totalEntries: entries.length, validTerms: glossary.length, elapsed: ms, finishReason,
  });

  return { glossary, usage, fromCache: false, _diag: null };
}
