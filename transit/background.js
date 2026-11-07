import { browser } from './lib/compat.js';
import { translateBatch, extractGlossary, extractTermRenderings, translateBatchStream } from './lib/gemini.js';
import { translateBatch as translateBatchCustom, extractGlossary as extractGlossaryCustom } from './lib/openai-compat.js';
import { translateGoogleBatch } from './lib/google-translate.js';
import { getSettingsCached, setSettings, DEFAULT_SUBTITLE_SYSTEM_PROMPT, DEFAULT_ASR_SUBTITLE_SYSTEM_PROMPT, DEFAULT_DOC_SYSTEM_PROMPT, DOC_INLINE_MARKER_INSTRUCTION, getEffectiveSystemPrompt, getEffectiveSubtitleSystemPrompt, getEffectiveAsrSubtitleSystemPrompt, getEffectiveDocSystemPrompt, getEffectiveGlossaryPrompt, LANG_LABELS, isPromptUnchangedFromAnyTargetDefault, DEFAULT_SETTINGS, resolveTranslateChain, migrateTranslateEnginesIfNeeded } from './lib/storage.js';
import { debugLog, getLogs, clearLogs, getPersistedLogs, getAnomalyLogs, clearPersistedLogs } from './lib/logger.js';
import * as cache from './lib/cache.js';
import * as usageDB from './lib/usage-db.js';
import { getPricingForModel } from './lib/model-pricing.js';
import { detectForbiddenTermLeaks } from './lib/forbidden-terms.js';
import { filterEchoPairsForCache } from './lib/system-instruction.js';
import { checkForUpdate, markUpdateNoticeShown, localTodayKey } from './lib/update-check.js';
import { maybeWriteWelcomeNotice } from './lib/welcome-notice.js';
import { refreshExchangeRate, getCachedRate, isCacheFresh } from './lib/exchange-rate.js';
import { codedError } from './lib/bg-error.js';
import { computeBilling, geminiCachedRate, resolveCustomProviderCachedRate, customProviderPricing } from './lib/billing.js';
import { createTranslatePipeline } from './lib/translate-pipeline.js';
import { planStreamingPartialReuse } from './lib/stream-reuse.js';
import { convertZhBatch, ZH_CONVERT_DIRECTIONS } from './lib/zh-convert.js';
import './lib/domain-utils.js';
import './lib/i18n.js';

debugLog('info', 'system', 'service worker started', { version: browser.runtime.getManifest().version });

(async () => {
  const currentVersion = browser.runtime.getManifest().version;
  const result = await cache.checkVersionAndClear(currentVersion);
  if (result.changed) {
    debugLog('info', 'cache', 'version mark updated (cache preserved across version changes)', {
      oldVersion: result.oldVersion ?? '?',
      newVersion: currentVersion,
    });
  } else {
    debugLog('info', 'cache', 'cache up-to-date', { version: currentVersion });
  }
})();

checkForUpdate().catch(err => debugLog('warn', 'update-check', 'initial check failed', { error: err.message }));

browser.runtime.onStartup?.addListener(() => {
  checkForUpdate().catch(err => debugLog('warn', 'update-check', 'onStartup check failed', { error: err.message }));
});

const _alarmHandlers = Object.create(null);
function _registerAlarm(name, handler) { _alarmHandlers[name] = handler; }
try {
  browser.alarms?.onAlarm.addListener((alarm) => {
    const handler = alarm && _alarmHandlers[alarm.name];
    if (handler) handler(alarm);
  });
} catch (_) {   }

browser.alarms?.create('update-check', { periodInMinutes: 60 * 24 });
_registerAlarm('update-check', () => {
  checkForUpdate().catch(err => debugLog('warn', 'update-check', 'alarm check failed', { error: err.message }));
});

isCacheFresh().then(fresh => {
  if (!fresh) {
    refreshExchangeRate().catch(err => debugLog('warn', 'exchange-rate', 'initial fetch failed', { error: err.message }));
  }
});

browser.runtime.onStartup?.addListener(() => {
  refreshExchangeRate().catch(err => debugLog('warn', 'exchange-rate', 'onStartup fetch failed', { error: err.message }));
});

browser.alarms?.create('exchange-rate-fetch', { periodInMinutes: 60 * 24 });
_registerAlarm('exchange-rate-fetch', () => {
  refreshExchangeRate().catch(err => debugLog('warn', 'exchange-rate', 'alarm fetch failed', { error: err.message }));
});

function buildFixedGlossaryEntries(fixedGlossary, sender) {
  if (!fixedGlossary) return null;
  const globalEntries = Array.isArray(fixedGlossary.global)
    ? fixedGlossary.global.filter((e) => e.source && e.target)
    : [];
  let domainEntries = [];
  if (fixedGlossary.byDomain && sender?.tab?.url) {
    try {
      const pageUrl = new URL(sender.tab.url);
      const keys = globalThis.__SKDomain.matchingDomainKeys(pageUrl.hostname, fixedGlossary.byDomain, pageUrl.pathname);
      for (const key of keys) {
        const entries = Array.isArray(fixedGlossary.byDomain[key])
          ? fixedGlossary.byDomain[key].filter((e) => e.source && e.target)
          : [];
        domainEntries.push(...entries);
      }
    } catch {   }
  }
  if (globalEntries.length === 0 && domainEntries.length === 0) return null;
  const merged = new Map();
  for (const entry of globalEntries) merged.set(entry.source, entry.target);
  for (const entry of domainEntries) merged.set(entry.source, entry.target);
  return [...merged.entries()].map(([source, target]) => ({ source, target }));
}

function preferArticleGlossaryEntries(fixedGlossaryEntries, articleGlossary, enabled) {
  if (!enabled
      || !Array.isArray(articleGlossary) || articleGlossary.length === 0
      || !Array.isArray(fixedGlossaryEntries) || fixedGlossaryEntries.length === 0) {
    return fixedGlossaryEntries;
  }
  const articleSources = new Set(articleGlossary.map((entry) => entry.source));
  const filtered = fixedGlossaryEntries.filter((entry) => !articleSources.has(entry.source));
  return filtered.length > 0 ? filtered : null;
}

async function buildCacheKeySuffix({
  cacheTag = '',
  glossary = null,
  fixedGlossaryEntries = null,
  forbiddenTermsList = [],
  modelKeyPart = 'unknown',
  targetLanguage = '',
  temperature = undefined,
  temperatureDefault = undefined,
  docExtraPrompt = '',
  customPrompt = '',
}) {
  let suffix = cacheTag;
  const allGlossaryForHash = [
    ...(glossary || []).map((e) => `${e.source}:${e.target}`),
    ...(fixedGlossaryEntries || []).map((e) => `F:${e.source}:${e.target}`),
  ];
  if (allGlossaryForHash.length > 0) {
    const fullHash = await cache.hashText(allGlossaryForHash.join('|'));
    suffix += '_g' + fullHash.slice(0, 12);
  }
  const forbiddenHash = await cache.hashForbiddenTerms(forbiddenTermsList);
  if (forbiddenHash) {
    suffix += '_b' + forbiddenHash;
  }
  suffix += '_m' + modelKeyPart;
  if (targetLanguage && targetLanguage !== 'zh-TW') {
    suffix += '_lang' + targetLanguage.replace(/[^a-z0-9]/gi, '');
  }
  if (typeof temperature === 'number' && Number.isFinite(temperature)
      && !(typeof temperatureDefault === 'number' && temperature === temperatureDefault)) {
    suffix += '_t' + temperature.toFixed(2);
  }
  if (typeof docExtraPrompt === 'string' && docExtraPrompt.trim()) {
    suffix += '_x' + (await cache.hashText(docExtraPrompt.trim())).slice(0, 12);
  }
  if (typeof customPrompt === 'string' && customPrompt.trim()) {
    suffix += '_p' + (await cache.hashText(customPrompt.trim())).slice(0, 8);
  }
  return suffix;
}

function customPromptForKey(saved, getEffectiveFn) {
  if (typeof saved !== 'string' || !saved.trim()) return '';
  return isPromptUnchangedFromAnyTargetDefault(saved, getEffectiveFn) ? '' : saved.trim();
}

async function customProviderModelKeyPart(cp) {
  const baseUrlHash = (await cache.hashText(cp.baseUrl)).slice(0, 6);
  const safeModel = String(cp.model).replace(/[^a-z0-9.\-]/gi, '_');
  let part = `${baseUrlHash}_${safeModel}`;
  const level = typeof cp.thinkingLevel === 'string' ? cp.thinkingLevel : '';
  if (level && level !== 'off') part += '_th' + level.replace(/[^a-z0-9]/gi, '');
  const extra = typeof cp.extraBodyJson === 'string' ? cp.extraBodyJson.trim() : '';
  if (extra) part += '_xb' + (await cache.hashText(extra)).slice(0, 8);
  return part;
}

async function logWebBatchUsage({ sender, engine, model, usage, billedInputTokens, billedCostUSD, segments, cacheHits }) {
  try {
    await usageDB.upsertPageUsage({
      url: sender?.tab?.url || '',
      title: sender?.tab?.title || '',
      engine,
      model: model || 'unknown',
      inputTokens: usage?.inputTokens || 0,
      outputTokens: usage?.outputTokens || 0,
      cachedTokens: usage?.cachedTokens || 0,
      billedInputTokens: billedInputTokens || 0,
      billedCostUSD: billedCostUSD || 0,
      segments: segments || 0,
      cacheHits: cacheHits || 0,
      durationMs: 0,
      timestamp: Date.now(),
    });
    return true;
  } catch (err) {
    debugLog('warn', 'api', 'web batch usage log failed — content will fall back to LOG_USAGE', { error: err?.message || String(err) });
    return false;
  }
}

const pipeline = createTranslatePipeline({
  cache, usageDB, debugLog, detectForbiddenTermLeaks, filterEchoPairsForCache,
  buildFixedGlossaryEntries, preferArticleGlossaryEntries, mergeExtraForbiddenTerms,
  buildCacheKeySuffix, logWebBatchUsage,
});

function docExtraPromptOf(payload) {
  const p = payload?.extraPrompt;
  return (typeof p === 'string') ? p.trim() : '';
}

const BADGE_COLOR = '#cf3a2c';
const BADGE_TEXT = '●';

async function setTranslatedBadge(tabId) {
  if (tabId == null) return;
  try {
    await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId });
    if (browser.action.setBadgeTextColor) {
      await browser.action.setBadgeTextColor({ color: '#ffffff', tabId });
    }
    await browser.action.setBadgeText({ text: BADGE_TEXT, tabId });
  } catch (err) {
    debugLog('warn', 'system', 'setBadge failed', { error: err.message });
  }
}

async function clearTranslatedBadge(tabId) {
  if (tabId == null) return;
  try {
    await browser.action.setBadgeText({ text: '', tabId });
  } catch (err) {
    debugLog('warn', 'system', 'clearBadge failed', { error: err.message });
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    clearTranslatedBadge(tabId);
  }
});

const stickyTabs = new Map();
let _stickyHydratingPromise = null;

const _stickyStorage = (browser.storage && browser.storage.session) ?? browser.storage.local;

function hydrateStickyTabs() {
  if (_stickyHydratingPromise) return _stickyHydratingPromise;
  _stickyHydratingPromise = (async () => {
    try {
      const { stickyTabs: saved } = await _stickyStorage.get('stickyTabs');
      if (saved && typeof saved === 'object') {
        for (const [tabId, slot] of Object.entries(saved)) {
          if (typeof slot === 'number') stickyTabs.set(Number(tabId), slot);
        }
      }
    } catch (err) {
      debugLog('warn', 'system', 'hydrateStickyTabs failed', { error: err.message });
    }
  })();
  return _stickyHydratingPromise;
}

async function persistStickyTabs() {
  try {
    const obj = {};
    stickyTabs.forEach((slot, tabId) => { obj[tabId] = slot; });
    await _stickyStorage.set({ stickyTabs: obj });
  } catch (err) {
    debugLog('warn', 'system', 'persistStickyTabs failed', { error: err.message });
  }
}

if (browser.webNavigation && browser.webNavigation.onCreatedNavigationTarget) {
  browser.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
    await hydrateStickyTabs();
    const sourceTabId = details.sourceTabId;
    const newTabId = details.tabId;
    if (sourceTabId == null || newTabId == null) return;
    const slot = stickyTabs.get(sourceTabId);
    if (slot == null) return;
    stickyTabs.set(newTabId, slot);
    await persistStickyTabs();
    debugLog('info', 'system', 'sticky inherited from link-opened new tab', {
      newTabId, sourceTabId, slot, url: details.url,
    });
  });
} else {
  debugLog('warn', 'system', 'webNavigation.onCreatedNavigationTarget unavailable, cross-tab sticky disabled', {});
}

browser.tabs.onRemoved.addListener(async (tabId) => {
  await hydrateStickyTabs();
  if (!stickyTabs.has(tabId)) return;
  stickyTabs.delete(tabId);
  await persistStickyTabs();
});

async function _handleAsrSubtitleBatch(payload, sender, cacheTag, namespace) {
  const _tReceived = Date.now();
  const s = await getSettingsCached();
  const _settingsMs = Date.now() - _tReceived;
  debugLog('info', namespace, 'asr subtitle batch received', {
    inputBytes: payload?.texts?.[0]?.length || 0,
    settingsMs: _settingsMs,
  });
  const yt = s.ytSubtitle || {};
  const geminiOverrides = {
    systemInstruction: getEffectiveAsrSubtitleSystemPrompt(s.targetLanguage, payload?.sourceLanguage || 'en'),
    temperature: yt.temperature ?? 0.1,
  };
  if (yt.model) geminiOverrides.model = yt.model;
  const pricingOverride = (yt.pricing && yt.pricing.inputPerMTok != null) ? yt.pricing : null;
  return handleTranslate(payload, sender, geminiOverrides, pricingOverride, cacheTag,
    false, false,
    { temperatureDefault: DEFAULT_SETTINGS.ytSubtitle.temperature });
}

const DOC_FETCH_TIMEOUT_MS = 120_000;

const messageHandlers = {
  RELOAD_EXTENSION: {
    async: false,
    handler: () => {
      setTimeout(() => { try { browser.runtime.reload(); } catch (_) {} }, 50);
      return { ok: true, reloading: true };
    },
  },
  CONVERT_ZH_LOCAL: {
    async: true,
    handler: async (payload) => {
      const texts = Array.isArray(payload?.texts) ? payload.texts : [];
      const direction = payload?.direction;
      if (!ZH_CONVERT_DIRECTIONS.includes(direction)) {
        throw new Error(`CONVERT_ZH_LOCAL: unknown direction ${direction}`);
      }
      if (texts.length === 0) return { result: [] };
      const t0 = Date.now();
      const result = await convertZhBatch(texts, direction);
      debugLog('info', 'translate', 'CONVERT_ZH_LOCAL done', {
        count: texts.length, direction, elapsed: Date.now() - t0,
      });
      return { result };
    },
  },
  TRANSLATE_BATCH: {
    async: true,
    handler: (payload, sender) => {
      const overrides = payload?.modelOverride ? { model: payload.modelOverride } : {};
      return handleTranslate(payload, sender, overrides);
    },
  },
  TRANSLATE_BATCH_STREAM: {
    async: false,
    handler: (payload, sender) => {
      const tabId = sender?.tab?.id;
      if (!tabId) return { ok: false, error: 'no tab' };
      const streamId = payload?.streamId;
      if (!streamId) return { ok: false, error: 'no streamId' };
      handleTranslateStream(payload, sender, streamId, tabId).catch((err) => {
        debugLog('error', 'system', 'TRANSLATE_BATCH_STREAM uncaught', { streamId, error: err?.message || String(err) });
        browser.tabs.sendMessage(tabId, {
          type: 'STREAMING_ERROR',
          payload: { streamId, ...errorFields(err), atSegment: 0 },
        }).catch(() => {});
      });
      return { started: true };
    },
  },
  TRANSLATE_SUBTITLE_BATCH_STREAM: {
    async: false,
    handler: (payload, sender) => {
      const tabId = sender?.tab?.id;
      if (!tabId) return { ok: false, error: 'no tab' };
      const streamId = payload?.streamId;
      if (!streamId) return { ok: false, error: 'no streamId' };
      (async () => {
        const s = await getSettingsCached();
        const yt = s.ytSubtitle || {};
        const geminiOverrides = {
          systemInstruction: getEffectiveSubtitleSystemPrompt(s.targetLanguage, yt.systemPrompt),
          temperature: yt.temperature ?? 0.1,
        };
        if (yt.model) geminiOverrides.model = yt.model;
        const pricingOverride = (yt.pricing && yt.pricing.inputPerMTok != null) ? yt.pricing : null;
        await handleTranslateStream(payload, sender, streamId, tabId, {
          cacheTag: '_yt',
          geminiOverrides,
          pricingOverride,
          applyFixedGlossary: yt.applyFixedGlossary === true,
          applyForbiddenTerms: yt.applyForbiddenTerms === true,
          customPrompt: customPromptForKey(yt.systemPrompt, getEffectiveSubtitleSystemPrompt),
          temperatureDefault: DEFAULT_SETTINGS.ytSubtitle.temperature,
        });
      })().catch((err) => {
        debugLog('error', 'system', 'TRANSLATE_SUBTITLE_BATCH_STREAM uncaught', { streamId, error: err?.message || String(err) });
        browser.tabs.sendMessage(tabId, {
          type: 'STREAMING_ERROR',
          payload: { streamId, ...errorFields(err), atSegment: 0 },
        }).catch(() => {});
      });
      return { started: true };
    },
  },
  STREAMING_ABORT: {
    async: false,
    handler: (payload) => {
      const streamId = payload?.streamId;
      if (!streamId) return { aborted: false };
      const ac = inFlightStreams.get(streamId);
      if (ac) {
        try { ac.abort(); } catch (_) {   }
        inFlightStreams.delete(streamId);
        return { aborted: true };
      }
      _sweepAbortTombstones();
      abortedStreamTombstones.set(streamId, Date.now() + ABORT_TOMBSTONE_TTL_MS);
      return { aborted: false, tombstoned: true };
    },
  },
  TRANSLATE_SUBTITLE_BATCH: {
    async: true,
    handler: async (payload, sender) => {
      const _tReceived = Date.now();
      const s = await getSettingsCached();
      const _settingsMs = Date.now() - _tReceived;
      debugLog('info', 'youtube', 'subtitle batch received', {
        count: payload?.texts?.length || 0,
        settingsMs: _settingsMs,
      });
      const yt = s.ytSubtitle || {};
      const geminiOverrides = {
        systemInstruction: getEffectiveSubtitleSystemPrompt(s.targetLanguage, yt.systemPrompt),
        temperature: yt.temperature ?? 0.1,
      };
      if (yt.model) geminiOverrides.model = yt.model;
      const pricingOverride = (yt.pricing && yt.pricing.inputPerMTok != null) ? yt.pricing : null;
      return handleTranslate(payload, sender, geminiOverrides, pricingOverride, '_yt',
        yt.applyFixedGlossary === true,
        yt.applyForbiddenTerms === true,
        {
          customPrompt: customPromptForKey(yt.systemPrompt, getEffectiveSubtitleSystemPrompt),
          temperatureDefault: DEFAULT_SETTINGS.ytSubtitle.temperature,
        });
    },
  },
  TRANSLATE_ASR_SUBTITLE_BATCH: {
    async: true,
    handler: (payload, sender) => _handleAsrSubtitleBatch(payload, sender, '_yt_asr', 'youtube'),
  },
  TRANSLATE_DRIVE_ASR_SUBTITLE_BATCH: {
    async: true,
    handler: (payload, sender) => _handleAsrSubtitleBatch(payload, sender, '_drive_yt_asr', 'drive'),
  },
  TRANSLATE_X_ASR_SUBTITLE_BATCH: {
    async: true,
    handler: (payload, sender) => _handleAsrSubtitleBatch(payload, sender, '_x_asr', 'x'),
  },
  DRIVE_TIMEDTEXT_URL: {
    async: true,
    handler: async (payload, sender) => {
      const url = payload?.url;
      if (!url || !sender?.tab?.id) return { ok: false, error: 'invalid payload' };
      debugLog('info', 'drive', 'timedtext url received from iframe', {
        tabId: sender.tab.id,
        frameId: sender.frameId,
        url: url.slice(0, 200),
      });
      try {
        const res = await fetchWithTimeout(url, { credentials: 'omit' }, 15000);
        if (!res.ok) {
          debugLog('warn', 'drive', 'timedtext fetch failed', { status: res.status });
          return { ok: false, error: `http ${res.status}` };
        }
        const json3 = await res.json();
        debugLog('info', 'drive', 'timedtext fetched', {
          eventCount: Array.isArray(json3?.events) ? json3.events.length : 0,
        });
        try {
          await browser.tabs.sendMessage(
            sender.tab.id,
            { type: 'DRIVE_ASR_CAPTIONS', payload: { url, json3 } },
            { frameId: 0 },
          );
        } catch (e) {
          debugLog('info', 'drive', 'top frame relay no listener', {
            error: e?.message || String(e),
          });
        }
        return { ok: true };
      } catch (e) {
        debugLog('warn', 'drive', 'timedtext handler error', { error: e?.message || String(e) });
        return { ok: false, error: e?.message || String(e) };
      }
    },
  },
  TRANSLATE_BATCH_GOOGLE: {
    async: true,
    handler: (payload, sender) => handleTranslateGoogle(payload, sender, '_gt'),
  },
  TRANSLATE_DOC_BATCH: {
    async: true,
    handler: async (payload, sender) => {
      const s = await getSettingsCached();
      const td = s.translateDoc || {};
      const userPrompt = getEffectiveDocSystemPrompt(s.targetLanguage, td.systemPrompt);
      const extraPrompt = docExtraPromptOf(payload);
      const effectivePrompt = userPrompt
        + (extraPrompt ? '\n\n' + extraPrompt : '')
        + DOC_INLINE_MARKER_INSTRUCTION;
      const overrides = { systemInstruction: effectivePrompt };
      overrides.fetchTimeoutMs = DOC_FETCH_TIMEOUT_MS;
      overrides.timeoutRetries = 1;
      if (typeof td.temperature === 'number' && Number.isFinite(td.temperature)) {
        overrides.temperature = td.temperature;
      }
      if (payload?.modelOverride) overrides.model = payload.modelOverride;
      const applyFixedGlossary = td.applyFixedGlossary !== false;
      return _withDocBatchKeepAlive(() =>
        handleTranslate(payload, sender, overrides, null, '_doc', applyFixedGlossary, true,
          { customPrompt: customPromptForKey(td.systemPrompt, getEffectiveDocSystemPrompt) }));
    },
  },
  TRANSLATE_DOC_BATCH_CUSTOM: {
    async: true,
    handler: async (payload, sender) => {
      const s = await getSettingsCached();
      const td = s.translateDoc || {};
      const userPrompt = getEffectiveDocSystemPrompt(s.targetLanguage, td.systemPrompt);
      const extraPrompt = docExtraPromptOf(payload);
      const effectivePrompt = userPrompt
        + (extraPrompt ? '\n\n' + extraPrompt : '')
        + DOC_INLINE_MARKER_INSTRUCTION;
      const overrides = { systemPrompt: effectivePrompt };
      const userTimeoutSec = s.customProvider?.fetchTimeoutSec;
      overrides.fetchTimeoutSec = Math.max(
        DOC_FETCH_TIMEOUT_MS / 1000,
        (typeof userTimeoutSec === 'number' && userTimeoutSec > 0) ? userTimeoutSec : 0,
      );
      if (typeof td.temperature === 'number' && Number.isFinite(td.temperature)) {
        overrides.temperature = td.temperature;
      }
      const applyFixedGlossary = td.applyFixedGlossary !== false;
      return _withDocBatchKeepAlive(() =>
        handleTranslateCustom(payload, sender, '_oc_doc', overrides, applyFixedGlossary, true,
          { customPrompt: customPromptForKey(td.systemPrompt, getEffectiveDocSystemPrompt) }));
    },
  },
  TRANSLATE_DRIVE_BATCH_GOOGLE: {
    async: true,
    handler: (payload, sender) => handleTranslateGoogle(payload, sender, '_gt_drive'),
  },
  TRANSLATE_X_BATCH_GOOGLE: {
    async: true,
    handler: (payload, sender) => handleTranslateGoogle(payload, sender, '_gt_x'),
  },
  TRANSLATE_BATCH_CUSTOM: {
    async: true,
    handler: (payload, sender) => handleTranslateCustom(payload, sender, '_oc'),
  },
  TRANSLATE_SUBTITLE_BATCH_CUSTOM: {
    async: true,
    handler: async (payload, sender) => {
      const s = await getSettingsCached();
      const yt = s.ytSubtitle || {};
      const overrides = { systemPrompt: getEffectiveSubtitleSystemPrompt(s.targetLanguage, yt.systemPrompt) };
      return handleTranslateCustom(payload, sender, '_oc_yt', overrides,
        yt.applyFixedGlossary === true,
        yt.applyForbiddenTerms === true,
        { customPrompt: customPromptForKey(yt.systemPrompt, getEffectiveSubtitleSystemPrompt) });
    },
  },
  TRANSLATE_ASR_SUBTITLE_BATCH_CUSTOM: {
    async: true,
    handler: async (payload, sender) => {
      const s = await getSettingsCached();
      const yt = s.ytSubtitle || {};
      const overrides = {
        systemPrompt: getEffectiveAsrSubtitleSystemPrompt(s.targetLanguage, payload?.sourceLanguage || 'en'),
        temperature: yt.temperature ?? 0.1,
      };
      return handleTranslateCustom(payload, sender, '_oc_yt_asr', overrides, false, false,
        { temperatureDefault: DEFAULT_SETTINGS.ytSubtitle.temperature });
    },
  },
  TRANSLATE_DRIVE_ASR_SUBTITLE_BATCH_CUSTOM: {
    async: true,
    handler: async (payload, sender) => {
      const s = await getSettingsCached();
      const yt = s.ytSubtitle || {};
      const overrides = {
        systemPrompt: getEffectiveAsrSubtitleSystemPrompt(s.targetLanguage, payload?.sourceLanguage || 'en'),
        temperature: yt.temperature ?? 0.1,
      };
      return handleTranslateCustom(payload, sender, '_oc_drive_yt_asr', overrides, false, false,
        { temperatureDefault: DEFAULT_SETTINGS.ytSubtitle.temperature });
    },
  },
  TRANSLATE_X_ASR_SUBTITLE_BATCH_CUSTOM: {
    async: true,
    handler: async (payload, sender) => {
      const s = await getSettingsCached();
      const yt = s.ytSubtitle || {};
      const overrides = {
        systemPrompt: getEffectiveAsrSubtitleSystemPrompt(s.targetLanguage, payload?.sourceLanguage || 'en'),
        temperature: yt.temperature ?? 0.1,
      };
      return handleTranslateCustom(payload, sender, '_oc_x_asr', overrides, false, false,
        { temperatureDefault: DEFAULT_SETTINGS.ytSubtitle.temperature });
    },
  },
  UPDATE_NOTICE_DISMISSED: {
    async: true,
    handler: () => markUpdateNoticeShown(),
  },
  WELCOME_NOTICE_DISMISSED: {
    async: true,
    handler: async () => {
      const { welcomeNotice } = await browser.storage.local.get('welcomeNotice');
      if (!welcomeNotice) return;
      await browser.storage.local.set({
        welcomeNotice: { ...welcomeNotice, dismissed: true },
      });
    },
  },
  WELCOME_NOTICE_TOAST_SHOWN: {
    async: true,
    handler: async () => {
      const { welcomeNotice } = await browser.storage.local.get('welcomeNotice');
      if (!welcomeNotice) return;
      await browser.storage.local.set({
        welcomeNotice: { ...welcomeNotice, lastNoticeShownDate: localTodayKey() },
      });
    },
  },
  TEST_GEMINI_KEY: {
    async: true,
    handler: (payload) => testGeminiKey(payload),
  },
  TEST_CUSTOM_PROVIDER: {
    async: true,
    handler: (payload) => testCustomProvider(payload),
  },
  TRANSLATE_SUBTITLE_BATCH_GOOGLE: {
    async: true,
    handler: (payload, sender) => handleTranslateGoogle(payload, sender, '_gt_yt'),
  },
  EXTRACT_GLOSSARY: {
    async: true,
    handler: (payload, sender) => handleExtractGlossary(payload, sender),
  },
  EXTRACT_GLOSSARY_CUSTOM: {
    async: true,
    handler: (payload, sender) => handleExtractGlossaryCustomProvider(payload, sender),
  },
  SCAN_TERM_RENDERINGS: {
    async: true,
    handler: (payload, sender) => handleScanTermRenderings(payload, sender),
  },
  CLEAR_CACHE: {
    async: true,
    handler: () => cache.clearAll().then(async (removed) => {
      try {
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
          if (!tab.id) continue;
          browser.tabs.sendMessage(tab.id, { type: 'YT_RESET_AFTER_CACHE_CLEAR' })
            .catch(() => {});
        }
      } catch (_) {}
      return { removed };
    }),
  },
  CACHE_STATS: {
    async: true,
    handler: () => cache.stats(),
  },
  SET_BADGE_TRANSLATED: {
    async: true,
    handler: (_, sender) => setTranslatedBadge(sender?.tab?.id),
  },
  CLEAR_BADGE: {
    async: true,
    handler: (_, sender) => clearTranslatedBadge(sender?.tab?.id),
  },
  GET_TRANSLATE_CHAIN: {
    async: true,
    handler: async () => {
      const settings = await getSettingsCached();
      return { ok: true, chain: resolveTranslateChain(settings) };
    },
  },
  STICKY_QUERY: {
    async: true,
    handler: async (_, sender) => {
      await hydrateStickyTabs();
      const tabId = sender?.tab?.id;
      if (tabId == null) return { ok: true, shouldTranslate: false };
      const slot = stickyTabs.get(tabId);
      return { ok: true, shouldTranslate: slot != null, slot: slot ?? null };
    },
  },
  STICKY_SET: {
    async: true,
    handler: async (payload, sender) => {
      await hydrateStickyTabs();
      const tabId = sender?.tab?.id;
      if (tabId == null) return { ok: false, error: 'no tab id' };
      const slot = Number(payload?.slot);
      if (!Number.isInteger(slot) || slot < 1) return { ok: false, error: 'invalid slot' };
      stickyTabs.set(tabId, slot);
      await persistStickyTabs();
      return { ok: true };
    },
  },
  STICKY_CLEAR: {
    async: true,
    handler: async (_, sender) => {
      await hydrateStickyTabs();
      const tabId = sender?.tab?.id;
      if (tabId == null) return { ok: false };
      stickyTabs.delete(tabId);
      await persistStickyTabs();
      return { ok: true };
    },
  },
  LOG: {
    async: false,
    handler: (payload, sender) => {
      const { level, category, message: msg, data } = payload || {};
      const enrichedData = { ...data, _tab: sender?.tab?.url || sender?.url };
      debugLog(level || 'info', category || 'system', msg || '', enrichedData);
    },
  },
  GET_LOGS: {
    async: false,
    handler: (payload) => getLogs(payload?.afterSeq || 0),
  },
  CLEAR_LOGS: {
    async: false,
    handler: () => { clearLogs(); },
  },
  GET_PERSISTED_LOGS: {
    async: true,
    handler: async () => {
      const logs = await getPersistedLogs();
      const anomalies = await getAnomalyLogs();
      return { logs, count: logs.length, anomalies };
    },
  },
  CLEAR_PERSISTED_LOGS: {
    async: true,
    handler: async () => {
      await clearPersistedLogs();
      return { ok: true };
    },
  },
  OPEN_GDOC_MOBILE: {
    async: true,
    handler: async (payload) => {
      const url = payload?.url;
      if (!url) throw new Error('missing url');
      const tab = await browser.tabs.create({ url });
      debugLog('info', 'system', 'opened Google Docs mobilebasic tab', { url, tabId: tab.id });

      return new Promise((resolve) => {
        let safetyTimer = null;
        const onUpdated = (tabId, changeInfo) => {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            browser.tabs.onUpdated.removeListener(onUpdated);
            if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
            setTimeout(() => {
              browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATE' }).catch(() => {});
            }, 500);
            resolve({ tabId: tab.id });
          }
        };
        browser.tabs.onUpdated.addListener(onUpdated);

        safetyTimer = setTimeout(() => {
          browser.tabs.onUpdated.removeListener(onUpdated);
          resolve({ tabId: tab.id, timeout: true });
        }, 30000);
      });
    },
  },
  LOG_USAGE: {
    async: true,
    handler: async (payload) => {
      const settings = await getSettingsCached();
      let resolvedModel;
      if (payload.engine === 'openai-compat') {
        resolvedModel = settings.customProvider?.model || '<server-default>';
      } else {
        resolvedModel = payload.model || settings.geminiConfig?.model || 'unknown';
      }
      const record = {
        ...payload,
        engine: payload.engine || 'gemini',
        model: resolvedModel,
      };
      if (usageDB.shouldSkipUsageRecord(record)) {
        return;
      }
      if ((record.source === 'youtube-subtitle' || record.source === 'drive-subtitle' || record.source === 'x-subtitle') && record.videoId) {
        await usageDB.upsertYouTubeUsage(record);
      } else {
        await usageDB.logTranslation(record);
      }
    },
  },
  QUERY_USAGE: {
    async: true,
    handler: async (payload) => ({ records: await usageDB.query(payload || {}) }),
  },
  QUERY_USAGE_STATS: {
    async: true,
    handler: async (payload) => ({ stats: await usageDB.getStats(payload || {}) }),
  },
  QUERY_USAGE_CHART: {
    async: true,
    handler: async (payload) => ({ data: await usageDB.getAggregated(payload || {}) }),
  },
  QUERY_USAGE_PAGE: {
    async: true,
    handler: async (payload) => usageDB.queryUsagePage(payload || {}),
  },
  EXPORT_USAGE_CSV: {
    async: true,
    handler: async (payload) => ({ csv: await usageDB.exportCSV(payload || {}) }),
  },
  CLEAR_USAGE: {
    async: true,
    handler: (payload) => {
      return payload?.beforeTimestamp
        ? usageDB.clearBefore(payload.beforeTimestamp)
        : usageDB.clearAll();
    },
  },

  EXCHANGE_RATE_GET: {
    async: true,
    handler: async () => {
      const cached = await getCachedRate();
      return { ok: true, ...cached };
    },
  },
  EXCHANGE_RATE_REFRESH: {
    async: true,
    handler: async () => {
      const fresh = await refreshExchangeRate();
      if (fresh) return { ok: true, ...fresh };
      const cached = await getCachedRate();
      return { ok: false, error: 'fetch failed', ...cached };
    },
  },
};

function errorFields(err) {
  const fields = { error: err?.message || String(err) };
  if (err?.skCode) {
    fields.errorCode = err.skCode;
    if (err.skParams) fields.errorParams = err.skParams;
  }
  return fields;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  const entry = messageHandlers[type];
  if (!entry) return;

  const onError = (err) => {
    debugLog('error', 'system', `${type} failed`, { error: err?.message || String(err) });
    sendResponse({ ok: false, ...errorFields(err) });
  };
  if (entry.async) {
    let p;
    try {
      p = Promise.resolve(entry.handler(message.payload, sender));
    } catch (err) {
      onError(err);
      return false;
    }
    p.then((result) => sendResponse({ ok: true, ...(result && typeof result === 'object' ? result : {}) }))
      .catch(onError);
    return true;
  } else {
    try {
      const result = entry.handler(message.payload, sender);
      sendResponse({ ok: true, ...(result && typeof result === 'object' ? result : {}) });
    } catch (err) {
      onError(err);
    }
    return false;
  }
});

const inFlightStreams = new Map();

const abortedStreamTombstones = new Map();
const ABORT_TOMBSTONE_TTL_MS = 60_000;
function _sweepAbortTombstones() {
  const now = Date.now();
  for (const [id, exp] of abortedStreamTombstones) {
    if (exp <= now) abortedStreamTombstones.delete(id);
  }
}

const _STREAM_KEEPALIVE_ALARM = 'transit-stream-keepalive';
const _STREAM_KEEPALIVE_PERIOD_MIN = 0.5;
function _startStreamKeepAlive() {
  try {
    browser.alarms.create(_STREAM_KEEPALIVE_ALARM, {
      delayInMinutes: _STREAM_KEEPALIVE_PERIOD_MIN,
      periodInMinutes: _STREAM_KEEPALIVE_PERIOD_MIN,
    });
  } catch (_) {   }
}
function _stopStreamKeepAliveIfIdle() {
  if (inFlightStreams.size === 0 && _inFlightDocBatches === 0) {
    try { browser.alarms.clear(_STREAM_KEEPALIVE_ALARM); } catch (_) {}
  }
}
_registerAlarm(_STREAM_KEEPALIVE_ALARM, () => {
  if (inFlightStreams.size === 0 && _inFlightDocBatches === 0) {
    try { browser.alarms.clear(_STREAM_KEEPALIVE_ALARM); } catch (_) {}
  }
});

let _inFlightDocBatches = 0;
async function _withDocBatchKeepAlive(fn) {
  _inFlightDocBatches++;
  _startStreamKeepAlive();
  try {
    return await fn();
  } finally {
    _inFlightDocBatches--;
    _stopStreamKeepAliveIfIdle();
  }
}

function mergeExtraForbiddenTerms(baseList, extras) {
  if (!Array.isArray(extras) || extras.length === 0) return baseList;
  const cleaned = extras.slice(0, 200)
    .filter((e) => e && typeof e.forbidden === 'string' && e.forbidden.trim())
    .map((e) => ({
      forbidden: e.forbidden,
      replacement: typeof e.replacement === 'string' ? e.replacement : '',
    }));
  if (cleaned.length === 0) return baseList;
  return [...baseList, ...cleaned];
}

async function handleTranslateStream(payload, sender, streamId, tabId, opts = {}) {
  const {
    cacheTag = '',
    geminiOverrides = {},
    pricingOverride = null,
    applyFixedGlossary = true,
    applyForbiddenTerms = true,
    customPrompt: customPromptOpt = undefined,
    temperatureDefault: temperatureDefaultOpt = undefined,
  } = opts;

  const settings = await getSettingsCached();
  if (!settings.apiKey) {
    browser.tabs.sendMessage(tabId, {
      type: 'STREAMING_ERROR',
      payload: { streamId, ...errorFields(codedError('apiKeyMissing', null, '尚未設定 Gemini API Key，請至設定頁填入。')), atSegment: 0 },
    }).catch(() => {});
    return;
  }

  const texts = payload?.texts || [];
  if (!texts.length) {
    browser.tabs.sendMessage(tabId, {
      type: 'STREAMING_DONE',
      payload: { streamId, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, billedInputTokens: 0, billedCostUSD: 0 }, totalSegments: 0, hadMismatch: false, finishReason: 'STOP' },
    }).catch(() => {});
    return;
  }

  const overrides = { ...geminiOverrides };
  if (payload?.modelOverride) overrides.model = payload.modelOverride;
  const baseSI = ('systemInstruction' in overrides)
    ? overrides.systemInstruction
    : getEffectiveSystemPrompt(settings.targetLanguage, settings.geminiConfig?.systemInstruction);
  const effectiveSettings = {
    ...settings,
    geminiConfig: { ...settings.geminiConfig, ...overrides, systemInstruction: baseSI },
  };
  let effectivePricing = pricingOverride;
  if (!effectivePricing && overrides.model) effectivePricing = getPricingForModel(overrides.model, settings);
  if (!effectivePricing) effectivePricing = settings.pricing;

  const cachedRate = geminiCachedRate(effectivePricing);
  const logDiscardedStreamUsage = (usage, why, segments) => pipeline.logDiscardedUsage({
    sender, engine: 'gemini', model: effectiveSettings.geminiConfig?.model || 'unknown',
    usage, pricing: effectivePricing, cachedRate, segments, cacheHits: 0, why,
    logLabel: 'streaming', logExtra: { streamId },
  });

  const { glossary, fixedGlossaryEntries, forbiddenTermsList, cacheKeySuffix, cached, cacheHits } = await pipeline.prepareBatch({
    payload, sender, settings, cacheTag, applyFixedGlossary, applyForbiddenTerms,
    logLabel: 'streaming', logExtra: { streamId },
    keyParts: {
      modelKeyPart: (effectiveSettings.geminiConfig?.model || 'unknown').replace(/[^a-z0-9.\-]/gi, '_'),
      targetLanguage: effectiveSettings.targetLanguage,
      customPrompt: ('systemInstruction' in geminiOverrides)
        ? (customPromptOpt || '')
        : customPromptForKey(settings.geminiConfig?.systemInstruction, getEffectiveSystemPrompt),
      temperature: effectiveSettings.geminiConfig?.temperature,
      temperatureDefault: temperatureDefaultOpt ?? DEFAULT_SETTINGS.geminiConfig.temperature,
    },
  });
  const allHit = cached.every((tr) => tr != null);

  if (allHit) {
    inFlightStreams.delete(streamId);
    _stopStreamKeepAliveIfIdle();
    browser.tabs.sendMessage(tabId, { type: 'STREAMING_FIRST_CHUNK', payload: { streamId } }).catch(() => {});
    for (let i = 0; i < cached.length; i++) {
      browser.tabs.sendMessage(tabId, {
        type: 'STREAMING_SEGMENT',
        payload: { streamId, segmentIdx: i, translation: cached[i] },
      }).catch(() => {});
    }
    const fastLogged = (cacheTag === '')
      ? await logWebBatchUsage({
        sender, engine: 'gemini', model: effectiveSettings.geminiConfig?.model,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, billedInputTokens: 0, billedCostUSD: 0,
        segments: 0, cacheHits: texts.length,
      })
      : false;
    browser.tabs.sendMessage(tabId, {
      type: 'STREAMING_DONE',
      payload: {
        streamId,
        usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, billedInputTokens: 0, billedCostUSD: 0, cacheHits: texts.length, logged: fastLogged },
        totalSegments: cached.length,
        hadMismatch: false,
        finishReason: 'STOP',
      },
    }).catch(() => {});
    return;
  }

  _sweepAbortTombstones();
  if (abortedStreamTombstones.has(streamId)) {
    abortedStreamTombstones.delete(streamId);
    debugLog('info', 'api', 'stream aborted before start — tombstone hit, no API call', { streamId });
    browser.tabs.sendMessage(tabId, { type: 'STREAMING_ABORTED', payload: { streamId } }).catch(() => {});
    return;
  }

  const ac = new AbortController();
  inFlightStreams.set(streamId, ac);
  _startStreamKeepAlive();

  let firstChunkSent = false;
  const onFirstChunk = () => {
    if (firstChunkSent) return;
    firstChunkSent = true;
    browser.tabs.sendMessage(tabId, {
      type: 'STREAMING_FIRST_CHUNK',
      payload: { streamId },
    }).catch(() => {});
  };
  const onSegment = (idx, translation, _hadMismatch) => {
    browser.tabs.sendMessage(tabId, {
      type: 'STREAMING_SEGMENT',
      payload: { streamId, segmentIdx: idx, translation },
    }).catch(() => {});
  };

  const { missingIdxs, missingTexts, cachedSegments } = planStreamingPartialReuse(cached, texts);
  debugLog('info', 'cache', 'streaming batch partial reuse', {
    streamId, total: texts.length, reusedFromCache: cacheHits, streamedMissing: missingTexts.length,
  });

  try {
    onFirstChunk();
    for (const seg of cachedSegments) onSegment(seg.idx, seg.translation, false);

    const result = await translateBatchStream(
      missingTexts,
      effectiveSettings,
      glossary,
      fixedGlossaryEntries,
      forbiddenTermsList.length > 0 ? forbiddenTermsList : null,
      { onFirstChunk, onSegment: (mIdx, tr, hm) => onSegment(missingIdxs[mIdx], tr, hm) },
      ac.signal,
    );

    if (result.finishReason === 'MAX_TOKENS' && !result.hadMismatch) {
      debugLog('warn', 'api', 'streaming output truncated (MAX_TOKENS) — treat as mismatch, not cached', {
        streamId, segments: missingTexts.length,
      });
      result.hadMismatch = true;
    }

    if (!result.hadMismatch && result.translations && result.translations.length > 0) {
      const written = await pipeline.writeBatchCache({
        missingTexts, fresh: result.translations, cacheKeySuffix,
        targetLanguage: settings.targetLanguage, logLabel: 'streaming',
      });
      if (written > 0) {
        debugLog('info', 'cache', 'streaming batch cache write', { streamId, written });
      }
    }

    const { billedInputTokens, billedCostUSD } = computeBilling(result.usage, effectivePricing, cachedRate);

    if (result.hadMismatch) {
      await logDiscardedStreamUsage(result.usage, 'mismatch-discarded', missingTexts.length);
    }

    const logged = (cacheTag === '' && !result.hadMismatch)
      ? await logWebBatchUsage({
        sender, engine: 'gemini', model: effectiveSettings.geminiConfig?.model,
        usage: result.usage, billedInputTokens, billedCostUSD,
        segments: missingTexts.length, cacheHits,
      })
      : false;

    browser.tabs.sendMessage(tabId, {
      type: 'STREAMING_DONE',
      payload: {
        streamId,
        usage: {
          ...result.usage,
          billedInputTokens,
          billedCostUSD,
          logged,
          cacheHits,
        },
        totalSegments: texts.length,
        hadMismatch: result.hadMismatch,
        finishReason: result.finishReason,
      },
    }).catch(() => {});
  } catch (err) {
    await logDiscardedStreamUsage(err?.usage, ac.signal.aborted ? 'aborted' : 'error', missingTexts.length);
    if (ac.signal.aborted || /aborted/i.test(err?.message || '')) {
      browser.tabs.sendMessage(tabId, {
        type: 'STREAMING_ABORTED',
        payload: { streamId },
      }).catch(() => {});
    } else {
      debugLog('error', 'api', 'streaming translateBatch failed', { streamId, error: err?.message || String(err) });
      browser.tabs.sendMessage(tabId, {
        type: 'STREAMING_ERROR',
        payload: { streamId, ...errorFields(err), atSegment: 0 },
      }).catch(() => {});
    }
  } finally {
    inFlightStreams.delete(streamId);
    _stopStreamKeepAliveIfIdle();
  }
}

async function handleTranslate(payload, sender, geminiOverrides = {}, pricingOverride = null, cacheTag = '', applyFixedGlossary = true, applyForbiddenTerms = true, keyExtras = {}) {
  const settings = await getSettingsCached();
  if (!settings.apiKey) {
    throw codedError('apiKeyMissing', null, '尚未設定 Gemini API Key，請至設定頁填入。');
  }
  const baseSI = ('systemInstruction' in geminiOverrides)
    ? geminiOverrides.systemInstruction
    : getEffectiveSystemPrompt(settings.targetLanguage, settings.geminiConfig?.systemInstruction);
  const effectiveSettings = {
    ...settings,
    geminiConfig: { ...settings.geminiConfig, ...geminiOverrides, systemInstruction: baseSI },
  };
  if (Number.isInteger(payload.docBatchSize) && payload.docBatchSize >= 1 && payload.docBatchSize <= 100) {
    effectiveSettings.maxUnitsPerBatch = payload.docBatchSize;
  }
  let effectivePricing = pricingOverride;
  if (!effectivePricing && geminiOverrides.model) {
    effectivePricing = getPricingForModel(geminiOverrides.model, settings);
  }
  if (!effectivePricing) {
    effectivePricing = settings.pricing;
  }

  return pipeline.runTranslatePipeline({
    payload, sender, settings, cacheTag, applyFixedGlossary, applyForbiddenTerms,
    engine: 'gemini',
    modelLabel: effectiveSettings.geminiConfig?.model || 'unknown',
    pricing: effectivePricing,
    cachedRate: geminiCachedRate(effectivePricing),
    isWebPath: cacheTag === '',
    logLabel: 'gemini',
    keyParts: {
      modelKeyPart: (effectiveSettings.geminiConfig?.model || 'unknown').replace(/[^a-z0-9.\-]/gi, '_'),
      targetLanguage: effectiveSettings.targetLanguage,
      temperature: effectiveSettings.geminiConfig?.temperature,
      temperatureDefault: cacheTag === '_doc'
        ? undefined
        : (keyExtras.temperatureDefault ?? DEFAULT_SETTINGS.geminiConfig.temperature),
      docExtraPrompt: cacheTag === '_doc' ? docExtraPromptOf(payload) : '',
      customPrompt: ('systemInstruction' in geminiOverrides)
        ? (keyExtras.customPrompt || '')
        : customPromptForKey(settings.geminiConfig?.systemInstruction, getEffectiveSystemPrompt),
    },
    translate: (missingTexts, glossary, fixedGlossaryEntries, forbiddenTermsList) =>
      translateBatch(missingTexts, effectiveSettings, glossary, fixedGlossaryEntries, forbiddenTermsList),
  });
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 15000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testGeminiKey(payload) {
  const apiKey = (payload?.apiKey || '').trim();
  const model = (payload?.model || 'gemini-3.8-flash').trim();
  if (!apiKey) return { ok: false, ...errorFields(codedError('testKeyEmpty', null, 'API Key 為空，請先填入再測試。')) };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`;
  try {
    const resp = await fetchWithTimeout(url, { method: 'GET', headers: { 'x-goog-api-key': apiKey } }, 10000);
    if (resp.ok) {
      let j;
      try {
        j = await resp.json();
      } catch {
        return {
          ok: false,
          status: resp.status,
          ...errorFields(codedError('testNonJsonGemini', { status: resp.status }, `HTTP ${resp.status}，但回應不是有效的 JSON。可能是網路環境（公司 proxy / 登入頁）攔截了請求，請換網路再試。`)),
        };
      }
      return { ok: true, status: resp.status, code: 'okModel', params: { model: j?.name || model } };
    }
    let errMsg = `HTTP ${resp.status}`;
    try { const j = await resp.json(); errMsg = j?.error?.message || errMsg; } catch {   }
    return { ok: false, status: resp.status, message: errMsg };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, ...errorFields(codedError('testTimeout', null, '連線逾時，請確認網址與網路狀態。')) };
    const msg = err?.message || String(err);
    return { ok: false, ...errorFields(codedError('network', { msg }, '網路錯誤：' + msg)) };
  }
}

async function testCustomProvider(payload) {
  const baseUrl = (payload?.baseUrl || '').trim().replace(/\/+$/, '');
  const model = (payload?.model || '').trim();
  const apiKey = (payload?.apiKey || '').trim();
  if (!baseUrl) return { ok: false, ...errorFields(codedError('baseUrlMissing', null, 'Base URL 為空。')) };

  const url = /\/chat\/completions$/.test(baseUrl) ? baseUrl : baseUrl + '/chat/completions';
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const reqBody = {
      messages: [{ role: 'user', content: 'ping' }],
      stream: false,
    };
    if (model) reqBody.model = model;
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
    }, 10000);
    if (resp.ok) {
      let j;
      try {
        j = await resp.json();
      } catch {
        return {
          ok: false,
          status: resp.status,
          ...errorFields(codedError('testNonJsonCustom', { status: resp.status }, `HTTP ${resp.status}，但 Provider 回應不是有效的 JSON。請確認 Base URL 是否為正確的 OpenAI-compatible API endpoint。`)),
        };
      }
      const used = j?.usage?.total_tokens || j?.usage?.prompt_tokens || 0;
      const modelLabel = model || j?.model || 'server-default';
      return { ok: true, status: resp.status, code: 'okUsage', params: { model: modelLabel, tokens: used } };
    }
    let errMsg = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      errMsg = j?.error?.message || j?.message || errMsg;
    } catch {   }
    return { ok: false, status: resp.status, message: errMsg };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, ...errorFields(codedError('testTimeout', null, '連線逾時，請確認網址與網路狀態。')) };
    const msg = err?.message || String(err);
    return { ok: false, ...errorFields(codedError('network', { msg }, '網路錯誤：' + msg)) };
  }
}

async function handleTranslateCustom(payload, sender, cacheTag = '_oc', cpOverrides = null, applyFixedGlossary = true, applyForbiddenTerms = true, keyExtras = {}) {
  const settings = await getSettingsCached();
  const cp = { ...(settings.customProvider || {}), ...(cpOverrides || {}) };
  if (!cpOverrides || !('systemPrompt' in cpOverrides)) {
    cp.systemPrompt = getEffectiveSystemPrompt(settings.targetLanguage, cp.systemPrompt);
  }
  if (settings.customProvider?.temperature === null) cp.temperature = null;
  if (!cp.baseUrl) throw codedError('baseUrlMissing', null, '尚未設定自訂 Provider 的 Base URL。');

  const effSettings = { ...settings, customProvider: cp };
  if (Number.isInteger(payload.docBatchSize) && payload.docBatchSize >= 1 && payload.docBatchSize <= 100) {
    effSettings.maxUnitsPerBatch = payload.docBatchSize;
  }

  return pipeline.runTranslatePipeline({
    payload, sender, settings, cacheTag, applyFixedGlossary, applyForbiddenTerms,
    engine: 'openai-compat',
    modelLabel: cp.model || '<server-default>',
    pricing: customProviderPricing(cp),
    cachedRate: resolveCustomProviderCachedRate(cp),
    isWebPath: cacheTag === '_oc',
    logLabel: 'openai-compat',
    logExtra: { baseUrl: cp.baseUrl, model: cp.model },
    keyParts: {
      modelKeyPart: await customProviderModelKeyPart(cp),
      targetLanguage: settings.targetLanguage,
      temperature: cp.temperature,
      temperatureDefault: cacheTag === '_oc_doc'
        ? undefined
        : (keyExtras.temperatureDefault ?? DEFAULT_SETTINGS.customProvider.temperature),
      docExtraPrompt: cacheTag === '_oc_doc' ? docExtraPromptOf(payload) : '',
      customPrompt: (cpOverrides && ('systemPrompt' in cpOverrides))
        ? (keyExtras.customPrompt || '')
        : customPromptForKey(settings.customProvider?.systemPrompt, getEffectiveSystemPrompt),
    },
    translate: (missingTexts, glossary, fixedGlossaryEntries, forbiddenTermsList) =>
      translateBatchCustom(missingTexts, effSettings, glossary, fixedGlossaryEntries, forbiddenTermsList),
  });
}

async function handleTranslateGoogle(payload, sender, cacheSuffix) {
  const texts = payload?.texts;
  if (!Array.isArray(texts) || texts.length === 0) {
    return { result: [], usage: { engine: 'google', chars: 0 } };
  }

  const settings = await getSettingsCached();
  const tl = settings.targetLanguage || 'zh-TW';
  const effectiveCacheSuffix = (tl && tl !== 'zh-TW')
    ? cacheSuffix + '_lang' + tl.replace(/[^a-z0-9]/gi, '')
    : cacheSuffix;

  const cached = await cache.getBatch(texts, effectiveCacheSuffix);
  const missingIdxs = [];
  const missingTexts = [];
  cached.forEach((tr, i) => {
    if (tr == null) {
      missingIdxs.push(i);
      missingTexts.push(texts[i]);
    }
  });

  const cacheHits = texts.length - missingTexts.length;
  debugLog('info', 'cache', 'google batch cache lookup', {
    total: texts.length, hits: cacheHits, misses: missingTexts.length, tl,
  });

  let fresh = [];
  let totalChars = 0;
  if (missingTexts.length > 0) {
    const t0 = Date.now();
    debugLog('info', 'api', 'google translateBatch start', { count: missingTexts.length, tl });
    let res;
    try {
      res = await translateGoogleBatch(missingTexts, tl);
    } catch (err) {
      debugLog('error', 'api', 'google translateBatch failed', {
        count: missingTexts.length, tl, error: err?.message || String(err),
      });
      throw err;
    }
    fresh = res.translations;
    totalChars = res.chars;
    debugLog('info', 'api', 'google translateBatch done', {
      count: missingTexts.length,
      chars: totalChars,
      elapsed: Date.now() - t0,
      tl,
    });

    await cache.setBatch(missingTexts, fresh, effectiveCacheSuffix);

    await usageDB.upsertGoogleUsage({
      url: sender?.tab?.url || '',
      title: '',
      engine: 'google',
      model: 'google-translate',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      billedInputTokens: 0,
      billedCostUSD: 0,
      chars: totalChars,
      segments: missingTexts.length,
      cacheHits,
      durationMs: 0,
      timestamp: Date.now(),
    });
  }

  const result = cached.slice();
  missingIdxs.forEach((idx, k) => { result[idx] = fresh[k]; });

  return {
    result,
    usage: { engine: 'google', chars: totalChars, cacheHits },
  };
}

function resolveGlossaryModel(settings, modelOverride) {
  const own = (settings.glossary?.model || '').trim();
  if (own) return own;
  const override = (typeof modelOverride === 'string' && modelOverride.trim()) ? modelOverride.trim() : '';
  return override || settings.geminiConfig?.model || '';
}

async function handleExtractGlossary(payload, sender) {
  debugLog('info', 'glossary', 'glossary extraction start', { inputHash: payload.inputHash, chars: payload.compressedText?.length });
  const settings = await getSettingsCached();
  if (!settings.apiKey) {
    throw codedError('apiKeyMissing', null, '尚未設定 Gemini API Key，請至設定頁填入。');
  }
  const { compressedText, inputHash } = payload;

  const tl = settings.targetLanguage;
  const glossarySuffix = (tl && tl !== 'zh-TW') ? '_lang' + tl.replace(/[^a-z0-9]/gi, '') : '';

  const cached = payload.forceRefresh ? null : await cache.getGlossary(inputHash, glossarySuffix);
  if (cached) {
    debugLog('info', 'glossary', 'glossary cache hit', { inputHash, terms: cached.length });
    return { glossary: cached, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, fromCache: true };
  }

  debugLog('info', 'glossary', 'calling Gemini');

  const promptSuffix = (typeof payload.promptSuffix === 'string' && payload.promptSuffix.trim())
    ? '\n\n' + payload.promptSuffix.trim().slice(0, 2000)
    : '';
  const effGlossaryModel = resolveGlossaryModel(settings, payload.modelOverride);
  const glossaryEffSettings = {
    ...settings,
    glossary: {
      ...settings.glossary,
      prompt: getEffectiveGlossaryPrompt(tl, settings.glossary?.prompt) + promptSuffix,
      model: effGlossaryModel,
    },
  };

  const result = await extractGlossary(compressedText, glossaryEffSettings);
  const { glossary, usage, _diag } = result;
  debugLog('info', 'glossary', 'Gemini returned glossary', { terms: glossary.length, usage, diag: _diag || null });

  if (glossary.length > 0) {
    await cache.setGlossary(inputHash, glossary, glossarySuffix);
  }

  let glossaryBilledCostUSD = 0;
  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    const glossaryModel = effGlossaryModel || 'unknown';
    const glossaryPricing = getPricingForModel(glossaryModel, settings) || settings.pricing;
    const { billedInputTokens, billedCostUSD } = computeBilling(usage, glossaryPricing, geminiCachedRate(glossaryPricing));
    glossaryBilledCostUSD = billedCostUSD;
    await usageDB.logTranslation({
      url: sender?.tab?.url || '',
      title: sender?.tab?.title || '',
      engine: 'gemini',
      model: glossaryModel,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cachedTokens: usage.cachedTokens || 0,
      billedInputTokens,
      billedCostUSD: glossaryBilledCostUSD,
      segments: 0,
      cacheHits: 0,
      durationMs: 0,
      timestamp: Date.now(),
      source: 'glossary',
    });
  }

  debugLog('info', 'glossary', 'glossary extraction complete', {
    terms: glossary.length,
    inputHash,
    tabUrl: sender?.tab?.url,
  });

  return { glossary, usage: { ...usage, billedCostUSD: glossaryBilledCostUSD }, fromCache: false, _diag: _diag || null };
}

async function handleExtractGlossaryCustomProvider(payload, sender) {
  debugLog('info', 'glossary', 'openai-compat glossary extraction start', {
    inputHash: payload.inputHash, chars: payload.compressedText?.length,
  });
  const settings = await getSettingsCached();
  const cp = settings.customProvider || {};
  if (!cp.baseUrl) {
    return { glossary: [], usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, _diag: '尚未設定自訂 Provider 的 Base URL。' };
  }
  const { compressedText, inputHash } = payload;

  const tl = settings.targetLanguage;
  const glossarySuffix = (tl && tl !== 'zh-TW') ? '_lang' + tl.replace(/[^a-z0-9]/gi, '') : '';

  const cached = payload.forceRefresh ? null : await cache.getGlossary(inputHash, glossarySuffix);
  if (cached) {
    debugLog('info', 'glossary', 'openai-compat glossary cache hit', { inputHash, terms: cached.length });
    return { glossary: cached, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, fromCache: true };
  }

  const promptSuffix = (typeof payload.promptSuffix === 'string' && payload.promptSuffix.trim())
    ? '\n\n' + payload.promptSuffix.trim().slice(0, 2000)
    : '';
  const glossaryEffSettings = {
    ...settings,
    glossary: { ...settings.glossary, prompt: getEffectiveGlossaryPrompt(tl, settings.glossary?.prompt) + promptSuffix },
  };

  const result = await extractGlossaryCustom(compressedText, glossaryEffSettings);
  const { glossary, usage, _diag } = result;
  debugLog('info', 'glossary', 'openai-compat returned glossary', { terms: glossary.length, usage, diag: _diag || null });

  if (glossary.length > 0) {
    await cache.setGlossary(inputHash, glossary, glossarySuffix);
  }

  let glossaryBilledCostUSD = 0;
  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    const { billedInputTokens, billedCostUSD } = computeBilling(usage, customProviderPricing(cp), resolveCustomProviderCachedRate(cp));
    glossaryBilledCostUSD = billedCostUSD;
    await usageDB.logTranslation({
      url: sender?.tab?.url || '',
      title: sender?.tab?.title || '',
      engine: 'openai-compat',
      model: cp.model || '<server-default>',
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cachedTokens: usage.cachedTokens || 0,
      billedInputTokens,
      billedCostUSD: glossaryBilledCostUSD,
      segments: 0,
      cacheHits: 0,
      durationMs: 0,
      timestamp: Date.now(),
      source: 'glossary',
    });
  }

  debugLog('info', 'glossary', 'openai-compat glossary extraction complete', {
    terms: glossary.length, inputHash, tabUrl: sender?.tab?.url,
  });

  return { glossary, usage: { ...usage, billedCostUSD: glossaryBilledCostUSD }, fromCache: false, _diag: _diag || null };
}

async function handleScanTermRenderings(payload, sender) {
  const settings = await getSettingsCached();
  if (!settings.apiKey) {
    throw codedError('apiKeyMissing', null, '尚未設定 Gemini API Key，請至設定頁填入。');
  }
  const { items, inputHash } = payload;
  const cached = inputHash ? await cache.getScanRenderings(inputHash) : null;
  if (cached) {
    debugLog('info', 'scan', 'scan renderings cache hit', { inputHash, terms: cached.length });
    return { renderings: cached, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, billedCostUSD: 0 }, fromCache: true };
  }

  const result = await extractTermRenderings(items, settings);
  const { renderings, usage, _diag } = result;

  if (inputHash && renderings.length > 0) {
    await cache.setScanRenderings(inputHash, renderings);
  }

  let scanBilledCostUSD = 0;
  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    const scanModel = (settings.glossary?.model || '').trim() || settings.geminiConfig?.model || 'unknown';
    const scanPricing = getPricingForModel(scanModel, settings) || settings.pricing;
    const { billedInputTokens, billedCostUSD } = computeBilling(usage, scanPricing, geminiCachedRate(scanPricing));
    scanBilledCostUSD = billedCostUSD;
    await usageDB.logTranslation({
      url: sender?.tab?.url || '',
      title: sender?.tab?.title || '',
      engine: 'gemini',
      model: scanModel,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cachedTokens: usage.cachedTokens || 0,
      billedInputTokens,
      billedCostUSD: scanBilledCostUSD,
      segments: 0,
      cacheHits: 0,
      durationMs: 0,
      timestamp: Date.now(),
      source: 'scan',
    });
  }

  debugLog('info', 'scan', 'scan renderings complete', { terms: renderings.length, inputHash });
  return { renderings, usage: { ...usage, billedCostUSD: scanBilledCostUSD }, fromCache: false, _diag: _diag || null };
}

// command id 沿用 translate-preset-0, 保留使用者在 chrome://extensions/shortcuts 自訂的鍵位
browser.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate-preset-0') return;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATE' }).catch(() => {});
});

// 右鍵選單: 選取文字後翻譯選取範圍涵蓋的段落 (content-hover.js 處理)
const SELECTION_MENU_ID = 'transit-translate-selection';

// 選單文字跟著 options 的「介面語言」(uiLanguage), 不跟瀏覽器語系
function selectionMenuTitle(uiPref) {
  const i18n = globalThis.__SK.i18n;
  return i18n.t('contextMenu.translateSelection', null, i18n.getUiLanguage(uiPref || 'auto'));
}

async function setupSelectionMenu() {
  let uiPref = null;
  try { ({ uiLanguage: uiPref } = await browser.storage.sync.get('uiLanguage')); } catch (_) {}
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: SELECTION_MENU_ID,
    title: selectionMenuTitle(uiPref),
    contexts: ['selection'],
  }, () => void browser.runtime.lastError);
}

browser.runtime.onStartup.addListener(() => {
  setupSelectionMenu().catch((e) => debugLog('warn', 'system', 'context menu setup failed', { error: e.message }));
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SELECTION_MENU_ID || !tab?.id) return;
  browser.tabs.sendMessage(tab.id, { type: 'TRANSLATE_SELECTION' }, { frameId: info.frameId ?? 0 }).catch(() => {});
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.uiLanguage) return;
  const title = selectionMenuTitle(changes.uiLanguage.newValue);
  browser.contextMenus.update(SELECTION_MENU_ID, { title }).catch(() => {});
});

browser.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  debugLog('info', 'system', `extension ${reason}`, {
    version: browser.runtime.getManifest().version,
    previousVersion: previousVersion || null,
  });
  const currentVersion = browser.runtime.getManifest().version;
  await cache.checkVersionAndClear(currentVersion);

  try {
    if (await migrateTranslateEnginesIfNeeded()) {
      debugLog('info', 'system', 'translate presets migrated to primary/fallback engines', {});
    }
  } catch (e) {
    debugLog('warn', 'system', 'translate engine migration failed', { error: e.message });
  }

  try {
    await setupSelectionMenu();
  } catch (e) {
    debugLog('warn', 'system', 'context menu setup failed', { error: e.message });
  }

  const wrote = await maybeWriteWelcomeNotice({ reason, previousVersion, currentVersion });
  if (wrote) {
    debugLog('info', 'system', 'welcome notice written', {
      from: previousVersion, to: currentVersion,
    });
  }

  if (reason === 'install') {
    try {
      await browser.runtime.openOptionsPage();
    } catch (e) {
      debugLog('warn', 'system', 'openOptionsPage on install failed', { error: e.message });
    }
  }
});
