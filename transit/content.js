(function(SK) {
  if (!SK || SK.disabled) return;

  const STATE = SK.STATE;

  window.addEventListener('jread-reader-mode', (e) => {
    const active = !!(e && e.detail && e.detail.active);
    if (typeof SK.setContentGuardPaused === 'function') SK.setContentGuardPaused(active);
  });

  window.addEventListener('transit-debug-request', (e) => {
    const { action, afterSeq } = (e.detail || {});
    const respond = (detail) => {
      window.dispatchEvent(new CustomEvent('transit-debug-response', { detail }));
    };

    const _RELEASE_SAFE_ACTIONS = new Set(['GET_STATE', 'GET_CACHE_STATS']);
    if (!_RELEASE_SAFE_ACTIONS.has(action) && !SK.isDevTailBuild()) {
      respond({ ok: false, error: `${action} disabled in release build (dev tail only)` });
      return;
    }

    const forwardToBackground = (type, extraPayload) => {
      const msg = extraPayload === undefined ? { type } : { type, payload: extraPayload };
      SK.safeSendMessage(msg)
        .then((res) => respond(res || { ok: true }))
        .catch((err) => respond({ ok: false, error: err?.message || String(err) }));
    };

    if (action === 'GET_LOGS') {
      forwardToBackground('GET_LOGS', { afterSeq: afterSeq || 0 });
    } else if (action === 'CLEAR_LOGS') {
      forwardToBackground('CLEAR_LOGS');
    } else if (action === 'CLEAR_CACHE') {
      try { SK.YT?._resetTranslationStateForCacheClear?.(); } catch (_) {}
      forwardToBackground('CLEAR_CACHE');
    } else if (action === 'TRANSLATE') {
      respond({ ok: true, triggered: true });
      SK.translatePage();
    } else if (action === 'TRANSLATE_ENGINE') {
      const eng = (e.detail && e.detail.engine) || 'gemini';
      respond({ ok: true, triggered: true, engine: eng });
      if (eng === 'google') {
        SK.translatePageGoogle({ label: 'Google MT (debug bridge)' });
      } else if (eng === 'openai-compat') {
        SK.translatePage({ engine: 'openai-compat', label: 'OpenAI-compat (debug bridge)' });
      } else {
        SK.translatePage();
      }
    } else if (action === 'GET_SPA_DEBUG') {
      const info = SK._spaDebug ? SK._spaDebug() : null;
      respond({ ok: true, spa: info });
    } else if (action === 'RESTORE') {
      if (SK.isPageTranslated()) {
        restorePage();
        respond({ ok: true, restored: true });
      } else {
        respond({ ok: false, error: 'not translated' });
      }
    } else if (action === 'TOGGLE_EDIT_MODE') {
      const _force = (e.detail && typeof e.detail.force === 'boolean') ? e.detail.force : undefined;
      respond(toggleEditMode(_force));
    } else if (action === 'GET_PERSISTED_LOGS') {
      forwardToBackground('GET_PERSISTED_LOGS');
    } else if (action === 'CLEAR_PERSISTED_LOGS') {
      forwardToBackground('CLEAR_PERSISTED_LOGS');
    } else if (action === 'GET_STATE') {
      const out = {
        ok: true,
        translated: STATE.translated,
        pageTranslated: SK.isPageTranslated?.(),
        translating: STATE.translating,
        segmentCount: STATE.originalHTML.size,
      };
      try {
        const _rt = globalThis.browser?.runtime;
        out.version = _rt?.getManifest?.().version || null;
      } catch (_) {
        out.version = null;
      }
      if (SK.isYouTubePage?.() && SK.YT) {
        out.yt = {
          active:          SK.YT.active,
          translating:     (SK.YT.translatingWindows?.size ?? 0) > 0,
          rawCount:        SK.YT.rawSegments?.length ?? 0,
          captionMapSize:  SK.YT.captionMap?.size ?? 0,
          captionLang:     SK.YT.captionLang,
          isAsr:           SK.YT.isAsr,
          displayCuesLen:  SK.YT.displayCues?.length ?? 0,
          ytConfig:        SK.YT.config,
          overlayProf:     SK.YT._overlayProf || null,
        };
      }
      respond(out);
    } else if (action === 'GET_STORAGE') {
      const keys = (e.detail && e.detail.keys) || null;
      try {
        const _storage = globalThis.browser?.storage;
        if (!_storage || !_storage.sync) {
          respond({ ok: false, error: 'storage.sync unavailable in this context' });
        } else {
          const LARGE_LOCAL = ['fixedGlossary', 'forbiddenTerms'];
          const wantLocal = keys === null ? LARGE_LOCAL : LARGE_LOCAL.filter((k) => keys.includes(k));
          Promise.all([_storage.sync.get(keys), wantLocal.length ? _storage.local.get(wantLocal) : Promise.resolve({})])
            .then(([data, local]) => respond({ ok: true, sync: { ...data, ...local } }))
            .catch((err) => respond({ ok: false, error: err?.message || String(err) }));
        }
      } catch (err) {
        const m = err?.message || String(err);
        respond({
          ok: false,
          error: m.includes('Extension context invalidated')
            ? 'extension 已重載,此分頁的 content script 已失效——請重新整理頁面後再試'
            : m,
        });
      }
    } else if (action === 'SET_GLOSSARY_ENABLED') {
      const _enabled = !!(e.detail && e.detail.enabled);
      try {
        const _storage = globalThis.browser?.storage;
        if (!_storage || !_storage.sync) {
          respond({ ok: false, error: 'storage.sync unavailable in this context' });
        } else {
          _storage.sync.get('glossary')
            .then((data) => {
              const gc = (data && data.glossary) || {};
              gc.enabled = _enabled;
              return _storage.sync.set({ glossary: gc });
            })
            .then(() => respond({ ok: true, enabled: _enabled }))
            .catch((err) => respond({ ok: false, error: err?.message || String(err) }));
        }
      } catch (err) {
        respond({ ok: false, error: err?.message || String(err) });
      }
    } else if (action === 'GET_CACHE_STATS') {
      try {
        const _storage = globalThis.browser?.storage;
        if (!_storage || !_storage.local) {
          respond({ ok: false, error: 'storage.local unavailable in this context' });
        } else {
          _storage.local.get(null)
            .then((all) => {
              const stats = { tc: 0, gloss: 0, bookgloss: 0, other: 0, tcOldestT: null, tcNewestT: null, glossOldestT: null };
              for (const k of Object.keys(all)) {
                if (k.startsWith('tc_')) {
                  stats.tc++;
                  const t = all[k] && all[k].t;
                  if (typeof t === 'number') {
                    if (stats.tcOldestT === null || t < stats.tcOldestT) stats.tcOldestT = t;
                    if (stats.tcNewestT === null || t > stats.tcNewestT) stats.tcNewestT = t;
                  }
                } else if (k.startsWith('gloss_')) {
                  stats.gloss++;
                  const t = all[k] && all[k].t;
                  if (typeof t === 'number' && (stats.glossOldestT === null || t < stats.glossOldestT)) stats.glossOldestT = t;
                } else if (k.startsWith('bookgloss_')) {
                  stats.bookgloss++;
                } else {
                  stats.other++;
                }
              }
              const respondWith = (bytes) => respond({ ok: true, bytes, stats });
              if (typeof _storage.local.getBytesInUse === 'function') {
                _storage.local.getBytesInUse(null).then(respondWith).catch(() => respondWith(null));
              } else {
                respondWith(null);
              }
            })
            .catch((err) => respond({ ok: false, error: err?.message || String(err) }));
        }
      } catch (err) {
        respond({ ok: false, error: err?.message || String(err) });
      }
    } else if (action === 'GET_CACHE_PEEK') {
      const _contains = String((e.detail && e.detail.contains) || '');
      const _limit = Math.max(1, Math.min(20, (e.detail && e.detail.limit) || 5));
      try {
        const _storage = globalThis.browser?.storage;
        if (!_storage || !_storage.local || !_contains) {
          respond({ ok: false, error: !_contains ? 'contains 必填' : 'storage.local unavailable in this context' });
        } else {
          _storage.local.get(null)
            .then((all) => {
              const hits = [];
              for (const k of Object.keys(all)) {
                if (!k.startsWith('tc_')) continue;
                const entry = all[k];
                const v = (entry && typeof entry === 'object') ? entry.v : entry;
                if (typeof v === 'string' && (v.includes(_contains) || k.includes(_contains))) {
                  hits.push({ key: k, v, t: entry && entry.t });
                  if (hits.length >= _limit) break;
                }
              }
              respond({ ok: true, hits });
            })
            .catch((err) => respond({ ok: false, error: err?.message || String(err) }));
        }
      } catch (err) {
        respond({ ok: false, error: err?.message || String(err) });
      }
    } else if (action === 'GET_USAGE_STATS') {
      forwardToBackground('QUERY_USAGE_STATS', { from: e.detail?.from, to: e.detail?.to });
    } else if (action === 'YT_TRANSLATE') {
      if (!SK.isYouTubePage?.()) {
        respond({ ok: false, error: 'not on YouTube page' });
      } else {
        respond({ ok: true, triggered: true });
        SK.translateYouTubeSubtitles?.({ source: 'debug' }).catch((err) => {
          SK.sendLog('warn', 'system', 'YT_TRANSLATE failed', { error: err?.message });
        });
      }
    } else if (action === 'YT_STOP') {
      try { SK.stopYouTubeTranslation?.(); respond({ ok: true }); }
      catch (err) { respond({ ok: false, error: err?.message || String(err) }); }
    } else if (action === 'RELOAD_EXTENSION') {
      forwardToBackground('RELOAD_EXTENSION');
    } else if (action === 'PROFILE_DETECT' || action === 'PROFILE_SERIALIZE') {
      try {
        const d = e.detail || {};
        const runs = Math.max(1, Math.min(20, Number(d.runs) || 5));
        const times = [];
        let units = [];
        let stats = {};
        for (let i = 0; i < runs; i++) {
          stats = {};
          const t0 = performance.now();
          units = SK.collectParagraphs(document.body, stats);
          times.push(Math.round((performance.now() - t0) * 100) / 100);
        }
        const summary = units.map((u) => {
          const s = unitSummary(u, 0);
          return `${s.kind}|${s.tag}|${s.textLength}|${s.textPreview.slice(0, 40)}`;
        });
        if (action === 'PROFILE_DETECT') {
          respond({ ok: true, runs, timesMs: times, unitCount: units.length, skipStats: stats, summary });
          return;
        }
        const serTimes = [];
        const deserTimes = [];
        let serialized = [];
        for (let i = 0; i < runs; i++) {
          const t0 = performance.now();
          serialized = units.map((u) => {
            if (u.kind === 'fragment') return SK.serializeFragmentWithPlaceholders(u);
            if (!SK.hasPreservableInline(u.el)) return { text: (u.el.innerText ?? u.el.textContent ?? '').trim(), slots: [] };
            return SK.serializeWithPlaceholders(u.el);
          });
          serTimes.push(Math.round((performance.now() - t0) * 100) / 100);
          const t1 = performance.now();
          for (const s of serialized) {
            if (!s.text) continue;
            SK.deserializeWithPlaceholders(s.text, s.slots, { cloneReuse: true });
          }
          deserTimes.push(Math.round((performance.now() - t1) * 100) / 100);
        }
        const serSummary = serialized.map((s) => `${s.slots.length}|${s.text.length}|${s.text.slice(0, 60)}`);
        respond({
          ok: true, runs, unitCount: units.length,
          detectTimesMs: times, serializeTimesMs: serTimes, deserializeTimesMs: deserTimes,
          totalSlots: serialized.reduce((a, s) => a + s.slots.length, 0),
          serSummary,
        });
      } catch (err) { respond({ ok: false, error: err?.message || String(err) }); }
    } else if (action === 'GET_YT_DEBUG') {
      const YT = SK.YT;
      if (!YT) { respond({ ok: false, error: 'SK.YT not available' }); return; }
      const rawNorms    = YT.rawSegments.map(s => s.normText);
      const rawTexts    = YT.rawSegments.map(s => s.text);
      const rawStartMs  = YT.rawSegments.map(s => s.startMs);
      const rawGroupIds = YT.rawSegments.map(s => s.groupId);
      const mapKeys     = Array.from(YT.captionMap.keys());
      const rawSet      = new Set(rawNorms);
      const onTheFlyKeys = mapKeys.filter(k => !rawSet.has(k));
      respond({
        ok: true,
        active:           YT.active,
        translating:      (YT.translatingWindows?.size ?? 0) > 0,
        rawCount:         YT.rawSegments.length,
        rawNormTexts:     rawNorms,
        rawTexts:         rawTexts,
        rawStartMs:       rawStartMs,
        rawGroupIds:      rawGroupIds,
        captionMapSize:   YT.captionMap.size,
        captionMapKeys:   mapKeys,
        onTheFlyKeys:     onTheFlyKeys,
        translatedUpToMs: YT.translatedUpToMs,
        ytConfig:         YT.config,
        ccPaused:                  YT.ccPaused,
        translatingWindowsSize:    YT.translatingWindows?.size ?? -1,
        translatingWindowsArray:   YT.translatingWindows ? Array.from(YT.translatingWindows) : [],
        translatedWindowsSize:     YT.translatedWindows?.size ?? -1,
        translatedWindowsArray:    YT.translatedWindows ? Array.from(YT.translatedWindows).slice(0, 10) : [],
        displayCuesLen:            YT.displayCues?.length ?? -1,
        displayCues:               (YT.displayCues || []).slice(0, 400).map(c => c ? ({
          startMs: c.startMs, endMs: c.endMs,
          targetText: String(c.targetText || '').slice(0, 40),
        }) : null),
        captionLang:               YT.captionLang,
        isAsr:                     YT.isAsr,
      });
    } else {
      respond({ ok: false, error: 'unknown action: ' + action });
    }
  });

  let rescanAttempts = 0;
  let rescanTimer = null;

  let rescanAbortController = null;

  SK.getRescanSignal = function getRescanSignal() {
    if (!rescanAbortController || rescanAbortController.signal.aborted) {
      rescanAbortController = new AbortController();
    }
    return rescanAbortController.signal;
  };

  SK.abortRescanRuns = function abortRescanRuns() {
    if (rescanAbortController) {
      rescanAbortController.abort();
      rescanAbortController = null;
    }
  };

  SK.cancelRescan = function cancelRescan() {
    if (rescanTimer) {
      clearTimeout(rescanTimer);
      rescanTimer = null;
    }
    rescanAttempts = 0;
  };

  function scheduleRescanForLateContent() {
    SK.cancelRescan();
    rescanTimer = setTimeout(rescanTick, SK.RESCAN_DELAYS_MS[0]);
  }

  async function rescanTick() {
    rescanTimer = null;
    if (!STATE.translated) return;
    if (STATE.partialModeActive) {
      SK.sendLog('info', 'translate', 'partialMode: skip rescan');
      return;
    }
    let newUnits = SK.collectParagraphs();
    if (STATE.translatedMode === 'dual' && SK.consolidateDualInlineUnits) {
      newUnits = SK.consolidateDualInlineUnits(newUnits);
    }
    if (newUnits.length > 0) {
      try {
        const { done, failures } = await SK.translateUnitsByProvider(newUnits);
        if (!STATE.translated) return;
        if (done > 0) {
          SK.sendLog('info', 'translate', 'rescan caught new units', { done, failures: failures.length, attempt: rescanAttempts + 1 });
        }
      } catch (err) {
        SK.sendLog('warn', 'translate', 'rescan failed', { error: err.message });
      }
    }
    rescanAttempts += 1;
    if (rescanAttempts < SK.RESCAN_DELAYS_MS.length) {
      rescanTimer = setTimeout(rescanTick, SK.RESCAN_DELAYS_MS[rescanAttempts]);
    }
  }

  const BATCH_TIMEOUT_MS = 90_000;

  function sendMessageWithTimeout(message, timeoutMs) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(SK.t('error.batchTimeout', { s: timeoutMs / 1000 }))),
        timeoutMs,
      );
    });
    return Promise.race([SK.safeSendMessage(message), timeoutPromise])
      .finally(() => clearTimeout(timer));
  }

  async function runWithConcurrency(jobs, maxConcurrent, workerFn, signal) {
    const n = Math.min(maxConcurrent, jobs.length);
    if (n === 0) return;
    let cursor = 0;
    const workers = [];
    for (let w = 0; w < n; w++) {
      workers.push((async () => {
        while (true) {
          if (signal?.aborted) return;
          const idx = cursor++;
          if (idx >= jobs.length) return;
          await workerFn(jobs[idx]);
        }
      })());
    }
    await Promise.all(workers);
  }

  function packBatches(texts, units, slotsList, maxUnits, maxChars, firstMaxUnits = null, firstMaxChars = null) {
    const jobs = [];
    let cur = null;
    const flush = () => {
      if (cur && cur.texts.length > 0) {
        cur.idx = jobs.length;
        jobs.push(cur);
      }
      cur = null;
    };
    const limU = () => (jobs.length === 0 && firstMaxUnits != null) ? firstMaxUnits : maxUnits;
    const limC = () => (jobs.length === 0 && firstMaxChars != null) ? firstMaxChars : maxChars;
    for (let i = 0; i < texts.length; i++) {
      const len = (texts[i] || '').length;
      if (len > limC()) {
        flush();
        jobs.push({
          idx: jobs.length,
          start: i,
          texts: [texts[i]],
          units: [units[i]],
          slots: [slotsList[i]],
          chars: len,
          oversized: true,
        });
        continue;
      }
      if (cur && (cur.chars + len > limC() || cur.texts.length >= limU())) {
        flush();
      }
      if (!cur) cur = { start: i, texts: [], units: [], slots: [], chars: 0 };
      cur.texts.push(texts[i]);
      cur.units.push(units[i]);
      cur.slots.push(slotsList[i]);
      cur.chars += len;
    }
    flush();
    return jobs;
  }

  SK.applyTranslateDisplaySettings = function applyTranslateDisplaySettings(settings) {
    settings = settings || {};
    const TARGET = (typeof settings.targetLanguage === 'string' && SK.TARGET_LANGUAGES.includes(settings.targetLanguage))
      ? settings.targetLanguage : 'zh-TW';
    STATE.targetLanguage = TARGET;
    const mode = settings.displayMode;
    STATE.translatedMode = (mode === 'dual') ? 'dual' : 'single';
    const ms = settings.translationMarkStyle;
    SK.currentMarkStyle = (ms && SK.VALID_MARK_STYLES.has(ms)) ? ms : SK.DEFAULT_MARK_STYLE;
    SK.currentDualAccent = SK.sanitizeDualAccent?.(settings.dualAccentColor) ?? 'auto';
    if (STATE.translatedMode === 'dual') SK.ensureDualWrapperStyle?.();
    return TARGET;
  };

  SK.translateUnits = async function translateUnits(units, { onProgress, glossary, signal, modelOverride, engine, ignorePartialMode, convertDirection, convertOnly } = {}) {
    const tu_entry = Date.now();
    SK.setAnnotationDedupeRules?.(glossary || null);
    let serialized = units.map(unit => {
      if (unit.kind === 'fragment') {
        return SK.serializeFragmentWithPlaceholders(unit);
      }
      const el = unit.el;
      if (!SK.hasPreservableInline(el)) {
        return { text: (el.innerText ?? el.textContent ?? '').trim(), slots: [] };
      }
      return SK.serializeWithPlaceholders(el);
    });
    ({ units, serialized } = dropEmptyUnits(units, serialized, 'empty-text units dropped before API'));
    let total = units.length;
    const texts = serialized.map(s => s.text);
    const slotsList = serialized.map(s => s.slots);
    SK.sendLog('info', 'translate', 'milestone:tu_serialize_done', { t: Date.now() - tu_entry, units: total });

    const origIndicesByText = new Map();
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      let arr = origIndicesByText.get(t);
      if (!arr) { arr = []; origIndicesByText.set(t, arr); }
      arr.push(i);
    }
    const uniqueIndices = Array.from(origIndicesByText.values()).map(arr => arr[0]);
    uniqueIndices.sort((a, b) => a - b);
    const dedupSavedCount = total - uniqueIndices.length;
    if (dedupSavedCount > 0) {
      SK.sendLog('info', 'translate', 'milestone:dedup_done', {
        t: Date.now() - tu_entry,
        original: total,
        unique: uniqueIndices.length,
        saved: dedupSavedCount,
      });
    }
    const dedupedTexts = uniqueIndices.map(i => texts[i]);
    const dedupedUnits = uniqueIndices.map(i => units[i]);
    const dedupedSlots = uniqueIndices.map(i => slotsList[i]);

    const llmPickIdx = [];
    const convPickIdx = [];
    if (convertDirection) {
      for (let i = 0; i < dedupedTexts.length; i++) {
        (SK.isConvertibleVariant(dedupedTexts[i], convertDirection) ? convPickIdx : llmPickIdx).push(i);
      }
      SK.sendLog('info', 'translate', 'milestone:zh_convert_partition', {
        t: Date.now() - tu_entry, direction: convertDirection, convertOnly: !!convertOnly,
        convertible: convPickIdx.length, llm: llmPickIdx.length,
      });
    } else {
      for (let i = 0; i < dedupedTexts.length; i++) llmPickIdx.push(i);
    }
    if (convertOnly && llmPickIdx.length > 0) {
      let skippedOrig = 0;
      for (const i of llmPickIdx) {
        skippedOrig += (origIndicesByText.get(dedupedTexts[i])?.length || 1);
      }
      total -= skippedOrig;
      SK.sendLog('info', 'translate', 'convertOnly: non-convertible units skipped (no API)', { skippedUnique: llmPickIdx.length, skippedOrig });
    }
    const llmTexts = (convertOnly ? [] : llmPickIdx.map(i => dedupedTexts[i]));
    const llmUnits = (convertOnly ? [] : llmPickIdx.map(i => dedupedUnits[i]));
    const llmSlots = (convertOnly ? [] : llmPickIdx.map(i => dedupedSlots[i]));

    let maxConcurrent = SK.DEFAULT_MAX_CONCURRENT;
    let maxUnitsPerBatch = SK.DEFAULT_UNITS_PER_BATCH;
    let maxCharsPerBatch = SK.DEFAULT_CHARS_PER_BATCH;
    let partialMode = { enabled: false, maxUnits: 25 };
    try {
      const batchCfg = await browser.storage.sync.get(['maxConcurrentBatches', 'maxUnitsPerBatch', 'maxCharsPerBatch', 'partialMode']);
      if (Number.isFinite(batchCfg.maxConcurrentBatches) && batchCfg.maxConcurrentBatches > 0) {
        maxConcurrent = batchCfg.maxConcurrentBatches;
      }
      if (Number.isFinite(batchCfg.maxUnitsPerBatch) && batchCfg.maxUnitsPerBatch >= 1) {
        maxUnitsPerBatch = batchCfg.maxUnitsPerBatch;
      }
      if (Number.isFinite(batchCfg.maxCharsPerBatch) && batchCfg.maxCharsPerBatch >= 500) {
        maxCharsPerBatch = batchCfg.maxCharsPerBatch;
      }
      if (batchCfg.partialMode && typeof batchCfg.partialMode === 'object') {
        if (typeof batchCfg.partialMode.enabled === 'boolean') partialMode.enabled = batchCfg.partialMode.enabled;
        if (Number.isFinite(batchCfg.partialMode.maxUnits) && batchCfg.partialMode.maxUnits >= 5 && batchCfg.partialMode.maxUnits <= 50) {
          partialMode.maxUnits = batchCfg.partialMode.maxUnits;
        }
      }
    } catch (_) {   }
    SK.sendLog('info', 'translate', 'milestone:tu_storage_loaded', { t: Date.now() - tu_entry, partialMode });

    let done = 0;
    let batch0StreamDone = 0;
    let convertedCount = 0;
    const pageUsage = {
      inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUSD: 0,
      billedInputTokens: 0, billedCostUSD: 0,
      cacheHits: 0,
      unlogged: false,
    };
    const partialModeActive = partialMode.enabled && !ignorePartialMode;
    const firstBatchUnits = partialModeActive ? partialMode.maxUnits : SK.BATCH0_UNITS;
    const jobs = packBatches(llmTexts, llmUnits, llmSlots, maxUnitsPerBatch, maxCharsPerBatch, firstBatchUnits, SK.BATCH0_CHARS);
    SK.sendLog('info', 'translate', 'milestone:tu_packed', { t: Date.now() - tu_entry, batches: jobs.length });
    SK.sendLog('info', 'translate', 'packBatches detail', {
      totalBatches: jobs.length,
      batchSizes: jobs.map((j, i) => ({ idx: i, units: j.texts.length, chars: j.chars })),
      partialMode,
      firstBatchUnitLimit: firstBatchUnits,
      firstBatchCharLimit: SK.BATCH0_CHARS,
      firstBatchActualUnits: jobs[0]?.texts.length || 0,
      firstBatchActualChars: jobs[0]?.chars || 0,
    });
    const failures = [];
    let hadAnyMismatch = false;
    // 已注入譯文的原始 unit; 失敗清單只放還沒注入的 unit, 讓 failback 補翻時不會重翻
    const injectedUnits = new Set();
    const failedUnitsFor = (uniqueTexts) => {
      const out = [];
      for (const text of uniqueTexts) {
        for (const origIdx of (origIndicesByText.get(text) || [])) {
          const u = units[origIdx];
          if (u && !injectedUnits.has(u)) out.push(u);
        }
      }
      return out;
    };

    const t0All = Date.now();
    SK.sendLog('info', 'translate', 'translateUnits start', { batches: jobs.length, total, maxConcurrent });

    const runBatch = async (job) => {
      if (signal?.aborted) return;
      const batchIdx = job.idx;
      const t0 = Date.now();
      SK.sendLog('info', 'translate', `batch ${batchIdx + 1}/${jobs.length} start`, { units: job.texts.length, chars: job.chars });
      try {
        const messageType = engine === 'openai-compat' ? 'TRANSLATE_BATCH_CUSTOM' : 'TRANSLATE_BATCH';
        const response = await sendMessageWithTimeout({
          type: messageType,
          payload: { texts: job.texts, glossary: glossary || null, modelOverride: modelOverride || null },
        }, BATCH_TIMEOUT_MS);
        const elapsed = Date.now() - t0;
        const cacheHit = response?.usage?.cacheHits || 0;
        const apiCalls = job.texts.length - cacheHit;
        SK.sendLog('info', 'translate', `batch ${batchIdx + 1}/${jobs.length} done`, { elapsed, cacheHits: cacheHit, apiCalls });
        if (!response?.ok) throw new Error(SK.i18n.bgErrorMessage(response) || SK.t('common.errorUnknown'));
        const translations = response.result;
        if (response.usage) {
          pageUsage.inputTokens += response.usage.inputTokens || 0;
          pageUsage.outputTokens += response.usage.outputTokens || 0;
          pageUsage.cachedTokens += response.usage.cachedTokens || 0;
          pageUsage.costUSD += response.usage.costUSD || 0;
          pageUsage.billedInputTokens += response.usage.billedInputTokens || 0;
          pageUsage.billedCostUSD += response.usage.billedCostUSD || 0;
          pageUsage.cacheHits += response.usage.cacheHits || 0;
          if (!response.usage.logged) pageUsage.unlogged = true;
        }
        if (response.hadMismatch) hadAnyMismatch = true;
        const performBatchInject = () => {
          if (signal?.aborted) return;
          let injectedThisBatch = 0;
          const injectedEls = new Set();
          const fragmentInjectedEls = new Set();
          const shouldSkipDupInject = (u) => {
            if (!u?.el) return false;
            if (u.kind === 'element') {
              if (injectedEls.has(u.el) || fragmentInjectedEls.has(u.el)) return true;
              injectedEls.add(u.el);
            } else if (u.kind === 'fragment') {
              if (injectedEls.has(u.el)) return true;
              fragmentInjectedEls.add(u.el);
            }
            return false;
          };
          translations.forEach((tr, j) => {
            const sanitized = SK.sanitizeMarkers(tr);
            const uniqueText = job.texts[j];
            const allOrigIndices = origIndicesByText.get(uniqueText);
            if (allOrigIndices && allOrigIndices.length > 0) {
              for (const origIdx of allOrigIndices) {
                const u = units[origIdx];
                if (shouldSkipDupInject(u)) { injectedThisBatch++; continue; }
                try {
                  SK.injectTranslation(u, sanitized, slotsList[origIdx]);
                } catch (injectErr) {
                  SK.sendLog('warn', 'translate', 'inject failed (unit skipped)', { batch: batchIdx + 1, origIdx, error: injectErr.message });
                }
                injectedThisBatch++;
              }
            } else {
              try {
                SK.injectTranslation(job.units[j], sanitized, job.slots[j]);
              } catch (injectErr) {
                SK.sendLog('warn', 'translate', 'inject failed (unit skipped)', { batch: batchIdx + 1, j, error: injectErr.message });
              }
              injectedThisBatch++;
            }
          });
          done += injectedThisBatch;
          if (onProgress) onProgress(done, total, hadAnyMismatch);
        };
        if (SK._idleGateReached) {
          performBatchInject();
        } else {
          await SK.ensureFirstInjectIdle();
          performBatchInject();
        }
      } catch (err) {
        const elapsed = Date.now() - t0;
        SK.sendLog('error', 'translate', `batch ${batchIdx + 1}/${jobs.length} FAILED`, { elapsed, start: job.start, error: err.message });
        failures.push({ start: job.start, count: job.texts.length, error: err.message, units: failedUnitsFor(job.texts) });
      }
    };

    const FIRST_CHUNK_TIMEOUT_MS = 3000;
    const runBatch0Streaming = (job) => {
      const streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const t0 = Date.now();
      SK.sendLog('info', 'translate', `batch 1/${jobs.length} stream start`, { streamId, units: job.texts.length, chars: job.chars });

      let firstChunkResolve, doneResolve, doneReject;
      const firstChunkPromise = new Promise((r) => { firstChunkResolve = r; });
      const donePromise = new Promise((res, rej) => { doneResolve = res; doneReject = rej; });
      donePromise.catch(() => {});

      const STREAM_IDLE_TIMEOUT_MS = 20000;
      let _idleTimer = null;
      const _resetIdleWatchdog = () => {
        clearTimeout(_idleTimer);
        _idleTimer = setTimeout(() => {
          try { browser.runtime.onMessage.removeListener(onMessage); } catch (_) {}
          SK.sendLog('warn', 'translate', `batch 1/${jobs.length} streaming idle watchdog fired (stall / SW dead mid-stream?)`, { streamId });
          SK.safeSendMessage({ type: 'STREAMING_ABORT', payload: { streamId } }).catch(() => {});
          firstChunkResolve(false);
          doneReject(new Error('streaming idle timeout'));
        }, SK._streamIdleTimeoutMs || STREAM_IDLE_TIMEOUT_MS);
      };
      const _clearIdleWatchdog = () => { clearTimeout(_idleTimer); _idleTimer = null; };

      let firstSegmentInjectedT = null;
      let firstSegMsgLogged = false;
      let idleGateInstrumented = false;
      const streamSeenIdx = new Set();

      const abortHandler = () => {
        SK.sendLog('info', 'translate', `batch 1/${jobs.length} stream abort triggered`, { streamId });
        _clearIdleWatchdog();
        SK.safeSendMessage({ type: 'STREAMING_ABORT', payload: { streamId } }).catch(() => {});
        try { browser.runtime.onMessage.removeListener(onMessage); } catch (_) {}
        firstChunkResolve(false);
        doneResolve({ ok: false, aborted: true });
      };
      if (signal) {
        if (signal.aborted) {
          abortHandler();
          return { firstChunkOrTimeout: Promise.resolve({ kind: 'failed' }), donePromise, streamId, cleanup: () => {} };
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      const onMessage = (message) => {
        if (!message || message.payload?.streamId !== streamId) return;
        _resetIdleWatchdog();
        if (message.type === 'STREAMING_FIRST_CHUNK') {
          firstChunkResolve(true);
        } else if (message.type === 'STREAMING_SEGMENT') {
          const idx = message.payload.segmentIdx;
          if (!firstSegMsgLogged) {
            SK.sendLog('info', 'translate', 'milestone:stream_first_seg_msg', { streamId, idx, t: Date.now() - t0 });
            firstSegMsgLogged = true;
          }
          const tr = SK.sanitizeMarkers(message.payload.translation);
          if (typeof idx === 'number' && idx >= 0 && idx < job.texts.length && tr) {
            const isReinject = streamSeenIdx.has(idx);
            streamSeenIdx.add(idx);
            const tallySeg = () => { if (!isReinject) { done += 1; batch0StreamDone += 1; } };
            const performInject = () => {
              if (signal?.aborted) return;
              try {
                const uniqueText = job.texts[idx];
                const allOrigIndices = origIndicesByText.get(uniqueText);
                if (allOrigIndices && allOrigIndices.length > 0) {
                  const injectedEls = new Set();
                  const fragmentInjectedEls = new Set();
                  for (const origIdx of allOrigIndices) {
                    const u = units[origIdx];
                    if (u) injectedUnits.add(u);
                    if (u?.el) {
                      if (u.kind === 'element') {
                        if (injectedEls.has(u.el) || fragmentInjectedEls.has(u.el)) { tallySeg(); continue; }
                        injectedEls.add(u.el);
                      } else if (u.kind === 'fragment') {
                        if (injectedEls.has(u.el)) { tallySeg(); continue; }
                        fragmentInjectedEls.add(u.el);
                      }
                    }
                    SK.injectTranslation(u, tr, slotsList[origIdx]);
                    tallySeg();
                  }
                } else {
                  if (job.units[idx]) injectedUnits.add(job.units[idx]);
                  SK.injectTranslation(job.units[idx], tr, job.slots[idx]);
                  tallySeg();
                }
                if (onProgress) onProgress(done, total, hadAnyMismatch);
                if (firstSegmentInjectedT === null) {
                  firstSegmentInjectedT = Date.now() - t0;
                  SK.sendLog('info', 'translate', `batch 1/${jobs.length} stream first segment injected`, { streamId, idx, t: firstSegmentInjectedT });
                }
              } catch (injectErr) {
                SK.sendLog('warn', 'translate', 'streaming inject failed', { idx, error: injectErr.message });
              }
            };
            if (SK._idleGateReached) {
              performInject();
            } else if (!idleGateInstrumented) {
              idleGateInstrumented = true;
              const gateStartT = Date.now() - t0;
              SK.sendLog('info', 'translate', 'milestone:stream_idle_gate_start', { streamId, idx, t: gateStartT, waitMs: SK.FIRST_INJECT_HYDRATION_WAIT_MS });
              SK.ensureFirstInjectIdle().then(() => {
                SK.sendLog('info', 'translate', 'milestone:stream_idle_gate_resolved', { streamId, t: Date.now() - t0, dt: Date.now() - t0 - gateStartT });
                performInject();
              });
            } else {
              SK.ensureFirstInjectIdle().then(performInject);
            }
          }
        } else if (message.type === 'STREAMING_DONE') {
          const elapsed = Date.now() - t0;
          const usage = message.payload.usage || {};
          // background 已把 MAX_TOKENS 視為 hadMismatch.
          if (message.payload.hadMismatch) {
            SK.sendLog('warn', 'translate', `batch 1/${jobs.length} stream DONE with hadMismatch, triggering retry`, { elapsed, totalSegments: message.payload.totalSegments, injectedSoFar: batch0StreamDone, finishReason: message.payload.finishReason, _anomaly: true });
            _clearIdleWatchdog();
            browser.runtime.onMessage.removeListener(onMessage);
            firstChunkResolve(true);
            doneReject(new Error('streaming hadMismatch'));
            return;
          }
          pageUsage.inputTokens += usage.inputTokens || 0;
          pageUsage.outputTokens += usage.outputTokens || 0;
          pageUsage.cachedTokens += usage.cachedTokens || 0;
          pageUsage.billedInputTokens += usage.billedInputTokens || 0;
          pageUsage.billedCostUSD += usage.billedCostUSD || 0;
          pageUsage.cacheHits += usage.cacheHits || 0;
          if (!usage.logged) pageUsage.unlogged = true;
          SK.sendLog('info', 'translate', `batch 1/${jobs.length} stream done`, { elapsed, totalSegments: message.payload.totalSegments, hadMismatch: false });
          _clearIdleWatchdog();
          browser.runtime.onMessage.removeListener(onMessage);
          firstChunkResolve(true);
          doneResolve({ ok: true });
        } else if (message.type === 'STREAMING_ERROR') {
          const elapsed = Date.now() - t0;
          SK.sendLog('error', 'translate', `batch 1/${jobs.length} stream FAILED`, { elapsed, error: message.payload.error });
          _clearIdleWatchdog();
          browser.runtime.onMessage.removeListener(onMessage);
          firstChunkResolve(false);
          doneReject(new Error(SK.i18n.bgErrorMessage(message.payload) || 'streaming failed'));
        } else if (message.type === 'STREAMING_ABORTED') {
          SK.sendLog('info', 'translate', `batch 1/${jobs.length} stream aborted`, { streamId });
          _clearIdleWatchdog();
          browser.runtime.onMessage.removeListener(onMessage);
          firstChunkResolve(false);
          doneResolve({ ok: false, aborted: true });
        }
      };
      browser.runtime.onMessage.addListener(onMessage);
      _resetIdleWatchdog();

      SK.safeSendMessage({
        type: 'TRANSLATE_BATCH_STREAM',
        payload: { texts: job.texts, glossary: glossary || null, modelOverride: modelOverride || null, streamId },
      }).then((resp) => {
        if (!resp?.started) {
          _clearIdleWatchdog();
          browser.runtime.onMessage.removeListener(onMessage);
          firstChunkResolve(false);
          doneReject(new Error(resp?.error || 'streaming failed to start'));
        }
      }).catch((err) => {
        _clearIdleWatchdog();
        browser.runtime.onMessage.removeListener(onMessage);
        firstChunkResolve(false);
        doneReject(err);
      });

      const firstChunkOrTimeout = Promise.race([
        firstChunkPromise.then((v) => ({ kind: v ? 'first_chunk' : 'failed' })),
        new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), FIRST_CHUNK_TIMEOUT_MS)),
      ]);

      return { firstChunkOrTimeout, donePromise, streamId, cleanup: () => { _clearIdleWatchdog(); try { browser.runtime.onMessage.removeListener(onMessage); } catch (_) {} } };
    };

    const runZhConvert = async () => {
      if (convPickIdx.length === 0) return;
      const t0c = Date.now();
      const CONV_CHUNK = 400;
      const _convInjectedEls = new Set();
      for (let off = 0; off < convPickIdx.length; off += CONV_CHUNK) {
        if (signal?.aborted) return;
        const idxChunk = convPickIdx.slice(off, off + CONV_CHUNK);
        const chunkTexts = idxChunk.map(i => dedupedTexts[i]);
        const response = await sendMessageWithTimeout({
          type: 'CONVERT_ZH_LOCAL',
          payload: { texts: chunkTexts, direction: convertDirection },
        }, 30000);
        if (!response?.ok) throw new Error(SK.i18n.bgErrorMessage(response) || SK.t('common.errorUnknown'));
        if (!SK._idleGateReached) await SK.ensureFirstInjectIdle();
        if (signal?.aborted) return;
        let injectedThisChunk = 0;
        response.result.forEach((converted, j) => {
          const uniqueText = chunkTexts[j];
          const allOrigIndices = origIndicesByText.get(uniqueText) || [];
          for (const origIdx of allOrigIndices) {
            const u = units[origIdx];
            if (u) injectedUnits.add(u);
            if (u?.el && _convInjectedEls.has(u.el)) { injectedThisChunk++; continue; }
            if (u?.el) _convInjectedEls.add(u.el);
            SK.injectTranslation(u, converted, slotsList[origIdx]);
            injectedThisChunk++;
          }
        });
        done += injectedThisChunk;
        convertedCount += injectedThisChunk;
        if (onProgress) onProgress(done, total, hadAnyMismatch);
      }
      SK.sendLog('info', 'translate', 'local zh-convert done', {
        direction: convertDirection, uniqueSegments: convPickIdx.length,
        injected: convertedCount, elapsed: Date.now() - t0c,
      });
    };
    try {
      await runZhConvert();
    } catch (err) {
      SK.sendLog('error', 'translate', 'local zh-convert FAILED', { error: err.message, _anomaly: true });
      failures.push({ start: 0, count: convPickIdx.length, error: err.message, units: failedUnitsFor(convPickIdx.map(i => dedupedTexts[i])) });
    }

    const useStreaming = engine !== 'openai-compat';

    if (jobs.length > 0) {
      let batch0NeedsFallback = false;
      const skipBatch1Plus = partialModeActive;
      SK.sendLog('info', 'translate', 'main flow start', {
        useStreaming, skipBatch1Plus, jobsCount: jobs.length, t: Date.now() - tu_entry,
      });
      if (skipBatch1Plus && jobs.length > 1) {
        SK.sendLog('info', 'translate', 'partialMode: skip batch 1+', { totalBatches: jobs.length, skipped: jobs.length - 1, batch0Units: jobs[0].texts.length });
      }

      if (useStreaming) {
        const stream = runBatch0Streaming(jobs[0]);
        const r = await stream.firstChunkOrTimeout;
        SK.sendLog('info', 'translate', 'stream firstChunkOrTimeout result', { kind: r.kind, t: Date.now() - tu_entry });
        if (r.kind === 'first_chunk') {
          const willParallel = jobs.length > 1 && !signal?.aborted && !skipBatch1Plus;
          SK.sendLog('info', 'translate', 'parallel batches dispatch decision', { willParallel, count: willParallel ? jobs.length - 1 : 0 });
          const parallelP = willParallel
            ? runWithConcurrency(jobs.slice(1), maxConcurrent, runBatch, signal)
            : Promise.resolve();
          try {
            await stream.donePromise;
            SK.sendLog('info', 'translate', 'after await stream.donePromise', { t: Date.now() - tu_entry });
          } catch (streamErr) {
            const injectedSoFar = batch0StreamDone;
            done -= batch0StreamDone;
            batch0StreamDone = 0;
            SK.sendLog('warn', 'translate', 'streaming mid-failure, retrying batch 0 non-streaming', { error: streamErr.message, injectedSoFar, _anomaly: true });
            await runBatch(jobs[0]);
          }
          await parallelP;
          SK.sendLog('info', 'translate', 'after await parallelP', { t: Date.now() - tu_entry, doneSoFar: done });
        } else {
          stream.cleanup();
          if (r.kind === 'timeout') {
            SK.sendLog('warn', 'translate', 'streaming first_chunk timeout, falling back to non-streaming', { streamId: stream.streamId, _anomaly: true });
            SK.safeSendMessage({ type: 'STREAMING_ABORT', payload: { streamId: stream.streamId } }).catch(() => {});
          }
          batch0NeedsFallback = true;
        }
      } else {
        batch0NeedsFallback = true;
      }

      if (batch0NeedsFallback) {
        await runBatch(jobs[0]);
        if (jobs.length > 1 && !signal?.aborted && !skipBatch1Plus) {
          await runWithConcurrency(jobs.slice(1), maxConcurrent, runBatch, signal);
        }
      }
    }

    SK.sendLog('info', 'translate', 'translateUnits complete', { elapsed: Date.now() - t0All, done, total, convertedCount, failures: failures.length });

    return { done, total, failures, pageUsage, convertedCount };
  };

  // 移除序列化後沒有文字的 unit, 避免送空字串給 API.
  function dropEmptyUnits(units, serialized, logMsg) {
    const kept = [];
    for (let i = 0; i < serialized.length; i++) {
      if ((serialized[i].text || '').trim()) kept.push(i);
    }
    if (kept.length === units.length) return { units, serialized };
    SK.sendLog('warn', 'translate', logMsg, {
      dropped: units.length - kept.length, kept: kept.length,
    });
    return { units: kept.map(i => units[i]), serialized: kept.map(i => serialized[i]) };
  }

  function isGoogleDocsEditorPage() {
    return location.hostname === 'docs.google.com'
      && /^\/document\/d\/[^/]+\/(edit|preview|view)/.test(location.pathname);
  }

  function getGoogleDocsMobileBasicUrl() {
    const match = location.pathname.match(/^\/document\/d\/([^/]+)/);
    if (!match) return null;
    return `https://docs.google.com/document/d/${match[1]}/mobilebasic`;
  }

  SK.translatePage = async function translatePage(options = {}) {
    const labelPrefix = options.label ? `[${options.label}] ` : '';

    if (SK.isEmbeddedPlayerFrame?.(document, window)) {
      SK.sendLog('info', 'translate', 'embedded player frame, skip translate', { url: location.href });
      return;
    }
    if (SK.isInstanceLeader && !SK.isInstanceLeader()) {
      SK.sendLog('info', 'translate', 'skip translate (another instance leads)', { url: location.href });
      return;
    }

    SK.sendLog('info', 'translate', 'translatePage entry', {
      ignorePartialMode: !!options.ignorePartialMode,
      stateTranslated: STATE.translated,
      statePartialModeActive: STATE.partialModeActive,
      alreadyMarkedCount: document.querySelectorAll('[data-transit-translated]').length,
    });
    let resumeConvertedOnFail = false;
    if (STATE.translated && !options.ignorePartialMode) {
      if (options.convertOnly) {
        SK.sendLog('info', 'translate', 'convertOnly: page already translated, silent exit');
        return;
      }
      if (STATE.translatedBy === 'opencc-local' && (options.overConverted || SK.hasSubstantialUntranslated(1))) {
        SK.sendLog('info', 'translate', 'page only locally converted, proceed to full translate instead of toggle restore');
        STATE.translated = false;
        resumeConvertedOnFail = true;
      } else {
        restorePage();
        return;
      }
    }
    if (STATE.translated && options.ignorePartialMode) {
      SK.sendLog('info', 'translate', 'ignorePartialMode: re-translate without restorePage', { previousPartialMode: STATE.partialModeActive });
      STATE.translated = false;
    }

    if (isGoogleDocsEditorPage()) {
      if (options.convertOnly) return;
      const mobileUrl = getGoogleDocsMobileBasicUrl();
      if (mobileUrl) {
        SK.sendLog('info', 'translate', 'Google Docs detected, redirecting to mobilebasic', { mobileUrl });
        SK.showToast('loading', SK.t('toast.detectGoogleDocs'));
        SK.safeSendMessage({
          type: 'OPEN_GDOC_MOBILE',
          payload: { url: mobileUrl },
        }).catch(() => {});
        return;
      }
    }

    if (STATE.translating) {
      if (STATE.abortController && !STATE.abortController.signal.aborted) {
        if (options.convertOnly) return;
        if (STATE.translatingConvertOnly) {
          abortInProgressTranslation({ silent: true });
        } else {
          abortInProgressTranslation();
          return;
        }
      } else if (options.convertOnly) {
        return;
      }
    }

    if (!navigator.onLine) {
      if (!options.convertOnly) {
        SK.showToast('error', SK.t('toast.offline'), { autoHideMs: 5000 });
        if (resumeConvertedOnFail) STATE.translated = true;
        return;
      }
    }

    STATE.translating = true;
    STATE.translatingConvertOnly = !!options.convertOnly;
    const myAbortController = new AbortController();
    STATE.abortController = myAbortController;
    const abortSignal = myAbortController.signal;
    if (!options.convertOnly) SK.abortRescanRuns();
    if (!options.convertOnly) SK.safeSendMessage({ type: 'SET_BADGE_TRANSLATED' }).catch(() => {});
    const clearRunBadge = () => {
      if (!options.convertOnly) SK.safeSendMessage({ type: 'CLEAR_BADGE' }).catch(() => {});
    };
    const markConvertedAgain = () => {
      if (resumeConvertedOnFail) remarkConvertedPage(myAbortController);
    };

    const entryTime = Date.now();

    let settings = {};
    try {
      settings = await browser.storage.sync.get(null);
    } catch (_) {   }
    SK.sendLog('info', 'translate', 'milestone:storage_loaded', { t: Date.now() - entryTime });

    const TARGET = SK.applyTranslateDisplaySettings(settings);

    const convertDirection = SK.convertDirectionFor(TARGET);
    const convertOnly = !!options.convertOnly;
    if (convertOnly && !convertDirection) {
      SK.sendLog('info', 'translate', 'convertOnly: target not Chinese, skip', { target: TARGET });
      releaseRunState(myAbortController);
      return;
    }

    {
      const currency = settings.displayCurrency === 'USD' ? 'USD' : 'TWD';
      let rate = window.__SKFormat.FALLBACK_USD_TWD_RATE;
      try {
        const { exchangeRate } = await browser.storage.local.get('exchangeRate');
        if (exchangeRate && Number.isFinite(exchangeRate.rate) && exchangeRate.rate > 0) {
          rate = exchangeRate.rate;
        }
      } catch (_) {   }
      SK.currencyState = { currency, rate };
    }

    const translateStartTime = Date.now();

    if (convertOnly && SK.pageHasConvertibleSignal && !SK.pageHasConvertibleSignal(convertDirection)) {
      SK.sendLog('info', 'translate', 'convertOnly: no source-variant chars on page, silent exit (precheck)', { direction: convertDirection });
      releaseRunState(myAbortController);
      return;
    }

    const t_collect_start = Date.now();
    let units = SK.collectParagraphs();
    if (units.length === 0) {
      if (!convertOnly) {
        SK.showToast('error', SK.t('toast.noContent'), { autoHideMs: 3000 });
      } else {
        SK.sendLog('info', 'translate', 'convertOnly: no units at collect (page not rendered yet?), silent exit');
      }
      clearRunBadge();
      markConvertedAgain();
      releaseRunState(myAbortController);
      return;
    }
    SK.sendLog('info', 'translate', 'milestone:collect_done', { t: Date.now() - entryTime, dt: Date.now() - t_collect_start, segments: units.length });

    if (STATE.translatedMode === 'dual' && SK.consolidateDualInlineUnits) {
      units = SK.consolidateDualInlineUnits(units);
    }

    if (convertOnly) {
      units = units.filter(u => SK.isConvertibleVariant((u.el?.innerText || '').trim(), convertDirection));
      if (units.length === 0) {
        SK.sendLog('info', 'translate', 'convertOnly: no convertible units, silent exit');
        releaseRunState(myAbortController);
        return;
      }
    }

    const pm = settings.partialMode;
    const pmActive = !options.ignorePartialMode && !convertOnly
      && !!(pm && pm.enabled === true && Number.isFinite(pm.maxUnits) && pm.maxUnits >= 1);
    STATE.partialModeActive = pmActive;

    if (!pmActive) {
      const t_priority_start = Date.now();
      units = SK.prioritizeUnits(units);
      SK.sendLog('info', 'translate', 'milestone:prioritize_done', { t: Date.now() - entryTime, dt: Date.now() - t_priority_start });
    } else {
      SK.sendLog('info', 'translate', 'partialMode: skip prioritizeUnits, use DOM order', { totalUnits: units.length });
    }

    let maxTotalUnits = SK.DEFAULT_MAX_TOTAL_UNITS;
    {
      const v = settings.maxTranslateUnits;
      if (Number.isFinite(v) && v >= 0) maxTotalUnits = v;
    }

    let truncatedCount = 0;
    if (maxTotalUnits > 0 && units.length > maxTotalUnits) {
      truncatedCount = units.length - maxTotalUnits;
      SK.sendLog('warn', 'translate', 'page truncated', { total: units.length, limit: maxTotalUnits, skipped: truncatedCount });
      units = units.slice(0, maxTotalUnits);
    }

    let pmSkippedCount = 0;
    if (pmActive && units.length > pm.maxUnits) {
      pmSkippedCount = units.length - pm.maxUnits;
      SK.sendLog('info', 'translate', 'partialMode: truncate units', { total: units.length, kept: pm.maxUnits, skipped: pmSkippedCount });
      units = units.slice(0, pm.maxUnits);
    }

    const total = units.length;

    const glossaryEnabled = SK.resolveGlossaryEnabled(settings);
    let skipThreshold = SK.GLOSSARY_SKIP_THRESHOLD_DEFAULT;
    let blockingThreshold = SK.GLOSSARY_BLOCKING_THRESHOLD_DEFAULT;
    let glossaryTimeout = SK.GLOSSARY_TIMEOUT_DEFAULT;
    {
      const gc = settings.glossary;
      if (gc) {
        skipThreshold = gc.skipThreshold ?? skipThreshold;
        blockingThreshold = gc.blockingThreshold ?? blockingThreshold;
        glossaryTimeout = gc.timeoutMs ?? glossaryTimeout;
      }
    }

    const t_preser_start = Date.now();
    const preSerialized = units.map(unit => {
      return { text: (unit.el?.innerText || '').trim() };
    });
    const preTexts = preSerialized.map(s => s.text);
    SK.sendLog('info', 'translate', 'milestone:preserialize_done', { t: Date.now() - entryTime, dt: Date.now() - t_preser_start });

    let estUnitsPerBatch = SK.DEFAULT_UNITS_PER_BATCH;
    let estCharsPerBatch = SK.DEFAULT_CHARS_PER_BATCH;
    {
      const uv = settings.maxUnitsPerBatch;
      const cv = settings.maxCharsPerBatch;
      if (Number.isFinite(uv) && uv >= 1) estUnitsPerBatch = uv;
      if (Number.isFinite(cv) && cv >= 500) estCharsPerBatch = cv;
    }

    const _isConvertible = convertDirection
      ? preTexts.map(t => SK.isConvertibleVariant(t, convertDirection))
      : null;
    const llmPreTexts = _isConvertible ? preTexts.filter((_, i) => !_isConvertible[i]) : preTexts;

    let batchCount = 0;
    {
      let chars = 0, segs = 0;
      for (const t of llmPreTexts) {
        const len = t.length;
        if (len > estCharsPerBatch) { batchCount++; chars = 0; segs = 0; continue; }
        if (chars + len > estCharsPerBatch || segs >= estUnitsPerBatch) {
          batchCount++; chars = 0; segs = 0;
        }
        chars += len; segs++;
      }
      if (segs > 0) batchCount++;
    }

    let glossary = null;
    SK.sendLog('info', 'translate', 'milestone:glossary_decision', { t: Date.now() - entryTime, glossaryEnabled, skip: !glossaryEnabled || batchCount <= skipThreshold, batchCount, skipThreshold, blockingThreshold });

    if (glossaryEnabled && batchCount > skipThreshold && !(crypto && crypto.subtle)) {
      SK.sendLog('warn', 'glossary', 'crypto.subtle unavailable (insecure context) — skipping glossary');
    }
    if (glossaryEnabled && batchCount > skipThreshold && crypto && crypto.subtle) {
      const compressedText = SK.extractGlossaryInput(_isConvertible ? units.filter((_, i) => !_isConvertible[i]) : units);
      const inputHash = await SK.sha1(compressedText);
      SK.sendLog('info', 'glossary', 'glossary preprocessing', { batchCount, mode: batchCount > blockingThreshold ? 'blocking' : 'fire-and-forget', compressedChars: compressedText.length, hash: inputHash.slice(0, 8) });

      const _glossaryMsgType = SK.getGlossaryExtractType(options?.engine);
      if (batchCount > blockingThreshold) {
        SK.showToast('loading', SK.t('toast.glossaryBuilding'), { progress: 0, startTimer: true });
        try {
          const glossaryResult = await Promise.race([
            SK.safeSendMessage({
              type: _glossaryMsgType,
              payload: { compressedText, inputHash },
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('術語表逾時')), glossaryTimeout)
            ),
          ]);
          if (glossaryResult?.ok && glossaryResult.glossary?.length > 0) {
            glossary = glossaryResult.glossary;
            SK.sendLog('info', 'glossary', 'glossary ready', { terms: glossary.length, fromCache: !!glossaryResult.fromCache });
          } else if (glossaryResult?.ok) {
            SK.sendLog('warn', 'glossary', 'glossary returned empty', { fromCache: glossaryResult.fromCache, diag: glossaryResult._diag, inputTokens: glossaryResult.usage?.inputTokens || 0, outputTokens: glossaryResult.usage?.outputTokens || 0 });
          } else {
            SK.sendLog('warn', 'glossary', 'glossary returned not ok', { error: glossaryResult?.error, diag: glossaryResult?._diag });
          }
        } catch (err) {
          SK.sendLog('warn', 'glossary', 'glossary failed/timeout, proceeding without', { error: err.message });
        }
      } else {
        SK.showToast('loading', SK.t('toast.glossaryBuilding'), { progress: 0, startTimer: true });
        const glossaryPromise = SK.safeSendMessage({
          type: _glossaryMsgType,
          payload: { compressedText, inputHash },
        }).then(res => {
          if (res?.ok && res.glossary?.length > 0) {
            SK.sendLog('info', 'glossary', 'glossary arrived (async)', { terms: res.glossary.length });
            return res.glossary;
          }
          return null;
        }).catch(err => {
          SK.sendLog('warn', 'glossary', 'glossary async failed', { error: err.message });
          return null;
        });
        STATE._glossaryPromise = glossaryPromise;
      }
    }

    if (!glossary && STATE._glossaryPromise) {
      try {
        glossary = await Promise.race([
          STATE._glossaryPromise,
          new Promise(resolve => setTimeout(() => resolve(null), 2000)),
        ]);
      } catch (_) {   }
      STATE._glossaryPromise = null;
    }

    const progressText = (d, t) => (convertOnly
      ? SK.t('toast.zhConvertProgress', { prefix: labelPrefix, done: d, total: t })
      : SK.t('toast.translateProgress', { prefix: labelPrefix, done: d, total: t }));
    SK.showToast('loading', progressText(0, total), {
      progress: 0,
      startTimer: true,
    });

    let _progressClosed = false;

    try {
      SK.sendLog('info', 'translate', 'milestone:before_translate_units', { t: Date.now() - entryTime });
      let { done, failures, pageUsage, convertedCount } = await SK.translateUnits(units, {
        glossary,
        signal: abortSignal,
        modelOverride: options.modelOverride || null,
        engine: options.engine || 'gemini',
        convertDirection,
        convertOnly,
        ignorePartialMode: !!options.ignorePartialMode,
        onProgress: (d, t, mismatch) => {
          if (_progressClosed) return;
          SK.showToast('loading', progressText(d, t), {
            progress: d / t,
            mismatch: !!mismatch,
          });
        },
      });
      _progressClosed = true;

      const fallbackRun = convertOnly ? null : await SK.retryFailuresWithFallback(failures, options.fallback, {
        glossary, signal: abortSignal, convertDirection,
      });
      const fallbackDone = fallbackRun?.done || 0;
      if (fallbackRun) {
        done += fallbackRun.done;
        failures = fallbackRun.failures;
        pageUsage = SK.mergePageUsage(pageUsage, fallbackRun.pageUsage);
        convertedCount = (convertedCount || 0) + (fallbackRun.convertedCount || 0);
      }
      const onlyFallbackUsed = fallbackDone > 0 && fallbackDone === done;

      if (abortSignal.aborted) {
        const restoredEarly = _earlyRestoredAborts.has(myAbortController);
        const stillOwnsRun = STATE.abortController === myAbortController;
        SK.sendLog('info', 'translate', 'translation aborted', { done, total, restoredEarly, stillOwnsRun });
        if (!restoredEarly && stillOwnsRun) {
          restoreOriginalHTMLAndReset();
          SK.showToast('success', SK.t('toast.cancelled'), { progress: 1, stopTimer: true, autoHideMs: 2000 });
        }
        return;
      }

      if (failures.length) {
        const failedSegs = failures.reduce((s, f) => s + f.count, 0);
        const firstErr = failures[0].error;
        SK.showToast('error', SK.t('toast.partialFailed', { failed: failedSegs, total }), {
          stopTimer: true,
          detail: firstErr.slice(0, 120),
        });
      }

      if (done === 0 && failures.length > 0) {
        clearRunBadge();
        markConvertedAgain();
        return;
      }

      if (convertOnly && done === 0) {
        SK.sendLog('info', 'translate', 'convertOnly: done=0 (all skipped) — not marking translated');
        return;
      }

      STATE.translated = true;
      if (STATE.translatedMode === 'single') SK.applyDocTargetLang?.();
      if (convertOnly) {
        STATE.translatedBy = 'opencc-local';
        STATE.translationContext = { provider: 'opencc-local', convertDirection };
      } else if (onlyFallbackUsed) {
        // 主要引擎一段都沒翻成功, 整頁都是 failback 翻的: 之後的 rescan 直接用 failback
        STATE.translationContext = SK.buildTranslationContext(options.fallback, { glossary, convertDirection });
        STATE.translatedBy = STATE.translationContext.provider;
        STATE.stickyTranslate = true;
        STATE.stickySlot = options.slot ?? null;
        if (options.slot != null) {
          SK.safeSendMessage({ type: 'STICKY_SET', payload: { slot: options.slot } }).catch(() => {});
        }
      } else {
        const _providerUsed = options.engine === 'openai-compat' ? 'openai-compat' : 'gemini';
        STATE.translatedBy = _providerUsed;
        STATE.translationContext = {
          provider: _providerUsed,
          engine: options.engine || null,
          modelOverride: options.modelOverride || null,
          glossary: glossary || null,
          convertDirection,
          fallback: options.fallback || null,
        };
        STATE.stickyTranslate = true;
        STATE.stickySlot = options.slot ?? null;
        if (options.slot != null) {
          SK.safeSendMessage({ type: 'STICKY_SET', payload: { slot: options.slot } }).catch(() => {});
        }
      }

      if (!failures.length) {
        const totalTokens = pageUsage.inputTokens + pageUsage.outputTokens;
        let successMsg;
        if (convertOnly) {
          successMsg = SK.t('toast.zhConvertDone', { total });
        } else if (pmActive && pmSkippedCount > 0) {
          successMsg = SK.t('toast.donePartial', { total, all: total + pmSkippedCount });
        } else if (truncatedCount > 0) {
          successMsg = SK.t('toast.doneTruncated', { total, truncated: truncatedCount });
        } else {
          successMsg = SK.t('toast.done', { total });
        }
        let detail;
        if (totalTokens > 0) {
          const billedTotalTokens = pageUsage.billedInputTokens + pageUsage.outputTokens;
          let line1 = `${SK.formatTokens(billedTotalTokens)} tokens`;
          let line2 = SK.formatMoney(pageUsage.billedCostUSD);
          if (pageUsage.cachedTokens > 0 && pageUsage.inputTokens > 0) {
            const hitPct = (pageUsage.cachedTokens / pageUsage.inputTokens) * 100;
            const savedPct = pageUsage.costUSD > 0
              ? ((pageUsage.costUSD - pageUsage.billedCostUSD) / pageUsage.costUSD) * 100
              : 0;
            line1 += ` (${hitPct.toFixed(0)}% hit)`;
            line2 += ` (${savedPct.toFixed(0)}% saved)`;
          }
          detail = `${line1}\n${line2}`;
        } else if (pageUsage.cacheHits === total) {
          detail = SK.t('toast.allCacheHit');
        }
        if (convertOnly) {
          detail = SK.t('toast.zhConvertFree');
        } else if ((convertedCount || 0) > 0) {
          const _convLine = SK.t('toast.zhConvertPartial', { count: convertedCount });
          detail = detail ? `${detail}\n${_convLine}` : _convLine;
        }
        const _fbLines = SK.fallbackNoticeText(options, fallbackDone);
        if (_fbLines) detail = detail ? `${detail}\n${_fbLines}` : _fbLines;
        SK.sendLog('info', 'translate', 'page translation usage', {
          segments: total,
          inputTokens: pageUsage.inputTokens,
          cachedTokens: pageUsage.cachedTokens,
          outputTokens: pageUsage.outputTokens,
          billedInputTokens: pageUsage.billedInputTokens,
          billedTotalTokens: pageUsage.billedInputTokens + pageUsage.outputTokens,
          implicitCacheHitRate: pageUsage.inputTokens > 0
            ? `${((pageUsage.cachedTokens / pageUsage.inputTokens) * 100).toFixed(1)}%`
            : 'n/a',
          billedCostUSD: pageUsage.billedCostUSD,
          localCacheHitSegments: pageUsage.cacheHits,
          url: location.href,
        });
        if (convertOnly && SK.shouldHideZhConvertToast?.()) {
          SK.hideToast?.();
        } else {
        const updateNotice = await SK.maybeBuildUpdateNotice();
        const welcomeNotice = await SK.maybeBuildWelcomeNotice();
        const action = (pmActive && pmSkippedCount > 0) ? {
          label: SK.t('toast.translateRemaining'),
          onClick: () => {
            SK.translatePage({
              ...options,
              ignorePartialMode: true,
            });
          },
        } : null;
        SK.sendLog('info', 'translate', 'about to fire success toast', {
          successMsg, total, pmActive, pmSkippedCount, hasAction: !!action,
          ignorePartialMode: !!options.ignorePartialMode,
          done, failures: failures.length,
        });
        SK.showToast('success', successMsg, {
          progress: 1,
          stopTimer: true,
          detail,
          updateNotice,
          welcomeNotice,
          action,
        });
        }
      }

      if (done > 0 && !convertOnly && pageUsage.unlogged) {
        SK.safeSendMessage({
          type: 'LOG_USAGE',
          payload: {
            url: location.href,
            title: document.title,
            inputTokens: pageUsage.inputTokens,
            outputTokens: pageUsage.outputTokens,
            cachedTokens: pageUsage.cachedTokens,
            billedInputTokens: pageUsage.billedInputTokens,
            billedCostUSD: pageUsage.billedCostUSD,
            segments: total,
            cacheHits: pageUsage.cacheHits,
            durationMs: Date.now() - translateStartTime,
            timestamp: Date.now(),
            engine: options.engine || 'gemini',
            model: options.modelOverride || null,
          },
        }).catch(() => {});
      }

      scheduleRescanForLateContent();
      SK.startSpaObserver();
    } catch (err) {
      _progressClosed = true;
      SK.sendLog('error', 'translate', 'translatePage error', { error: err.message || String(err) });
      if (!abortSignal.aborted) {
        SK.showToast('error', SK.t('toast.translateFailed', { error: err.message }), { stopTimer: true });
      }
      if (!STATE.translated) clearRunBadge();
      if (!abortSignal.aborted) markConvertedAgain();
    } finally {
      _progressClosed = true;
      releaseRunState(myAbortController);
    }
  };

  function restoreInjectedDom() {
    if (STATE.translatedMode === 'dual' || (STATE.translationCache && STATE.translationCache.size > 0)) {
      SK.removeDualWrappers?.();
    }
    if (STATE.nodeValueMutateBackup && STATE.nodeValueMutateBackup.size > 0) {
      STATE.nodeValueMutateBackup.forEach((backup, el) => {
        backup.forEach(({ node, originalValue }) => {
          if (node) {
            try { node.nodeValue = originalValue; } catch (_) {}
          }
        });
        try {
          el.removeAttribute('data-transit-nodevalue-mutated');
          SK.restoreLocaleStyling?.(el);
        } catch (_) {}
      });
      STATE.nodeValueMutateBackup.clear();
    }
    let detached = 0;
    STATE.originalHTML.forEach((originalHTML, el) => {
      if (!el.isConnected) detached++;
      if (el.innerHTML !== originalHTML) el.innerHTML = originalHTML;
      el.removeAttribute('data-transit-translated');
      SK.restoreLocaleStyling?.(el);
    });
    STATE.originalHTML.clear();
    STATE.translatedHTML?.clear?.();
    STATE.translatedHTMLByText?.clear?.();
    STATE.originalText?.clear?.();
    STATE.originalLang?.clear?.();
    STATE.originalFontFamily?.clear?.();
    STATE.translationCache?.clear?.();
    STATE.hoverTranslated = false;
    SK.restoreDocLang?.();
    SK.sweepOrphanTranslationMarkers?.();
    return detached;
  }

  function restoreOriginalHTMLAndReset() {
    SK.abortRescanRuns();
    const detached = restoreInjectedDom();
    if (detached > 0) {
      SK.sendLog?.('warn', 'system', 'restoreOriginalHTMLAndReset: restored detached elements (framework may reattach)', { detached });
    }
    STATE.translated = false;
    SK.safeSendMessage({ type: 'CLEAR_BADGE' }).catch(() => {});
  }

  const _earlyRestoredAborts = new WeakSet();

  function abortInProgressTranslation({ silent = false } = {}) {
    SK.sendLog('info', 'translate', 'aborting in-progress translation (immediate restore)', { silent });
    const ac = STATE.abortController;
    if (ac) {
      _earlyRestoredAborts.add(ac);
      ac.abort();
    }
    restoreOriginalHTMLAndReset();
    if (!silent) {
      SK.showToast('success', SK.t('toast.cancelled'), { progress: 1, stopTimer: true, autoHideMs: 2000 });
    }
  }

  function releaseRunState(myAC) {
    if (STATE.abortController === myAC) {
      STATE.translating = false;
      STATE.translatingConvertOnly = false;
      STATE.abortController = null;
    }
  }

  function remarkConvertedPage(myAC) {
    if (STATE.abortController === myAC && !STATE.translated
        && STATE.translatedBy === 'opencc-local' && SK.isPageTranslated()) {
      STATE.translated = true;
    }
  }

  function restorePage() {
    const _noRestoreData = STATE.originalHTML.size === 0
      && (!STATE.translationCache || STATE.translationCache.size === 0)
      && (!STATE.nodeValueMutateBackup || STATE.nodeValueMutateBackup.size === 0);
    if (_noRestoreData && SK.INSTANCE?.stoodDown) {
      SK.sendLog?.('info', 'system', 'restorePage ignored (instance stood down, markers belong to leader)');
      return;
    }
    if (_noRestoreData && SK.isPageTranslated()) {
      SK.sendLog?.('warn', 'system', 'restorePage: markers present but no restore data, reloading to original');
      document.querySelectorAll('[data-transit-translated], [data-transit-nodevalue-mutated]')
        .forEach((el) => {
          el.removeAttribute('data-transit-translated');
          el.removeAttribute('data-transit-nodevalue-mutated');
        });
      STATE.translated = false;
      SK.safeSendMessage({ type: 'CLEAR_BADGE' }).catch(() => {});
      location.reload();
      return;
    }
    if (editModeActive) toggleEditMode(false);
    SK.cancelRescan();
    SK.abortRescanRuns();
    SK.stopSpaObserver();
    SK.clearAnnotationDedupeRules?.();

    const restoreDetached = restoreInjectedDom();
    if (restoreDetached > 0) {
      SK.sendLog?.('warn', 'system', 'restorePage: restored detached elements (framework may reattach)', { detached: restoreDetached });
    }
    STATE.translated = false;
    STATE.translatedBy = null;
    STATE.translationContext = null;
    STATE.translatedMode = null;
    STATE.stickyTranslate = false;
    STATE.stickySlot = null;
    STATE.partialModeActive = false;
    SK.safeSendMessage({ type: 'CLEAR_BADGE' }).catch(() => {});
    SK.safeSendMessage({ type: 'STICKY_CLEAR' }).catch(() => {});
    SK.showToast('success', SK.t('toast.restored'), { progress: 1, autoHideMs: 2000 });
  }

  SK.translateUnitsGoogle = async function translateUnitsGoogle(units, { onProgress, signal } = {}) {
    SK.clearAnnotationDedupeRules?.();
    let serialized = units.map(unit => {
      if (unit.kind === 'fragment') {
        return SK.serializeFragmentForGoogleTranslate(unit);
      }
      return SK.serializeForGoogleTranslate(unit.el);
    });

    ({ units, serialized } = dropEmptyUnits(units, serialized, 'empty-text units dropped before API (google)'));
    const total = units.length;

    const texts = serialized.map(s => s.text);
    const slotsList = serialized.map(s => s.slots);

    let done = 0;
    let totalChars = 0;
    let totalCacheHits = 0;
    const failures = [];

    const jobs = packBatches(texts, units, slotsList, 20, 4000, SK.BATCH0_UNITS, SK.BATCH0_CHARS);
    const t0All = Date.now();
    SK.sendLog('info', 'translate', 'translateUnitsGoogle start', { batches: jobs.length, total });

    const runBatch = async (job) => {
      if (signal?.aborted) return;
      const batchIdx = job.idx;
      try {
        const response = await sendMessageWithTimeout({
          type: 'TRANSLATE_BATCH_GOOGLE',
          payload: { texts: job.texts },
        }, BATCH_TIMEOUT_MS);
        if (!response?.ok) throw new Error(SK.i18n.bgErrorMessage(response) || SK.t('common.errorUnknown'));
        totalChars += response.usage?.chars || 0;
        totalCacheHits += response.usage?.cacheHits || 0;
        const translations = response.result;
        if (!SK._idleGateReached) {
          await SK.ensureFirstInjectIdle();
        }
        if (signal?.aborted) return;
        translations.forEach((tr, j) => {
          const unit = job.units[j];
          if (!tr) return;
          const slots = job.slots[j];
          let restored = slots?.length
            ? SK.restoreGoogleTranslateMarkers(tr)
            : tr;
          if (slots?.length && SK.ensureCJKSlotSpacing) {
            restored = SK.ensureCJKSlotSpacing(restored);
          }
          try {
            SK.injectTranslation(unit, restored, slots || []);
          } catch (injectErr) {
            SK.sendLog('warn', 'translate', 'google inject failed (unit skipped)', { batch: batchIdx + 1, j, error: injectErr.message });
          }
        });
        done += job.texts.length;
        if (onProgress) onProgress(done, total);
      } catch (err) {
        SK.sendLog('error', 'translate', `google batch ${batchIdx + 1} FAILED`, { error: err.message });
        failures.push({ start: job.start, count: job.texts.length, error: err.message, units: job.units });
      }
    };

    if (jobs.length > 0) {
      await runBatch(jobs[0]);
      if (jobs.length > 1 && !signal?.aborted) {
        await runWithConcurrency(jobs.slice(1), 5, runBatch, signal);
      }
    }

    SK.sendLog('info', 'translate', 'translateUnitsGoogle complete', {
      elapsed: Date.now() - t0All, done, total, failures: failures.length, chars: totalChars,
      cacheHits: totalCacheHits,
    });

    return { done, total, failures, chars: totalChars, cacheHits: totalCacheHits };
  };

  // 用指定引擎翻譯 units. spec = { engine: 'gemini' | 'google' | 'openai-compat', model, label }
  SK.translateUnitsWithEngine = async function translateUnitsWithEngine(units, spec, opts = {}) {
    if (spec?.engine === 'google') {
      const r = await SK.translateUnitsGoogle(units, { signal: opts.signal, onProgress: opts.onProgress });
      return { ...r, pageUsage: { cacheHits: r.cacheHits || 0 } };
    }
    const engine = spec?.engine === 'openai-compat' ? 'openai-compat' : 'gemini';
    return SK.translateUnits(units, {
      ...opts,
      engine,
      modelOverride: engine === 'gemini' ? (spec?.model || null) : null,
    });
  };

  // 主要引擎失敗的段落改用 failback 引擎補翻. 沒有 failback 或沒有可補翻的段落時回傳 null
  SK.retryFailuresWithFallback = async function retryFailuresWithFallback(failures, fallback, opts = {}) {
    if (!fallback || !failures || failures.length === 0 || opts.signal?.aborted) return null;
    const failedUnits = failures.flatMap((f) => f.units || []);
    if (failedUnits.length === 0) return null;
    const label = fallback.label || fallback.engine;
    SK.sendLog('info', 'translate', 'fallback: retry failed units', {
      units: failedUnits.length, engine: fallback.engine, model: fallback.model || null, firstError: failures[0].error,
    });
    const onProgress = opts.silent ? undefined : (d, t) => {
      SK.showToast('loading', SK.t('toast.fallbackProgress', { label, done: d, total: t }), { progress: t ? d / t : 0 });
    };
    if (onProgress) onProgress(0, failedUnits.length);
    const r = await SK.translateUnitsWithEngine(failedUnits, fallback, {
      glossary: opts.glossary || null,
      signal: opts.signal,
      convertDirection: opts.convertDirection || null,
      ignorePartialMode: true,
      onProgress,
    });
    SK.sendLog('info', 'translate', 'fallback: done', { done: r.done, failures: r.failures.length });
    return r;
  };

  SK.mergePageUsage = function mergePageUsage(base, extra) {
    if (!extra) return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = (Number(out[k]) || 0) + v;
    }
    if (extra.unlogged) out.unlogged = true;
    return out;
  };

  // failback 引擎的 translationContext (給 rescan / SPA 重播使用)
  SK.buildTranslationContext = function buildTranslationContext(spec, { glossary = null, convertDirection = null } = {}) {
    if (spec?.engine === 'google') return { provider: 'google', fallback: null };
    const engine = spec?.engine === 'openai-compat' ? 'openai-compat' : 'gemini';
    return {
      provider: engine,
      engine,
      modelOverride: engine === 'gemini' ? (spec?.model || null) : null,
      glossary,
      convertDirection,
      fallback: null,
    };
  };

  // 成功 toast 的附加說明: 主要引擎不可用的提示, 以及 failback 補翻的段落數
  SK.fallbackNoticeText = function fallbackNoticeText(options, fallbackDone) {
    const lines = [];
    if (options?.primaryNotice) lines.push(options.primaryNotice);
    if (fallbackDone > 0 && options?.fallback) {
      lines.push(SK.t('toast.fallbackUsed', { label: options.fallback.label || options.fallback.engine, count: fallbackDone }));
    }
    return lines.join('\n');
  };

  SK.translateUnitsByProvider = async function translateUnitsByProvider(units, opts = {}) {
    if (!opts.signal) opts = { ...opts, signal: SK.getRescanSignal() };
    const ctx = STATE.translationContext;
    if (!ctx) {
      SK.sendLog?.('warn', 'translate', 'translateUnitsByProvider: no translationContext, fallback to default gemini');
      return SK.translateUnits(units, opts);
    }
    if (ctx.provider === 'opencc-local') {
      return SK.translateUnits(units, {
        ...opts,
        convertDirection: ctx.convertDirection,
        convertOnly: true,
      });
    }
    let r;
    if (ctx.provider === 'google') {
      const g = await SK.translateUnitsGoogle(units, opts);
      r = { ...g, pageUsage: { cacheHits: g.cacheHits || 0 } };
    } else {
      r = await SK.translateUnits(units, {
        ...opts,
        engine: ctx.engine || undefined,
        modelOverride: ctx.modelOverride || undefined,
        glossary: ctx.glossary || undefined,
        convertDirection: ctx.convertDirection || undefined,
      });
    }
    const fb = await SK.retryFailuresWithFallback(r.failures, ctx.fallback, {
      signal: opts.signal,
      glossary: ctx.glossary || null,
      convertDirection: ctx.convertDirection || null,
      silent: true,
    });
    if (!fb) return r;
    return { ...r, done: r.done + fb.done, failures: fb.failures };
  };

  SK.replayTranslateByProvider = function replayTranslateByProvider() {
    const ctx = STATE.translationContext;
    if (!ctx) return SK.translatePage();
    if (ctx.provider === 'google') return SK.translatePageGoogle({ fallback: ctx.fallback || null });
    if (ctx.provider === 'opencc-local') return SK.translatePage({ convertOnly: true });
    return SK.translatePage({
      engine: ctx.engine || undefined,
      modelOverride: ctx.modelOverride || undefined,
      fallback: ctx.fallback || null,
    });
  };

  let _zhConvertWatch = null;
  SK.autoConvertZhWithRetry = async function autoConvertZhWithRetry() {
    const MAX_ATTEMPTS = 4;
    const DEBOUNCE_MS = 1200;
    if (_zhConvertWatch) {
      try { _zhConvertWatch.obs.disconnect(); } catch (_) {}
      clearTimeout(_zhConvertWatch.timer);
      _zhConvertWatch = null;
    }
    await SK.translatePage({ convertOnly: true });
    if (STATE.translated || STATE.translating) return;
    const t = STATE.targetLanguage;
    if (t !== 'zh-TW' && t !== 'zh-CN') return;
    let attempts = 0;
    const watch = { obs: null, timer: null };
    _zhConvertWatch = watch;
    const finish = () => {
      try { watch.obs.disconnect(); } catch (_) {}
      clearTimeout(watch.timer);
      if (_zhConvertWatch === watch) _zhConvertWatch = null;
    };
    const retry = async () => {
      watch.timer = null;
      if (STATE.translated || STATE.translating) return finish();
      attempts += 1;
      SK.sendLog('info', 'translate', 'convertOnly late-render retry', { attempt: attempts, max: MAX_ATTEMPTS });
      await SK.translatePage({ convertOnly: true });
      if (STATE.translated || STATE.translating || attempts >= MAX_ATTEMPTS) return finish();
    };
    watch.obs = new MutationObserver(() => {
      if (watch.timer != null) return;
      watch.timer = setTimeout(retry, DEBOUNCE_MS);
    });
    try {
      watch.obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (_) { finish(); }
  };

  SK.translatePageGoogle = async function translatePageGoogle(gtOptions = {}) {
    const labelPrefix = gtOptions.label ? `[${gtOptions.label}] ` : '';
    if (SK.isEmbeddedPlayerFrame?.(document, window)) {
      SK.sendLog('info', 'translate', 'embedded player frame, skip translate (google)', { url: location.href });
      return;
    }
    if (SK.isInstanceLeader && !SK.isInstanceLeader()) {
      SK.sendLog('info', 'translate', 'skip translate (another instance leads, google)', { url: location.href });
      return;
    }
    if (STATE.translated && STATE.translatedBy === 'google' && !gtOptions.ignorePartialMode) {
      restorePage();
      return;
    }
    if (STATE.translated && gtOptions.ignorePartialMode) {
      STATE.translated = false;
    }

    if (STATE.translating) {
      if (STATE.abortController && !STATE.abortController.signal.aborted) {
        if (STATE.translatingConvertOnly) {
          abortInProgressTranslation({ silent: true });
        } else {
          abortInProgressTranslation();
          return;
        }
      }
    }

    let resumeConvertedOnFail = false;
    if (STATE.translated && STATE.translatedBy === 'opencc-local'
        && (gtOptions.overConverted || SK.hasSubstantialUntranslated(1))) {
      SK.sendLog('info', 'translate', 'page only locally converted, proceed to full translate instead of toggle restore (google)');
      STATE.translated = false;
      resumeConvertedOnFail = true;
    }

    if (STATE.translated) {
      restorePage();
    }

    if (!navigator.onLine) {
      SK.showToast('error', SK.t('toast.offline'), { autoHideMs: 5000 });
      if (resumeConvertedOnFail) STATE.translated = true;
      return;
    }

    STATE.translating = true;
    STATE.translatingConvertOnly = false;
    const myAbortController = new AbortController();
    STATE.abortController = myAbortController;
    const abortSignal = myAbortController.signal;
    SK.abortRescanRuns();
    SK.safeSendMessage({ type: 'SET_BADGE_TRANSLATED' }).catch(() => {});
    const markConvertedAgain = () => {
      if (resumeConvertedOnFail) remarkConvertedPage(myAbortController);
    };

    let settings = {};
    try { settings = await browser.storage.sync.get(null); } catch (_) {}
    SK.applyTranslateDisplaySettings(settings);

    const translateStartTime = Date.now();

    let units = SK.collectParagraphs();
    if (STATE.translatedMode === 'dual' && SK.consolidateDualInlineUnits) {
      units = SK.consolidateDualInlineUnits(units);
    }
    if (units.length === 0) {
      SK.showToast('error', SK.t('toast.noContent'), { autoHideMs: 3000 });
      SK.safeSendMessage({ type: 'CLEAR_BADGE' }).catch(() => {});
      markConvertedAgain();
      releaseRunState(myAbortController);
      return;
    }

    const pm = settings.partialMode;
    const pmActive = !gtOptions.ignorePartialMode
      && !!(pm && pm.enabled === true && Number.isFinite(pm.maxUnits) && pm.maxUnits >= 1);
    STATE.partialModeActive = pmActive;
    if (!pmActive) {
      units = SK.prioritizeUnits(units);
    }

    let maxTotalUnits = SK.DEFAULT_MAX_TOTAL_UNITS;
    const v = settings.maxTranslateUnits;
    if (Number.isFinite(v) && v >= 0) maxTotalUnits = v;
    let truncatedCount = 0;
    if (maxTotalUnits > 0 && units.length > maxTotalUnits) {
      truncatedCount = units.length - maxTotalUnits;
      units = units.slice(0, maxTotalUnits);
    }
    if (pmActive && units.length > pm.maxUnits) {
      units = units.slice(0, pm.maxUnits);
    }
    const total = units.length;

    SK.showToast('loading', SK.t('toast.translateProgressGoogle', { prefix: labelPrefix, done: 0, total }), { progress: 0, startTimer: true });

    let _progressClosed = false;

    try {
      let { done, failures, chars } = await SK.translateUnitsGoogle(units, {
        signal: abortSignal,
        onProgress: (d, t) => {
          if (_progressClosed) return;
          SK.showToast('loading', SK.t('toast.translateProgressGoogle', { prefix: labelPrefix, done: d, total: t }), {
            progress: d / t,
          });
        },
      });
      _progressClosed = true;

      const _tl = STATE.targetLanguage;
      const _convDir = SK.convertDirectionFor(_tl);
      const fallbackRun = await SK.retryFailuresWithFallback(failures, gtOptions.fallback, {
        signal: abortSignal,
        convertDirection: _convDir,
      });
      const fallbackDone = fallbackRun?.done || 0;
      if (fallbackRun) {
        done += fallbackRun.done;
        failures = fallbackRun.failures;
      }
      const onlyFallbackUsed = fallbackDone > 0 && fallbackDone === done;

      if (abortSignal.aborted) {
        if (!_earlyRestoredAborts.has(myAbortController) && STATE.abortController === myAbortController) {
          restoreOriginalHTMLAndReset();
          SK.showToast('success', SK.t('toast.cancelled'), { progress: 1, stopTimer: true, autoHideMs: 2000 });
        }
        return;
      }

      if (failures.length) {
        const failedSegs = failures.reduce((s, f) => s + f.count, 0);
        SK.showToast('error', SK.t('toast.partialFailed', { failed: failedSegs, total }), {
          stopTimer: true,
          detail: failures[0].error.slice(0, 120),
        });
      }

      if (done === 0 && failures.length > 0) {
        SK.safeSendMessage({ type: 'CLEAR_BADGE' }).catch(() => {});
        markConvertedAgain();
        return;
      }

      STATE.translated = true;
      if (STATE.translatedMode === 'single') SK.applyDocTargetLang?.();
      STATE.translationContext = onlyFallbackUsed
        ? SK.buildTranslationContext(gtOptions.fallback, { convertDirection: _convDir })
        : { provider: 'google', fallback: gtOptions.fallback || null };
      STATE.translatedBy = STATE.translationContext.provider;
      STATE.stickyTranslate = true;
      STATE.stickySlot = gtOptions.slot ?? null;
      if (gtOptions.slot != null) {
        SK.safeSendMessage({ type: 'STICKY_SET', payload: { slot: gtOptions.slot } }).catch(() => {});
      }

      if (!failures.length) {
        const successMsg = truncatedCount > 0
          ? SK.t('toast.googleDoneTruncated', { total, truncated: truncatedCount })
          : SK.t('toast.googleDone', { total });
        const updateNotice = await SK.maybeBuildUpdateNotice();
        const welcomeNotice = await SK.maybeBuildWelcomeNotice();
        let detail = SK.t('toast.googleFreeDetail', { chars: chars.toLocaleString() });
        const _fbLines = SK.fallbackNoticeText(gtOptions, fallbackDone);
        if (_fbLines) detail = `${detail}\n${_fbLines}`;
        SK.showToast('success', successMsg, {
          progress: 1,
          stopTimer: true,
          detail,
          updateNotice,
          welcomeNotice,
        });
      }

      SK.sendLog('info', 'translate', 'google page translation done', {
        segments: total, chars, elapsed: Date.now() - translateStartTime, url: location.href,
      });

      scheduleRescanForLateContent();
      SK.startSpaObserver();
    } catch (err) {
      _progressClosed = true;
      SK.sendLog('error', 'translate', 'translatePageGoogle error', { error: err.message || String(err) });
      if (!abortSignal.aborted) {
        SK.showToast('error', SK.t('toast.translateFailed', { error: err.message }), { stopTimer: true });
      }
      if (!STATE.translated) SK.safeSendMessage({ type: 'CLEAR_BADGE' }).catch(() => {});
      if (!abortSignal.aborted) markConvertedAgain();
    } finally {
      _progressClosed = true;
      releaseRunState(myAbortController);
    }
  };

  let editModeActive = false;

  let editBarHost = null;
  let editBarEls = null;
  const editPreEditHTML = new Map();
  const editUndoOrder = [];

  const EDIT_BAR_CSS = `
      :host, * { box-sizing: border-box; }
      .bar {
        position: fixed;
        bottom: calc(24px + env(safe-area-inset-bottom, 0px));
        left: 50%;
        transform: translateX(-50%);
        display: none;
        align-items: center;
        gap: 12px;
        max-width: calc(100vw - 32px);
        padding: 10px 12px 10px 16px;
        background: rgba(28, 33, 43, .96);
        color: #e8eaed;
        border-radius: 12px;
        box-shadow: 0 8px 28px rgba(0, 0, 0, .35);
        font: 14px -apple-system, 'PingFang TC', 'Microsoft JhengHei', sans-serif;
        white-space: nowrap;
      }
      .bar.show { display: flex; }
      .hint {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .btn {
        cursor: pointer;
        font: inherit;
        font-weight: 600;
        border: none;
        border-radius: 8px;
        padding: 6px 14px;
        background: transparent;
        user-select: none;
        -webkit-user-select: none;
      }
      .btn-undo { color: #9aa0a6; }
      .btn-undo:not(:disabled):hover { color: #ffffff; background: rgba(255, 255, 255, .08); }
      .btn-undo:disabled { opacity: .45; cursor: default; }
      .btn-done { background: #2f6fed; color: #ffffff; }
      .btn-done:hover { background: #2861d4; }
  `;

  function ensureEditBar() {
    if (editBarEls) return editBarEls;
    editBarHost = document.createElement('div');
    editBarHost.id = 'transit-edit-bar-host';
    editBarHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    const shadow = editBarHost.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(EDIT_BAR_CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const styleEl = document.createElement('style');
      styleEl.textContent = EDIT_BAR_CSS;
      shadow.appendChild(styleEl);
    }
    const bar = document.createElement('div');
    bar.className = 'bar';
    const hint = document.createElement('span');
    hint.className = 'hint';
    const undoBtn = document.createElement('button');
    undoBtn.className = 'btn btn-undo';
    undoBtn.addEventListener('click', editBarUndo);
    const doneBtn = document.createElement('button');
    doneBtn.className = 'btn btn-done';
    doneBtn.addEventListener('click', () => toggleEditMode(false));
    bar.append(hint, undoBtn, doneBtn);
    shadow.appendChild(bar);
    editBarEls = { bar, hint, undoBtn, doneBtn };
    return editBarEls;
  }

  function updateEditBarUndoState() {
    if (editBarEls) editBarEls.undoBtn.disabled = editUndoOrder.length === 0;
  }

  function showEditBar() {
    const els = ensureEditBar();
    els.hint.textContent = SK.t('editbar.hint');
    els.undoBtn.textContent = SK.t('editbar.undo');
    els.doneBtn.textContent = SK.t('editbar.done');
    updateEditBarUndoState();
    if (!editBarHost.isConnected) {
      (document.body || document.documentElement).appendChild(editBarHost);
    }
    els.bar.classList.add('show');
  }

  function hideEditBar() {
    if (editBarEls) editBarEls.bar.classList.remove('show');
  }

  function onEditPaste(e) {
    const t = e.target;
    const node = t && (t.nodeType === Node.ELEMENT_NODE ? t : t.parentElement);
    const el = node?.closest?.('[data-transit-translated][contenteditable="true"]');
    if (!el) return;
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    snapshotEditEl(el);
    document.execCommand('insertText', false, text);
  }

  const editLinkRepair = window.__SKEditLinkRepair.createEditLinkRepair({
    isEditableHost: (el) => el.hasAttribute('data-transit-translated'),
  });

  function snapshotEditEl(el) {
    if (!el || editPreEditHTML.has(el)) return;
    editPreEditHTML.set(el, el.innerHTML);
    editUndoOrder.push(el);
    updateEditBarUndoState();
  }

  function onEditBeforeInput(e) {
    const t = e.target;
    if (!t || t.nodeType !== Node.ELEMENT_NODE) return;
    const el = t.closest?.('[data-transit-translated][contenteditable="true"]');
    if (!el) return;
    snapshotEditEl(el);
    editLinkRepair.onBeforeInput(e);
  }

  function editBarUndo() {
    const el = editUndoOrder.pop();
    if (el && editPreEditHTML.has(el)) {
      if (el.isConnected) el.innerHTML = editPreEditHTML.get(el);
      editPreEditHTML.delete(el);
    }
    editLinkRepair.reset();
    updateEditBarUndoState();
  }

  function resetEditUndoStack() {
    editPreEditHTML.clear();
    editUndoOrder.length = 0;
    editLinkRepair.reset();
  }

  function toggleEditMode(forceState) {
    if (!STATE.translated && forceState !== false) {
      return { ok: false, error: 'translation not complete' };
    }
    const enable = typeof forceState === 'boolean' ? forceState : !editModeActive;
    const els = document.querySelectorAll('[data-transit-translated]');
    if (enable && els.length === 0) return { ok: false, error: 'no translated elements' };

    for (const el of els) {
      if (enable) {
        el.setAttribute('contenteditable', 'true');
        el.classList.add('transit-editable');
      } else {
        el.removeAttribute('contenteditable');
        el.classList.remove('transit-editable');
        if (STATE.translatedHTML.has(el)) {
          STATE.translatedHTML.set(el, el.innerHTML);
          SK.refreshAncestorSavedHTML?.(el);
        }
      }
    }
    resetEditUndoStack();
    if (enable) {
      document.addEventListener('beforeinput', onEditBeforeInput, true);
      document.addEventListener('paste', onEditPaste, true);
      document.addEventListener('input', editLinkRepair.onInput, true);
      document.addEventListener('compositionend', editLinkRepair.onCompositionEnd, true);
      document.addEventListener('pointerdown', editLinkRepair.onPointerDown, true);
      document.addEventListener('keydown', editLinkRepair.onKeyDown, true);
      showEditBar();
    } else {
      document.removeEventListener('beforeinput', onEditBeforeInput, true);
      document.removeEventListener('paste', onEditPaste, true);
      document.removeEventListener('input', editLinkRepair.onInput, true);
      document.removeEventListener('compositionend', editLinkRepair.onCompositionEnd, true);
      document.removeEventListener('pointerdown', editLinkRepair.onPointerDown, true);
      document.removeEventListener('keydown', editLinkRepair.onKeyDown, true);
      hideEditBar();
    }
    editModeActive = enable;
    SK.sendLog('info', 'system', enable ? 'edit mode ON' : 'edit mode OFF', { elements: els.length });
    return { ok: true, editing: editModeActive, elements: els.length };
  }

  SK.exitEditModeIfActive = function exitEditModeIfActive() {
    if (editModeActive) toggleEditMode(false);
  };

  function untranslatedPartialKind() {
    if (STATE.translated && STATE.translatedBy === 'opencc-local') {
      return SK.hasSubstantialUntranslated(1) ? 'converted' : null;
    }
    if (!STATE.translated && STATE.hoverTranslated) {
      return SK.hasSubstantialUntranslated() ? 'hover' : null;
    }
    return null;
  }

  // sticky 只有一種翻譯動作, 固定記為 1 (background 的 STICKY_SET 只接受正整數)
  const TRANSLATE_STICKY_SLOT = 1;

  // i18n-content.js 以字面字串收集 key, 所以這裡要寫完整的 key
  const ENGINE_REASON_KEYS = {
    apiKeyMissing: 'engineReason.apiKeyMissing',
    baseUrlMissing: 'engineReason.baseUrlMissing',
    engineMissing: 'engineReason.engineMissing',
  };

  // 決定這次要用哪個引擎: 主要引擎不能用 (例如沒有 API Key) 時直接改用 failback
  SK.resolveTranslatePlan = async function resolveTranslatePlan() {
    let chain = null;
    try {
      const resp = await SK.safeSendMessage({ type: 'GET_TRANSLATE_CHAIN' });
      if (resp?.ok && resp.chain?.primary) chain = resp.chain;
    } catch (_) {   }
    if (!chain) {
      const D = SK.DEFAULT_TRANSLATE_ENGINES;
      chain = { primary: D.primary, fallback: D.fallback, primaryReason: null, fallbackReason: null };
    }
    const fallbackOk = !!chain.fallback && !chain.fallbackReason;
    if (chain.primaryReason && fallbackOk) {
      SK.sendLog('info', 'translate', 'primary engine unavailable, use fallback', { reason: chain.primaryReason, fallback: chain.fallback.engine });
      return {
        engine: chain.fallback,
        fallback: null,
        primaryNotice: SK.t('toast.primaryUnavailable', {
          label: chain.primary.label || chain.primary.engine,
          reason: SK.t(ENGINE_REASON_KEYS[chain.primaryReason] || 'engineReason.engineMissing'),
        }),
      };
    }
    return { engine: chain.primary, fallback: fallbackOk ? chain.fallback : null, primaryNotice: null };
  };

  function runPageWithEngine(spec, extra = {}) {
    const base = {
      slot: TRANSLATE_STICKY_SLOT,
      label: spec.label || null,
      overConverted: !!extra.overConverted,
      fallback: extra.fallback || null,
      primaryNotice: extra.primaryNotice || null,
    };
    if (spec.engine === 'google') return SK.translatePageGoogle(base);
    if (spec.engine === 'openai-compat') return SK.translatePage({ ...base, engine: 'openai-compat' });
    return SK.translatePage({ ...base, modelOverride: spec.model || null });
  }

  // 翻譯本頁 (快速鍵, 工具列按鈕, 浮動按鈕, 自動翻譯共用): 已翻譯時還原, 翻譯中時取消
  async function handleTranslate(opts = {}) {
    const force = opts.force === true;
    if (SK.INSTANCE?.stoodDown) {
      SK.sendLog('info', 'translate', 'translate ignored (this instance stood down)');
      return;
    }
    if (STATE.translating) {
      if (STATE.abortController && !STATE.abortController.signal.aborted) {
        if (STATE.translatingConvertOnly) {
          abortInProgressTranslation({ silent: true });
        } else {
          abortInProgressTranslation();
          return;
        }
      }
    }
    let overConverted = false;
    if (SK.isPageTranslated()) {
      const partial = untranslatedPartialKind();
      if (partial === 'converted') {
        overConverted = true;
        SK.sendLog('info', 'translate', 'page only locally converted, proceed to full translate instead of toggle restore (preset)');
      } else if (partial === 'hover' && !force) {
        SK.sendLog('info', 'translate', 'page only hover-translated, proceed to full translate instead of toggle restore');
      } else {
        restorePage();
        if (!force) return;
      }
    }
    const plan = await SK.resolveTranslatePlan();
    runPageWithEngine(plan.engine, { overConverted, fallback: plan.fallback, primaryNotice: plan.primaryNotice });
  }
  SK.handleTranslate = handleTranslate;

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'TOGGLE_TRANSLATE') {
      handleTranslate();
      return;
    }
    if (msg?.type === 'TOGGLE_EDIT_MODE') {
      sendResponse(toggleEditMode());
      return true;
    }
    if (msg?.type === 'GET_STATE') {
      const injected = SK.isPageTranslated();
      sendResponse({
        ok: true,
        translated: injected && !untranslatedPartialKind(),
        injected,
        editing: editModeActive,
      });
      return true;
    }
    if (msg?.type === 'YT_RESET_AFTER_CACHE_CLEAR') {
      try { SK.YT?._resetTranslationStateForCacheClear?.(); } catch (_) {}
      return;
    }
    if (msg?.type === 'MODE_CHANGED') {
      const mode = msg.mode === 'dual' ? 'dual' : 'single';
      if (STATE.translated) {
        const desc = SK.t(mode === 'dual' ? 'popup.label.modeDual' : 'popup.label.modeSingle');
        SK.showToast('success', SK.t('toast.modeChanged', { desc }), {
          autoHideMs: 5000,
        });
      }
      return;
    }
    if (msg?.type === 'SET_AUTO_CONVERT_ZH') {
      const enabled = !!msg.payload?.enabled;
      if (enabled) {
        if (!STATE.translated && !STATE.translating) {
          SK.translatePage({ convertOnly: true }).catch(err => {
            SK.sendLog('warn', 'system', 'SET_AUTO_CONVERT_ZH convert failed', { error: err.message });
          });
        }
      } else if (STATE.translated && STATE.translatedBy === 'opencc-local') {
        restorePage();
      }
      return;
    }
    if (msg?.type === 'SET_SUBTITLE') {
      const enabled = !!msg.payload?.enabled;
      const active = !!(SK.YT && SK.YT.active);
      if (enabled && !active) {
        SK.translateYouTubeSubtitles?.().catch(err => {
          SK.sendLog('warn', 'system', 'SET_SUBTITLE start failed', { error: err.message });
        });
      } else if (!enabled && active) {
        try { SK.stopYouTubeTranslation?.(); }
        catch (err) {
          SK.sendLog('warn', 'system', 'SET_SUBTITLE stop failed', { error: err.message });
        }
      }
      return;
    }
  });

  window.__transit_translate = SK.translatePage;

  function buildSelectorPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 6) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) {
        s += '#' + cur.id;
        parts.unshift(s);
        break;
      }
      if (cur.className && typeof cur.className === 'string') {
        const cls = cur.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (cls) s += '.' + cls;
      }
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function unitSummary(unit, i) {
    if (unit.kind === 'fragment') {
      let text = '';
      let n = unit.startNode;
      while (n) {
        text += n.textContent || '';
        if (n === unit.endNode) break;
        n = n.nextSibling;
      }
      const trimmed = text.trim();
      return {
        index: i,
        kind: 'fragment',
        tag: unit.el.tagName,
        id: unit.el.id || null,
        textLength: trimmed.length,
        textPreview: trimmed.slice(0, 200),
        hasMedia: false,
        selectorPath: buildSelectorPath(unit.el),
      };
    }
    const el = unit.el;
    return {
      index: i,
      kind: 'element',
      tag: el.tagName,
      id: el.id || null,
      textLength: (el.innerText || '').trim().length,
      textPreview: (el.innerText || '').trim().slice(0, 200),
      hasMedia: SK.containsMedia(el),
      selectorPath: buildSelectorPath(el),
    };
  }

  window.__transit = {
    get version() { return browser.runtime.getManifest().version; },
    collectParagraphs() {
      return SK.collectParagraphs().map(unitSummary);
    },
    collectParagraphsWithStats() {
      const stats = {};
      const units = SK.collectParagraphs(document.body, stats);
      return {
        units: units.map(unitSummary),
        skipStats: stats,
      };
    },
    serialize(el) { return SK.serializeWithPlaceholders(el); },
    deserialize(text, slots) { return SK.deserializeWithPlaceholders(text, slots); },
    testInject(el, translation) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) {
        throw new Error('testInject: el must be an Element');
      }
      const { text, slots } = SK.serializeWithPlaceholders(el);
      const unit = { kind: 'element', el };
      SK.injectTranslation(unit, translation, slots);
      return { sourceText: text, slotCount: slots.length };
    },
    testInjectDual(el, translation, opts) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) {
        throw new Error('testInjectDual: el must be an Element');
      }
      SK.ensureDualWrapperStyle?.();
      if (opts && opts.markStyle && SK.VALID_MARK_STYLES.has(opts.markStyle)) {
        SK.currentMarkStyle = opts.markStyle;
      } else if (!SK.currentMarkStyle) {
        SK.currentMarkStyle = SK.DEFAULT_MARK_STYLE;
      }
      if (opts && 'dualAccentColor' in opts) {
        SK.currentDualAccent = SK.sanitizeDualAccent?.(opts.dualAccentColor) ?? 'auto';
      } else if (!SK.currentDualAccent) {
        SK.currentDualAccent = 'auto';
      }
      const { text, slots } = SK.serializeWithPlaceholders(el);
      const unit = { kind: 'element', el };
      SK.injectDual(unit, translation, slots);
      STATE.translatedMode = 'dual';
      STATE.translated = true;
      return {
        sourceText: text,
        slotCount: slots.length,
        wrapperPresent: !!STATE.translationCache.get(el),
      };
    },
    testRestoreDual() {
      SK.removeDualWrappers?.();
      STATE.translationCache?.clear?.();
      STATE.translated = false;
      STATE.translatedMode = null;
    },
    testAbortRestore() {
      restoreOriginalHTMLAndReset();
    },
    testRestorePage() {
      restorePage();
    },
    selectBestSlotOccurrences(text) {
      return SK.selectBestSlotOccurrences(text);
    },
    getState() {
      return {
        translated: STATE.translated,
        translating: STATE.translating,
        stickyTranslate: STATE.stickyTranslate,
        replacedCount: STATE.originalHTML.size,
        guardCacheSize: STATE.translatedHTML.size,
      };
    },
    setTestState(overrides) {
      if ('translated' in overrides) STATE.translated = !!overrides.translated;
      if ('stickyTranslate' in overrides) STATE.stickyTranslate = !!overrides.stickyTranslate;
      if ('translatedMode' in overrides) {
        const m = overrides.translatedMode;
        STATE.translatedMode = (m === 'dual' || m === 'single') ? m : null;
      }
    },
    testRunContentGuard() {
      return SK.testRunContentGuard();
    },
    testToggleEditMode(forceState) {
      return toggleEditMode(forceState);
    },
    testEditBarState() {
      return {
        hostConnected: !!(editBarHost && editBarHost.isConnected),
        visible: !!(editBarEls && editBarEls.bar.classList.contains('show')),
        hintText: editBarEls ? editBarEls.hint.textContent : null,
        undoDisabled: editBarEls ? editBarEls.undoBtn.disabled : null,
        undoStackSize: editUndoOrder.length,
      };
    },
    testEditBarUndo() {
      editBarUndo();
      return { undoStackSize: editUndoOrder.length };
    },
    testEditBarDone() {
      return toggleEditMode(false);
    },
    testEditLinkRepair() {
      return editLinkRepair;
    },
    testGoogleDocsUrl(urlString) {
      try {
        const url = new URL(urlString);
        const isEditor = url.hostname === 'docs.google.com'
          && /^\/document\/d\/[^/]+\/(edit|preview|view)/.test(url.pathname);
        const isMobileBasic = url.hostname === 'docs.google.com'
          && /^\/document\/d\/[^/]+\/mobilebasic/.test(url.pathname);
        const match = url.pathname.match(/^\/document\/d\/([^/]+)/);
        const mobileBasicUrl = match
          ? `https://docs.google.com/document/d/${match[1]}/mobilebasic`
          : null;
        return { isEditor, isMobileBasic, mobileBasicUrl };
      } catch { return { isEditor: false, isMobileBasic: false, mobileBasicUrl: null }; }
    },
  };

  SK.safeSendMessage({ type: 'CLEAR_BADGE' }).catch(() => {});

  SK.sendLog('info', 'system', 'content script ready', { version: browser.runtime.getManifest().version, url: location.href });

  (async () => {
    try {
      if (SK.isYouTubePage?.()) {
        const saved = await browser.storage.sync.get('ytSubtitle');
        const ytAutoOn = (saved.ytSubtitle?.autoTranslate !== false);
        if (ytAutoOn) {
          SK.sendLog('info', 'system', 'YouTube auto-subtitle enabled, activating on load');
          setTimeout(() => {
            SK.translateYouTubeSubtitles?.({ source: 'auto' }).catch(err => {
              SK.sendLog('warn', 'system', 'YouTube auto-subtitle failed', { error: err.message });
            });
          }, 800);
        }
        return;
      }

      let navType = null;
      try {
        navType = performance.getEntriesByType('navigation')?.[0]?.type || null;
      } catch {   }
      if (navType === 'reload') {
        await SK.safeSendMessage({ type: 'STICKY_CLEAR' }).catch(() => {});
        SK.sendLog('info', 'system', 'page reload, sticky cleared', { navType, url: location.href });
      } else {
        const stickyResp = await SK.safeSendMessage({ type: 'STICKY_QUERY' }).catch(() => null);
        if (stickyResp?.shouldTranslate && stickyResp.slot != null) {
          SK.sendLog('info', 'system', 'sticky translate inherited from opener tab, translating', { url: location.href });
          handleTranslate();
          return;
        }
      }

      const { autoTranslate = false, autoConvertZh = true } = await browser.storage.sync.get(['autoTranslate', 'autoConvertZh']);
      if (autoTranslate && await SK.isDomainWhitelisted()) {
        SK.sendLog('info', 'system', 'domain in auto-translate list, translating on load', { url: location.href });
        handleTranslate();
        return;
      }
      if (autoConvertZh) {
        SK.sendLog('info', 'system', 'autoConvertZh on, trying local zh-convert on load', { url: location.href });
        SK.autoConvertZhWithRetry();
      }
    } catch (err) {
      SK.sendLog('warn', 'system', 'auto-translate check failed on load', { error: err.message });
    }
  })();

})(window.__SK);
