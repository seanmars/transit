(function (SK) {
  if (!SK || SK.disabled) return;

  const BATCH_SIZE = 30;
  const MAX_CONCURRENT = 3;
  const TRACK_LABEL = 'Transit';

  const XV = SK.XV = SK.XV || {
    masterUrls: new Map(),
    media: new Map(),
    bilingualMode: false,
    autoTranslate: true,
    engine: 'gemini',
    model: '',
  };

  function mediaIdFromPoster(poster) {
    const m = String(poster || '').match(/\/(?:amplify_video_thumb|ext_tw_video_thumb)\/(\d+)\//);
    return m ? m[1] : null;
  }

  function mediaIdFromMasterUrl(url) {
    const m = String(url || '').match(/^https:\/\/video\.twimg\.com\/(?:amplify_video|ext_tw_video)\/(\d+)\/pl\/[A-Za-z0-9_-]+\.m3u8(?:\?|$)/);
    return m ? m[1] : null;
  }

  function _parseHlsAttrs(s) {
    const out = {};
    const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    let m;
    while ((m = re.exec(s))) out[m[1]] = m[2].replace(/^"|"$/g, '');
    return out;
  }

  function parseMasterSubtitles(text, baseUrl) {
    const tracks = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.startsWith('#EXT-X-MEDIA:')) continue;
      const a = _parseHlsAttrs(line.slice('#EXT-X-MEDIA:'.length));
      if (a.TYPE !== 'SUBTITLES' || !a.URI) continue;
      let uri;
      try { uri = new URL(a.URI, baseUrl).href; } catch { continue; }
      tracks.push({ uri, lang: a.LANGUAGE || '', name: a.NAME || '', isDefault: a.DEFAULT === 'YES' });
    }
    return tracks;
  }

  function parseMediaPlaylist(text, baseUrl) {
    const urls = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      try { urls.push(new URL(line, baseUrl).href); } catch {   }
    }
    return urls;
  }

  function _vttTimeToMs(t) {
    const m = String(t).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!m) return NaN;
    return ((+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + +m[4].padEnd(3, '0');
  }

  const _ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

  function parseVtt(text) {
    const segs = [];
    const blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split('\n');
      const ti = lines.findIndex(l => l.includes('-->'));
      if (ti < 0) continue;
      const [a, b] = lines[ti].split('-->');
      const startMs = _vttTimeToMs(a);
      const endMs = _vttTimeToMs(String(b).trim().split(/\s+/)[0]);
      if (!Number.isFinite(startMs)) continue;
      const body = lines.slice(ti + 1).join(' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, k) => _ENTITIES[k])
        .replace(/\s+/g, ' ')
        .trim();
      if (!body) continue;
      segs.push({ text: body, startMs, endMs: Number.isFinite(endMs) ? endMs : startMs + 1000 });
    }
    segs.sort((x, y) => x.startMs - y.startMs);
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].startMs <= segs[i - 1].startMs) segs[i].startMs = segs[i - 1].startMs + 1;
    }
    return segs;
  }

  function overlappingSrcText(rawSegments, startMs, endMs, lang) {
    const bits = (rawSegments || [])
      .filter(s => s.startMs >= startMs && s.startMs < endMs)
      .map(s => s.text);
    if (!bits.length) return '';
    return typeof SK.ASR?.joinSegTexts === 'function' ? SK.ASR.joinSegTexts(bits, lang) : bits.join(' ');
  }

  function buildCueList(entries, rawSegments, bilingual, lang) {
    const lead = SK.ASR_CUE_LEAD_MS || 0;
    const out = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const next = entries[i + 1];
      const effEnd = next ? Math.min(e.endMs, next.startMs) : e.endMs;
      const start = Math.max(0, e.startMs - lead);
      const end = Math.max(start + 1, effEnd - lead);
      let text = e.text;
      if (bilingual) {
        const src = overlappingSrcText(rawSegments, e.startMs, e.endMs, lang);
        if (src) text = `${src}\n${text}`;
      }
      out.push({ startSec: start / 1000, endSec: end / 1000, text });
    }
    return out;
  }

  function isLangAlreadyTarget(lang, target) {
    const set = SK.ASR?.skipLangsByTarget?.[target || 'zh-TW'];
    return !!(set && lang && set.has(lang));
  }

  SK._xMediaIdFromPoster = mediaIdFromPoster;
  SK._xMediaIdFromMasterUrl = mediaIdFromMasterUrl;
  SK._xParseMasterSubtitles = parseMasterSubtitles;
  SK._xParseMediaPlaylist = parseMediaPlaylist;
  SK._xParseVtt = parseVtt;
  SK._xBuildCueList = buildCueList;

  function _ourTrack(video) {
    if (!video._skXTrack) {
      const lang = SK.STATE?.targetLanguage || 'zh-TW';
      video._skXTrack = video.addTextTrack('subtitles', TRACK_LABEL, lang);
      video._skXCues = [];
      video._skXCreatedAt = Date.now();
      video._skXTrack.mode = 'showing';
      _watchNativeTracks(video);
      for (const ms of [300, 1000]) setTimeout(() => _syncWithNativeTracks(video), ms);
    }
    return video._skXTrack;
  }
  const _INIT_GRACE_MS = 1500;

  function _syncWithNativeTracks(video) {
    const ours = video._skXTrack;
    if (!ours || !XV.autoTranslate) return;
    const others = Array.from(video.textTracks).filter(t => t !== ours && t.mode === 'showing');
    if (!others.length) {
      if (ours.mode === 'disabled' && Date.now() - video._skXCreatedAt < _INIT_GRACE_MS) ours.mode = 'showing';
      return;
    }
    const now = Date.now();
    const g = video._skXGuard || (video._skXGuard = { t: now, n: 0, gaveUp: false });
    if (g.gaveUp) return;
    if (now - g.t > 1000) { g.t = now; g.n = 0; }
    if (++g.n > 10) {
      g.gaveUp = true;
      SK.sendLog('warn', 'x', 'native caption track keeps re-showing — stop taking over');
      return;
    }
    for (const t of others) t.mode = 'hidden';
    if (ours.mode !== 'showing') ours.mode = 'showing';
  }

  function _watchNativeTracks(video) {
    try {
      video.textTracks.addEventListener('change', () => _syncWithNativeTracks(video));
    } catch (_) {   }
  }

  function _renderVideo(video, rec) {
    if (!XV.autoTranslate) {
      if (video._skXTrack) video._skXTrack.mode = 'disabled';
      return;
    }
    if (!rec.entries.length) return;
    const track = _ourTrack(video);
    for (const c of video._skXCues) { try { track.removeCue(c); } catch (_) {} }
    video._skXCues = [];
    const Cue = window.VTTCue || window.TextTrackCue;
    for (const c of buildCueList(rec.entries, rec.rawSegments, XV.bilingualMode, rec.sourceLang)) {
      try {
        const cue = new Cue(c.startSec, c.endSec, c.text);
        track.addCue(cue);
        video._skXCues.push(cue);
      } catch (_) {   }
    }
    _syncWithNativeTracks(video);
  }

  function _renderMedia(rec) {
    for (const v of rec.videos) {
      if (!v.isConnected) { rec.videos.delete(v); continue; }
      _renderVideo(v, rec);
    }
  }

  function _renderAll() {
    for (const rec of XV.media.values()) _renderMedia(rec);
  }
  SK._xRenderAll = _renderAll;

  function _logUsage(mediaId, segCount, usage, engineLabel) {
    if (!usage || ((usage.inputTokens || 0) === 0 && (usage.cacheHits || 0) === 0)) return;
    SK.safeSendMessage({
      type: 'LOG_USAGE',
      payload: {
        url: location.href,
        title: document.title,
        source: 'x-subtitle',
        videoId: mediaId,
        engine: engineLabel,
        model: XV.model || undefined,
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
        cachedTokens: usage.cachedTokens || 0,
        billedInputTokens: usage.billedInputTokens || 0,
        billedCostUSD: usage.billedCostUSD || 0,
        segments: segCount,
        cacheHits: usage.cacheHits || 0,
        durationMs: 0,
        timestamp: Date.now(),
      },
    }).catch(() => {});
  }

  async function _runBatchLlm(rec, mediaId, batch, label, msgType, engineLabel, runId) {
    const batchEndMs = SK.ASR.batchEndMs(batch[batch.length - 1].startMs, rec.rawSegments);
    let res;
    try {
      res = await SK.safeSendMessage({
        type: msgType,
        payload: { texts: [SK.ASR.buildLlmInput(batch)], glossary: null, sourceLanguage: rec.sourceLang || 'en' },
      });
    } catch (e) {
      SK.sendLog('warn', 'x', `batch ${label} ${engineLabel} sendMessage failed`, { error: e?.message || String(e) });
      return;
    }
    if (!res?.ok) {
      SK.sendLog('warn', 'x', `batch ${label} ${engineLabel} failed`, { error: res?.error || 'unknown' });
      return;
    }
    _logUsage(mediaId, batch.length, res.usage, engineLabel);
    if (runId !== rec.runId) return;
    let entries;
    try {
      entries = SK.ASR.parseLlmOutput(res.result?.[0] || '', batch, batchEndMs);
    } catch (e) {
      SK.sendLog('warn', 'x', `batch ${label} parse failed (${engineLabel})`, { error: e?.message || String(e) });
      return;
    }
    const { cues, droppedCount } = SK.ASR.resolveEntryTimeline(entries, batch, batchEndMs);
    const starts = batch.map(s => s.startMs);
    for (const cue of cues) {
      for (const piece of SK.ASR.splitLongCue(cue.startMs, cue.endMs, cue.text, starts)) {
        rec.entries.push({ startMs: piece.startMs, endMs: piece.endMs, text: piece.text });
      }
    }
    rec.entries.sort((a, b) => a.startMs - b.startMs);
    SK.sendLog('info', 'x', `batch ${label} done (${engineLabel})`, {
      mediaId, llmEntryCount: entries.length, droppedMisaligned: droppedCount, totalEntries: rec.entries.length,
    });
  }

  async function _runBatchGoogle(rec, mediaId, batch, label, runId) {
    let res;
    try {
      res = await SK.safeSendMessage({ type: 'TRANSLATE_X_BATCH_GOOGLE', payload: { texts: batch.map(s => s.text), glossary: null } });
    } catch (e) {
      SK.sendLog('warn', 'x', `batch ${label} google sendMessage failed`, { error: e?.message || String(e) });
      return;
    }
    if (!res?.ok) {
      SK.sendLog('warn', 'x', `batch ${label} google failed`, { error: res?.error || 'unknown' });
      return;
    }
    if (runId !== rec.runId) return;
    const tr = Array.isArray(res.result) ? res.result : [];
    for (let i = 0; i < batch.length; i++) {
      const text = String(tr[i] || '').trim();
      if (!text) continue;
      const next = batch[i + 1];
      const endMs = next ? next.startMs : SK.ASR.batchEndMs(batch[i].startMs, rec.rawSegments);
      rec.entries.push({ startMs: batch[i].startMs, endMs, text });
    }
    rec.entries.sort((a, b) => a.startMs - b.startMs);
    SK.sendLog('info', 'x', `batch ${label} done (google)`, { mediaId, totalEntries: rec.entries.length });
  }

  async function _translateMedia(mediaId, rec) {
    const segs = rec.rawSegments;
    const batches = [];
    for (let i = 0; i < segs.length; i += BATCH_SIZE) batches.push(segs.slice(i, i + BATCH_SIZE));
    const engine = XV.engine;
    const runId = ++rec.runId;
    rec.entries = [];
    SK.sendLog('info', 'x', 'starting transcript translation', {
      mediaId, totalSegments: segs.length, totalBatches: batches.length, engine, sourceLang: rec.sourceLang,
    });
    let next = 0;
    const worker = async () => {
      while (true) {
        const idx = next++;
        if (idx >= batches.length || !XV.autoTranslate || runId !== rec.runId) return;
        const label = `${idx + 1}/${batches.length}`;
        if (engine === 'google') {
          await _runBatchGoogle(rec, mediaId, batches[idx], label, runId);
        } else if (engine === 'openai-compat') {
          await _runBatchLlm(rec, mediaId, batches[idx], label, 'TRANSLATE_X_ASR_SUBTITLE_BATCH_CUSTOM', 'openai-compat', runId);
        } else {
          await _runBatchLlm(rec, mediaId, batches[idx], label, 'TRANSLATE_X_ASR_SUBTITLE_BATCH', 'gemini', runId);
        }
        if (runId === rec.runId) _renderMedia(rec);
      }
    };
    await Promise.all(Array.from({ length: MAX_CONCURRENT }, worker));
    rec.status = rec.entries.length ? 'done' : 'idle';
    SK.sendLog('info', 'x', 'transcript translation finished', { mediaId, totalEntries: rec.entries.length, status: rec.status });
  }

  async function _fetchText(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.text();
  }

  async function startForVideo(video, mediaId, masterUrl) {
    let rec = XV.media.get(mediaId);
    if (!rec) {
      rec = { status: 'idle', rawSegments: [], entries: [], runId: 0, sourceLang: '', videos: new Set() };
      XV.media.set(mediaId, rec);
    }
    rec.videos.add(video);
    if (rec.status === 'done') { _renderVideo(video, rec); return; }
    if (rec.status !== 'idle') return;
    rec.status = 'loading';
    try {
      const tracks = parseMasterSubtitles(await _fetchText(masterUrl), masterUrl);
      if (!tracks.length) {
        rec.status = 'none';
        SK.sendLog('info', 'x', 'no subtitle track in master playlist', { mediaId });
        return;
      }
      const target = SK.STATE?.targetLanguage || 'zh-TW';
      if (tracks.some(t => isLangAlreadyTarget(t.lang, target))) {
        rec.status = 'skip';
        SK.sendLog('info', 'x', 'subtitle already in target language — skip', { mediaId, langs: tracks.map(t => t.lang), target });
        return;
      }
      const track = tracks.find(t => t.isDefault) || tracks[0];
      const segUrls = parseMediaPlaylist(await _fetchText(track.uri), track.uri);
      const raw = [];
      for (const u of segUrls) raw.push(...parseVtt(await _fetchText(u)));
      raw.sort((a, b) => a.startMs - b.startMs);
      for (let i = 1; i < raw.length; i++) {
        if (raw[i].startMs <= raw[i - 1].startMs) raw[i].startMs = raw[i - 1].startMs + 1;
      }
      rec.rawSegments = raw;
      rec.sourceLang = track.lang || 'en';
      SK.sendLog('info', 'x', 'subtitle fetched', { mediaId, name: track.name, lang: track.lang, segments: raw.length });
      if (!raw.length) { rec.status = 'none'; return; }
      await _translateMedia(mediaId, rec);
    } catch (e) {
      rec.status = 'idle';
      SK.sendLog('warn', 'x', 'subtitle pipeline failed', { mediaId, error: e?.message || String(e) });
    }
  }
  SK._xStartForVideo = startForVideo;
  SK._xSetEngine = (v) => { XV.engine = SK._driveNormalizeEngine ? SK._driveNormalizeEngine(v) : 'gemini'; };

  SK.stopXSubtitles = function stopXSubtitles() {
    XV.autoTranslate = false;
    _renderAll();
  };

  if (!/(^|\.)(x|twitter)\.com$/.test(location.hostname)) return;
  if (window.top !== window) return;

  function _recordMaster(name) {
    const id = mediaIdFromMasterUrl(name);
    if (id && !XV.masterUrls.has(id)) XV.masterUrls.set(id, name);
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) _recordMaster(e.name);
    }).observe({ type: 'resource', buffered: true });
  } catch (_) {
    for (const e of performance.getEntriesByType('resource')) _recordMaster(e.name);
  }

  async function _waitMasterUrl(mediaId) {
    for (let i = 0; i < 10; i++) {
      const url = XV.masterUrls.get(mediaId);
      if (url) return url;
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }

  async function _maybeStart(video) {
    if (!XV.autoTranslate) return;
    if (video.paused || video.muted || video.volume === 0) return;
    const mediaId = mediaIdFromPoster(video.getAttribute('poster'));
    if (!mediaId) return;
    const rec = XV.media.get(mediaId);
    if (rec && rec.videos.has(video) && rec.status !== 'idle') return;
    if (!SK.isInstanceLeader()) return;
    const masterUrl = await _waitMasterUrl(mediaId);
    if (!masterUrl) {
      SK.sendLog('warn', 'x', 'master playlist not observed for video', { mediaId });
      return;
    }
    startForVideo(video, mediaId, masterUrl);
  }

  for (const ev of ['play', 'playing', 'volumechange']) {
    document.addEventListener(ev, (e) => {
      if (e.target instanceof HTMLVideoElement) _maybeStart(e.target);
    }, true);
  }

  (async () => {
    try {
      const { ytSubtitle = {}, displayMode } = await browser.storage.sync.get(['ytSubtitle', 'displayMode']);
      XV.autoTranslate = ytSubtitle.autoTranslate !== false;
      SK._xSetEngine(ytSubtitle.engine);
      XV.model = ytSubtitle.model || '';
      XV.bilingualMode = displayMode === 'dual';
    } catch {   }
  })();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let rerender = false;
    if (changes.ytSubtitle) {
      const v = changes.ytSubtitle.newValue || {};
      const enabled = v.autoTranslate !== false;
      if (enabled !== XV.autoTranslate) {
        XV.autoTranslate = enabled;
        rerender = true;
        if (enabled) {
          document.querySelectorAll('video').forEach(v => {
            if (v._skXTrack) v._skXTrack.mode = 'showing';
            _maybeStart(v);
          });
        }
      }
      SK._xSetEngine(v.engine);
      XV.model = v.model || '';
    }
    if (changes.displayMode) {
      const bi = changes.displayMode.newValue === 'dual';
      if (bi !== XV.bilingualMode) { XV.bilingualMode = bi; rerender = true; }
    }
    if (rerender) _renderAll();
  });

  SK.sendLog('info', 'x', 'content-x.js ready', { href: location.href.slice(0, 200) });

})(window.__SK);
