(function (SK) {
  if (!SK || SK.disabled) return;

  const DRIVE = SK.DRIVE = SK.DRIVE || {
    entries: [],
    rawSegments: [],
    bilingualMode: false,
    currentTimeMs: 0,
    currentEntryIdx: -1,
    overlayHost: null,
    overlayTgtEl: null,
    overlaySrcEl: null,
    iframeEl: null,
    registeredListening: false,
    runId: 0,
  };

  const _OVERLAY_TAG = 'transit-drive-overlay';

  function _ensureOverlay() {
    if (DRIVE.overlayHost && document.body.contains(DRIVE.overlayHost)) return DRIVE.overlayHost;
    const host = document.createElement(_OVERLAY_TAG);
    host.setAttribute('popover', 'manual');
    Object.assign(host.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: '99999',
      display: 'none',
      left: '0px', top: '0px', width: '0px', height: '0px',
      border: 'none',
      padding: '0',
      margin: '0',
      background: 'transparent',
      overflow: 'visible',
      inset: 'auto',
    });
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          font-family: "PingFang TC", "Microsoft JhengHei", "微軟正黑體",
                       "Heiti TC", "Noto Sans CJK TC", sans-serif;
        }
        .container {
          position: absolute;
          left: 0; right: 0;
          bottom: var(--sk-cue-bottom, 22%);
          display: flex;
          justify-content: center;
          padding: 0 24px;
          box-sizing: border-box;
        }
        .cue-block {
          display: inline-block;
          max-width: 100%;
          padding: 0.15em 0.5em;
          background: rgba(0, 0, 0, 0.78);
          color: #fff;
          border-radius: 4px;
          text-align: center;
          box-sizing: border-box;
          letter-spacing: 0.02em;
        }
        .src, .tgt {
          display: block;
          font-size: var(--sk-cue-size, 22px);
          white-space: pre-wrap;
        }
        .src { line-height: 1.05; }
        .tgt { line-height: 1.45; }
        .src[hidden], .tgt:empty { display: none; }
      </style>
      <div class="container">
        <div class="cue-block">
          <span class="src" hidden></span>
          <span class="tgt"></span>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    DRIVE.overlayHost = host;
    DRIVE.overlaySrcEl = shadow.querySelector('.src');
    DRIVE.overlayTgtEl = shadow.querySelector('.tgt');
    return host;
  }

  function _findActiveEntryIdx() {
    const find = SK.ASR && SK.ASR.findActiveCueIdx;
    if (typeof find !== 'function') return -1;
    return find(DRIVE.entries, DRIVE.currentTimeMs);
  }
  SK._driveFindActiveEntryIdx = _findActiveEntryIdx;

  function _findOverlappingSrcText(startMs, endMs) {
    const segs = DRIVE.rawSegments;
    if (!segs || !segs.length) return '';
    const bits = [];
    for (const seg of segs) {
      if (seg.startMs >= startMs && seg.startMs < endMs) {
        const t = (seg.text || '').trim();
        if (t) bits.push(t);
      }
    }
    return bits.join(' ');
  }

  function _renderActiveCue() {
    const tgtEl = DRIVE.overlayTgtEl;
    const srcEl = DRIVE.overlaySrcEl;
    if (!tgtEl) return;
    const idx = _findActiveEntryIdx();
    if (idx === DRIVE.currentEntryIdx) return;
    DRIVE.currentEntryIdx = idx;

    if (idx === -1) {
      if (tgtEl.textContent !== '') tgtEl.textContent = '';
      if (srcEl) {
        if (srcEl.textContent !== '') srcEl.textContent = '';
        srcEl.hidden = true;
      }
      return;
    }

    const entry = DRIVE.entries[idx];
    const tgt = entry.text || '';
    if (tgtEl.textContent !== tgt) tgtEl.textContent = tgt;

    if (srcEl) {
      if (DRIVE.bilingualMode) {
        const src = _findOverlappingSrcText(entry.startMs, entry.endMs);
        if (src) {
          if (srcEl.textContent !== src) srcEl.textContent = src;
          srcEl.hidden = false;
        } else {
          if (srcEl.textContent !== '') srcEl.textContent = '';
          srcEl.hidden = true;
        }
      } else {
        if (srcEl.textContent !== '') srcEl.textContent = '';
        srcEl.hidden = true;
      }
    }
  }

  function _normalizeDriveEngine(v) {
    if (v === 'google') return 'google';
    if (v === 'openai-compat') return 'openai-compat';
    return 'gemini';
  }

  SK._driveEnsureOverlay = _ensureOverlay;
  SK._driveRenderActiveCue = _renderActiveCue;
  SK._driveFindOverlappingSrcText = _findOverlappingSrcText;
  SK._driveNormalizeEngine = _normalizeDriveEngine;

  const BATCH_SIZE = 30;
  const MAX_CONCURRENT = 3;

  let _autoTranslateEnabled = true;
  let _engine = 'gemini';
  let _ytModel = '';

  function _disablePlayerCaptions() {
    if (!DRIVE.iframeEl?.contentWindow) return;
    try {
      DRIVE.iframeEl.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'unloadModule', args: ['captions'] }),
        'https://youtube.googleapis.com'
      );
      SK.sendLog('info', 'drive', 'sent unloadModule captions');
    } catch (e) {
      SK.sendLog('warn', 'drive', 'unloadModule captions failed', { error: e?.message || String(e) });
    }
  }

  function _logDriveUsage(segCount, usage, engineLabel) {
    if (!usage || ((usage.inputTokens || 0) === 0 && (usage.cacheHits || 0) === 0)) return;
    const u = usage;
    const fileId = (location.pathname.match(/\/file\/([^/]+)/) || [])[1] || '';
    SK.safeSendMessage({
      type: 'LOG_USAGE',
      payload: {
        url:   location.href,
        title: document.title,
        source: 'drive-subtitle',
        videoId: fileId,
        engine: engineLabel,
        model: _ytModel || undefined,
        inputTokens:      u.inputTokens     || 0,
        outputTokens:     u.outputTokens    || 0,
        cachedTokens:     u.cachedTokens    || 0,
        billedInputTokens: u.billedInputTokens || 0,
        billedCostUSD:    u.billedCostUSD   || 0,
        segments:         segCount,
        cacheHits:        u.cacheHits       || 0,
        durationMs:       0,
        timestamp:        Date.now(),
      },
    }).catch(() => {});
  }

  function _isStaleRun(runId, batchIdx, totalBatches, engineLabel) {
    if (runId === DRIVE.runId) return false;
    SK.sendLog('info', 'drive', `batch ${batchIdx + 1}/${totalBatches} discarded — stale run (${engineLabel})`, {
      batchRunId: runId, currentRunId: DRIVE.runId,
    });
    return true;
  }

  async function _runOneBatchLlm(batch, batchIdx, totalBatches, msgType, engineLabel, runId) {
    if (batch.length === 0) return;

    const lastSeg = batch[batch.length - 1];
    const batchEndMs = SK.ASR.batchEndMs(lastSeg.startMs, DRIVE.rawSegments);
    const inputJson = SK.ASR.buildLlmInput(batch);

    let res;
    try {
      res = await SK.safeSendMessage({
        type: msgType,
        payload: { texts: [inputJson], glossary: null },
      });
    } catch (e) {
      SK.sendLog('warn', 'drive', `batch ${batchIdx + 1}/${totalBatches} ${engineLabel} sendMessage failed`, {
        error: e?.message || String(e),
      });
      return;
    }

    if (!res?.ok) {
      SK.sendLog('warn', 'drive', `batch ${batchIdx + 1}/${totalBatches} ${engineLabel} failed`, {
        error: res?.error || 'unknown',
      });
      return;
    }

    _logDriveUsage(batch.length, res.usage, engineLabel);

    if (_isStaleRun(runId, batchIdx, totalBatches, engineLabel)) return;

    const rawText = res.result?.[0] || '';
    let entries;
    try {
      entries = SK.ASR.parseLlmOutput(rawText, batch, batchEndMs);
    } catch (e) {
      SK.sendLog('warn', 'drive', `batch ${batchIdx + 1}/${totalBatches} parseAsrResponse failed (${engineLabel})`, {
        error: e?.message || String(e),
        rawHead: rawText.slice(0, 200),
      });
      return;
    }

    const { cues, droppedCount } = SK.ASR.resolveEntryTimeline(entries, batch, batchEndMs);
    let pushedCount = 0;
    const _batchStarts = batch.map(seg => seg.startMs);
    for (const cue of cues) {
      for (const piece of SK.ASR.splitLongCue(cue.startMs, cue.endMs, cue.text, _batchStarts)) {
        DRIVE.entries.push({ startMs: piece.startMs, endMs: piece.endMs, text: piece.text });
        pushedCount++;
      }
    }
    DRIVE.entries.sort((a, b) => a.startMs - b.startMs);
    DRIVE.currentEntryIdx = -2;

    SK.sendLog('info', 'drive', `batch ${batchIdx + 1}/${totalBatches} done (${engineLabel})`, {
      llmEntryCount: entries.length,
      pushedToOverlay: pushedCount,
      droppedMisaligned: droppedCount,
      totalOverlayEntries: DRIVE.entries.length,
      usage: res.usage,
    });
  }

  async function _runOneBatchGoogle(batch, batchIdx, totalBatches, runId) {
    if (batch.length === 0) return;

    const texts = batch.map(seg => seg.text);

    let res;
    try {
      res = await SK.safeSendMessage({
        type: 'TRANSLATE_DRIVE_BATCH_GOOGLE',
        payload: { texts, glossary: null },
      });
    } catch (e) {
      SK.sendLog('warn', 'drive', `batch ${batchIdx + 1}/${totalBatches} google sendMessage failed`, {
        error: e?.message || String(e),
      });
      return;
    }

    if (!res?.ok) {
      SK.sendLog('warn', 'drive', `batch ${batchIdx + 1}/${totalBatches} google failed`, {
        error: res?.error || 'unknown',
      });
      return;
    }

    if (_isStaleRun(runId, batchIdx, totalBatches, 'google')) return;

    const translations = Array.isArray(res.result) ? res.result : [];
    let pushedCount = 0;
    for (let i = 0; i < batch.length; i++) {
      const seg = batch[i];
      const text = String(translations[i] || '').trim();
      if (!text) continue;
      const next = batch[i + 1];
      const endMs = next ? next.startMs : SK.ASR.batchEndMs(seg.startMs, DRIVE.rawSegments);
      DRIVE.entries.push({ startMs: seg.startMs, endMs, text });
      pushedCount++;
    }
    DRIVE.entries.sort((a, b) => a.startMs - b.startMs);
    DRIVE.currentEntryIdx = -2;

    SK.sendLog('info', 'drive', `batch ${batchIdx + 1}/${totalBatches} done (google)`, {
      inputCount: batch.length,
      translatedCount: translations.length,
      pushedToOverlay: pushedCount,
      totalOverlayEntries: DRIVE.entries.length,
      usage: res.usage,
    });
  }

  async function _handleCaptionsMessage(message) {
    if (!_autoTranslateEnabled) {
      SK.sendLog('info', 'drive', 'autoTranslate off — skipping captions');
      return;
    }
    const { json3 } = message.payload || {};
    if (!json3) {
      SK.sendLog('warn', 'drive', 'DRIVE_ASR_CAPTIONS payload missing json3');
      return;
    }
    if (!SK.ASR?.parseJson3 || !SK.ASR?.parseAsrResponse || !SK.ASR?.resolveEntryTimeline) {
      SK.sendLog('warn', 'drive', 'SK.ASR helpers not available (load order issue?)');
      return;
    }
    const rawSegments = SK.ASR.parseJson3(json3, { perLineTiming: true });
    SK.sendLog('info', 'drive', 'asr segments parsed', {
      count: rawSegments.length,
      firstStartMs: rawSegments[0]?.startMs,
      lastStartMs: rawSegments[rawSegments.length - 1]?.startMs,
    });

    if (rawSegments.length === 0) return;

    const _fp = `${rawSegments.length}|${rawSegments[0].startMs}|${rawSegments[rawSegments.length - 1].startMs}`;
    if (DRIVE._lastCaptionsFp === _fp) {
      SK.sendLog('info', 'drive', 'duplicate captions payload — skipping retranslation', { fp: _fp });
      return;
    }
    DRIVE._lastCaptionsFp = _fp;

    DRIVE.entries = [];
    DRIVE.currentEntryIdx = -2;
    const runId = ++DRIVE.runId;

    DRIVE.rawSegments = rawSegments;

    _disablePlayerCaptions();

    const batches = [];
    for (let i = 0; i < rawSegments.length; i += BATCH_SIZE) {
      batches.push(rawSegments.slice(i, i + BATCH_SIZE));
    }
    const totalBatches = batches.length;

    const engine = _engine;

    SK.sendLog('info', 'drive', 'starting full transcript translation', {
      totalSegments: rawSegments.length,
      totalBatches,
      maxConcurrent: MAX_CONCURRENT,
      engine,
    });

    let nextBatchIdx = 0;
    async function _worker() {
      while (true) {
        const idx = nextBatchIdx++;
        if (idx >= totalBatches) return;
        if (!_autoTranslateEnabled) {
          SK.sendLog('info', 'drive', 'autoTranslate turned off mid-translation, stopping');
          return;
        }
        if (runId !== DRIVE.runId) {
          SK.sendLog('info', 'drive', 'track switched mid-translation, old run stops dispatching', { runId, currentRunId: DRIVE.runId });
          return;
        }
        if (engine === 'google') {
          await _runOneBatchGoogle(batches[idx], idx, totalBatches, runId);
        } else if (engine === 'openai-compat') {
          await _runOneBatchLlm(batches[idx], idx, totalBatches, 'TRANSLATE_DRIVE_ASR_SUBTITLE_BATCH_CUSTOM', 'openai-compat', runId);
        } else {
          await _runOneBatchLlm(batches[idx], idx, totalBatches, 'TRANSLATE_DRIVE_ASR_SUBTITLE_BATCH', 'gemini', runId);
        }
      }
    }

    const tStart = Date.now();
    await Promise.all(Array(MAX_CONCURRENT).fill(0).map(_worker));
    SK.sendLog('info', 'drive', 'full transcript translation completed', {
      totalBatches,
      totalEntries: DRIVE.entries.length,
      elapsedMs: Date.now() - tStart,
      runId,
      superseded: runId !== DRIVE.runId,
    });
    if (DRIVE.entries.length === 0 && DRIVE._lastCaptionsFp === _fp) {
      DRIVE._lastCaptionsFp = null;
      SK.sendLog('warn', 'drive', 'translation yielded no entries — fingerprint cleared for retry', { fp: _fp });
    }
  }

  SK._driveHandleCaptionsMessage = _handleCaptionsMessage;
  SK._driveSetEngine = (v) => { _engine = _normalizeDriveEngine(v); };
  SK._driveSetAutoTranslate = (v) => { _autoTranslateEnabled = v !== false; };

  if (location.hostname !== 'drive.google.com') return;
  if (!location.pathname.startsWith('/file/')) return;
  if (window.top !== window) return;

  (async () => {
    try {
      const { ytSubtitle = {}, displayMode } = await browser.storage.sync.get(['ytSubtitle', 'displayMode']);
      _autoTranslateEnabled = ytSubtitle.autoTranslate !== false;
      _engine = _normalizeDriveEngine(ytSubtitle.engine);
      _ytModel = ytSubtitle.model || '';
      DRIVE.bilingualMode = displayMode === 'dual';
      SK.sendLog('info', 'drive', 'settings loaded (from ytSubtitle)', {
        autoTranslate: _autoTranslateEnabled,
        engine: _engine,
        bilingual: DRIVE.bilingualMode,
      });
    } catch {   }
  })();
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.ytSubtitle) {
      const newVal = changes.ytSubtitle.newValue || {};
      const nextEnabled = newVal.autoTranslate !== false;
      if (nextEnabled !== _autoTranslateEnabled) {
        _autoTranslateEnabled = nextEnabled;
        SK.sendLog('info', 'drive', 'autoTranslate setting changed', { enabled: nextEnabled });
      }
      const nextEngine = _normalizeDriveEngine(newVal.engine);
      if (nextEngine !== _engine) {
        _engine = nextEngine;
        SK.sendLog('info', 'drive', 'engine setting changed', { engine: nextEngine });
      }
      _ytModel = newVal.model || '';
    }
    if (changes.displayMode) {
      const nextBilingual = changes.displayMode.newValue === 'dual';
      if (nextBilingual !== DRIVE.bilingualMode) {
        DRIVE.bilingualMode = nextBilingual;
        DRIVE.currentEntryIdx = -2;
        SK.sendLog('info', 'drive', 'bilingualMode toggled live (displayMode)', { bilingual: nextBilingual });
      }
    }
  });

  function _findPlayerIframe() {
    return document.querySelector('iframe[src*="youtube.googleapis.com/embed"]');
  }

  function _handleFullscreenChange() {
    const host = DRIVE.overlayHost;
    if (!host) return;
    const fsElem = document.fullscreenElement;
    const isFs = !!fsElem;
    try {
      if (isFs) {
        if (typeof host.showPopover === 'function') host.showPopover();
      } else {
        if (typeof host.hidePopover === 'function') host.hidePopover();
      }
    } catch (e) {
    }
    SK.sendLog('info', 'drive', 'fullscreenchange', { isFs, fsElemTag: fsElem?.tagName });
  }

  function _updateOverlayPosition() {
    const iframe = DRIVE.iframeEl;
    const host = DRIVE.overlayHost;
    if (!iframe || !host) return;
    let left, top, width, height;
    const isFs = !!document.fullscreenElement;
    if (isFs) {
      left = 0; top = 0;
      width = window.innerWidth;
      height = window.innerHeight;
    } else {
      const rect = iframe.getBoundingClientRect();
      left = rect.left; top = rect.top;
      width = rect.width; height = rect.height;
    }
    if (width < 100 || height < 100) {
      host.style.display = 'none';
      return;
    }
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    host.style.display = 'block';
    const fontSize = Math.max(16, Math.min(56, Math.round(height * 0.04)));
    host.style.setProperty('--sk-cue-size', `${fontSize}px`);
    host.style.setProperty('--sk-cue-bottom', isFs ? '8%' : '22%');
  }

  let _initialMessagesLogged = 0;
  const _MAX_INITIAL_LOGS = 5;

  function _listenPlayerMessages() {
    if (DRIVE._msgListenerInstalled) return;
    DRIVE._msgListenerInstalled = true;
    window.addEventListener('message', (e) => {
      if (e.origin !== 'https://youtube.googleapis.com') return;
      let data = e.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch { return; }
      }
      if (!data || typeof data !== 'object') return;

      if (_initialMessagesLogged < _MAX_INITIAL_LOGS) {
        _initialMessagesLogged++;
        SK.sendLog('info', 'drive', 'player message received', {
          event: data.event,
          hasInfo: !!data.info,
          hasCurrentTime: typeof data.info?.currentTime === 'number',
          dataKeys: Object.keys(data).slice(0, 8),
        });
      }

      if (data.event === 'onReady' && !DRIVE.registeredListening) {
        DRIVE.registeredListening = true;
        try {
          DRIVE.iframeEl?.contentWindow?.postMessage(
            JSON.stringify({ event: 'listening', id: 'transit-drive', channel: 'widget' }),
            'https://youtube.googleapis.com'
          );
          SK.sendLog('info', 'drive', 'sent listening register');
        } catch (err) {
          SK.sendLog('warn', 'drive', 'listening register failed', { error: err?.message });
        }
      }

      if (data.event === 'infoDelivery' && typeof data.info?.currentTime === 'number') {
        DRIVE.currentTimeMs = Math.floor(data.info.currentTime * 1000);
      }
    });
  }

  function _startRenderLoop() {
    if (DRIVE.renderLoopRunning) return;
    DRIVE.renderLoopRunning = true;
    function loop() {
      if (!globalThis.chrome?.runtime?.id) {
        DRIVE.renderLoopRunning = false;
        DRIVE.renderLoopId = null;
        return;
      }
      _updateOverlayPosition();
      _renderActiveCue();
      DRIVE.renderLoopId = requestAnimationFrame(loop);
    }
    DRIVE.renderLoopId = requestAnimationFrame(loop);
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'DRIVE_ASR_CAPTIONS') return;
    _handleCaptionsMessage(message).catch(err => {
      SK.sendLog('warn', 'drive', 'DRIVE_ASR_CAPTIONS handler exception', {
        error: err?.message || String(err),
      });
    });
  });

  function _init(retries = 0) {
    const iframe = _findPlayerIframe();
    if (!iframe) {
      if (retries < 20) {
        setTimeout(() => _init(retries + 1), 500);
      } else {
        SK.sendLog('warn', 'drive', 'player iframe not found after retries', { retries });
      }
      return;
    }
    DRIVE.iframeEl = iframe;
    _ensureOverlay();
    _listenPlayerMessages();
    _startRenderLoop();
    document.addEventListener('fullscreenchange', _handleFullscreenChange);
    SK.sendLog('info', 'drive', 'overlay & message listener attached', {
      iframeRect: { width: iframe.offsetWidth, height: iframe.offsetHeight },
      retriesUntilFound: retries,
    });
  }

  setTimeout(() => _init(), 500);

  SK.sendLog('info', 'drive', 'content-drive.js top frame ready', {
    href: location.href.slice(0, 200),
  });

})(window.__SK);
