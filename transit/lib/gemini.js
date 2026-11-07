import { debugLog } from './logger.js';
import { DELIMITER, SEP_RE, MARKER_COMPACT, packChunks, buildEffectiveSystemInstruction, isValidGlossaryEntry, detectOutputLangMismatch, realignByMarkers } from './system-instruction.js';
import { codedError } from './bg-error.js';
import {
  FETCH_TIMEOUT_MS, fetchWithRetry, readJsonBody, alignAndFallback, runChunkedBatch,
  emptyContentError, parseLlmJson, emptyUsage,
} from './llm-common.js';
import SCAN_RENDERINGS_PROMPT from '../prompts/scan-renderings.js';


export class DailyQuotaExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DailyQuotaExceededError';
    this.skCode = 'dailyQuota';
    this.skParams = null;
  }
}

export function pickThinkingConfig(model) {
  const m = String(model || '');
  if (/pro/i.test(m)) return { thinkingLevel: 'low' };
  const ver = m.match(/gemini-(\d+)(?:\.(\d+))?/i);
  if (ver) {
    const major = Number(ver[1]);
    const minor = Number(ver[2] || 0);
    if (major > 3 || (major === 3 && minor >= 7)) return { thinkingLevel: 'low' };
  }
  return { thinkingLevel: 'minimal' };
}

export function parseGeminiUsage(meta) {
  const m = meta || {};
  const candidates = m.candidatesTokenCount || 0;
  const thoughts = m.thoughtsTokenCount || 0;
  return {
    inputTokens: m.promptTokenCount || 0,
    outputTokens: candidates + thoughts,
    cachedTokens: m.cachedContentTokenCount || 0,
    thoughtsTokens: thoughts,
  };
}

export function buildSamplingFields(model, { topP, topK } = {}) {
  if (modelDropsSamplingParams(model)) return {};
  if (/gemini-3/i.test(String(model || ''))) return {};
  return { topP, topK };
}

export function modelDropsSamplingParams(model) {
  const m = String(model || '');
  if (/gemini-3\.5-flash-lite/i.test(m)) return true;
  const ver = m.match(/gemini-(\d+)(?:\.(\d+))?/i);
  if (!ver) return false;
  const major = Number(ver[1]);
  const minor = Number(ver[2] || 0);
  return major > 3 || (major === 3 && minor >= 6);
}

export function buildTemperatureField(model, temperature) {
  if (modelDropsSamplingParams(model)) return {};
  return { temperature };
}

function extractQuotaDimension(json) {
  const details = json?.error?.details;
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    const metric = d?.quotaMetric || d?.metric || '';
    const id = d?.quotaId || '';
    const haystack = `${metric} ${id}`.toLowerCase();
    if (haystack.includes('perday') || haystack.includes('_day')) return 'RPD';
    if (haystack.includes('tokens') && haystack.includes('minute')) return 'TPM';
    if (haystack.includes('requests') && haystack.includes('minute')) return 'RPM';
  }
  return null;
}

function classifyGemini429(bodyJson) {
  const dimension = extractQuotaDimension(bodyJson);
  return {
    dimension,
    fatal: dimension === 'RPD'
      ? new DailyQuotaExceededError('今日 Gemini API 配額已用盡(RPD 達上限),請明天再試或升級付費層級。')
      : null,
  };
}

export async function extractGlossary(compressedText, settings) {
  const { apiKey, geminiConfig, glossary: glossaryConfig } = settings;
  const {
    serviceTier,
    topP,
    topK,
    maxOutputTokens,
  } = geminiConfig;

  const model = (glossaryConfig?.model || '').trim() || geminiConfig.model;

  const glossaryPrompt = glossaryConfig?.prompt || '';
  const glossaryTemperature = glossaryConfig?.temperature ?? 1.0;
  const maxTerms = glossaryConfig?.maxTerms ?? 200;
  const fetchTimeoutMs = glossaryConfig?.fetchTimeoutMs ?? 15_000;

  const glossaryMaxOutput = Math.max(maxOutputTokens || 0, 4096);

  const body = {
    contents: [{ role: 'user', parts: [{ text: compressedText }] }],
    systemInstruction: { parts: [{ text: glossaryPrompt }] },
    generationConfig: {
      ...buildTemperatureField(model, glossaryTemperature),
      ...buildSamplingFields(model, { topP, topK }),
      maxOutputTokens: glossaryMaxOutput,
      thinkingConfig: pickThinkingConfig(model),
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  if (serviceTier && serviceTier !== 'DEFAULT') {
    body.service_tier = serviceTier.toLowerCase();
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  await debugLog('info', 'glossary', 'glossary extraction request', { model, chars: compressedText.length, fetchTimeoutMs, maxOutputTokens: glossaryMaxOutput, settingsMaxOutput: maxOutputTokens });

  const t0 = Date.now();

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(abortTimer);
    const reason = err.name === 'AbortError' ? `fetch timeout (${fetchTimeoutMs}ms)` : 'network error';
    await debugLog('error', 'glossary', `glossary extraction failed (${reason})`, { error: err.message, elapsed: Date.now() - t0 });
    return { glossary: [], usage: emptyUsage(), _diag: `${reason}: ${err.message}` };
  }
  let json;
  try {
    json = await resp.json();
  } catch (parseErr) {
    await debugLog('error', 'glossary', 'glossary response body parse failed', { status: resp.status, error: parseErr.message });
    return { glossary: [], usage: emptyUsage(), _diag: `resp.json() failed: ${parseErr.message}` };
  } finally {
    clearTimeout(abortTimer);
  }
  const ms = Date.now() - t0;
  const usage = parseGeminiUsage(json?.usageMetadata);

  if (!resp.ok) {
    const errMsg = json?.error?.message || `HTTP ${resp.status}`;
    await debugLog('error', 'glossary', 'glossary extraction failed (API)', { status: resp.status, error: errMsg, elapsed: ms });
    return { glossary: [], usage, _diag: `API error ${resp.status}: ${errMsg}` };
  }

  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const finishReason = json?.candidates?.[0]?.finishReason || 'unknown';
  await debugLog('info', 'glossary', 'glossary extraction response', {
    elapsed: ms, usage, rawChars: rawText.length, finishReason,
  });

  const parsedJson = parseLlmJson(rawText);
  if (!parsedJson.ok) {
    await debugLog('warn', 'glossary', 'glossary JSON parse failed', {
      error: parsedJson.error.message, finishReason,
      preview: rawText.slice(0, 500),
    });
    return { glossary: [], usage, _diag: `JSON parse error (finishReason=${finishReason}): ${parsedJson.error.message}, preview: ${rawText.slice(0, 300)}` };
  }
  const { parsed, entries } = parsedJson;

  if (!entries) {
    await debugLog('warn', 'glossary', 'glossary result: no array found in response', {
      type: typeof parsed,
      keys: parsed ? Object.keys(parsed).slice(0, 5) : [],
    });
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

  await debugLog('info', 'glossary', 'glossary extraction done', {
    totalEntries: entries.length, validTerms: glossary.length, elapsed: ms, finishReason,
  });

  return { glossary, usage };
}

export async function extractTermRenderings(items, settings) {
  const zeroUsage = emptyUsage();
  const { apiKey, geminiConfig, glossary: glossaryConfig } = settings;
  if (!Array.isArray(items) || items.length === 0) {
    return { renderings: [], usage: zeroUsage };
  }
  const model = (glossaryConfig?.model || '').trim() || geminiConfig.model;
  const fetchTimeoutMs = glossaryConfig?.fetchTimeoutMs ?? 20_000;

  const parts = [];
  for (const item of items) {
    parts.push(`### ${item.term}`);
    item.samples.forEach((s, i) => parts.push(`[${i + 1}] ${s.text}`));
  }
  const userText = parts.join('\n');

  const body = {
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    systemInstruction: { parts: [{ text: SCAN_RENDERINGS_PROMPT }] },
    generationConfig: {
      ...buildTemperatureField(model, glossaryConfig?.temperature ?? 1.0),
      ...buildSamplingFields(model, { topP: geminiConfig.topP, topK: geminiConfig.topK }),
      maxOutputTokens: Math.max(geminiConfig.maxOutputTokens || 0, 4096),
      thinkingConfig: pickThinkingConfig(model),
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };
  if (geminiConfig.serviceTier && geminiConfig.serviceTier !== 'DEFAULT') {
    body.service_tier = geminiConfig.serviceTier.toLowerCase();
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  await debugLog('info', 'scan', 'term renderings request', { model, terms: items.length, chars: userText.length });
  const t0 = Date.now();
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(abortTimer);
    const reason = err.name === 'AbortError' ? `fetch timeout (${fetchTimeoutMs}ms)` : 'network error';
    await debugLog('error', 'scan', `term renderings failed (${reason})`, { error: err.message, elapsed: Date.now() - t0 });
    return { renderings: [], usage: zeroUsage, _diag: `${reason}: ${err.message}` };
  }
  let json;
  try {
    json = await resp.json();
  } catch (parseErr) {
    return { renderings: [], usage: zeroUsage, _diag: `resp.json() failed: ${parseErr.message}` };
  } finally {
    clearTimeout(abortTimer);
  }
  const usage = parseGeminiUsage(json?.usageMetadata);
  if (!resp.ok) {
    const errMsg = json?.error?.message || `HTTP ${resp.status}`;
    await debugLog('error', 'scan', 'term renderings failed (API)', { status: resp.status, error: errMsg });
    return { renderings: [], usage, _diag: `API error ${resp.status}: ${errMsg}` };
  }
  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsedJson = parseLlmJson(rawText);
  if (!parsedJson.ok) {
    await debugLog('warn', 'scan', 'term renderings JSON parse failed', { error: parsedJson.error.message, preview: rawText.slice(0, 300) });
    return { renderings: [], usage, _diag: `JSON parse error: ${parsedJson.error.message}` };
  }
  const { entries } = parsedJson;
  const renderings = (entries || [])
    .filter((e) => e && typeof e.term === 'string' && Array.isArray(e.renderings))
    .map((e) => ({ term: e.term, renderings: e.renderings.map((r) => (typeof r === 'string' ? r : '')) }));
  await debugLog('info', 'scan', 'term renderings done', { terms: renderings.length, elapsed: Date.now() - t0, usage });
  return { renderings, usage };
}

export async function translateBatch(texts, settings, glossary, fixedGlossary, forbiddenTerms) {
  return runChunkedBatch(texts, settings,
    (slice) => translateChunk(slice, settings, glossary, fixedGlossary, forbiddenTerms), packChunks);
}

async function translateChunk(texts, settings, glossary, fixedGlossary, forbiddenTerms) {
  if (!texts?.length) return { parts: [], usage: emptyUsage() };
  const { apiKey, geminiConfig } = settings;
  const {
    model,
    serviceTier,
    temperature,
    topP,
    topK,
    maxOutputTokens,
    systemInstruction,
  } = geminiConfig;

  const useSeqMarkers = texts.length > 1;
  const markedTexts = useSeqMarkers
    ? texts.map((t, i) => MARKER_COMPACT.fmt(i + 1) + t)
    : texts;
  const joined = markedTexts.join(DELIMITER);

  const effectiveSystem = buildEffectiveSystemInstruction(systemInstruction, texts, joined, glossary, fixedGlossary, forbiddenTerms);

  const body = {
    contents: [{ role: 'user', parts: [{ text: joined }] }],
    systemInstruction: { parts: [{ text: effectiveSystem }] },
    generationConfig: {
      ...buildTemperatureField(model, temperature),
      ...buildSamplingFields(model, { topP, topK }),
      maxOutputTokens,
      thinkingConfig: pickThinkingConfig(model),
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  if (serviceTier && serviceTier !== 'DEFAULT') {
    body.service_tier = serviceTier.toLowerCase();
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  await debugLog('info', 'api', 'gemini request', {
    model, serviceTier, segments: texts.length, chars: joined.length,
    inputPreview: joined.slice(0, 300),
    glossaryCount: glossary?.length || 0,
    fixedGlossaryCount: fixedGlossary?.length || 0,
    forbiddenTermsCount: forbiddenTerms?.length || 0,
  });

  const t0 = Date.now();
  const maxRetries = typeof settings?.maxRetries === 'number' ? settings.maxRetries : 3;
  const resp = await fetchWithRetry(url, body, {
    maxRetries,
    logPrefix: 'gemini',
    classify429: classifyGemini429,
    headers: { 'x-goog-api-key': apiKey },
    timeoutMs: (typeof geminiConfig.fetchTimeoutMs === 'number' && geminiConfig.fetchTimeoutMs > 0)
      ? geminiConfig.fetchTimeoutMs : undefined,
    timeoutRetries: (typeof geminiConfig.timeoutRetries === 'number') ? geminiConfig.timeoutRetries : null,
  });

  const json = await readJsonBody(resp, {
    t0, logPrefix: 'gemini', errorCode: 'badResponse',
    message: (status, preview) => `Gemini API 回應格式異常（非 JSON）：HTTP ${status}。${preview ? '回應前 200 字元：' + preview : ''}`,
  });
  const ms = Date.now() - t0;

  if (!resp.ok) {
    await debugLog('error', 'api', 'gemini error', { status: resp.status, elapsed: ms, error: json?.error?.message });
    const msg = json?.error?.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }

  const candidate = json?.candidates?.[0];
  const finishReason = candidate?.finishReason || 'unknown';
  const text = candidate?.content?.parts?.[0]?.text || '';

  const chunkUsage = parseGeminiUsage(json?.usageMetadata);

  const blockReason = json?.promptFeedback?.blockReason;
  if (blockReason) {
    await debugLog('error', 'api', 'gemini prompt blocked', { blockReason, elapsed: ms });
    const err = codedError('blocked', { reason: blockReason },
      `Gemini 拒絕處理此請求（promptFeedback.blockReason: ${blockReason}）。可能是安全過濾器誤判，請嘗試縮短段落或調整內容。`);
    err.usage = { ...chunkUsage };
    throw err;
  }

  if (!candidate || !text) {
    await debugLog('error', 'api', 'gemini empty candidates', {
      elapsed: ms, finishReason,
      candidatesLength: json?.candidates?.length || 0,
      promptFeedback: json?.promptFeedback,
    });
    throw emptyContentError(finishReason, chunkUsage);
  }

  if (finishReason && finishReason !== 'STOP' && finishReason !== 'unknown') {
    await debugLog('warn', 'api', 'gemini unusual finishReason', { finishReason, elapsed: ms, textLength: text.length });
  }

  await debugLog('info', 'api', 'gemini response', {
    elapsed: ms,
    segments: texts.length,
    inputTokens: chunkUsage.inputTokens,
    outputTokens: chunkUsage.outputTokens,
    thoughtsTokens: chunkUsage.thoughtsTokens,
    cachedTokens: chunkUsage.cachedTokens,
    finishReason,
    outputPreview: text.slice(0, 300),
  });

  return alignAndFallback({
    texts, text, marker: MARKER_COMPACT, chunkUsage, finishReason,
    truncatedFinishReason: 'MAX_TOKENS',
    makeTruncatedError: () => codedError('emptyMaxTokens', { reason: finishReason },
      '輸出超過 maxOutputTokens 上限（譯文被截斷）。請到設定頁提高上限，或減少每批段落數。'),
    translateOne: (t) => translateChunk([t], settings, glossary, fixedGlossary, forbiddenTerms),
    targetLanguage: settings.targetLanguage,
    elapsedMs: ms,
    logPrefix: 'gemini',
  });
}

export async function translateBatchStream(texts, settings, glossary, fixedGlossary, forbiddenTerms, callbacks = {}, signal = undefined) {
  if (!texts?.length) {
    return { translations: [], usage: emptyUsage(), hadMismatch: false, finishReason: 'STOP' };
  }

  const { apiKey, geminiConfig } = settings;
  const { model, serviceTier, temperature, topP, topK, maxOutputTokens, systemInstruction } = geminiConfig;

  const useSeqMarkers = texts.length > 1;
  const markedTexts = useSeqMarkers ? texts.map((t, i) => MARKER_COMPACT.fmt(i + 1) + t) : texts;
  const joined = markedTexts.join(DELIMITER);

  const effectiveSystem = buildEffectiveSystemInstruction(systemInstruction, texts, joined, glossary, fixedGlossary, forbiddenTerms);

  const body = {
    contents: [{ role: 'user', parts: [{ text: joined }] }],
    systemInstruction: { parts: [{ text: effectiveSystem }] },
    generationConfig: {
      ...buildTemperatureField(model, temperature),
      ...buildSamplingFields(model, { topP, topK }),
      maxOutputTokens,
      thinkingConfig: pickThinkingConfig(model),
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };
  if (serviceTier && serviceTier !== 'DEFAULT') body.service_tier = serviceTier.toLowerCase();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  await debugLog('info', 'api', 'gemini stream request', {
    model, segments: texts.length, chars: joined.length,
    inputPreview: joined.slice(0, 200),
    glossaryCount: glossary?.length || 0,
    fixedGlossaryCount: fixedGlossary?.length || 0,
  });

  const t0 = Date.now();

  const ac = new AbortController();
  let headersTimer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  const onExternalAbort = () => ac.abort();
  if (signal?.aborted) ac.abort();
  else signal?.addEventListener('abort', onExternalAbort);

  try {
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    clearTimeout(headersTimer);
    headersTimer = null;
  } catch (err) {
    if (headersTimer) clearTimeout(headersTimer);
    if (signal?.aborted) {
      throw new Error('streaming aborted');
    }
    if (err?.name === 'AbortError') {
      throw new Error(`streaming fetch timeout (${FETCH_TIMEOUT_MS}ms)`);
    }
    throw err;
  }

  if (!resp.ok) {
    let errText = '';
    try { errText = await resp.text(); } catch (_) {}
    await debugLog('error', 'api', 'gemini stream HTTP error', { status: resp.status, error: errText.slice(0, 200) });
    throw new Error(`Gemini API HTTP ${resp.status}${errText ? ': ' + errText.slice(0, 200) : ''}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let allText = '';
  let firstChunkFired = false;
  let segmentsEmitted = 0;
  let lastUsage = emptyUsage();
  let finishReason = 'unknown';
  let blockReason = null;

  function tryEmitSegments() {
    if (!callbacks.onSegment) return;
    const allParts = allText.split(SEP_RE);
    const numComplete = allParts.length - 1;
    while (segmentsEmitted < numComplete && segmentsEmitted < texts.length) {
      const segText = allParts[segmentsEmitted].trim().replace(MARKER_COMPACT.re, '');
      callbacks.onSegment(segmentsEmitted, segText, false);
      segmentsEmitted++;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!firstChunkFired) {
        firstChunkFired = true;
        try { callbacks.onFirstChunk?.(); } catch (_) {   }
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const m = buffer.match(/\r?\n\r?\n/);
        if (!m) break;
        const eventBlock = buffer.slice(0, m.index);
        buffer = buffer.slice(m.index + m[0].length);
        if (!eventBlock.startsWith('data: ')) continue;
        const dataStr = eventBlock.slice(6);

        let json;
        try {
          json = JSON.parse(dataStr);
        } catch (_) {
          continue;
        }

        const candidate = json?.candidates?.[0];
        const partText = candidate?.content?.parts?.[0]?.text || '';
        const fr = candidate?.finishReason;
        if (fr) finishReason = fr;
        if (json?.promptFeedback?.blockReason) blockReason = json.promptFeedback.blockReason;

        if (partText) {
          allText += partText;
          tryEmitSegments();
        }

        const meta = json?.usageMetadata;
        if (meta) {
          lastUsage = parseGeminiUsage(meta);
        }
      }
    }
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') {
      const abortErr = new Error('streaming aborted');
      abortErr.usage = lastUsage;
      throw abortErr;
    }
    if (err && typeof err === 'object' && !err.usage) err.usage = lastUsage;
    throw err;
  } finally {
    try { reader.releaseLock?.(); } catch (_) {}
  }

  const elapsed = Date.now() - t0;

  if (callbacks.onSegment) {
    const allParts = allText.split(SEP_RE);
    while (segmentsEmitted < allParts.length && segmentsEmitted < texts.length) {
      const segText = allParts[segmentsEmitted].trim().replace(MARKER_COMPACT.re, '');
      callbacks.onSegment(segmentsEmitted, segText, false);
      segmentsEmitted++;
    }
  }

  await debugLog('info', 'api', 'gemini stream response', {
    elapsed, segments: texts.length, segmentsEmitted,
    inputTokens: lastUsage.inputTokens,
    outputTokens: lastUsage.outputTokens,
    thoughtsTokens: lastUsage.thoughtsTokens,
    cachedTokens: lastUsage.cachedTokens,
    finishReason,
    outputPreview: allText.slice(0, 300),
  });

  if (blockReason) {
    const err = codedError('blocked', { reason: blockReason },
      `Gemini 拒絕處理此請求(promptFeedback.blockReason: ${blockReason})`);
    err.usage = lastUsage;
    throw err;
  }

  if (allText.length === 0) {
    throw emptyContentError(finishReason, lastUsage);
  }

  let translations = allText.split(SEP_RE).map(s => s.trim().replace(MARKER_COMPACT.re, ''));
  let hadMismatch = translations.length !== texts.length;

  if (hadMismatch) {
    const realigned = realignByMarkers(allText, texts.length, MARKER_COMPACT);
    if (realigned) {
      await debugLog('info', 'api', 'gemini stream segment mismatch — realigned via seq markers', {
        expected: texts.length, got: translations.length, elapsed,
      });
      if (callbacks.onSegment) {
        for (let i = 0; i < realigned.length; i++) {
          if (i >= segmentsEmitted || realigned[i] !== translations[i]) {
            callbacks.onSegment(i, realigned[i], false);
          }
        }
      }
      translations = realigned;
      hadMismatch = false;
    } else {
      await debugLog('warn', 'api', 'gemini stream segment mismatch', {
        expected: texts.length, got: translations.length, elapsed,
      });
    }
  }

  if (!hadMismatch && texts.length > 1 && detectOutputLangMismatch(translations, settings.targetLanguage)) {
    await debugLog('warn', 'api', 'gemini stream output language mismatch — flag hadMismatch for retry', {
      segments: texts.length, elapsed, targetLanguage: settings.targetLanguage,
    });
    hadMismatch = true;
  }

  return {
    translations,
    usage: lastUsage,
    hadMismatch,
    finishReason,
  };
  } finally {
    if (headersTimer) clearTimeout(headersTimer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
