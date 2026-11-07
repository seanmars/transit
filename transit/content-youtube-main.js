(function () {
  const TIMEDTEXT_RE = /\/api\/timedtext/;
  const CAPTION_EVENT = 'transit-yt-captions';

  function parseBridgeDetail(e) {
    const d = e?.detail;
    if (typeof d === 'string') {
      try { return JSON.parse(d); } catch (_) { return null; }
    }
    return d || null;
  }

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args) {
    this.__transitUrl =
      typeof args[1] === 'string' ? args[1] : (args[1]?.href || '');
    return _open.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const url = this.__transitUrl || '';
    if (TIMEDTEXT_RE.test(url)) {
      this.addEventListener('readystatechange', function () {
        try {
          if (this.responseType && this.responseType !== 'text') return;
          if (this.readyState === 4 && this.status === 200 && this.responseText) {
            window.dispatchEvent(new CustomEvent(CAPTION_EVENT, {
              detail: { url, responseText: this.responseText },
            }));
          }
        } catch (_) {   }
      });
    }
    return _send.apply(this, args);
  };

  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string'
      ? args[0]
      : (args[0]?.url || args[0]?.href || '');
    const response = await _fetch.apply(this, args);
    if (TIMEDTEXT_RE.test(url)) {
      try {
        response.clone().text().then(text => {
          if (text) {
            window.dispatchEvent(new CustomEvent(CAPTION_EVENT, {
              detail: { url, responseText: text },
            }));
          }
        }).catch(() => {});
      } catch (_) {}
    }
    return response;
  };

  window.addEventListener('transit-yt-query-player-response', () => {
    let captionTracks = null;
    let playerResponseAvailable = false;
    let videoId = null;
    let activeTrack = null;
    let defaultCaptionTrackIndex = null;
    let originalAudioLang = null;
    const player = document.querySelector('#movie_player');
    try {
      let resp = null;
      try {
        if (player?.getPlayerResponse) resp = player.getPlayerResponse();
      } catch (_) {}
      if (!resp) resp = window.ytInitialPlayerResponse;
      playerResponseAvailable = !!resp;
      videoId = resp?.videoDetails?.videoId || null;
      const renderer = resp?.captions?.playerCaptionsTracklistRenderer;
      const tracks = renderer?.captionTracks;
      if (Array.isArray(tracks)) {
        captionTracks = tracks.map((t) => ({
          languageCode:   t?.languageCode || null,
          kind:           t?.kind || '',
          isTranslatable: !!t?.isTranslatable,
          vssId:          t?.vssId || null,
          name:           t?.name?.simpleText || t?.name?.runs?.[0]?.text || null,
        }));
      }
      try {
        const audioTracks = renderer?.audioTracks;
        if (Array.isArray(audioTracks) && audioTracks.length > 0) {
          const ai = Number.isInteger(renderer?.defaultAudioTrackIndex) ? renderer.defaultAudioTrackIndex : 0;
          const idx = audioTracks[ai]?.defaultCaptionTrackIndex;
          if (Number.isInteger(idx)) defaultCaptionTrackIndex = idx;
        }
      } catch (_) {}
      try {
        const formats = resp?.streamingData?.adaptiveFormats;
        if (Array.isArray(formats)) {
          const def = formats.find((f) => f?.audioTrack?.audioIsDefault && typeof f.audioTrack.id === 'string');
          if (def) originalAudioLang = def.audioTrack.id.split('.')[0] || null;
        }
      } catch (_) {}
    } catch (_) {
      captionTracks = null;
    }
    try {
      if (player?.getOption) {
        const at = player.getOption('captions', 'track');
        if (at && typeof at === 'object') {
          activeTrack = {
            languageCode:            at.languageCode || null,
            kind:                    at.kind || '',
            translationLanguageCode: at.translationLanguage?.languageCode || null,
          };
        }
      }
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('transit-yt-player-response', {
      detail: { captionTracks, playerResponseAvailable, videoId, activeTrack, defaultCaptionTrackIndex, originalAudioLang },
    }));
  });

  window.addEventListener('transit-yt-cc-control', (e) => {
    const op = parseBridgeDetail(e)?.op || 'status';
    let ok = false;
    let ccOn = false;
    let error = null;
    try {
      const player = document.querySelector('#movie_player');
      if (!player) throw new Error('no-movie-player');

      const currentTrack = (() => {
        try {
          const t = player.getOption?.('captions', 'track');
          return (t && typeof t === 'object' && t.languageCode) ? t : null;
        } catch (_) { return null; }
      })();
      ccOn = !!currentTrack;

      if (op === 'status') {
        ok = true;
      } else if (op === 'enable') {
        player.loadModule?.('captions');
        let track = null;
        try {
          const list = player.getOption?.('captions', 'tracklist');
          if (Array.isArray(list) && list.length) track = list[0];
        } catch (_) {}
        if (!track) {
          let resp = null;
          try { if (player.getPlayerResponse) resp = player.getPlayerResponse(); } catch (_) {}
          if (!resp) resp = window.ytInitialPlayerResponse;
          const _liveM = location.pathname.match(/^\/live\/([A-Za-z0-9_-]{6,})/);
          const urlVid = new URL(location.href).searchParams.get('v') || (_liveM ? _liveM[1] : null);
          const respVid = resp?.videoDetails?.videoId || null;
          if (urlVid && respVid && urlVid !== respVid) throw new Error('stale-player-response');
          const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
          if (Array.isArray(tracks) && tracks.length) track = tracks[0];
        }
        if (!track?.languageCode) throw new Error('no-caption-track');
        player.setOption('captions', 'track', {
          languageCode: track.languageCode,
          kind: track.kind || '',
        });
        ccOn = true;
        ok = true;
      } else if (op === 'reload') {
        if (!currentTrack) throw new Error('cc-not-on');
        player.unloadModule?.('captions');
        setTimeout(() => {
          try {
            player.loadModule?.('captions');
            player.setOption('captions', 'track', {
              languageCode: currentTrack.languageCode,
              kind: currentTrack.kind || '',
            });
          } catch (_) {}
        }, 200);
        ok = true;
      } else {
        throw new Error('unknown-op');
      }
    } catch (err) {
      error = err?.message || String(err);
    }
    window.dispatchEvent(new CustomEvent('transit-yt-cc-control-result', {
      detail: { op, ok, ccOn, error },
    }));
  });

  window.addEventListener('transit-yt-set-caption-track', (e) => {
    const { languageCode, kind } = parseBridgeDetail(e) || {};
    let ok = false;
    let error = null;
    try {
      const player = document.querySelector('#movie_player');
      if (player?.setOption && languageCode) {
        player.setOption('captions', 'track', {
          languageCode,
          kind: kind || '',
        });
        ok = true;
      } else {
        error = 'no-player-or-langcode';
      }
    } catch (err) {
      error = err?.message || String(err);
    }
    window.dispatchEvent(new CustomEvent('transit-yt-set-caption-track-result', {
      detail: { ok, error },
    }));
  });

})();
