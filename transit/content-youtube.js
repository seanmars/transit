(function(SK) {
  if (!SK || SK.disabled) return;

  const DEFAULT_YT_CONFIG = {
    windowSizeS: 30,
    lookaheadS:  10,
    debugToast:  false,
    onTheFly:    false,
  };

  let _debugEl        = null;
  let _debugInterval  = null;
  let _lastEvent      = '—';
  let _debugMissedKeys = new Set();

  function _debugRender() {
    if (!_debugEl) return;
    const YT = SK.YT;
    const maxMs = YT.rawSegments.length > 0
      ? YT.rawSegments[YT.rawSegments.length - 1].startMs : 0;
    const video   = YT.videoEl || document.querySelector('video');
    const curS    = video ? video.currentTime.toFixed(1) : '0.0';
    const speed   = video ? `${video.playbackRate}x` : '—';
    const config  = YT.config || DEFAULT_YT_CONFIG;
    const bufMs   = video ? YT.translatedUpToMs - video.currentTime * 1000 : 0;
    const _curWinStart = video
      ? Math.floor(video.currentTime * 1000 / ((config.windowSizeS || 30) * 1000)) * ((config.windowSizeS || 30) * 1000)
      : 0;
    const _curWinTranslating = YT.translatingWindows?.has(_curWinStart);
    const _curWinDone        = YT.translatedWindows?.has(_curWinStart);
    const bufStr  = (_curWinTranslating && !_curWinDone)
      ? '翻譯中…'
      : bufMs >= 0
        ? `+${(bufMs / 1000).toFixed(1)}s ✓`
        : `${(bufMs / 1000).toFixed(1)}s ⚠️ 落後`;
    const batchArr = YT.batchApiMs || [];
    const batchStr = batchArr.length === 0
      ? (YT.lastApiMs > 0 ? `${YT.lastApiMs}ms` : '—')
      : batchArr.map(t => t > 0 ? `${t}` : '…').join(' / ') + 'ms';
    _debugEl.textContent = [
      '🔍 Transit 字幕 Debug',
      `active      : ${YT.active}`,
      `translating : ${YT.translatingWindows.size > 0}（${YT.translatingWindows.size} 視窗）`,
      `speed       : ${speed}`,
      `rawSegments : ${YT.rawSegments.length} 條（涵蓋 ${Math.round(maxMs/1000)}s）`,
      `captionMap  : ${YT.captionMap.size} 條`,
      `translated↑ : ${Math.round(YT.translatedUpToMs/1000)}s`,
      `coverage    : ${YT.captionMapCoverageUpToMs > 0 ? Math.round(YT.captionMapCoverageUpToMs/1000) + 's' : '—'}`,
      `video now   : ${curS}s`,
      `buffer      : ${bufStr}`,
      `batch API   : ${batchStr}`,
      `batch0 size : ${(() => { const lead = YT.lastLeadMs; const s = YT.firstBatchSize || 8; const tag = lead <= 0 ? `⚠️ lead ${(lead/1000).toFixed(1)}s` : `lead +${(lead/1000).toFixed(1)}s`; return `${s} 條（${tag}）`; })()}`,
      `on-the-fly  : ${YT.onTheFlyTotal} 條`,
      `stale skip  : ${YT.staleSkipCount > 0 ? `⚠️ ${YT.staleSkipCount} 次` : '0'}`,
      `window/look : ${config.windowSizeS}s / ${config.lookaheadS}s`,
      `adapt look  : ${YT.adaptiveLookaheadMs > 0 ? Math.round(YT.adaptiveLookaheadMs / 1000) + 's' : '—'}`,
      `事件        : ${_lastEvent}`,
    ].join('\n');
  }

  function _debugUpdate(eventLabel) {
    const YT = SK.YT;
    if (!YT.config?.debugToast) return;
    _lastEvent = eventLabel;

    if (!_debugEl) {
      _debugEl = document.createElement('div');
      _debugEl.id = '__sk-yt-debug';
      Object.assign(_debugEl.style, {
        position:   'fixed',
        top:        '8px',
        left:       '8px',
        background: 'rgba(0,0,0,0.88)',
        color:      '#39ff14',
        fontFamily: 'monospace',
        fontSize:   '11px',
        lineHeight: '1.65',
        padding:    '8px 12px',
        borderRadius: '6px',
        zIndex:     '2147483647',
        maxWidth:   '340px',
        pointerEvents: 'none',
        whiteSpace: 'pre',
      });
      document.body.appendChild(_debugEl);
      _debugInterval = setInterval(_debugRender, 500);
    }

    _debugRender();
  }

  function _debugRemove() {
    if (_debugInterval) { clearInterval(_debugInterval); _debugInterval = null; }
    if (_debugEl) { _debugEl.remove(); _debugEl = null; }
    _lastEvent = '—';
    _debugMissedKeys.clear();
  }

  let _captionStatusEl    = null;
  let _captionStatusTimer = null;

  function _updateCaptionStatusPosition() {
    if (!_captionStatusEl) return;
    const container = _captionStatusEl.parentElement;
    if (!container) return;

    const captionWindow = document.querySelector('.caption-window');
    if (captionWindow) {
      const contRect  = container.getBoundingClientRect();
      const capRect   = captionWindow.getBoundingClientRect();
      if (capRect.height === 0) return;
      const ourH      = _captionStatusEl.offsetHeight || 28;
      const relTop    = capRect.top  - contRect.top - ourH - 4;
      const relLeft   = capRect.left - contRect.left + capRect.width / 2;
      _captionStatusEl.style.top    = Math.max(2, relTop) + 'px';
      _captionStatusEl.style.bottom = '';
      _captionStatusEl.style.left   = relLeft + 'px';
    } else {
      _captionStatusEl.style.top    = '';
      _captionStatusEl.style.bottom = '8%';
      _captionStatusEl.style.left   = '50%';
    }
  }

  function _hasVisibleTargetCaption() {
    const YT = SK.YT;
    const target = SK.STATE?.targetLanguage || 'zh-TW';
    const inTarget = (text) => !!text && (
      typeof SK.isAlreadyInTarget === 'function'
        ? SK.isAlreadyInTarget(text, target)
        : /[一-鿿]/.test(text)
    );
    if (YT.isAsr) {
      const video = document.querySelector('video');
      const currentMs = video ? Math.floor(video.currentTime * 1000) : 0;
      const cue = _findActiveCue(currentMs);
      return !!(cue && inTarget(cue.targetText));
    }
    const segs = document.querySelectorAll('.ytp-caption-segment');
    for (const s of segs) {
      if (inTarget(s.textContent || '')) return true;
    }
    return false;
  }

  function showCaptionStatus(text) {
    if (SK.YT.config?.bilingualMode === true) return;
    const container =
      document.querySelector('.ytp-caption-window-container') ||
      document.querySelector('#movie_player');
    if (!container) return;

    if (!_captionStatusEl) {
      _captionStatusEl = document.createElement('div');
      _captionStatusEl.id = '__sk-yt-caption-status';
      const seg      = document.querySelector('.ytp-caption-segment');
      const fontSize = seg ? getComputedStyle(seg).fontSize : '14px';
      Object.assign(_captionStatusEl.style, {
        position:      'absolute',
        zIndex:        '99',
        background:    'rgba(8, 8, 8, 0.75)',
        color:         '#fff',
        fontFamily:    '"YouTube Noto", Roboto, Arial, Helvetica, sans-serif',
        fontSize,
        lineHeight:    '1.5',
        padding:       '0.1em 0.45em',
        borderRadius:  '2px',
        pointerEvents: 'none',
        whiteSpace:    'nowrap',
        transform:     'translateX(-50%)',
        bottom:        '8%',
        left:          '50%',
      });
      container.appendChild(_captionStatusEl);

      if (_captionStatusTimer) clearInterval(_captionStatusTimer);
      _captionStatusTimer = setInterval(_updateCaptionStatusPosition, 250);
      _updateCaptionStatusPosition();
    }

    _captionStatusEl.textContent = text;
  }

  function hideCaptionStatus() {
    if (_captionStatusTimer) {
      clearInterval(_captionStatusTimer);
      _captionStatusTimer = null;
    }
    if (_captionStatusEl) {
      _captionStatusEl.remove();
      _captionStatusEl = null;
    }
  }

  SK.YT = {
    captionMap:       new Map(),
    rawSegments:      [],
    pendingQueue:     new Map(),
    observer:         null,
    batchTimer:       null,
    flushing:         false,
    active:           false,
    videoId:          null,
    isAsr:            false,
    captionLang:      null,
    captionSourceId:  null,
    captionSourceGen: 0,
    translatingWindows: new Set(),
    translatedUpToMs: 0,
    config:           null,
    videoEl:          null,
    sessionUsage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, billedInputTokens: 0, billedCostUSD: 0, segments: 0, cacheHits: 0 },
    sessionStartTime: 0,
    lastApiMs:           0,
    batchApiMs:          [],
    adaptiveLookaheadMs: 0,
    staleSkipCount:          0,
    captionMapCoverageUpToMs: 0,
    translatedWindows:    new Set(),
    onTheFlyTotal:            0,
    firstBatchSize:           8,
    lastLeadMs:               0,
    _firstCacheHitLogged:     false,
    _autoCcToggled:           false,
    _errorNotified:           false,
    displayCues:              [],
    asrSegConsumed:           new Set(),
    ccPaused:                 false,
    _ccButtonObserver:        null,
    _mwebCcRetryTimer:        null,
    _mwebCcRetries:           0,
  };

  SK.isYouTubePage = function isYouTubePage() {
    return (location.hostname === 'www.youtube.com' || location.hostname === 'm.youtube.com')
      && (location.pathname.startsWith('/watch') || YT_LIVE_PATH_RE.test(location.pathname));
  };

  function normText(t) {
    return t.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  const YT_LIVE_PATH_RE = /^\/live\/([A-Za-z0-9_-]{6,})/;

  function getVideoIdFromUrl() {
    const u = new URL(location.href);
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(YT_LIVE_PATH_RE);
    return m ? m[1] : null;
  }

  async function getYtConfig() {
    if (SK.YT.config) return SK.YT.config;
    const saved = await browser.storage.sync.get(['ytSubtitle', 'displayMode']);
    SK.YT.config = {
      ...DEFAULT_YT_CONFIG,
      ...(saved.ytSubtitle || {}),
      bilingualMode: saved.displayMode === 'dual',
    };
    return SK.YT.config;
  }
  SK._getYtConfig = getYtConfig;

  function parseTimeToMs(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    const secs = parts.reduce((acc, p) => acc * 60 + parseFloat(p || 0), 0);
    return Math.round(secs * 1000);
  }

  function parseJson3(input, opts) {
    const json = typeof input === 'string' ? JSON.parse(input) : input;
    const perLineTiming = !!(opts && opts.perLineTiming);
    const events = (json.events || []).filter(ev => ev && ev.segs);
    const segments = [];
    let groupCounter = 0;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const full = ev.segs.map(s => s.utf8 || '').join('');
      const lines = full.split('\n').map(l => l.trim()).filter(Boolean);
      const groupId = lines.length > 1 ? groupCounter++ : null;
      const lineStarts = perLineTiming
        ? _json3LineStarts(ev, lines.length, events[i + 1])
        : lines.map(() => ev.tStartMs || 0);
      lines.forEach((line, k) => {
        segments.push({ text: line, normText: normText(line), startMs: lineStarts[k], groupId });
      });
    }
    segments.sort((a, b) => a.startMs - b.startMs);
    if (perLineTiming) {
      for (let i = 1; i < segments.length; i++) {
        if (segments[i].startMs <= segments[i - 1].startMs) segments[i].startMs = segments[i - 1].startMs + 1;
      }
    }
    return segments;
  }

  function _json3LineStarts(ev, lineCount, nextEv) {
    const base = ev.tStartMs || 0;
    if (lineCount <= 1) return [base];
    const rawLines = ev.segs.map(s => String(s.utf8 || '')).join('').split('\n');
    const lineIdxOfRaw = [];
    { let k = 0; for (const l of rawLines) lineIdxOfRaw.push(l.trim() ? k++ : -1); }
    const offsets = new Array(lineCount).fill(null);
    let rawIdx = 0;
    let nonEmptySeen = false;
    for (const seg of ev.segs) {
      const utf8 = String(seg.utf8 || '');
      const parts = utf8.split('\n');
      for (let p = 0; p < parts.length; p++) {
        if (p > 0) { rawIdx++; nonEmptySeen = false; }
        const lineIdx = lineIdxOfRaw[rawIdx];
        if (lineIdx == null || lineIdx >= lineCount) break;
        if (lineIdx < 0) continue;
        if (!nonEmptySeen && parts[p].trim()) {
          nonEmptySeen = true;
          if (offsets[lineIdx] == null && Number.isFinite(seg.tOffsetMs)) offsets[lineIdx] = seg.tOffsetMs;
        }
      }
    }
    if (offsets.slice(1).every(o => o != null)) {
      const starts = [base];
      for (let k = 1; k < lineCount; k++) starts.push(base + offsets[k]);
      return starts;
    }
    let spanEnd = Infinity;
    if (nextEv && Number.isFinite(nextEv.tStartMs) && nextEv.tStartMs > base) spanEnd = nextEv.tStartMs;
    if (Number.isFinite(ev.dDurationMs) && ev.dDurationMs > 0) spanEnd = Math.min(spanEnd, base + ev.dDurationMs);
    if (!Number.isFinite(spanEnd) || spanEnd - base < lineCount) spanEnd = base + lineCount;
    const starts = [];
    for (let k = 0; k < lineCount; k++) starts.push(base + Math.floor((spanEnd - base) * k / lineCount));
    return starts;
  }
  SK._json3LineStarts = _json3LineStarts;

  function parseTtml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const els = doc.querySelectorAll('text, p');
    const segments = [];
    for (const el of els) {
      const t = el.textContent.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const begin = el.getAttribute('begin') || '0';
      const startMs = begin.includes(':') ? parseTimeToMs(begin) : parseInt(begin, 10) || 0;
      segments.push({ text: t, normText: normText(t), startMs });
    }
    return segments.sort((a, b) => a.startMs - b.startMs);
  }

  function parseCaptionResponse(responseText, opts) {
    if (!responseText) return [];
    try { return parseJson3(responseText, opts); } catch (_) {}
    try { return parseTtml(responseText); } catch (_) {}
    return [];
  }

  function _resetCaptionSourceBookkeeping(reason, extra) {
    const YT = SK.YT;
    YT.captionSourceGen = (YT.captionSourceGen || 0) + 1;
    YT.translatedWindows  = new Set();
    YT.translatingWindows = new Set();
    YT.captionMap         = new Map();
    YT.pendingQueue       = new Map();
    YT.displayCues        = [];
    YT.translatedUpToMs   = 0;
    YT.captionMapCoverageUpToMs = 0;
    YT.asrSegConsumed     = new Set();
    SK.sendLog('info', 'youtube', `caption source bookkeeping reset (${reason})`, {
      gen: YT.captionSourceGen, ...(extra || {}),
    });
  }

  window.addEventListener('transit-yt-captions', async (e) => {
    const { url, responseText } = e.detail || {};
    if (!responseText) return;

    {
      let _xhrVideoId = null;
      try { _xhrVideoId = new URL(url, location.href).searchParams.get('v'); } catch (_) {}
      const _urlVideoId = getVideoIdFromUrl();
      if (_xhrVideoId && _urlVideoId && _xhrVideoId !== _urlVideoId) {
        SK.sendLog('info', 'youtube', 'XHR captions ignored (stale videoId)', {
          xhrVideoId: _xhrVideoId, urlVideoId: _urlVideoId,
        });
        return;
      }
    }

    let _isAsrUrl = false;
    try { _isAsrUrl = new URL(url, location.href).searchParams.get('kind') === 'asr'; } catch (_) {}
    const segments = parseCaptionResponse(responseText, { perLineTiming: _isAsrUrl });
    if (segments.length === 0) return;

    const YT = SK.YT;
    try {
      const u = new URL(url, location.href);
      YT.isAsr = u.searchParams.get('kind') === 'asr';
      YT.captionLang = u.searchParams.get('tlang') || u.searchParams.get('lang') || null;
    } catch (_) {
      YT.isAsr = false;
      YT.captionLang = null;
    }
    const _sourceId = `${getVideoIdFromUrl() || ''}|${YT.captionLang || ''}|${YT.isAsr ? 'asr' : 'manual'}`;
    if (YT.captionSourceId && YT.captionSourceId !== _sourceId) {
      _resetCaptionSourceBookkeeping('source switched', { from: YT.captionSourceId, to: _sourceId });
    }
    YT.captionSourceId = _sourceId;
    YT.rawSegments = segments;
    YT._skipLoggedForLang = false;
    if (YT.active) {
      const cfg = YT.config || await getYtConfig();
      if (YT.isAsr) _ensureOverlay();
      _applyBilingualMode(cfg.bilingualMode === true);
    }
    const lastMs = segments[segments.length - 1]?.startMs ?? 0;
    SK.sendLog('info', 'youtube', 'XHR captions captured', {
      segmentCount: segments.length,
      lastMs,
      isAsr: YT.isAsr,
      captionLang: YT.captionLang,
      urlSnippet: url ? url.substring(url.indexOf('/api/timedtext'), Math.min(url.length, url.indexOf('/api/timedtext') + 60)) : '',
    });

    if (YT.active && !YT.ccPaused) {
      const video = document.querySelector('video');
      const currentMs = video ? Math.floor(video.currentTime * 1000) : 0;
      const config = YT.config || await getYtConfig();
      const windowSizeMs = (config.windowSizeS || 30) * 1000;
      const windowStartMs = Math.floor(currentMs / windowSizeMs) * windowSizeMs;
      _debugUpdate(`XHR 攔截 ${segments.length} 條字幕（至 ${Math.round(lastMs / 1000)}s），開始翻譯`);
      if (_shouldShowTranslatingStatus()) showCaptionStatus(SK.t('yt.status.translating'));
      translateWindowFrom(windowStartMs);
    }
  });

  function bridgeRequest(eventName, resultEventName, detail, timeoutMs) {
    return new Promise((resolve) => {
      const handler = (e) => {
        window.removeEventListener(resultEventName, handler);
        clearTimeout(timer);
        resolve(e?.detail || null);
      };
      const timer = setTimeout(() => {
        window.removeEventListener(resultEventName, handler);
        resolve(null);
      }, timeoutMs);
      window.addEventListener(resultEventName, handler);
      window.dispatchEvent(new CustomEvent(eventName, detail == null ? undefined : { detail: JSON.stringify(detail) }));
    });
  }

  async function _ccControlViaBridge(op, timeoutMs = 2000) {
    const res = await bridgeRequest('transit-yt-cc-control', 'transit-yt-cc-control-result', { op }, timeoutMs);
    return res || { op, ok: false, error: 'bridge-timeout' };
  }

  const MWEB_CC_RETRY_MS = 3000;
  const MWEB_CC_MAX_RETRIES = 20;

  function _scheduleMwebCcRetry() {
    const YT = SK.YT;
    if (YT._mwebCcRetryTimer) return;
    if ((YT._mwebCcRetries || 0) >= MWEB_CC_MAX_RETRIES) return;
    YT._mwebCcRetryTimer = setTimeout(() => {
      YT._mwebCcRetryTimer = null;
      if (!YT.active || YT.rawSegments.length > 0) return;
      YT._mwebCcRetries = (YT._mwebCcRetries || 0) + 1;
      YT._autoCcToggled = false;
      SK.sendLog('info', 'youtube', 'mweb CC retry', { attempt: YT._mwebCcRetries });
      forceSubtitleReload();
    }, MWEB_CC_RETRY_MS);
  }

  function _clearMwebCcRetry() {
    const YT = SK.YT;
    if (YT._mwebCcRetryTimer) {
      clearTimeout(YT._mwebCcRetryTimer);
      YT._mwebCcRetryTimer = null;
    }
    YT._mwebCcRetries = 0;
  }

  const POPUP_POLL_MS = 500;
  const POPUP_WAIT_MAX_MS = 60000;

  function _isPlayerPopupOpen() {
    const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    if (!player) return false;
    for (const el of player.querySelectorAll('.ytp-popup')) {
      if (el.getAttribute('aria-hidden') === 'true') continue;
      if (getComputedStyle(el).display === 'none') continue;
      return true;
    }
    return false;
  }

  function _deferReloadWhilePopupOpen() {
    const YT = SK.YT;
    if (YT._popupDeferTimer) return true;
    if (!_isPlayerPopupOpen()) { YT._popupDeferSince = 0; return false; }
    if (!YT._popupDeferSince) {
      YT._popupDeferSince = Date.now();
      SK.sendLog('info', 'youtube', 'forceSubtitleReload deferred: player popup open');
    } else if (Date.now() - YT._popupDeferSince > POPUP_WAIT_MAX_MS) {
      SK.sendLog('info', 'youtube', 'forceSubtitleReload: popup open too long, proceeding anyway');
      YT._popupDeferSince = 0;
      return false;
    }
    YT._popupDeferTimer = setTimeout(() => {
      YT._popupDeferTimer = null;
      if (!YT.active) { YT._popupDeferSince = 0; return; }
      forceSubtitleReload();
    }, POPUP_POLL_MS);
    return true;
  }

  function _clearPopupDefer() {
    const YT = SK.YT;
    if (YT._popupDeferTimer) {
      clearTimeout(YT._popupDeferTimer);
      YT._popupDeferTimer = null;
    }
    YT._popupDeferSince = 0;
  }

  async function forceSubtitleReload() {
    if (_deferReloadWhilePopupOpen()) return;
    const btn = document.querySelector('.ytp-subtitles-button');
    if (!btn) {
      const status = await _ccControlViaBridge('status');
      if (!status.ok) {
        SK.sendLog('warn', 'youtube', 'forceSubtitleReload: no CC button + bridge status failed', {
          error: status.error,
        });
        _scheduleMwebCcRetry();
        return;
      }
      if (!status.ccOn) {
        if (SK.YT._autoCcToggled) {
          SK.sendLog('info', 'youtube', 'forceSubtitleReload(api): CC off + already auto-toggled, skip');
          return;
        }
        SK.YT._autoCcToggled = true;
        const res = await _ccControlViaBridge('enable');
        SK.sendLog(res.ok ? 'info' : 'warn', 'youtube', 'forceSubtitleReload(api): auto-enable CC', {
          ok: res.ok, error: res.error || null,
        });
        _scheduleMwebCcRetry();
        return;
      }
      const res = await _ccControlViaBridge('reload');
      SK.sendLog(res.ok ? 'info' : 'warn', 'youtube', 'forceSubtitleReload(api): reload captions module', {
        ok: res.ok, error: res.error || null,
      });
      _scheduleMwebCcRetry();
      return;
    }
    const isOn = btn.getAttribute('aria-pressed') === 'true';
    if (!isOn) {
      if (SK.YT._autoCcToggled) {
        SK.sendLog('info', 'youtube', 'forceSubtitleReload: CC off + already auto-toggled, skip');
        return;
      }
      SK.sendLog('info', 'youtube', 'forceSubtitleReload: CC off, auto-clicking to open');
      SK.YT._autoCcToggled = true;
      btn.click();
      _scheduleMwebCcRetry();
      return;
    }
    SK.sendLog('info', 'youtube', 'forceSubtitleReload: toggling CC to force new XHR');
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    if (SK.YT.active) btn.click();
    _scheduleMwebCcRetry();
  }

  function buildTranslationUnits(segs, preserve) {
    if (!preserve) {
      return segs.map(s => ({ text: s.text, keys: [s.normText] }));
    }
    const units = [];
    let i = 0;
    while (i < segs.length) {
      const seg = segs[i];
      if (seg.groupId != null) {
        const group = [seg];
        let j = i + 1;
        while (j < segs.length && segs[j].groupId === seg.groupId) {
          group.push(segs[j]);
          j++;
        }
        units.push({ text: group.map(s => s.text).join(' '), keys: group.map(s => s.normText) });
        i = j;
      } else {
        units.push({ text: seg.text, keys: [seg.normText] });
        i++;
      }
    }
    return units;
  }

  function _stripJsonFence(s) {
    if (!s) return s;
    const m = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (m) return m[1].trim();
    return s.trim();
  }

  function _asrBatchEndMs(lastStartMs, rawSegments) {
    const next = (rawSegments || []).find(s => s && s.startMs > lastStartMs);
    if (next) return Math.min(next.startMs, lastStartMs + SK.ASR_LAST_CUE_MAX_EXTEND_MS);
    return lastStartMs + SK.ASR_LAST_CUE_FALLBACK_MS;
  }

  function _resolveAsrEntryTimeline(entries, subSegs, batchEndMs) {
    const startMsSet = new Set(subSegs.map(seg => seg && seg.startMs));
    const spanStart = subSegs[0] ? subSegs[0].startMs : 0;
    const valid = [];
    const caps = [];
    let droppedCount = 0;
    for (const entry of entries) {
      const s = Number(entry.s);
      const text = String(entry.t || '').trim();
      if (!Number.isFinite(s) || !text) { droppedCount++; continue; }
      if (!startMsSet.has(s)) {
        droppedCount++;
        if (s > spanStart && s < batchEndMs) caps.push(s);
        continue;
      }
      valid.push({ s, text });
    }
    valid.sort((a, b) => a.s - b.s);
    const dedup = [];
    for (const v of valid) {
      if (dedup.length && dedup[dedup.length - 1].s === v.s) dedup[dedup.length - 1] = v;
      else dedup.push(v);
    }
    caps.sort((a, b) => a - b);
    const cues = [];
    for (let i = 0; i < dedup.length; i++) {
      const cur = dedup[i];
      const nextS = i + 1 < dedup.length ? dedup[i + 1].s : batchEndMs;
      const cap = caps.find(c => c > cur.s && c < nextS);
      const endMs = cap != null ? cap : nextS;
      if (endMs <= cur.s) continue;
      cues.push({ startMs: cur.s, endMs, text: cur.text });
    }
    return { cues, droppedCount };
  }

  function _parseAsrResponse(text) {
    const stripped = _stripJsonFence(text);
    const start = stripped.indexOf('[');
    if (start < 0) throw new Error('ASR response: no array found');
    const parsed = JSON.parse(stripped.slice(start));
    if (!Array.isArray(parsed)) throw new Error('ASR response: not an array');
    return parsed;
  }

  SK.ASR_LLM_PAUSE_GAP_MS = 1500;
  function _buildAsrLlmInput(segs) {
    const lines = [];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg) continue;
      if (i > 0 && segs[i - 1] && seg.startMs - segs[i - 1].startMs >= SK.ASR_LLM_PAUSE_GAP_MS) lines.push('');
      const text = String(seg.text || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();
      lines.push(`${i + 1}|${text}`);
    }
    return lines.join('\n');
  }
  const _ASR_LLM_LINE_RE = /^\s*(\d+)\s*(?:[-–~]\s*(\d+))?\s*[|｜]\s*(.+?)\s*$/;
  function _parseAsrLlmOutput(text, segs, batchEndMs) {
    const stripped = _stripJsonFence(text || '');
    if (/^\s*\[/.test(stripped)) return _parseAsrResponse(stripped);
    const entries = [];
    let matched = 0;
    for (const line of stripped.split('\n')) {
      if (!line.trim()) continue;
      const m = line.match(_ASR_LLM_LINE_RE);
      if (!m) continue;
      matched++;
      let a = Number(m[1]);
      let b = m[2] != null ? Number(m[2]) : a;
      if (b < a) [a, b] = [b, a];
      b = Math.min(b, segs.length);
      const segA = segs[a - 1];
      if (!segA) { entries.push({ s: NaN, e: NaN, t: m[3] }); continue; }
      const next = segs[b];
      entries.push({ s: segA.startMs, e: next ? next.startMs : batchEndMs, t: m[3] });
    }
    if (matched === 0) throw new Error('ASR response: no parsable lines');
    return entries;
  }

  const _ASR_SENTENCE_END_RE = /[.!?。！？…]["')\]」』]*$/;

  function _collectAsrWindowSegs(rawSegments, windowStartMs, windowEndMs, consumed) {
    const maxMs = windowEndMs + SK.ASR_WINDOW_MAX_TAIL_EXTEND_MS;
    const segs = [];
    for (const seg of (rawSegments || [])) {
      if (!seg || seg.startMs < windowStartMs) continue;
      if (consumed && consumed.has(seg.startMs)) {
        if (seg.startMs >= windowEndMs) break;
        continue;
      }
      if (seg.startMs < windowEndMs) { segs.push(seg); continue; }
      if (segs.length === 0) break;
      if (_ASR_SENTENCE_END_RE.test(segs[segs.length - 1].text.trim())) break;
      if (seg.startMs > maxMs) break;
      segs.push(seg);
    }
    return segs;
  }
  SK._collectAsrWindowSegs = _collectAsrWindowSegs;

  const _ASR_SPLIT_SNAP_MS = 2000;

  function _splitLongAsrCue(startMs, endMs, text, segStarts) {
    const t = String(text || '').trim();
    const total = t.length;
    const whole = [{ startMs, endMs, text: t }];
    if (total <= SK.ASR_CUE_MAX_CHARS) return whole;
    const durMs = endMs - startMs;
    let n = Math.ceil(total / SK.ASR_CUE_MAX_CHARS);
    n = Math.min(n, Math.max(1, Math.floor(durMs / SK.ASR_CUE_MIN_PIECE_MS)));
    if (n <= 1) return whole;
    const SEARCH = 12;
    const pieces = [];
    let pos = 0;
    for (let k = 1; k < n; k++) {
      const ideal = Math.round((total * k) / n);
      let cut = -1;
      let bestDist = Infinity;
      const lo = Math.max(pos + 1, ideal - SEARCH);
      const hi = Math.min(total - 2, ideal + SEARCH);
      for (let i = lo; i <= hi; i++) {
        if (_isSentencePunctAt(t, i)) {
          const d = Math.abs(i + 1 - ideal);
          if (d < bestDist) { bestDist = d; cut = i + 1; }
        }
      }
      if (cut < 0) cut = ideal;
      cut = _snapCutOutOfWord(t, cut, pos, total);
      if (cut <= pos || cut >= total) continue;
      pieces.push(t.slice(pos, cut));
      pos = cut;
    }
    if (pos < total) pieces.push(t.slice(pos));
    if (pieces.length <= 1) return whole;
    const onsets = (segStarts || [])
      .filter(ms => Number.isFinite(ms) && ms > startMs && ms < endMs)
      .sort((a, b) => a - b);
    const out = [];
    let acc = 0;
    let cursor = startMs;
    for (let i = 0; i < pieces.length; i++) {
      acc += pieces[i].length;
      let end;
      if (i === pieces.length - 1) {
        end = endMs;
      } else {
        end = startMs + Math.round(durMs * acc / total);
        let best = null;
        let bestDist = _ASR_SPLIT_SNAP_MS + 1;
        for (const onset of onsets) {
          if (onset <= cursor) continue;
          const d = Math.abs(onset - end);
          if (d < bestDist) { bestDist = d; best = onset; }
        }
        if (best != null && bestDist <= _ASR_SPLIT_SNAP_MS) end = best;
      }
      const pt = pieces[i].trim();
      if (pt && end > cursor) out.push({ startMs: cursor, endMs: end, text: pt });
      cursor = end;
    }
    return out.length ? out : whole;
  }

  const _ASR_BREAK_WORDS = new Set([
    'mhm', 'um', '>>', '-',
    'in fact', 'such as', 'or even', 'get me', "well i'm",
    "i didn't", 'i know', 'i need', 'i will', "i'll", 'i mean',
    'you are', 'what does', 'no problem', 'as we', 'if you',
    'hello', 'okay', 'oh', 'yep', 'yes', 'hey', 'hi', 'yeah',
    'essentially', 'because', 'and', 'but', 'which', 'so',
    'where', 'what', 'now', 'or', 'how', 'after',
  ]);
  const _ASR_SKIP_WORDS = new Set(['uh']);
  const _ASR_END_WORDS = ['in', 'is', 'and', 'are', 'not', 'an', 'a', 'some', 'the',
    'but', 'our', 'for', 'of', 'if', 'his', 'her', 'my', 'noticed', 'come',
    'mean', 'why', 'this', 'has', 'make', 'gpt', 'p.m', 'a.m'];
  const _ASR_START_WORDS = ['or', 'to', 'in', 'has', 'of', 'are', 'is', 'lines',
    'with', 'days', 'years', 'tokens'];
  const _ASR_BREAK_MINI_TIME = 300;
  const _ASR_MIN_INTERVAL = 1000;
  const _ASR_MIN_WORD_LENGTH = 3;
  const _ASR_SENTENCE_MIN_WORD = 20;
  const _ASR_MAX_WORDS = 30;

  function _heuristicMergeAsr(rawSegments, lang) {
    if (lang === undefined) lang = SK.YT?.captionLang || null;
    if (!rawSegments?.length) return [];

    const events = rawSegments.map(s => ({
      utf8: s.text,
      tStartMs: s.startMs,
      groupId: s.groupId,
      isBreak: false,
      _src: s,
    }));

    function kle(evs) {
      if (!evs.length) return [];
      let baseMs = evs[0].tStartMs;
      const out = [];
      let cur = [];
      const pushBreak = (lead, group) => { baseMs = lead.tStartMs; out.push(cur); cur = group; group[0].isBreak = true; };
      for (let i = 0; i < evs.length; i++) {
        const c = evs[i];
        const next = evs[i + 1];
        const prev = evs[i - 1];
        const sameEvent = c.groupId != null && prev && prev.groupId === c.groupId;
        const m = sameEvent ? 0 : c.tStartMs - baseMs;
        const cTrim = c.utf8.trim().toLowerCase();
        if (_ASR_BREAK_WORDS.has(cTrim) && m > _ASR_BREAK_MINI_TIME) {
          pushBreak(c, [c]); continue;
        }
        if (next && _ASR_BREAK_WORDS.has((c.utf8 + next.utf8).trim().toLowerCase()) && m > _ASR_BREAK_MINI_TIME) {
          pushBreak(c, [c, next]); i++; continue;
        }
        if (_ASR_SKIP_WORDS.has(cTrim) && next) {
          baseMs = next.tStartMs; cur.push(next); i++; continue;
        }
        if (m <= _ASR_MIN_INTERVAL) {
          baseMs = c.tStartMs; cur.push(c); continue;
        }
        out.push(cur); cur = [c]; baseMs = c.tStartMs;
      }
      if (cur.length) out.push(cur);
      return out.filter(g => g.length > 0);
    }

    function Ile(groups) {
      if (groups.length <= 1) return groups;
      const _reEsc = (w) => w.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
      const startRe = new RegExp(`^\\s*(${_ASR_START_WORDS.map(_reEsc).join('|')})$`, 'i');
      const endRe = new RegExp(`\\b(${_ASR_END_WORDS.map(_reEsc).join('|')})\\s*$`, 'i');
      const result = [groups[0]];
      for (let u = 0; u < groups.length - 1; u++) {
        const cur = result[result.length - 1];
        const last = groups[u][groups[u].length - 1];
        const nextFirst = groups[u + 1][0];
        const gap = nextFirst.tStartMs - last.tStartMs;
        const matched = nextFirst.utf8.match(startRe) || last.utf8.match(endRe);
        if (matched && !nextFirst.isBreak && gap <= _ASR_MIN_INTERVAL) {
          const wordCount = joinSegTexts([...cur, ...groups[u + 1]].map(e => e.utf8), lang).split(/\s+/).filter(Boolean).length;
          if (wordCount <= _ASR_MAX_WORDS) {
            cur.push(...groups[u + 1]);
            continue;
          }
        }
        result.push(groups[u + 1]);
      }
      return result;
    }

    function Lle(groups) {
      const out = [...groups];
      for (let a = out.length - 1; a > 0; a--) {
        const o = out[a];
        const s = out[a - 1];
        if (o.length <= 0 || o.length > _ASR_MIN_WORD_LENGTH) continue;
        if (o.length + s.length >= _ASR_SENTENCE_MIN_WORD) continue;
        if (o[0].tStartMs - s[s.length - 1].tStartMs > _ASR_MIN_INTERVAL) continue;
        if (o[0].isBreak) continue;
        s.push(...o);
        out.splice(a, 1);
      }
      return out;
    }

    const split    = kle(events);
    const merged   = Ile(split);
    const compact  = Lle(merged);

    return compact.map((group, idx) => {
      const text = joinSegTexts(group.map(e => e.utf8), lang).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      const startMs = group[0].tStartMs;
      const next = compact[idx + 1];
      const endMs = next ? next[0].tStartMs : group[group.length - 1].tStartMs + SK.ASR_LAST_CUE_FALLBACK_MS;
      return {
        startMs,
        endMs,
        text,
        sourceSegs: group.map(e => e._src),
      };
    }).filter(s => s.text.length > 0);
  }

  SK._heuristicMergeAsr = _heuristicMergeAsr;

  const _TARGET_NATIVE_LANGS = {
    'zh-TW': ['zh-TW', 'zh-Hant', 'zh-HK'],
    'zh-CN': ['zh-CN', 'zh-Hans'],
    'en':    ['en', 'en-US', 'en-GB'],
    'ja':    ['ja', 'ja-JP'],
    'ko':    ['ko', 'ko-KR'],
    'es':    ['es', 'es-ES', 'es-MX'],
    'fr':    ['fr', 'fr-FR', 'fr-CA'],
    'de':    ['de', 'de-DE'],
  };

  const _AMBIGUOUS_LANGS_BY_TARGET = {
    'zh-TW': new Set(['zh']),
    'zh-CN': new Set(['zh']),
  };

  function _resolveTargetNativeLangs(targetLanguage) {
    return _TARGET_NATIVE_LANGS[targetLanguage] || [targetLanguage];
  }

  function _pickSourceAsrTrack(tracks, hints) {
    const asrTracks = tracks.filter(t => t.kind === 'asr');
    if (asrTracks.length === 0) return { track: null, asrCount: 0, via: 'none' };
    if (asrTracks.length === 1) return { track: asrTracks[0], asrCount: 1, via: 'single' };
    const h = hints || {};
    const byIdx = Number.isInteger(h.defaultCaptionTrackIndex) ? tracks[h.defaultCaptionTrackIndex] : null;
    if (byIdx && byIdx.kind === 'asr') return { track: byIdx, asrCount: asrTracks.length, via: 'default-index' };
    if (typeof h.originalAudioLang === 'string' && h.originalAudioLang) {
      const full = h.originalAudioLang.toLowerCase();
      const base = full.split('-')[0];
      const byLang = asrTracks.find(t => (t.languageCode || '').toLowerCase() === full)
                  || asrTracks.find(t => (t.languageCode || '').toLowerCase().split('-')[0] === base);
      if (byLang) return { track: byLang, asrCount: asrTracks.length, via: 'audio-lang' };
    }
    return { track: asrTracks[0], asrCount: asrTracks.length, via: 'first-fallback' };
  }

  SK._pickSourceAsrTrack = _pickSourceAsrTrack;

  function _chooseBestCaptionTrack(tracks, activeTrack, targetLanguage, hints) {
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return { action: 'noop', reason: 'no-tracks' };
    }
    const targetLangs = _resolveTargetNativeLangs(targetLanguage);
    const sourceAsr = _pickSourceAsrTrack(tracks, hints);
    const isNativeCandidate = t => t.kind !== 'asr' || t === sourceAsr.track;

    const p1 = tracks.find(t => targetLangs.includes(t.languageCode) && isNativeCandidate(t));
    if (p1) {
      const activeIsP1 = activeTrack
        && activeTrack.languageCode === p1.languageCode
        && (activeTrack.kind || '') === (p1.kind || '')
        && !activeTrack.translationLanguageCode;
      if (activeIsP1) {
        return { action: 'skip', track: p1, reason: 'p1-active-already-native' };
      }
      return { action: 'switch-to-native', track: p1, reason: 'p1-switch-to-native' };
    }

    const ambigSet = _AMBIGUOUS_LANGS_BY_TARGET[targetLanguage];
    if (ambigSet) {
      const p1b = tracks.find(t => ambigSet.has(t.languageCode) && (!t.kind || t.kind === ''))
               || tracks.find(t => ambigSet.has(t.languageCode) && isNativeCandidate(t));
      if (p1b) {
        const activeIsP1b = activeTrack
          && activeTrack.languageCode === p1b.languageCode
          && (activeTrack.kind || '') === (p1b.kind || '')
          && !activeTrack.translationLanguageCode;
        if (activeIsP1b) {
          return { action: 'noop', track: p1b, sourceLanguage: p1b.languageCode, reason: 'p1b-ambiguous-native-active' };
        }
        return { action: 'switch', track: p1b, sourceLanguage: p1b.languageCode, reason: 'p1b-ambiguous-native' };
      }
    }

    const asrTrack = sourceAsr.track;
    if (!asrTrack) {
      return { action: 'noop', reason: 'no-source-asr-track' };
    }
    const sourceLang = asrTrack.languageCode;

    const p2 = tracks.find(t => t.languageCode === sourceLang && (!t.kind || t.kind === ''));
    const desired = p2 || asrTrack;

    const alreadyOnTarget = activeTrack
      && activeTrack.languageCode === desired.languageCode
      && (activeTrack.kind || '') === (desired.kind || '')
      && !activeTrack.translationLanguageCode;
    if (alreadyOnTarget) {
      return { action: 'noop', track: desired, sourceLanguage: sourceLang, reason: 'already-on-target', sourceVia: sourceAsr.via };
    }

    return {
      action: 'switch',
      track: desired,
      sourceLanguage: sourceLang,
      reason: p2 ? 'p2-source-manual' : 'p3-source-asr',
      sourceVia: sourceAsr.via,
    };
  }

  SK._chooseBestCaptionTrack = _chooseBestCaptionTrack;

  async function _runCaptionTrackChooser(targetLanguage) {
    const detail = await bridgeRequest('transit-yt-query-player-response', 'transit-yt-player-response', null, 1500);
    if (!detail || !detail.playerResponseAvailable) {
      SK.sendLog('debug', 'youtube', 'chooser: bridge query failed / no player response', {});
      return 'noop';
    }
    const currentVideoId = getVideoIdFromUrl();
    if (detail.videoId && currentVideoId && detail.videoId !== currentVideoId) {
      SK.sendLog('debug', 'youtube', 'chooser: videoId mismatch (stale)', { bridge: detail.videoId, url: currentVideoId });
      return 'noop';
    }

    const hints = {
      defaultCaptionTrackIndex: detail.defaultCaptionTrackIndex,
      originalAudioLang:        detail.originalAudioLang,
    };
    const decision = _chooseBestCaptionTrack(detail.captionTracks, detail.activeTrack, targetLanguage, hints);
    const asrCount = Array.isArray(detail.captionTracks) ? detail.captionTracks.filter(t => t.kind === 'asr').length : 0;
    SK.sendLog('info', 'youtube', 'caption track chooser', {
      action:         decision.action,
      reason:         decision.reason,
      pickedLang:     decision.track?.languageCode,
      pickedKind:     decision.track?.kind,
      activeLang:     detail.activeTrack?.languageCode,
      activeKind:     detail.activeTrack?.kind,
      activeTransLang:detail.activeTrack?.translationLanguageCode,
      targetLanguage,
      trackCount:     detail.captionTracks?.length || 0,
      asrCount,
      sourceVia:      decision.sourceVia,
      hintDefaultIdx: hints.defaultCaptionTrackIndex,
      hintAudioLang:  hints.originalAudioLang,
    });
    if (asrCount > 1 && decision.sourceVia === 'first-fallback') {
      SK.sendLog('warn', 'youtube', 'chooser: multi-ASR video without usable source hints, fell back to first ASR track', { asrCount });
    }

    if (decision.action === 'switch' || decision.action === 'switch-to-native') {
      await bridgeRequest('transit-yt-set-caption-track', 'transit-yt-set-caption-track-result', {
        languageCode: decision.track.languageCode,
        kind: decision.track.kind || '',
      }, 1000);
    }

    return decision.action;
  }

  SK._runCaptionTrackChooser = _runCaptionTrackChooser;

  const _OVERLAY_TAG = 'transit-yt-overlay';

  function _getPlayerRoot() {
    return document.querySelector('#movie_player')
        || document.querySelector('.html5-video-player')
        || null;
  }

  function _ensureOverlay() {
    const root = _getPlayerRoot();
    if (!root) return null;
    let host = root.querySelector(_OVERLAY_TAG);
    if (host && host.shadowRoot) return host;
    if (!host) {
      host = document.createElement(_OVERLAY_TAG);
      Object.assign(host.style, {
        position: 'absolute',
        inset: '0',
        zIndex: '60',
        pointerEvents: 'none',
        display: 'none',
      });
      root.appendChild(host);
    }
    if (!host.shadowRoot) {
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host {
            font-family: var(--sk-cue-font-family,
              "PingFang TC", "Microsoft JhengHei", "微軟正黑體",
              "Heiti TC", "Noto Sans CJK TC", sans-serif);
          }
          .window {
            position: absolute;
            bottom: var(--sk-cue-bottom, 30px);
            transition: bottom 0.25s ease;
            left: 0;
            right: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 0 24px;
            box-sizing: border-box;
          }
          .cue-block {
            display: inline-block;
            max-width: 100%;
            padding: 0.05em 0.3em;
            background: var(--sk-cue-bg, rgba(0, 0, 0, 0.75));
            color: var(--sk-cue-color, #fff);
            border-radius: 3px;
            text-align: center;
            box-sizing: border-box;
          }
          .src, .tgt {
            display: block;
            font-size: var(--sk-cue-size, 18px);
            font-style: var(--sk-cue-font-style, normal);
            font-weight: var(--sk-cue-font-weight, normal);
            white-space: pre-wrap;
          }
          .src { line-height: 0.95; }
          .tgt { line-height: 1.45; }
          .src[hidden], .tgt:empty { display: none; }
        </style>
        <div class="window">
          <div class="cue-block">
            <span class="src" hidden></span>
            <span class="tgt"></span>
          </div>
        </div>
      `;
    }
    return host;
  }

  const _ASR_PUNCT_RE = /[\u002C\u002E\u003A\u003B\u0021\u003F\uFF0C\uFF0E\uFF1A\uFF1B\uFF01\uFF1F\u3001\u3002]/;

  const _ASR_WORD_CHAR_RE = /[A-Za-z0-9À-ɏ'’]/;

  function _isWordCharAt(t, i) {
    const c = t[i];
    if (c == null) return false;
    if (_ASR_WORD_CHAR_RE.test(c)) return true;
    return /[.\-]/.test(c) &&
      /[A-Za-z0-9]/.test(t[i - 1] || '') && /[A-Za-z0-9]/.test(t[i + 1] || '');
  }

  function _snapCutOutOfWord(t, cut, lo, hi) {
    if (cut <= lo || cut >= hi) return cut;
    if (!_isWordCharAt(t, cut - 1) || !_isWordCharAt(t, cut)) return cut;
    let s = cut;
    while (s > 0 && _isWordCharAt(t, s - 1)) s--;
    let e = cut;
    while (e < t.length && _isWordCharAt(t, e)) e++;
    const sOk = s > lo;
    const eOk = e < hi;
    if (sOk && eOk) return (cut - s <= e - cut) ? s : e;
    if (sOk) return s;
    if (eOk) return e;
    return cut;
  }
  SK._snapCutOutOfWord = _snapCutOutOfWord;

  function _isSentencePunctAt(t, i) {
    if (!_ASR_PUNCT_RE.test(t[i])) return false;
    if (/[,.:]/.test(t[i]) &&
        /[A-Za-z0-9]/.test(t[i - 1] || '') && /[A-Za-z0-9]/.test(t[i + 1] || '')) return false;
    return true;
  }

  function _calcMaxLineChars() {
    const video = document.querySelector('video');
    const fontSize = _readNativeCaptionFontSize() || 18;
    const videoWidth = (video && video.offsetWidth) || 800;
    const avgCharWidth = fontSize * 0.8;
    const targetWidth = videoWidth * 0.7;
    return Math.max(15, Math.min(35, Math.round(targetWidth / avgCharWidth)));
  }

  function _wrapTargetText(text) {
    const maxLine = _calcMaxLineChars();
    if (!text || text.length <= maxLine) return text;
    const lines = [];
    let rest = String(text);
    while (rest.length > maxLine) {
      let cutIdx = -1;
      for (let i = Math.min(rest.length - 2, maxLine); i >= 1; i--) {
        if (_isSentencePunctAt(rest, i)) { cutIdx = i + 1; break; }
      }
      if (cutIdx < 0) {
        for (let i = maxLine + 1; i < rest.length - 1; i++) {
          if (_isSentencePunctAt(rest, i)) { cutIdx = i + 1; break; }
        }
      }
      if (cutIdx < 0) cutIdx = maxLine;
      cutIdx = _snapCutOutOfWord(rest, cutIdx, 0, rest.length);
      lines.push(rest.slice(0, cutIdx).trim());
      rest = rest.slice(cutIdx).trim();
    }
    if (rest) lines.push(rest);
    return lines.join('\n');
  }

  function _escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const _injectedSegmentText = new WeakMap();

  function _setSegmentText(el, text) {
    const str = text == null ? '' : String(text);
    if (!str) {
      if (el.textContent !== '') el.textContent = '';
      _injectedSegmentText.set(el, '');
      return;
    }
    const wrapped = _wrapTargetText(str);
    if (wrapped.indexOf('\n') >= 0) {
      const html = _escapeHtml(wrapped).replace(/\n/g, '<br>');
      if (el.innerHTML !== html) el.innerHTML = html;
    } else {
      if (el.textContent !== wrapped) el.textContent = wrapped;
    }
    _applyScaleToSegment(el);
    _injectedSegmentText.set(el, el.textContent);
  }

  SK._setSegmentText = _setSegmentText;

  function _setOverlayContent(targetText, sourceText) {
    const host = _ensureOverlay();
    if (!host || !host.shadowRoot) return;
    let tgtEl = host.shadowRoot.querySelector('.tgt');
    let srcEl = host.shadowRoot.querySelector('.src');
    if (!tgtEl) {
      const win = host.shadowRoot.querySelector('.window');
      if (!win) return;
      win.innerHTML = '<div class="cue-block"><span class="src" hidden></span><span class="tgt"></span></div>';
      tgtEl = host.shadowRoot.querySelector('.tgt');
      srcEl = host.shadowRoot.querySelector('.src');
      if (!tgtEl) return;
    }
    if (!targetText) {
      if (tgtEl.innerHTML !== '') tgtEl.innerHTML = '';
      if (srcEl) {
        if (srcEl.innerHTML !== '') srcEl.innerHTML = '';
        srcEl.hidden = true;
      }
      host.style.display = 'none';
      return;
    }
    const wrapped = _wrapTargetText(targetText);
    const html = _escapeHtml(wrapped).replace(/\n/g, '<br>');
    if (tgtEl.innerHTML !== html) tgtEl.innerHTML = html;
    if (srcEl) {
      if (sourceText) {
        const srcHtml = _escapeHtml(String(sourceText)).replace(/\n/g, '<br>');
        if (srcEl.innerHTML !== srcHtml) srcEl.innerHTML = srcHtml;
        srcEl.hidden = false;
      } else {
        if (srcEl.innerHTML !== '') srcEl.innerHTML = '';
        srcEl.hidden = true;
      }
    }
    host.style.display = 'block';
  }

  SK._wrapTargetTextForOverlay = _wrapTargetText;
  SK._setOverlayContent = _setOverlayContent;
  SK._updateAsrOverlay = (...args) => _updateOverlay(...args);
  SK._splitAsrSubBatches = (windowSegs, videoNowMs, windowStartMs, playbackRate) =>
    _splitAsrSubBatches(windowSegs, videoNowMs, windowStartMs, playbackRate);

  function _updateNonAsrBilingualOverlay() {
    const YT = SK.YT;
    if (!YT.active || YT.isAsr) return;
    if (YT.config?.bilingualMode !== true) return;

    const segs = document.querySelectorAll('.ytp-caption-segment');
    const transBits = [];
    const srcBits = [];
    for (const seg of segs) {
      const txt = (seg.textContent || '').trim();
      if (!txt) continue;
      const cached = YT.captionMap.get(normText(txt));
      if (cached === undefined) continue;
      srcBits.push(txt);
      if (cached) transBits.push(cached);
    }
    const joinedTrans = transBits.join('\n');
    const joinedSrc = srcBits.join('\n');
    _setOverlayContent(joinedTrans, joinedSrc);

    const host = document.querySelector(_OVERLAY_TAG);
    if (!host) return;

    const nativeFz = _readNativeCaptionFontSize();
    if (nativeFz) host.style.setProperty('--sk-cue-size', _scaledCueSizePx(nativeFz) + 'px');
    const nativeFf = _readNativeCaptionFontFamily();
    if (nativeFf) host.style.setProperty('--sk-cue-font-family', nativeFf);
    const seg = document.querySelector('.ytp-caption-segment');
    if (seg) {
      const cs = getComputedStyle(seg);
      if (cs.fontStyle) host.style.setProperty('--sk-cue-font-style', cs.fontStyle);
      if (cs.fontWeight) host.style.setProperty('--sk-cue-font-weight', cs.fontWeight);
    }
    _applyNativeCaptionColors(host);

    _updateOverlayAnchor();
  }
  SK._updateNonAsrBilingualOverlay = _updateNonAsrBilingualOverlay;

  function _updateOverlayAnchor() {
    const host = document.querySelector(_OVERLAY_TAG);
    if (!host) return;
    const player = _getPlayerRoot();
    const cw = document.querySelector('.caption-window');
    if (player && cw) {
      const playerRect = player.getBoundingClientRect();
      const cwRect = cw.getBoundingClientRect();
      if (playerRect.height > 0 && cwRect.height > 0) {
        const bottom = Math.max(0, Math.round(playerRect.bottom - cwRect.bottom));
        host.style.setProperty('--sk-cue-bottom', bottom + 'px');
        return;
      }
    }
    host.style.removeProperty('--sk-cue-bottom');
  }

  function _removeOverlay() {
    const root = _getPlayerRoot();
    if (!root) return;
    root.querySelectorAll(_OVERLAY_TAG).forEach(el => el.remove());
  }

  const _ASR_PLAYER_CLASS = 'transit-asr-active';
  const _ASR_HIDE_CSS_ID  = 'transit-asr-hide-css';
  const _CC_PAUSED_PLAYER_CLASS = 'transit-cc-paused';
  function _ensureAsrStylesheet() {
    if (document.getElementById(_ASR_HIDE_CSS_ID)) return;
    const style = document.createElement('style');
    style.id = _ASR_HIDE_CSS_ID;
    style.textContent = `
      .${_ASR_PLAYER_CLASS} .ytp-caption-window-container,
      .${_CC_PAUSED_PLAYER_CLASS} .ytp-caption-window-container {
        pointer-events: none !important;
      }
      .${_ASR_PLAYER_CLASS} .caption-window,
      .${_ASR_PLAYER_CLASS} .ytp-caption-window-rollup,
      .${_ASR_PLAYER_CLASS} .ytp-caption-window-container .caption-window,
      .${_CC_PAUSED_PLAYER_CLASS} .caption-window,
      .${_CC_PAUSED_PLAYER_CLASS} .ytp-caption-window-rollup,
      .${_CC_PAUSED_PLAYER_CLASS} .ytp-caption-window-container .caption-window {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .html5-video-player:not(.ytp-autohide) ${_OVERLAY_TAG} {
        --sk-cue-bottom: calc(60px + var(--sk-cue-size, 22px));
      }
      ${_OVERLAY_TAG}[bilingual] {
        --sk-cue-bottom: 90px;
      }
      .html5-video-player:not(.ytp-autohide) ${_OVERLAY_TAG}[bilingual] {
        --sk-cue-bottom: calc(140px + var(--sk-cue-size, 22px));
      }
    `;
    document.head.appendChild(style);
  }

  function _setAsrHidingMode(active) {
    const root = _getPlayerRoot();
    if (!root) return;
    _ensureAsrStylesheet();
    if (active) {
      root.classList.add(_ASR_PLAYER_CLASS);
    } else {
      root.classList.remove(_ASR_PLAYER_CLASS);
    }
  }

  function _setCcPausedHidingMode(active) {
    const root = _getPlayerRoot();
    if (!root) return;
    _ensureAsrStylesheet();
    if (active) {
      root.classList.add(_CC_PAUSED_PLAYER_CLASS);
    } else {
      root.classList.remove(_CC_PAUSED_PLAYER_CLASS);
    }
  }

  function _applyBilingualMode(bilingual) {
    const captionInTarget = _shouldSkipBecauseAlreadyInTarget();
    const shouldHideNative = (bilingual || SK.YT.isAsr) && !captionInTarget;
    _setAsrHidingMode(shouldHideNative);
    if (bilingual) _ensureOverlay();
    const host = document.querySelector(_OVERLAY_TAG);
    if (host) {
      if (bilingual) {
        host.setAttribute('bilingual', 'true');
      } else {
        host.removeAttribute('bilingual');
      }
      host.style.removeProperty('--sk-cue-bottom');
      if (!bilingual) _setOverlayContent('');
    }
    if (bilingual) hideCaptionStatus();

    if (bilingual && !SK.YT.isAsr && SK.YT.active) {
      _updateNonAsrBilingualOverlay();
    }
    if (!bilingual && !SK.YT.isAsr && SK.YT.active) {
      document.querySelectorAll('.ytp-caption-segment').forEach((el) => {
        try { replaceSegmentEl(el); } catch (_) {}
      });
    }
  }
  SK._applyBilingualMode = _applyBilingualMode;

  let _lastGoodCaptionFontSize = 0;
  function _readNativeCaptionFontSize() {
    const seg = document.querySelector('.ytp-caption-segment');
    if (seg) {
      const baseAttr = seg.dataset ? parseFloat(seg.dataset.skBaseFs) : NaN;
      const fz = (Number.isFinite(baseAttr) && baseAttr > 0)
        ? baseAttr
        : parseFloat(getComputedStyle(seg).fontSize);
      if (Number.isFinite(fz) && fz > 0) { _lastGoodCaptionFontSize = fz; return fz; }
    }
    const win = document.querySelector('.caption-window');
    if (win) {
      const fz = parseFloat(getComputedStyle(win).fontSize);
      if (Number.isFinite(fz) && fz > 0) { _lastGoodCaptionFontSize = fz; return fz; }
    }
    if (_lastGoodCaptionFontSize > 0) return _lastGoodCaptionFontSize;
    const video = document.querySelector('video');
    if (video && video.offsetHeight) return Math.round(video.offsetHeight * 0.045);
    return 18;
  }
  SK._readNativeCaptionFontSize = _readNativeCaptionFontSize;
  SK._resetCaptionFontSizeCache = () => { _lastGoodCaptionFontSize = 0; };

  function _readNativeCaptionFontFamily() {
    const seg = document.querySelector('.ytp-caption-segment');
    if (seg) {
      const ff = getComputedStyle(seg).fontFamily;
      if (ff) return ff;
    }
    const win = document.querySelector('.caption-window');
    if (win) {
      const ff = getComputedStyle(win).fontFamily;
      if (ff) return ff;
    }
    return '"PingFang TC", "Microsoft JhengHei", "微軟正黑體", "Heiti TC", "Noto Sans CJK TC", sans-serif';
  }

  let _lastGoodCaptionColors = null;
  function _readNativeCaptionColors() {
    const seg = document.querySelector('.ytp-caption-segment');
    if (seg) {
      const cs = getComputedStyle(seg);
      if (cs.color || cs.backgroundColor) {
        _lastGoodCaptionColors = { color: cs.color, background: cs.backgroundColor };
      }
    }
    return _lastGoodCaptionColors;
  }
  function _applyNativeCaptionColors(host) {
    const colors = _readNativeCaptionColors();
    if (!colors || !host) return;
    if (colors.color) host.style.setProperty('--sk-cue-color', colors.color);
    if (colors.background) host.style.setProperty('--sk-cue-bg', colors.background);
  }
  SK._readNativeCaptionColors = _readNativeCaptionColors;
  SK._applyNativeCaptionColors = _applyNativeCaptionColors;
  SK._resetCaptionColorsCache = () => { _lastGoodCaptionColors = null; };

  function _findActiveCueIdx(cues, currentMs) {
    if (!cues || !cues.length) return -1;
    currentMs = currentMs + (SK.ASR_CUE_LEAD_MS || 0);
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (!c) continue;
      const next = cues[i + 1];
      const nextStart = (next) ? next.startMs : Infinity;
      const effectiveEnd = Math.min(c.endMs, nextStart);
      if (currentMs >= c.startMs && currentMs <= effectiveEnd) return i;
    }
    return -1;
  }
  function _findActiveCue(currentMs) {
    const cues = SK.YT.displayCues;
    const idx = _findActiveCueIdx(cues, currentMs);
    return idx >= 0 ? cues[idx] : null;
  }

  const _ASR_NO_SPACE_LANG_RE = /^(ja|zh|th|lo|km|my|bo)(-|_|$)/i;
  function joinSegTexts(texts, lang) {
    const sep = (lang && _ASR_NO_SPACE_LANG_RE.test(String(lang))) ? '' : ' ';
    return texts.join(sep);
  }

  const _OVERLAY_PROF = (() => { try { return !!SK.isDevTailBuild?.(); } catch (_) { return false; } })();
  function _updateOverlay() {
    if (!_OVERLAY_PROF) return _updateOverlayImpl();
    const t0 = performance.now();
    try { return _updateOverlayImpl(); } finally {
      const dt = performance.now() - t0;
      const P = SK.YT._overlayProf || (SK.YT._overlayProf = { calls: 0, totalMs: 0, maxMs: 0 });
      P.calls++; P.totalMs += dt; if (dt > P.maxMs) P.maxMs = dt;
    }
  }
  function _updateOverlayImpl() {
    const YT = SK.YT;
    if (!YT.active || !YT.isAsr) return;
    if (YT.ccPaused) {
      _setOverlayContent('');
      return;
    }
    if (!YT.videoEl) return;
    if (YT.videoEl.ended) {
      _setOverlayContent('');
      return;
    }
    const host = _ensureOverlay();
    if (host) {
      const nativeFz = _readNativeCaptionFontSize();
      host.style.setProperty('--sk-cue-size', _scaledCueSizePx(nativeFz) + 'px');
      const nativeFf = _readNativeCaptionFontFamily();
      if (nativeFf) host.style.setProperty('--sk-cue-font-family', nativeFf);
      _applyNativeCaptionColors(host);
    }
    const currentMs = YT.videoEl.currentTime * 1000;
    const cue = _findActiveCue(currentMs);
    if (cue && cue.targetText) hideCaptionStatus();
    const isBilingual = YT.config?.bilingualMode === true;
    const targetText = cue ? cue.targetText : '';
    const sourceText = (isBilingual && cue) ? cue.sourceText : undefined;
    _setOverlayContent(targetText, sourceText);
    if (isBilingual && cue) _updateOverlayAnchor();
  }

  const _ASR_READ_MS_PER_CHAR = 200;
  const _ASR_MIN_READ_MS       = 800;

  function _upsertDisplayCue(startMs, endMs, sourceText, targetText, opts) {
    const cues = SK.YT.displayCues;
    const trans = String(targetText || '');
    const llmEndMs = Number(endMs) || 0;
    const idealReadMs = Math.max(_ASR_MIN_READ_MS, trans.length * _ASR_READ_MS_PER_CHAR);
    const adjustedEnd = Math.max(llmEndMs, Number(startMs) + idealReadMs);
    const next = { startMs, endMs: adjustedEnd, sourceText: sourceText || '', targetText: trans };

    if (opts && opts.replaceRange) {
      for (let i = cues.length - 1; i >= 0; i--) {
        const c = cues[i];
        if (c && c.startMs > startMs && c.startMs < llmEndMs) cues.splice(i, 1);
      }
    }

    const idx = cues.findIndex(c => c && c.startMs === startMs);
    if (idx >= 0) cues[idx] = next;
    else cues.push(next);

    if (cues.some(c => !c)) {
      const filtered = cues.filter(c => !!c);
      cues.length = 0;
      cues.push(...filtered);
    }
    cues.sort((a, b) => a.startMs - b.startMs);
  }

  SK._findActiveCue = _findActiveCue;

  let _ytCaptionScale = 100;
  function _scaledCueSizePx(nativeFz) {
    return Math.round(nativeFz * _ytCaptionScale / 100);
  }
  SK._scaledCueSizePx = _scaledCueSizePx;
  function _applyScaleToSegment(el) {
    if (!el || !el.style) return;
    if (_ytCaptionScale === 100 && el.dataset.skBaseFs == null) return;
    if (el.dataset.skBaseFs == null) el.dataset.skBaseFs = el.style.fontSize || '';
    const base = parseFloat(el.dataset.skBaseFs);
    if (!Number.isFinite(base) || base <= 0) return;
    const px = (_ytCaptionScale === 100 ? base : Math.round(base * _ytCaptionScale / 100)) + 'px';
    if (el.style.fontSize !== px) el.style.fontSize = px;
  }
  SK._applyScaleToSegment = _applyScaleToSegment;
  let _captionScaleObserver = null;
  let _captionScaleRaf = 0;
  function _applyScaleToAllSegments() {
    document.querySelectorAll('.ytp-caption-segment').forEach(_applyScaleToSegment);
  }
  function _startCaptionScaleObserver(retries) {
    if (_captionScaleObserver) { _applyScaleToAllSegments(); return; }
    const root = document.querySelector('#movie_player');
    if (!root) {
      if ((retries == null ? 10 : retries) > 0) {
        setTimeout(() => _startCaptionScaleObserver((retries == null ? 10 : retries) - 1), 1000);
      }
      return;
    }
    _captionScaleObserver = new MutationObserver(() => {
      if (_captionScaleRaf) return;
      _captionScaleRaf = requestAnimationFrame(() => { _captionScaleRaf = 0; _applyScaleToAllSegments(); });
    });
    _captionScaleObserver.observe(root, { childList: true, subtree: true });
    _applyScaleToAllSegments();
  }
  function _stopCaptionScaleObserver() {
    if (_captionScaleObserver) { _captionScaleObserver.disconnect(); _captionScaleObserver = null; }
    if (_captionScaleRaf) { cancelAnimationFrame(_captionScaleRaf); _captionScaleRaf = 0; }
  }
  function _applyYtCaptionScale(scale) {
    const n = Number(scale);
    if (Number.isFinite(n) && n >= 50 && n <= 400) _ytCaptionScale = Math.round(n);
    const host = document.querySelector(_OVERLAY_TAG);
    if (host) {
      const nativeFz = _readNativeCaptionFontSize();
      if (nativeFz) host.style.setProperty('--sk-cue-size', _scaledCueSizePx(nativeFz) + 'px');
    }
    if (_ytCaptionScale !== 100) {
      _startCaptionScaleObserver();
    } else {
      _stopCaptionScaleObserver();
      document.querySelectorAll('.ytp-caption-segment').forEach(_applyScaleToSegment);
    }
  }
  SK._applyYtCaptionScale = _applyYtCaptionScale;

  function _calcAdaptiveBatch0(windowStartMs) {
    const YT = SK.YT;
    const videoNowMs = YT.videoEl ? YT.videoEl.currentTime * 1000 : windowStartMs;
    const leadMs = windowStartMs - videoNowMs;
    const playbackRate = YT.videoEl?.playbackRate || 1;
    const wallLeadMs = leadMs / playbackRate;
    const firstBatchSize = leadMs <= 0        ? 1
                         : wallLeadMs < 5000   ? 2
                         : wallLeadMs < 10000  ? 4
                         : wallLeadMs < 15000  ? 12
                         : 16;
    return { videoNowMs, leadMs, playbackRate, wallLeadMs, firstBatchSize };
  }
  SK._calcAdaptiveBatch0 = _calcAdaptiveBatch0;

  function _splitAsrSubBatches(windowSegs, videoNowMs, windowStartMs, playbackRate) {
    if (windowSegs.length === 0) return [];
    if (windowSegs.length <= 5) return [windowSegs];

    const GAP_MS = 500;

    const leadMs = (typeof windowStartMs === 'number' && typeof videoNowMs === 'number')
      ? windowStartMs - videoNowMs : Infinity;
    const rate = (typeof playbackRate === 'number' && playbackRate > 0) ? playbackRate : 1;
    const wallLeadMs = leadMs / rate;
    const sub0Start = leadMs <= 0 ? videoNowMs : windowSegs[0].startMs;
    const segs = leadMs <= 0
      ? windowSegs.filter(s => s.startMs >= sub0Start)
      : windowSegs;
    if (segs.length === 0) return [];
    if (segs.length <= 5) return [segs];
    const n = segs.length;

    const sub0Max = leadMs <= 0       ? 4000
                  : wallLeadMs < 5000 ? 6000
                                      : 8000;
    const sub0Min = Math.min(2000, sub0Max - 1000);

    function findCutIdx(fromIdx, minSpanMs, maxSpanMs) {
      const baseMs = segs[fromIdx].startMs;
      let bestIdx = -1;
      let bestGap = 0;
      for (let i = fromIdx + 1; i < n; i++) {
        const span = segs[i].startMs - baseMs;
        if (span < minSpanMs) continue;
        if (span > maxSpanMs) break;
        if (segs[i].groupId != null && segs[i].groupId === segs[i - 1].groupId) continue;
        const gap = segs[i].startMs - segs[i - 1].startMs;
        if (gap >= GAP_MS && gap > bestGap) {
          bestGap = gap;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) {
        for (let i = fromIdx + 1; i < n; i++) {
          const span = segs[i].startMs - baseMs;
          if (span >= maxSpanMs) { bestIdx = i; break; }
        }
      }
      return bestIdx;
    }

    const PUNCT_CUT_SLACK_MS = 5000;
    const hasPunct = segs.some(s => _ASR_SENTENCE_END_RE.test((s.text || '').trim()));

    function findPunctCutIdx(fromIdx, minSpanMs, maxSpanMs) {
      const baseMs = segs[fromIdx].startMs;
      let best = -1;
      for (let i = fromIdx + 1; i < n; i++) {
        const span = segs[i].startMs - baseMs;
        if (span > maxSpanMs + PUNCT_CUT_SLACK_MS) break;
        if (!_ASR_SENTENCE_END_RE.test((segs[i - 1].text || '').trim())) continue;
        if (span < minSpanMs) continue;
        if (span <= maxSpanMs) { best = i; continue; }
        if (best < 0) best = i;
        break;
      }
      return best;
    }

    const _findCut = hasPunct ? findPunctCutIdx : findCutIdx;
    const cuts = [];
    const cut1 = _findCut(0, sub0Min, sub0Max);
    if (cut1 > 0) cuts.push(cut1);
    if (cut1 > 0) {
      const cut2 = _findCut(cut1, 8000, 15000);
      if (cut2 > cut1) cuts.push(cut2);
    }

    if (cuts.length === 0) return [segs];
    const batches = [];
    let prev = 0;
    for (const c of cuts) {
      batches.push(segs.slice(prev, c));
      prev = c;
    }
    batches.push(segs.slice(prev));
    return batches.filter(b => b.length > 0);
  }

  async function _runAsrSubBatch(subSegs, batchIdx, _t0Window, batchApiMsRef) {
    const YT = SK.YT;
    const _myGen = YT.captionSourceGen || 0;
    const lastSeg = subSegs[subSegs.length - 1];
    const batchEndMs = _asrBatchEndMs(lastSeg.startMs, YT.rawSegments);
    const inputJson = _buildAsrLlmInput(subSegs);

    const _asrMsgType = SK.getSubtitleBatchType(SK.YT.config?.engine, true);
    const res = await SK.safeSendMessage({
      type: _asrMsgType,
      payload: {
        texts: [inputJson],
        glossary: null,
        sourceLanguage: SK.YT.captionLang || 'en',
      },
    });
    const elapsed = Date.now() - _t0Window;
    if (batchApiMsRef) batchApiMsRef[batchIdx] = elapsed;

    if (!res?.ok) throw new Error(SK.i18n.bgErrorMessage(res) || 'ASR translation failed');
    if (!YT.active || _myGen !== (YT.captionSourceGen || 0)) {
      SK.sendLog('info', 'youtube', 'asr sub-batch result discarded (session changed)', {
        batchIdx, gen: _myGen, currentGen: YT.captionSourceGen, active: YT.active,
      });
      return;
    }
    _logWindowUsage(subSegs.length, res.usage);

    const rawText = res.result?.[0] || '';
    const entries = _parseAsrLlmOutput(rawText, subSegs, batchEndMs);

    const { cues, droppedCount } = _resolveAsrEntryTimeline(entries, subSegs, batchEndMs);
    let writtenCount = 0;
    for (const cue of cues) {
      const covered = subSegs.filter(seg => seg && seg.startMs >= cue.startMs && seg.startMs < cue.endMs);
      if (covered.length === 0) continue;
      YT.captionMap.set(covered[0].normText, cue.text);
      for (let k = 1; k < covered.length; k++) {
        if (covered[k].normText !== covered[0].normText) YT.captionMap.set(covered[k].normText, '');
      }
      const sourceText = joinSegTexts(covered.map(seg => seg.text), YT.captionLang);
      const _segStarts = covered.map(seg => seg.startMs);
      for (const piece of _splitLongAsrCue(cue.startMs, cue.endMs, cue.text, _segStarts)) {
        _upsertDisplayCue(piece.startMs, piece.endMs, sourceText, piece.text, { replaceRange: true });
      }
      writtenCount++;
    }

    _updateOverlay();

    SK.sendLog('info', 'youtube', 'asr sub-batch done', {
      batchIdx,
      batchSize: subSegs.length,
      elapsedMs: elapsed,
      sessionOffsetMs: Date.now() - YT.sessionStartTime,
      entriesReturned: entries.length,
      entriesWritten: writtenCount,
      entriesDropped: droppedCount,
      captionMapSize: YT.captionMap.size,
    });
  }
  SK._runAsrSubBatch = _runAsrSubBatch;

  async function _runAsrWindow(windowSegs, windowStartMs, windowEndMs) {
    const YT = SK.YT;
    if (!YT.active) return;

    const videoNowMs = YT.videoEl ? Math.floor(YT.videoEl.currentTime * 1000) : windowStartMs;
    const playbackRate = YT.videoEl?.playbackRate || 1;
    const subBatches = _splitAsrSubBatches(windowSegs, videoNowMs, windowStartMs, playbackRate);
    YT.lastLeadMs = (windowStartMs - videoNowMs) / playbackRate;
    YT.firstBatchSize = subBatches[0]?.length ?? 0;
    SK.sendLog('info', 'youtube', 'asr window start', {
      windowStartMs, windowEndMs, videoNowMs,
      leadMs: windowStartMs - videoNowMs,
      segCount: windowSegs.length,
      subBatches: subBatches.map(b => b.length),
      subBatchSpans: subBatches.map(b => `${Math.round(b[0].startMs/1000)}–${Math.round(b[b.length-1].startMs/1000)}s`),
    });

    const _t0 = Date.now();
    const _batchApiMs = new Array(subBatches.length).fill(0);

    if (subBatches.length === 0) return 0;

    let _okBatches = 0;
    try {
      await _runAsrSubBatch(subBatches[0], 0, _t0, _batchApiMs);
      _okBatches++;
      YT.lastApiMs = _batchApiMs[0];
    } catch (err) {
      SK.sendLog('error', 'youtube', 'asr sub-batch 0 failed', { error: err.message });
      _notifyTranslationError(err.message);
    }
    if (!YT.active) {
      YT.batchApiMs = _batchApiMs;
      return _okBatches;
    }
    if (subBatches.length > 1) {
      const settled = await Promise.allSettled(
        subBatches.slice(1).map((sb, i) => _runAsrSubBatch(sb, i + 1, _t0, _batchApiMs))
      );
      settled.forEach((r, i) => {
        if (r.status === 'rejected') {
          SK.sendLog('error', 'youtube', `asr sub-batch ${i + 1} failed`, {
            error: r.reason?.message || String(r.reason),
          });
        } else {
          _okBatches++;
        }
      });
    }

    YT.batchApiMs = _batchApiMs;

    SK.sendLog('info', 'youtube', 'asr window done', {
      windowStartMs, windowEndMs,
      totalElapsedMs: Date.now() - _t0,
      sessionOffsetMs: Date.now() - YT.sessionStartTime,
      subBatchTimings: _batchApiMs,
      captionMapSize: YT.captionMap.size,
      okBatches: _okBatches,
    });
    return _okBatches;
  }

  async function _runAsrHeuristicWindow(windowSegs, windowStartMs, options) {
    const YT = SK.YT;
    if (!YT.active) return;

    const sentences = _heuristicMergeAsr(windowSegs);
    if (sentences.length === 0) return;

    const _lastSentence = sentences[sentences.length - 1];
    _lastSentence.endMs = _asrBatchEndMs(windowSegs[windowSegs.length - 1].startMs, YT.rawSegments);

    SK.sendLog('info', 'youtube', 'asr heuristic merged', {
      windowStartMs, windowSegCount: windowSegs.length,
      sentenceCount: sentences.length,
      avgSegsPerSentence: (windowSegs.length / sentences.length).toFixed(1),
    });

    const units = sentences.map(s => ({
      text: s.text,
      keys: s.sourceSegs.map(seg => seg.normText),
      _cue: {
        startMs: s.startMs, endMs: s.endMs, sourceText: s.text,
        segStarts: s.sourceSegs.map(seg => seg.startMs),
      },
    }));

    const BATCH = options?.isUrgent ? 4 : 12;
    const { wallLeadMs, firstBatchSize } = _calcAdaptiveBatch0(windowStartMs);
    YT.firstBatchSize = firstBatchSize;
    YT.lastLeadMs = wallLeadMs;

    const batches = [];
    if (units.length > 0) {
      batches.push(units.slice(0, Math.min(firstBatchSize, units.length)));
      for (let i = firstBatchSize; i < units.length; i += BATCH) {
        batches.push(units.slice(i, i + BATCH));
      }
    }

    if (!YT.active) return;
    const _t0 = Date.now();
    const _batchApiMs = new Array(batches.length).fill(0);
    const _myGen = YT.captionSourceGen || 0;

    const _heuristicMsgType = SK.getSubtitleBatchType(SK.YT.config?.engine, false);

    const _runBatch = (batchUnits, b) =>
      SK.safeSendMessage({
        type: _heuristicMsgType,
        payload: { texts: batchUnits.map(u => u.text), glossary: null },
      }).then(res => {
        const elapsed = Date.now() - _t0;
        _batchApiMs[b] = elapsed;
        if (!res?.ok) throw new Error(SK.i18n.bgErrorMessage(res) || SK.t('common.errorUnknown'));
        if (!YT.active || _myGen !== (YT.captionSourceGen || 0)) {
          SK.sendLog('info', 'youtube', 'asr heuristic batch result discarded (session changed)', {
            batchIdx: b, gen: _myGen, currentGen: YT.captionSourceGen, active: YT.active,
          });
          return;
        }
        _logWindowUsage(batchUnits.length, res.usage);
        const results = res.result || [];
        for (let j = 0; j < batchUnits.length; j++) {
          const unit = batchUnits[j];
          const trans = SK.sanitizeMarkers(String(results[j] || unit.text).trim());
          let normTrans = trans;
          if (unit.keys.length === 1) {
            YT.captionMap.set(unit.keys[0], trans);
          } else {
            normTrans = trans.replace(/\\n/g, ' ').replace(/\n/g, ' ').trim();
            YT.captionMap.set(unit.keys[0], normTrans);
            for (let k = 1; k < unit.keys.length; k++) {
              if (unit.keys[k] !== unit.keys[0]) YT.captionMap.set(unit.keys[k], '');
            }
          }
          if (unit._cue) {
            for (const piece of _splitLongAsrCue(unit._cue.startMs, unit._cue.endMs, normTrans, unit._cue.segStarts)) {
              _upsertDisplayCue(piece.startMs, piece.endMs, unit._cue.sourceText, piece.text);
            }
          }
        }
        _updateOverlay();
        SK.sendLog('info', 'youtube', 'asr heuristic batch done', {
          batchIdx: b, batchSize: batchUnits.length, elapsedMs: elapsed,
          sessionOffsetMs: Date.now() - YT.sessionStartTime,
          captionMapSize: YT.captionMap.size,
        });
      });

    let _okBatches = 0;
    if (batches.length > 0) {
      try {
        await _runBatch(batches[0], 0);
        _okBatches++;
        YT.lastApiMs = _batchApiMs[0];
      } catch (err) {
        SK.sendLog('error', 'youtube', 'asr heuristic batch 0 failed', { error: err.message });
        _notifyTranslationError(err.message);
      }
      if (!YT.active) { YT.batchApiMs = _batchApiMs; return _okBatches; }
      if (batches.length > 1) {
        const settled = await Promise.allSettled(
          batches.slice(1).map((bu, i) => _runBatch(bu, i + 1))
        );
        settled.forEach((r, i) => {
          if (r.status === 'rejected') {
            SK.sendLog('error', 'youtube', `asr heuristic batch ${i + 1} failed`, {
              error: r.reason?.message || String(r.reason),
            });
          } else {
            _okBatches++;
          }
        });
      }
    }
    YT.batchApiMs = _batchApiMs;

    SK.sendLog('info', 'youtube', 'asr heuristic window done', {
      sentences: sentences.length,
      totalElapsedMs: Date.now() - _t0,
      sessionOffsetMs: Date.now() - YT.sessionStartTime,
      captionMapSize: YT.captionMap.size,
      okBatches: _okBatches,
    });
    return _okBatches;
  }
  SK._runAsrHeuristicWindow = _runAsrHeuristicWindow;

  const SKIP_LANGS_BY_TARGET = {
    'zh-TW': new Set(['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO', 'zh-Hans', 'zh-CN', 'zh-SG']),
    'zh-CN': new Set(['zh-Hans', 'zh-CN', 'zh-SG']),
    'en':    new Set(['en', 'en-US', 'en-GB', 'en-CA', 'en-AU', 'en-IE', 'en-NZ']),
    'ja':    new Set(['ja', 'ja-JP']),
    'ko':    new Set(['ko', 'ko-KR']),
    'es':    new Set(['es', 'es-ES', 'es-MX', 'es-AR', 'es-CL', 'es-CO', 'es-419']),
    'fr':    new Set(['fr', 'fr-FR', 'fr-CA', 'fr-BE', 'fr-CH']),
    'de':    new Set(['de', 'de-DE', 'de-AT', 'de-CH']),
  };
  function _sampleCaptionText() {
    const segs = SK.YT.rawSegments;
    if (!segs || segs.length === 0) return '';
    return segs.slice(0, 30).map(s => s.text || '').join('').slice(0, 500);
  }
  function _shouldSkipBecauseAlreadyInTarget() {
    const captionLang = SK.YT.captionLang;
    if (!captionLang) return false;
    const target = SK.STATE?.targetLanguage || 'zh-TW';
    const skipSet = SKIP_LANGS_BY_TARGET[target];
    if (skipSet && skipSet.has(captionLang)) return true;
    const ambig = _AMBIGUOUS_LANGS_BY_TARGET[target];
    if (ambig && ambig.has(captionLang)) {
      const sample = _sampleCaptionText();
      if (sample) {
        if (target === 'zh-TW' && typeof SK.detectTextLang === 'function') {
          const detected = SK.detectTextLang(sample);
          if (detected === 'zh-Hant' || detected === 'zh-Hans') return true;
        } else if (typeof SK.isAlreadyInTarget === 'function' && SK.isAlreadyInTarget(sample, target)) {
          return true;
        }
      }
    }
    return false;
  }
  function _shouldSkipBecauseAlreadyTraditionalChinese() {
    return _shouldSkipBecauseAlreadyInTarget();
  }

  function _shouldShowTranslatingStatus() {
    if (_shouldSkipBecauseAlreadyTraditionalChinese()) return false;
    if (_hasVisibleTargetCaption()) return false;
    return true;
  }
  SK._shouldShowTranslatingStatus = _shouldShowTranslatingStatus;
  SK._showCaptionStatus = showCaptionStatus;
  SK._notifyTranslationError = _notifyTranslationError;

  function _notifyTranslationError(errorMessage) {
    const YT = SK.YT;
    hideCaptionStatus();
    if (YT._errorNotified) return;
    YT._errorNotified = true;
    SK.showToast('error', SK.t('toast.translateFailed', { error: errorMessage }), { autoHideMs: 8000 });
  }

  SK.translateWindowFrom = (windowStartMs) => translateWindowFrom(windowStartMs);

  async function translateWindowFrom(windowStartMs) {
    const YT = SK.YT;
    if (YT.translatingWindows.has(windowStartMs)) return;
    if (!YT.active) return;
    if (_shouldSkipBecauseAlreadyTraditionalChinese()) {
      if (!YT._skipLoggedForLang) {
        SK.sendLog('info', 'youtube', 'skip translate: caption already readable for target', {
          captionLang: YT.captionLang,
          videoId: YT.videoId,
        });
        YT._skipLoggedForLang = true;
      }
      hideCaptionStatus();
      return;
    }

    const _myCaptionGen = YT.captionSourceGen || 0;

    const config = await getYtConfig();
    const windowSizeMs = (config.windowSizeS || 30) * 1000;
    const windowEndMs  = windowStartMs + windowSizeMs;

    YT.translatedUpToMs = windowEndMs;
    const _myTranslatingWindows = YT.translatingWindows;
    _myTranslatingWindows.add(windowStartMs);

    try {

    if (YT.translatedWindows.has(windowStartMs)) return;

    const _cmSizeBefore = YT.captionMap.size;
    const _cuesCountBefore = YT.displayCues.length;
    let _okBatchCount = 0;

    const _myConsumedSet = YT.isAsr ? YT.asrSegConsumed : null;
    const windowSegs = YT.isAsr
      ? _collectAsrWindowSegs(YT.rawSegments, windowStartMs, windowEndMs, _myConsumedSet)
      : YT.rawSegments.filter(
          s => s.startMs >= windowStartMs && s.startMs < windowEndMs
        );
    if (_myConsumedSet) windowSegs.forEach(s => _myConsumedSet.add(s.startMs));

    SK.sendLog('info', 'youtube', 'translateWindow start', {
      windowStartMs, windowEndMs, segCount: windowSegs.length,
      sessionOffsetMs: Date.now() - YT.sessionStartTime,
    });
    if (config.debugToast && windowSegs.length > 0) {
      SK.sendLog('info', 'youtube-debug', 'translateWindow texts', {
        window: `${Math.round(windowStartMs/1000)}–${Math.round(windowEndMs/1000)}s`,
        texts: windowSegs.map(s => ({ ms: s.startMs, norm: s.normText })),
      });
    }
    _debugUpdate(`翻譯視窗 ${Math.round(windowStartMs/1000)}–${Math.round(windowEndMs/1000)}s（${windowSegs.length} 條）`);

    if (windowSegs.length > 0 && YT.isAsr) {
      const asrMode = (config.engine === 'google')
        ? 'heuristic'
        : (config.asrMode || 'progressive');

      const _videoNowMs = YT.videoEl ? YT.videoEl.currentTime * 1000 : 0;
      const _wallLead = (windowStartMs - _videoNowMs) / (YT.videoEl?.playbackRate || 1);
      const _isUrgent = _wallLead < 10000;

      if (asrMode === 'heuristic' || asrMode === 'progressive') {
        try {
          _okBatchCount += (await _runAsrHeuristicWindow(windowSegs, windowStartMs, { isUrgent: _isUrgent })) || 0;
        } catch (err) {
          SK.sendLog('error', 'youtube', 'asr heuristic translation failed', { error: err.message });
        }
      }

      if (asrMode === 'llm' || asrMode === 'progressive') {
        if (asrMode === 'progressive') {
          _runAsrWindow(windowSegs, windowStartMs, windowEndMs).catch(err => {
            SK.sendLog('error', 'youtube', 'asr llm overlay failed', {
              error: err.message,
              stack: (err.stack || '').split('\n').slice(0, 5).join(' | '),
            });
          });
        } else {
          try {
            _okBatchCount += (await _runAsrWindow(windowSegs, windowStartMs, windowEndMs)) || 0;
          } catch (err) {
            SK.sendLog('error', 'youtube', 'asr window translation failed', { error: err.message });
          }
        }
      }
    } else if (windowSegs.length > 0) {
      const BATCH = 12;
      const preserve = true;
      const units = buildTranslationUnits(windowSegs, preserve);
      try {
        const { leadMs, playbackRate, wallLeadMs, firstBatchSize } = _calcAdaptiveBatch0(windowStartMs);
        YT.firstBatchSize = firstBatchSize;
        YT.lastLeadMs     = wallLeadMs;
        SK.sendLog('info', 'youtube', 'adaptive batch0', {
          leadMs: Math.round(leadMs),
          wallLeadMs: Math.round(wallLeadMs),
          playbackRate,
          firstBatchSize,
          totalUnits: units.length,
        });
        const batches = [];
        if (units.length > 0) {
          batches.push(units.slice(0, Math.min(firstBatchSize, units.length)));
          for (let i = firstBatchSize; i < units.length; i += BATCH) {
            batches.push(units.slice(i, i + BATCH));
          }
        }

        if (!YT.active) return;

        const _t0 = Date.now();
        const _batchApiMs = new Array(batches.length).fill(0);

        const _subtitleMsgType = SK.getSubtitleBatchType(config.engine, false);

        const _injectBatchResult = (batchUnits, results, b, elapsed) => {
          if (!YT.active || _myCaptionGen !== (YT.captionSourceGen || 0)) {
            SK.sendLog('info', 'youtube', 'non-asr batch result discarded (session changed)', {
              batchIdx: b, gen: _myCaptionGen, currentGen: YT.captionSourceGen, active: YT.active,
            });
            return;
          }
          for (let j = 0; j < batchUnits.length; j++) {
            const unit     = batchUnits[j];
            const rawTrans = SK.sanitizeMarkers(results[j] || unit.text);
            if (unit.keys.length === 1) {
              YT.captionMap.set(unit.keys[0], rawTrans);
            } else {
              const merged = rawTrans.replace(/\\n/g, ' ').replace(/\n/g, ' ').trim();
              YT.captionMap.set(unit.keys[0], merged);
              for (let k = 1; k < unit.keys.length; k++) {
                if (unit.keys[k] !== unit.keys[0]) YT.captionMap.set(unit.keys[k], '');
              }
            }
          }
          const domSegs = document.querySelectorAll('.ytp-caption-segment');
          domSegs.forEach(replaceSegmentEl);
          SK.sendLog('info', 'youtube', `batch done`, {
            batchIdx: b,
            batchSize: batchUnits.length,
            elapsedMs: elapsed,
            sessionOffsetMs: Date.now() - YT.sessionStartTime,
            domSegmentCount: domSegs.length,
            captionMapSize: YT.captionMap.size,
          });
        };

        const _runBatch = (batchUnits, b) =>
          SK.safeSendMessage({
            type: _subtitleMsgType,
            payload: { texts: batchUnits.map(u => u.text), glossary: null },
          }).then(res => {
            const elapsed = Date.now() - _t0;
            _batchApiMs[b] = elapsed;
            if (!res?.ok) throw new Error(SK.i18n.bgErrorMessage(res) || SK.t('common.errorUnknown'));
            _okBatchCount++;
            _logWindowUsage(batchUnits.length, res.usage);
            _injectBatchResult(batchUnits, res.result || [], b, elapsed);
          });

        const _streamSubtitleEnabled = !config.engine || config.engine === 'gemini';
        const FIRST_CHUNK_TIMEOUT_MS = 3000;
        const STREAM_IDLE_TIMEOUT_MS = 20000;

        const _runBatch0Streaming = (batchUnits) => {
          const streamId = `yt_stream_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          let firstChunkResolve, doneResolve, doneReject;
          const firstChunkPromise = new Promise(r => { firstChunkResolve = r; });
          const donePromise = new Promise((res, rej) => { doneResolve = res; doneReject = rej; });
          donePromise.catch(() => {});

          let _idleTimer = null;
          const _resetIdleWatchdog = () => {
            clearTimeout(_idleTimer);
            _idleTimer = setTimeout(() => {
              try { browser.runtime.onMessage.removeListener(onMessage); } catch (_) {}
              SK.sendLog('warn', 'youtube', 'streaming idle watchdog fired (SW dead mid-stream?)', { streamId });
              firstChunkResolve(false);
              doneReject(new Error('streaming idle timeout'));
            }, SK._streamIdleTimeoutMs || STREAM_IDLE_TIMEOUT_MS);
          };
          const _clearIdleWatchdog = () => { clearTimeout(_idleTimer); _idleTimer = null; };

          const onMessage = (message) => {
            if (!message || message.payload?.streamId !== streamId) return;
            _resetIdleWatchdog();
            if (message.type === 'STREAMING_FIRST_CHUNK') {
              firstChunkResolve(true);
            } else if (message.type === 'STREAMING_SEGMENT') {
              if (!YT.active) return;
              const idx = message.payload.segmentIdx;
              const tr = message.payload.translation;
              if (typeof idx === 'number' && idx >= 0 && idx < batchUnits.length && tr) {
                _injectBatchResult([batchUnits[idx]], [tr], 0, Date.now() - _t0);
              }
            } else if (message.type === 'STREAMING_DONE') {
              const elapsed = Date.now() - _t0;
              _batchApiMs[0] = elapsed;
              if (message.payload.hadMismatch) {
                SK.sendLog('warn', 'youtube', 'streaming DONE with hadMismatch, triggering retry', { elapsed, totalSegments: message.payload.totalSegments });
                _clearIdleWatchdog();
                browser.runtime.onMessage.removeListener(onMessage);
                firstChunkResolve(true);
                doneReject(new Error('streaming hadMismatch'));
                return;
              }
              _logWindowUsage(batchUnits.length, message.payload.usage || {});
              _clearIdleWatchdog();
              browser.runtime.onMessage.removeListener(onMessage);
              firstChunkResolve(true);
              doneResolve({ ok: true });
            } else if (message.type === 'STREAMING_ERROR') {
              _clearIdleWatchdog();
              browser.runtime.onMessage.removeListener(onMessage);
              firstChunkResolve(false);
              doneReject(new Error(SK.i18n.bgErrorMessage(message.payload) || 'streaming failed'));
            } else if (message.type === 'STREAMING_ABORTED') {
              _clearIdleWatchdog();
              browser.runtime.onMessage.removeListener(onMessage);
              firstChunkResolve(false);
              doneResolve({ ok: false, aborted: true });
            }
          };
          browser.runtime.onMessage.addListener(onMessage);
          _resetIdleWatchdog();

          SK.safeSendMessage({
            type: 'TRANSLATE_SUBTITLE_BATCH_STREAM',
            payload: { texts: batchUnits.map(u => u.text), glossary: null, streamId },
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
            firstChunkPromise.then(v => ({ kind: v ? 'first_chunk' : 'failed' })),
            new Promise(r => setTimeout(() => r({ kind: 'timeout' }), FIRST_CHUNK_TIMEOUT_MS)),
          ]);

          return {
            firstChunkOrTimeout,
            donePromise,
            streamId,
            cleanup: () => {
              _clearIdleWatchdog();
              try { browser.runtime.onMessage.removeListener(onMessage); } catch (_) {}
            },
          };
        };

        if (batches.length > 0) {
          let batch0NeedsFallback = false;
          if (_streamSubtitleEnabled) {
            const stream = _runBatch0Streaming(batches[0]);
            const r = await stream.firstChunkOrTimeout;
            if (r.kind === 'first_chunk') {
              const willParallel = batches.length > 1 && YT.active;
              const parallelP = willParallel
                ? Promise.allSettled(batches.slice(1).map((bu, i) => _runBatch(bu, i + 1)))
                : Promise.resolve([]);
              try {
                const _doneRes = await stream.donePromise;
                if (_doneRes?.ok) _okBatchCount++;
                YT.lastApiMs = _batchApiMs[0];
              } catch (streamErr) {
                SK.sendLog('warn', 'youtube', 'streaming mid-failure, retrying batch 0 non-streaming', { error: streamErr.message });
                try {
                  await _runBatch(batches[0], 0);
                  YT.lastApiMs = _batchApiMs[0];
                } catch (err) {
                  SK.sendLog('error', 'youtube', 'batch 0 fallback failed', { error: err.message });
                  _notifyTranslationError(err.message);
                }
              }
              const settled = await parallelP;
              settled.forEach((rr, i) => {
                if (rr.status === 'rejected') {
                  SK.sendLog('error', 'youtube', `batch ${i + 1} failed`, {
                    error: rr.reason?.message || String(rr.reason),
                  });
                }
              });
            } else {
              stream.cleanup();
              if (r.kind === 'timeout') {
                SK.sendLog('warn', 'youtube', 'streaming first_chunk timeout, falling back to non-streaming', { streamId: stream.streamId });
                SK.safeSendMessage({ type: 'STREAMING_ABORT', payload: { streamId: stream.streamId } }).catch(() => {});
              }
              batch0NeedsFallback = true;
            }
          } else {
            batch0NeedsFallback = true;
          }

          if (batch0NeedsFallback) {
            try {
              await _runBatch(batches[0], 0);
              YT.lastApiMs = _batchApiMs[0];
            } catch (err) {
              SK.sendLog('error', 'youtube', 'batch 0 failed', { error: err.message });
              _notifyTranslationError(err.message);
            }
            if (!YT.active) {
              YT.batchApiMs = _batchApiMs;
              return;
            }
            if (batches.length > 1) {
              const settled = await Promise.allSettled(
                batches.slice(1).map((bu, i) => _runBatch(bu, i + 1))
              );
              settled.forEach((r, i) => {
                if (r.status === 'rejected') {
                  SK.sendLog('error', 'youtube', `batch ${i + 1} failed`, {
                    error: r.reason?.message || String(r.reason),
                  });
                }
              });
            }
          }
        }

        YT.batchApiMs = _batchApiMs;
      } catch (err) {
        SK.sendLog('error', 'youtube', 'window translation failed', { error: err.message });
        _notifyTranslationError(err.message);
      }
    }

    const _genStale = _myCaptionGen !== (YT.captionSourceGen || 0);
    if (!_genStale) YT.captionMapCoverageUpToMs = Math.max(YT.captionMapCoverageUpToMs, windowEndMs);
    const _windowProducedTranslation =
      YT.captionMap.size > _cmSizeBefore ||
      YT.displayCues.length > _cuesCountBefore;
    if (_genStale) {
      SK.sendLog('info', 'youtube', 'window finished after caption source switch / cache clear — not marking translated', {
        windowStartMs, gen: _myCaptionGen, currentGen: YT.captionSourceGen,
      });
    } else if (windowSegs.length === 0 || _okBatchCount > 0 || _windowProducedTranslation) {
      YT.translatedWindows.add(windowStartMs);
    } else {
      if (_myConsumedSet) windowSegs.forEach(s => _myConsumedSet.delete(s.startMs));
      SK.sendLog('warn', 'youtube', 'window translation produced nothing — leaving open for retry', {
        windowStartMs, segCount: windowSegs.length, okBatchCount: _okBatchCount,
        captionMapSize: YT.captionMap.size,
        displayCuesLen: YT.displayCues.length,
      });
    }

    const catchUpVideoMs = YT.videoEl ? Math.floor(YT.videoEl.currentTime * 1000) : 0;
    if (catchUpVideoMs > YT.translatedUpToMs) {
      const catchUpNewStart = Math.floor(catchUpVideoMs / windowSizeMs) * windowSizeMs;
      YT.staleSkipCount++;
      SK.sendLog('warn', 'youtube', '⚠️ 視窗過期，跳位追趕', {
        videoNowMs: catchUpVideoMs,
        windowEnd:  YT.translatedUpToMs,
        jumpTo:     catchUpNewStart,
        staleSkipCount: YT.staleSkipCount,
      });
      YT.translatedUpToMs = catchUpNewStart;
      _debugUpdate(`⚠️ 過期跳位 → ${Math.round(catchUpNewStart / 1000)}s（第 ${YT.staleSkipCount} 次）`);
    }

    if (YT.lastApiMs > 0) {
      const configLookaheadMs = (YT.config?.lookaheadS ?? DEFAULT_YT_CONFIG.lookaheadS) * 1000;
      const playbackRate = YT.videoEl?.playbackRate || 1;
      const needed = Math.ceil(YT.lastApiMs * 1.3 * playbackRate);
      YT.adaptiveLookaheadMs = Math.min(Math.max(needed, configLookaheadMs), 60000);
    }

    _debugUpdate(`視窗 ${Math.round(windowStartMs/1000)}–${Math.round(windowEndMs/1000)}s 完成（captionMap: ${YT.captionMap.size}）`);

    const maxMs = YT.rawSegments.length > 0
      ? YT.rawSegments[YT.rawSegments.length - 1].startMs
      : 0;
    if (YT.translatedUpToMs <= maxMs && YT.active) {
      SK.sendLog('info', 'youtube', 'more captions remain', {
        translatedUpToMs: YT.translatedUpToMs, maxMs,
      });
    }

    } finally {
      _myTranslatingWindows.delete(windowStartMs);
    }
  }

  function onVideoTimeUpdate() {
    const YT = SK.YT;
    _updateOverlay();
    if (!YT.active || YT.rawSegments.length === 0) return;
    if (YT.ccPaused) return;

    const video = YT.videoEl;
    if (!video) return;

    const config = YT.config || DEFAULT_YT_CONFIG;
    const configLookaheadMs = (config.lookaheadS || 10) * 1000 * (video.playbackRate || 1);
    const lookaheadMs = Math.max(configLookaheadMs, YT.adaptiveLookaheadMs || 0);

    const currentMs = video.currentTime * 1000;

    const maxMs = YT.rawSegments[YT.rawSegments.length - 1].startMs;
    if (YT.translatedUpToMs > maxMs) return;

    if (currentMs >= YT.translatedUpToMs - lookaheadMs) {
      _debugUpdate(`timeupdate 觸發下一批（now: ${Math.round(currentMs/1000)}s，up to: ${Math.round(YT.translatedUpToMs/1000)}s）`);
      translateWindowFrom(YT.translatedUpToMs);
    }
  }

  function onVideoRateChange() {
    const YT = SK.YT;
    if (!YT.active || YT.rawSegments.length === 0) return;
    if (YT.ccPaused) return;
    const video = YT.videoEl;
    if (!video) return;

    const config = YT.config || DEFAULT_YT_CONFIG;
    const configLookaheadMs = (config.lookaheadS || 10) * 1000 * (video.playbackRate || 1);
    const lookaheadMs = Math.max(configLookaheadMs, YT.adaptiveLookaheadMs || 0);
    const currentMs   = video.currentTime * 1000;
    const maxMs       = YT.rawSegments[YT.rawSegments.length - 1].startMs;
    if (YT.translatedUpToMs > maxMs) return;

    if (currentMs >= YT.translatedUpToMs - lookaheadMs) {
      _debugUpdate(`ratechange(${video.playbackRate}x) 觸發下一批`);
      translateWindowFrom(YT.translatedUpToMs);
    }
  }

  function onVideoSeeked() {
    const YT = SK.YT;
    _updateOverlay();
    if (!YT.active || YT.rawSegments.length === 0) return;
    if (YT.ccPaused) return;
    const video = YT.videoEl;
    if (!video) return;

    const currentMs    = video.currentTime * 1000;
    const config       = YT.config || DEFAULT_YT_CONFIG;
    const windowSizeMs = (config.windowSizeS || 30) * 1000;
    const newWindowStart = Math.floor(currentMs / windowSizeMs) * windowSizeMs;

    YT.translatedUpToMs = newWindowStart;
    _debugUpdate(`seeked → 重設翻譯起點 ${Math.round(newWindowStart/1000)}s`);
    if (!YT.translatedWindows.has(newWindowStart) && _shouldShowTranslatingStatus()) {
      showCaptionStatus(SK.t('yt.status.translating'));
    }
    translateWindowFrom(newWindowStart);
  }

  function onVideoEnded() {
    _setOverlayContent('');
  }
  SK._onVideoEnded = onVideoEnded;

  function attachVideoListener() {
    const YT = SK.YT;
    const video = document.querySelector('video');
    if (!video || YT.videoEl === video) return;
    if (YT.videoEl) {
      YT.videoEl.removeEventListener('timeupdate', onVideoTimeUpdate);
      YT.videoEl.removeEventListener('seeked',     onVideoSeeked);
      YT.videoEl.removeEventListener('ratechange', onVideoRateChange);
      YT.videoEl.removeEventListener('ended',      onVideoEnded);
    }
    YT.videoEl = video;
    video.addEventListener('timeupdate', onVideoTimeUpdate);
    video.addEventListener('seeked',     onVideoSeeked);
    video.addEventListener('ratechange', onVideoRateChange);
    video.addEventListener('ended',      onVideoEnded);
    _observeCcButton();
  }

  function _observeCcButton() {
    const YT = SK.YT;
    if (YT._ccButtonObserver) {
      YT._ccButtonObserver.disconnect();
      YT._ccButtonObserver = null;
    }
    const btn = document.querySelector('.ytp-subtitles-button');
    if (!btn) return;
    YT.ccPaused = btn.getAttribute('aria-pressed') !== 'true';
    _setCcPausedHidingMode(YT.ccPaused);
    YT._ccButtonObserver = new MutationObserver(() => {
      const isOn = btn.getAttribute('aria-pressed') === 'true';
      const wasPaused = YT.ccPaused;
      const nextPaused = !isOn;
      if (wasPaused === nextPaused) return;
      YT.ccPaused = nextPaused;
      _setCcPausedHidingMode(nextPaused);
      if (nextPaused) {
        if (YT.isAsr) _setOverlayContent('');
        hideCaptionStatus();
        SK.sendLog('info', 'youtube', 'cc paused (api hold)');
        return;
      }
      const video = YT.videoEl;
      if (!YT.active || !video) return;
      if (YT.isAsr) _updateOverlay();
      const config = YT.config || DEFAULT_YT_CONFIG;
      const windowSizeMs = (config.windowSizeS || 30) * 1000;
      const currentMs = video.currentTime * 1000;
      const newWindowStart = Math.floor(currentMs / windowSizeMs) * windowSizeMs;
      YT.translatedUpToMs = newWindowStart;
      SK.sendLog('info', 'youtube', 'cc resumed (api on)', {
        atMs: Math.round(currentMs),
        windowStartMs: newWindowStart,
      });
      if (YT.rawSegments.length > 0) {
        translateWindowFrom(newWindowStart);
      }
    });
    YT._ccButtonObserver.observe(btn, {
      attributes: true,
      attributeFilter: ['aria-pressed'],
    });
  }

  function expandCaptionLine(el) {
    el.style.whiteSpace = 'nowrap';
    let node = el.parentElement;
    while (node && !node.classList.contains('ytp-caption-window-container')) {
      const display = getComputedStyle(node).display;
      if (display !== 'inline' && display !== 'inline-block') {
        node.style.maxWidth = 'none';
        node.style.width = 'max-content';
        if (node.classList.contains('caption-window')) {
          node.style.marginLeft = '0';
          node.style.transform = 'translateX(-50%)';
          break;
        }
      }
      node = node.parentElement;
    }
  }

  function replaceSegmentEl(el) {
    if (!SK.YT.active) return;
    if (SK.YT.config?.bilingualMode === true && SK.YT.isAsr === true) return;
    const original = el.textContent.trim();
    if (!original) return;
    const key = normText(original);

    const cached = SK.YT.captionMap.get(key);
    if (cached === undefined && _injectedSegmentText.get(el) === el.textContent) {
      return;
    }
    if (cached !== undefined) {
      const YT = SK.YT;
      const isBilingual = YT.config?.bilingualMode === true;
      if (cached && !YT._firstCacheHitLogged) {
        YT._firstCacheHitLogged = true;
        SK.sendLog('info', 'youtube', '🎯 first translated subtitle visible', {
          sessionOffsetMs: Date.now() - YT.sessionStartTime,
          videoNowMs: Math.round((YT.videoEl?.currentTime || 0) * 1000),
          captionMapSize: YT.captionMap.size,
          key: key.slice(0, 40),
        });
      }
      if (cached) hideCaptionStatus();

      if (isBilingual) {
        if (cached) _updateNonAsrBilingualOverlay();
      } else if (el.textContent !== cached) {
        _setSegmentText(el, cached);
        if (cached) expandCaptionLine(el);
      }
      return;
    }

    if (SK.YT.isAsr) return;

    if (!SK.YT.config?.onTheFly) return;

    if (!_debugMissedKeys.has(key)) SK.YT.onTheFlyTotal++;
    if (SK.YT.config?.debugToast && !_debugMissedKeys.has(key)) {
      _debugMissedKeys.add(key);
      SK.sendLog('warn', 'youtube-debug', 'captionMap miss → on-the-fly', {
        domText: original,
        normKey: key,
        captionMapSize: SK.YT.captionMap.size,
        rawSegCount: SK.YT.rawSegments.length,
      });
    }
    if (!SK.YT.pendingQueue.has(key)) SK.YT.pendingQueue.set(key, []);
    SK.YT.pendingQueue.get(key).push(el);
    clearTimeout(SK.YT.batchTimer);
    SK.YT.batchTimer = setTimeout(flushOnTheFly, 300);
  }

  SK._replaceSegmentEl = replaceSegmentEl;

  SK.YT._resetTranslationStateForCacheClear = function _resetTranslationStateForCacheClear() {
    const YT = SK.YT;
    if (!YT) return;
    YT.captionSourceGen          = (YT.captionSourceGen || 0) + 1;
    YT.captionMap                = new Map();
    YT.translatedWindows         = new Set();
    YT.displayCues               = [];
    YT.translatedUpToMs          = 0;
    YT.captionMapCoverageUpToMs  = 0;
    YT.asrSegConsumed            = new Set();
    YT._firstCacheHitLogged      = false;
    hideCaptionStatus();
    if (YT.isAsr) {
      _setOverlayContent('');
    }
    const ccBtn = document.querySelector('.ytp-subtitles-button');
    if (ccBtn) YT.ccPaused = ccBtn.getAttribute('aria-pressed') !== 'true';
    SK.sendLog('info', 'youtube', 'CLEAR_CACHE: in-memory translation state reset', {
      videoId: YT.videoId,
      ccPaused: YT.ccPaused,
    });
    if (YT.active && YT.rawSegments.length > 0 && !YT.ccPaused) {
      const video = YT.videoEl || document.querySelector('video');
      const config = YT.config || DEFAULT_YT_CONFIG;
      const windowSizeMs = (config.windowSizeS || 30) * 1000;
      const currentMs = video ? Math.floor(video.currentTime * 1000) : 0;
      const windowStartMs = Math.floor(currentMs / windowSizeMs) * windowSizeMs;
      YT.translatedUpToMs = windowStartMs;
      if (_shouldShowTranslatingStatus()) showCaptionStatus(SK.t('yt.status.translating'));
      translateWindowFrom(windowStartMs);
    }
  };

  async function flushOnTheFly() {
    const YT = SK.YT;
    if (YT.pendingQueue.size === 0 || YT.flushing) return;
    if (!YT.active) return;
    const _myGen = YT.captionSourceGen || 0;
    YT.flushing = true;

    const queue = new Map(YT.pendingQueue);
    YT.pendingQueue.clear();
    const texts = Array.from(queue.keys());

    if (YT.config?.debugToast) {
      SK.sendLog('info', 'youtube-debug', 'flushOnTheFly batch', {
        count: texts.length,
        texts,
      });
    }

    try {
      const _onTheFlyMsgType = SK.getSubtitleBatchType(YT.config?.engine, false);
      const res = await SK.safeSendMessage({
        type: _onTheFlyMsgType,
        payload: { texts, glossary: null },
      });
      if (!res?.ok) throw new Error(SK.i18n.bgErrorMessage(res) || SK.t('common.errorUnknown'));
      if (!SK.YT.active || _myGen !== (SK.YT.captionSourceGen || 0)) {
        YT.flushing = false;
        return;
      }
      _logWindowUsage(texts.length, res.usage);

      const results = res.result || [];
      for (let i = 0; i < texts.length; i++) {
        const key = texts[i];
        const trans = SK.sanitizeMarkers(results[i] || texts[i]);
        YT.captionMap.set(key, trans);
        const isBilingual = YT.config?.bilingualMode === true;
        for (const el of (queue.get(key) || [])) {
          if (document.contains(el) && normText(el.textContent) === key) {
            if (isBilingual) {
              if (trans) _updateNonAsrBilingualOverlay();
            } else {
              _setSegmentText(el, trans);
            }
          }
        }
      }
    } catch (err) {
      SK.sendLog('warn', 'youtube', 'on-the-fly flush error', { error: err.message });
      _notifyTranslationError(err.message);
    }

    YT.flushing = false;
    if (YT.pendingQueue.size > 0) setTimeout(flushOnTheFly, 100);
  }
  SK._flushOnTheFly = flushOnTheFly;
  SK._startCaptionObserver = startCaptionObserver;

  let _captionObserverRootRetryTimer = 0;
  function startCaptionObserver(retries) {
    const YT = SK.YT;
    if (YT.observer) { YT.observer.disconnect(); YT.observer = null; }
    if (_captionObserverRootRetryTimer) {
      clearTimeout(_captionObserverRootRetryTimer);
      _captionObserverRootRetryTimer = 0;
    }

    document.querySelectorAll('.ytp-caption-segment').forEach(replaceSegmentEl);

    YT.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.classList.contains('ytp-caption-segment')) {
            replaceSegmentEl(node);
          } else {
            node.querySelectorAll?.('.ytp-caption-segment').forEach(replaceSegmentEl);
          }
        }
        if (m.type === 'characterData') {
          const parent = m.target.parentElement;
          if (parent?.classList?.contains('ytp-caption-segment')) {
            replaceSegmentEl(parent);
          }
        }
      }
      if (YT.config?.bilingualMode === true && !YT.isAsr) {
        _updateNonAsrBilingualOverlay();
      }
    });

    const container = document.querySelector('.ytp-caption-window-container');
    const root =
      container ||
      document.querySelector('#movie_player') ||
      document.body;

    YT.observer.observe(root, { childList: true, subtree: true, characterData: true });
    SK.sendLog('info', 'youtube', 'caption observer started', {
      root: root.className || root.tagName,
      translatedUpToMs: YT.translatedUpToMs,
    });
    _debugUpdate(`Observer 已啟動（root: ${root.className?.slice(0,30) || root.tagName}）`);

    if (!container) {
      const left = retries == null ? 20 : retries;
      if (left > 0) {
        const myObserver = YT.observer;
        _captionObserverRootRetryTimer = setTimeout(() => {
          _captionObserverRootRetryTimer = 0;
          if (SK.YT.observer !== myObserver) return;
          if (document.querySelector('.ytp-caption-window-container')) {
            startCaptionObserver();
          } else {
            startCaptionObserver(left - 1);
          }
        }, 1000);
      }
    }
  }

  function _logWindowUsage(batchTexts, usage) {
    if (!usage || (usage.inputTokens === 0 && usage.cacheHits === 0)) return;
    const YT = SK.YT;
    const u = usage;

    YT.sessionUsage.inputTokens     += u.inputTokens     || 0;
    YT.sessionUsage.outputTokens    += u.outputTokens    || 0;
    YT.sessionUsage.cachedTokens    += u.cachedTokens    || 0;
    YT.sessionUsage.billedInputTokens += u.billedInputTokens || 0;
    YT.sessionUsage.billedCostUSD   += u.billedCostUSD   || 0;
    YT.sessionUsage.segments        += batchTexts;
    YT.sessionUsage.cacheHits       += u.cacheHits       || 0;

    const model = (YT.config?.model) || undefined;

    SK.safeSendMessage({
      type: 'LOG_USAGE',
      payload: {
        url:   location.href,
        title: document.title,
        source: 'youtube-subtitle',
        videoId: YT.videoId || getVideoIdFromUrl(),
        model,
        inputTokens:      u.inputTokens     || 0,
        outputTokens:     u.outputTokens    || 0,
        cachedTokens:     u.cachedTokens    || 0,
        billedInputTokens: u.billedInputTokens || 0,
        billedCostUSD:    u.billedCostUSD   || 0,
        segments:         batchTexts,
        cacheHits:        u.cacheHits       || 0,
        durationMs:       0,
        timestamp:        Date.now(),
      },
    }).catch(() => {});
  }

  function stopYouTubeTranslation() {
    const YT = SK.YT;
    clearTimeout(YT.batchTimer);
    YT.batchTimer = null;
    if (YT.observer) { YT.observer.disconnect(); YT.observer = null; }
    if (_captionObserverRootRetryTimer) {
      clearTimeout(_captionObserverRootRetryTimer);
      _captionObserverRootRetryTimer = 0;
    }
    if (YT.videoEl) {
      YT.videoEl.removeEventListener('timeupdate',  onVideoTimeUpdate);
      YT.videoEl.removeEventListener('seeked',      onVideoSeeked);
      YT.videoEl.removeEventListener('ratechange',  onVideoRateChange);
      YT.videoEl.removeEventListener('ended',       onVideoEnded);
      YT.videoEl = null;
    }
    YT.active             = false;
    YT.captionSourceGen   = (YT.captionSourceGen || 0) + 1;
    YT.translatingWindows = new Set();
    YT.translatedWindows  = new Set();
    YT.translatedUpToMs   = 0;
    YT.rawSegments        = [];
    YT.captionMap         = new Map();
    YT.pendingQueue       = new Map();
    YT.flushing           = false;
    YT.isAsr              = false;
    YT.captionLang        = null;
    YT.captionSourceId    = null;
    YT.displayCues        = [];
    YT.asrSegConsumed     = new Set();
    YT.ccPaused           = false;
    if (YT._ccButtonObserver) {
      YT._ccButtonObserver.disconnect();
      YT._ccButtonObserver = null;
    }
    _clearMwebCcRetry();
    _clearPopupDefer();
    _setCcPausedHidingMode(false);
    _setAsrHidingMode(false);
    _removeOverlay();
    hideCaptionStatus();
    _debugRemove();
    SK.sendLog('info', 'youtube', 'stopped');
  }

  SK.stopYouTubeTranslation = stopYouTubeTranslation;

  function _maybeShowNoSubtitleToast() {
    const target = SK.STATE?.targetLanguage || 'zh-TW';
    const ogEl = document.querySelector('meta[property="og:title"]');
    const ogTitle = (ogEl && ogEl.getAttribute('content')) || '';
    const titleIsTarget = ogTitle
      && typeof SK.isAlreadyInTarget === 'function'
      && SK.isAlreadyInTarget(ogTitle, target);
    if (titleIsTarget) {
      SK.sendLog('info', 'youtube', 'no-subtitle toast silenced (title already in target)', {
        target, ogTitleSample: ogTitle.slice(0, 40),
      });
      return;
    }
    SK.showToast('error', SK.t('toast.subtitleNotAvailable'), { autoHideMs: 5000 });
  }
  SK._maybeShowNoSubtitleToast = _maybeShowNoSubtitleToast;

  SK.translateYouTubeSubtitles = async function translateYouTubeSubtitles({ source = 'manual' } = {}) {
    const YT = SK.YT;

    if (YT.active) {
      if (source === 'auto') {
        SK.sendLog('info', 'youtube', 'auto-activate skipped (already active)', { rawSegments: YT.rawSegments.length });
        return;
      }
      stopYouTubeTranslation();
      SK.showToast('success', SK.t('toast.subtitleRestored'));
      setTimeout(() => SK.hideToast(), 2000);
      return;
    }

    if (SK.isInstanceLeader && !SK.isInstanceLeader()) {
      SK.sendLog('info', 'youtube', 'activation skipped (another instance leads)', { source });
      return;
    }

    YT.active  = true;
    YT.videoId = getVideoIdFromUrl();
    YT.config  = null;
    YT.sessionUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, billedInputTokens: 0, billedCostUSD: 0, segments: 0, cacheHits: 0 };
    YT.sessionStartTime = Date.now();
    YT.lastApiMs           = 0;
    YT.batchApiMs          = [];
    YT.adaptiveLookaheadMs = 0;
    YT.staleSkipCount            = 0;
    YT.captionMapCoverageUpToMs  = 0;
    YT.translatedWindows         = new Set();
    YT.translatingWindows        = new Set();
    YT.onTheFlyTotal             = 0;
    YT.firstBatchSize            = 8;
    YT.lastLeadMs                = 0;
    YT._firstCacheHitLogged      = false;
    YT._autoCcToggled            = false;
    _clearMwebCcRetry();
    _clearPopupDefer();
    YT._errorNotified            = false;
    YT.ccPaused                  = false;
    YT.displayCues               = [];

    attachVideoListener();

    const config = await getYtConfig();
    _debugUpdate('字幕翻譯已啟動，等待 CC 字幕資料…');

    _applyBilingualMode(config.bilingualMode === true);

    startCaptionObserver();

    if (config.preferOriginalTrack !== false) {
      const { targetLanguage = 'zh-TW' } = await browser.storage.sync.get('targetLanguage');
      const action = await _runCaptionTrackChooser(targetLanguage);
      if (action === 'skip' || action === 'switch-to-native') {
        const isBilingual = config.bilingualMode === true;
        SK.sendLog('info', 'youtube', `activation ${isBilingual ? 'kept-listening-for-bilingual' : 'skipped'} (${action})`, { action, isBilingual });
        if (!isBilingual) {
          stopYouTubeTranslation();
        } else if (action === 'switch-to-native' && typeof SK.showToast === 'function') {
          SK.showToast('info', SK.t('toast.ytSwitchedNativeTarget'), {
            autoHideMs: 7000,
          });
        }
        return;
      }
      if (action === 'switch') {
        YT.rawSegments = [];
        YT.captionSourceId = null;
        _resetCaptionSourceBookkeeping('chooser switch');
      }
    }

    if (YT.rawSegments.length > 0) {
      _debugUpdate(`已有 ${YT.rawSegments.length} 條字幕，開始翻譯`);
      if (_shouldShowTranslatingStatus()) showCaptionStatus(SK.t('yt.status.translating'));
      const video = document.querySelector('video');
      const currentMs = video ? Math.floor(video.currentTime * 1000) : 0;
      const windowSizeMs = (config.windowSizeS || 30) * 1000;
      const windowStartMs = Math.floor(currentMs / windowSizeMs) * windowSizeMs;
      await translateWindowFrom(windowStartMs);
    } else {

      let noCaptionsConfirmed = false;
      let captionsConfirmedByBridge = false;
      let bridgeFinalDecision = false;
      let tick1Handle = null;
      let tick5Handle = null;
      let bridgeAttempts = 0;
      const MAX_BRIDGE_ATTEMPTS = 4;
      const BRIDGE_RETRY_MS = 200;
      const activateVideoId = getVideoIdFromUrl();
      const _sessionGen = SK.YT.captionSourceGen || 0;
      const _sessionAlive = () => SK.YT.active && (SK.YT.captionSourceGen || 0) === _sessionGen;

      const showWaitingStatus = () => {
        if (noCaptionsConfirmed || !SK.YT.active) return;
        if (SK.YT.rawSegments.length > 0) return;
        showCaptionStatus(SK.t('yt.status.waitingCaption'));
      };

      const queryAndDecide = () => {
        if (bridgeFinalDecision || !_sessionAlive()) return;
        if (bridgeAttempts >= MAX_BRIDGE_ATTEMPTS) {
          showWaitingStatus();
          return;
        }
        bridgeAttempts++;
        let retryScheduled = false;
        const scheduleRetry = () => {
          if (retryScheduled) return;
          retryScheduled = true;
          setTimeout(queryAndDecide, BRIDGE_RETRY_MS);
        };
        const handler = (e) => {
          window.removeEventListener('transit-yt-player-response', handler);
          if (bridgeFinalDecision || !SK.YT.active) return;
          const detail = e?.detail || {};
          const currentVideoId = getVideoIdFromUrl();
          const videoIdMatch = detail.videoId
            && currentVideoId
            && detail.videoId === currentVideoId
            && currentVideoId === activateVideoId;
          if (!videoIdMatch || !detail.playerResponseAvailable) {
            scheduleRetry();
            return;
          }
          const tracks = detail.captionTracks;
          const hasCaptions = Array.isArray(tracks) && tracks.length > 0;
          bridgeFinalDecision = true;
          if (hasCaptions) {
            captionsConfirmedByBridge = true;
            showWaitingStatus();
            return;
          }
          noCaptionsConfirmed = true;
          if (tick1Handle) clearTimeout(tick1Handle);
          if (tick5Handle) clearTimeout(tick5Handle);
          hideCaptionStatus();
          _maybeShowNoSubtitleToast();
          SK.sendLog('info', 'youtube', 'no-captions confirmed via ytInitialPlayerResponse', {
            videoId: currentVideoId, attempts: bridgeAttempts,
          });
        };
        window.addEventListener('transit-yt-player-response', handler);
        window.dispatchEvent(new CustomEvent('transit-yt-query-player-response'));
        setTimeout(() => {
          window.removeEventListener('transit-yt-player-response', handler);
          if (bridgeFinalDecision || !_sessionAlive()) return;
          if (bridgeAttempts >= MAX_BRIDGE_ATTEMPTS) {
            showWaitingStatus();
            return;
          }
          scheduleRetry();
        }, BRIDGE_RETRY_MS);
      };
      queryAndDecide();

      tick1Handle = setTimeout(() => {
        if (_sessionAlive() && SK.YT.rawSegments.length === 0) {
          forceSubtitleReload();
        }
      }, 1000);

      tick5Handle = setTimeout(() => {
        if (_sessionAlive() && SK.YT.rawSegments.length === 0) {
          if (captionsConfirmedByBridge) {
            _scheduleMwebCcRetry();
            tick5Handle = setTimeout(() => {
              if (_sessionAlive() && SK.YT.rawSegments.length === 0) {
                hideCaptionStatus();
                _maybeShowNoSubtitleToast();
              }
            }, 65000);
            return;
          }
          if (SK.YT.captionMap.size > 0) {
            hideCaptionStatus();
          } else {
            hideCaptionStatus();
            _maybeShowNoSubtitleToast();
          }
        }
      }, 5000);
    }

    SK.sendLog('info', 'youtube', 'activated', {
      videoId: YT.videoId,
      rawSegments: YT.rawSegments.length,
      windowSizeS: config.windowSizeS,
      lookaheadS:  config.lookaheadS,
    });
  };

  async function _onYtSpaNavigate() {
    const YT = SK.YT;
    const _newVideoId = getVideoIdFromUrl();
    if (YT.active && _newVideoId && _newVideoId === YT.videoId) {
      attachVideoListener();
      SK.sendLog('info', 'youtube', 'SPA nav skipped (same videoId, still active)', { videoId: _newVideoId });
      return;
    }
    const wasActive = YT.active;
    if (YT.active) stopYouTubeTranslation();
    hideCaptionStatus();
    _debugRemove();
    YT.rawSegments        = [];
    YT.captionMap         = new Map();
    YT.pendingQueue       = new Map();
    YT.translatedUpToMs   = 0;
    YT.translatedWindows  = new Set();
    YT.translatingWindows = new Set();
    YT.isAsr              = false;
    YT.captionLang        = null;
    YT.captionSourceId    = null;
    YT.displayCues        = [];
    _setAsrHidingMode(false);
    _removeOverlay();
    YT.config             = null;
    YT.videoId            = getVideoIdFromUrl();
    SK.sendLog('info', 'youtube', 'SPA navigation reset', { wasActive, newVideoId: YT.videoId });

    if (!SK.isYouTubePage?.()) return;
    try {
      const saved = await browser.storage.sync.get('ytSubtitle');
      const shouldRestart = wasActive || saved.ytSubtitle?.autoTranslate;
      if (shouldRestart) {
        SK.sendLog('info', 'youtube', 'SPA nav: will restart subtitle translation', {
          wasActive, autoTranslate: saved.ytSubtitle?.autoTranslate,
        });
        setTimeout(() => {
          if (SK.isYouTubePage?.()) {
            SK.translateYouTubeSubtitles?.({ source: 'auto' }).catch(err => {
              SK.sendLog('warn', 'youtube', 'SPA nav auto-subtitle restart failed', { error: err.message });
            });
          }
        }, 500);
      }
    } catch (err) {
      SK.sendLog('warn', 'youtube', 'SPA nav autoTranslate check failed', { error: err.message });
    }
  }
  window.addEventListener('yt-navigate-finish', _onYtSpaNavigate);
  window.addEventListener('state-navigateend', _onYtSpaNavigate);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.ytSubtitle) {
      const newVal = changes.ytSubtitle.newValue || {};
      if (SK.YT.config) {
        SK.YT.config = { ...DEFAULT_YT_CONFIG, ...newVal, bilingualMode: SK.YT.config.bilingualMode === true };
      }
      if ('captionScale' in newVal) _applyYtCaptionScale(newVal.captionScale);
    }
    if (changes.displayMode) {
      const newBilingual = changes.displayMode.newValue === 'dual';
      if (SK.YT.config) SK.YT.config = { ...SK.YT.config, bilingualMode: newBilingual };
      if (SK.YT.active) {
        _applyBilingualMode(newBilingual);
        SK.sendLog('info', 'youtube', 'bilingualMode toggled live (displayMode)', { bilingual: newBilingual, isAsr: SK.YT.isAsr });
      }
    }
  });

  // 字幕縮放只作用在 YouTube player frame (含嵌入與 Drive 的 youtube.googleapis.com).
  // 其他網站的 frame 不讀 storage, 也不啟動 #movie_player 輪詢.
  const _YT_PLAYER_HOST_RE = /(^|\.)(youtube\.com|youtube-nocookie\.com)$|^youtube\.googleapis\.com$/;
  if (_YT_PLAYER_HOST_RE.test(location.hostname)) {
    browser.storage.sync.get('ytSubtitle').then((s) => {
      const sc = s?.ytSubtitle?.captionScale;
      if (sc != null) _applyYtCaptionScale(sc);
    }).catch(() => {   });
  }

  SK.ASR = {
    parseJson3,
    mergeAsr: _heuristicMergeAsr,
    parseAsrResponse: _parseAsrResponse,
    buildLlmInput: _buildAsrLlmInput,
    parseLlmOutput: _parseAsrLlmOutput,
    resolveEntryTimeline: _resolveAsrEntryTimeline,
    batchEndMs: _asrBatchEndMs,
    splitLongCue: _splitLongAsrCue,
    findActiveCueIdx: _findActiveCueIdx,
    joinSegTexts,
    skipLangsByTarget: SKIP_LANGS_BY_TARGET,
  };

})(window.__SK);
