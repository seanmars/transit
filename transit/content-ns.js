globalThis.browser = globalThis.browser ?? globalThis.chrome;

function _sk_shouldDisableInFrame(isFrame, width, height, visible) {
  if (!isFrame) return false;
  if (!visible) return true;
  if (width < 200 || height < 100) return true;
  return false;
}

const _SK_EMBED_PLAYER_TEXT_LIMIT = 200;
function _sk_isEmbeddedPlayerFrame(doc, win) {
  try {
    if (!win || win === win.top) return false;
    if (!doc || !doc.querySelector('video, audio')) return false;
    const text = (doc.body?.innerText || '').replace(/\s+/g, ' ').trim();
    return text.length < _SK_EMBED_PLAYER_TEXT_LIMIT;
  } catch (_e) {
    return false;
  }
}

function _sk_isCurrentFrameDisabled() {
  const isFrame = window !== window.top;
  if (!isFrame) return false;
  const html = document.documentElement;
  let visible = !!html;
  if (html) {
    const cs = window.getComputedStyle?.(html);
    if (cs && (cs.visibility === 'hidden' || cs.display === 'none')) visible = false;
  }
  return _sk_shouldDisableInFrame(isFrame, window.innerWidth, window.innerHeight, visible);
}

function _sk_isNonHtmlDocument(doc) {
  try {
    const probe = doc && doc.createElement('div');
    return !probe || !probe.style;
  } catch (_e) {
    return true;
  }
}

if (window.__transit_loaded) {
} else if (_sk_isCurrentFrameDisabled() || _sk_isNonHtmlDocument(document)) {
  window.__transit_loaded = true;
  window.__SK = {
    disabled: true,
    shouldDisableInFrame: _sk_shouldDisableInFrame,
    isEmbeddedPlayerFrame: _sk_isEmbeddedPlayerFrame,
  };
} else {
  window.__transit_loaded = true;

  window.__SK = {};
  const SK = window.__SK;
  SK.disabled = false;
  SK.shouldDisableInFrame = _sk_shouldDisableInFrame;
  SK.isEmbeddedPlayerFrame = _sk_isEmbeddedPlayerFrame;
  SK.EMBED_PLAYER_TEXT_LIMIT = _SK_EMBED_PLAYER_TEXT_LIMIT;

  SK.STATE = {
    translated: false,
    translatedBy: null,
    translationContext: null,
    translating: false,
    translatingConvertOnly: false,
    abortController: null,
    originalHTML: new Map(),
    translatedHTML: new Map(),
    originalText: new Map(),
    translatedHTMLByText: new Map(),
    nodeValueMutateBackup: new Map(),
    stickyTranslate: false,
    stickySlot: null,
    translatedMode: null,
    translationCache: new Map(),
    targetLanguage: 'zh-TW',
    originalLang: new Map(),
    hoverTranslated: false,
    originalFontFamily: new Map(),
    docLangBackup: undefined,
  };

  SK.TRANSLATED_MARKER_SELECTOR =
    '[data-transit-translated], transit-translation, [data-transit-nodevalue-mutated]';
  SK.isPageTranslated = function isPageTranslated() {
    return !!document.querySelector(SK.TRANSLATED_MARKER_SELECTOR);
  };

  SK.sweepOrphanTranslationMarkers = function sweepOrphanTranslationMarkers() {
    let orphans = 0;
    document.querySelectorAll('[data-transit-translated], [data-transit-nodevalue-mutated]')
      .forEach((el) => {
        el.removeAttribute('data-transit-translated');
        el.removeAttribute('data-transit-nodevalue-mutated');
        orphans++;
      });
    document.querySelectorAll(SK.TRANSLATION_WRAPPER_TAG).forEach((n) => { n.remove(); orphans++; });
    document.querySelectorAll('[data-transit-dual-source]').forEach((el) => {
      el.removeAttribute('data-transit-dual-source');
      orphans++;
    });
    if (orphans > 0) {
      SK.sendLog?.('warn', 'system', 'sweepOrphanTranslationMarkers: cleared orphan markers (site-cloned/swapped nodes)', { orphans });
    }
    return orphans;
  };

  // 與 lib/storage.js 的 DEFAULT_SETTINGS.translateEngines 相同; 只在 background 無回應時使用
  SK.DEFAULT_TRANSLATE_ENGINES = {
    primary: { engine: 'gemini', model: 'gemini-3.1-flash-lite', label: 'Flash Lite' },
    fallback: { engine: 'google', model: null, label: 'Google MT' },
  };

  SK.FIRST_INJECT_HYDRATION_WAIT_MS = 0;
  SK._idleGateReached = false;
  SK._idleGatePromise = null;

  SK.USER_INTERACTION_BLACKOUT_MS = 2000;
  SK._lastInteractionT = 0;

  SK.ASR_LAST_CUE_FALLBACK_MS = 1500;
  SK.ASR_LAST_CUE_MAX_EXTEND_MS = 5000;
  SK.ASR_WINDOW_MAX_TAIL_EXTEND_MS = 12000;
  SK.ASR_CUE_MAX_CHARS = 40;
  SK.ASR_CUE_MIN_PIECE_MS = 1200;
  SK.ASR_CUE_LEAD_MS = 1000;
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const markInteraction = () => { SK._lastInteractionT = Date.now(); };
    ['mousedown', 'pointerdown', 'keydown'].forEach((evt) => {
      window.addEventListener(evt, markInteraction, { capture: true, passive: true });
    });
  }
  SK.ensureFirstInjectIdle = function ensureFirstInjectIdle() {
    if (SK._idleGateReached) return Promise.resolve();
    if (SK._idleGatePromise) return SK._idleGatePromise;
    if (typeof navigator !== 'undefined' && navigator.webdriver === true) {
      SK._idleGateReached = true;
      return Promise.resolve();
    }
    SK._idleGatePromise = new Promise((resolve) => {
      const markDone = () => {
        SK._idleGateReached = true;
        SK._idleGatePromise = null;
        resolve();
      };
      setTimeout(markDone, SK.FIRST_INJECT_HYDRATION_WAIT_MS);
    });
    return SK._idleGatePromise;
  };

  SK.sendLog = function sendLog(level, category, message, data) {
    try {
      browser.runtime.sendMessage({
        type: 'LOG',
        payload: { level, category, message, data },
      }).catch(() => {});
    } catch {   }
  };

  SK.isExtensionContextAlive = function isExtensionContextAlive() {
    return !!globalThis.chrome?.runtime?.id;
  };

  SK.isDevTailBuild = function isDevTailBuild() {
    try {
      const rt = globalThis.browser?.runtime;
      const m = rt?.getManifest?.() || {};
      if (String(m.version || '').split('.').length >= 4) return true;
      return /\btest-build\b/.test(String(m.version_name || ''));
    } catch (_) { return false; }
  };

  SK.safeSendMessage = function safeSendMessage(msg) {
    if (!SK.isExtensionContextAlive()) return Promise.resolve(undefined);
    try {
      return browser.runtime.sendMessage(msg).catch((err) => {
        const m = String(err?.message || err);
        if (m.includes('Extension context invalidated') || m.includes('Receiving end does not exist')) {
          return undefined;
        }
        throw err;
      });
    } catch (err) {
      const m = String(err?.message || err);
      if (m.includes('Extension context invalidated')) return Promise.resolve(undefined);
      return Promise.reject(err);
    }
  };

  SK.BLOCK_TAGS_SET = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'BLOCKQUOTE', 'DD', 'DT',
    'FIGCAPTION', 'CAPTION', 'TH', 'TD',
    'SUMMARY',
    'PRE',
    'FOOTER',
  ]);

  SK.BLOCK_TAG_SELECTOR = Array.from(SK.BLOCK_TAGS_SET).join(',');

  SK.CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE']);
  SK.CONTAINER_TAG_SELECTOR = Array.from(SK.CONTAINER_TAGS).join(',');

  SK.HARD_EXCLUDE_TAGS = new Set([
    'SCRIPT', 'STYLE', 'CODE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'BUTTON', 'SELECT',
    'TRANSIT-TRANSLATION',
  ]);

  SK.SEMANTIC_CONTAINER_EXCLUDE_TAGS = new Set(['FOOTER']);

  SK.EXCLUDE_ROLES = new Set(['contentinfo', 'search', 'grid', 'tree', 'treeitem']);

  SK.WIDGET_CHECK_EXEMPT_TAGS = new Set([
    'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  ]);

  SK.INCLUDE_BY_SELECTOR = [
    '#siteSub',
    '#contentSub',
    '#contentSub2',
    '#coordinates',
    '.hatnote',
    '.mw-redirectedfrom',
    '.dablink',
    '[role="note"]',
    '.thumbcaption',
    '[data-testid="tweetText"]',
    '[data-testid="card.layoutLarge.detail"] > div',
    '[data-testid="card.layoutSmall.detail"] > div',
    '.wp-block-post-navigation-link',
  ].join(',');

  SK.PH_OPEN = '\u27E6';
  SK.PH_CLOSE = '\u27E7';

  SK.PRESERVE_INLINE_TAGS = new Set([
    'A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'MARK', 'U', 'S',
    'SUB', 'SUP', 'KBD', 'ABBR', 'CITE', 'Q', 'SMALL',
    'DEL', 'INS', 'VAR', 'SAMP', 'TIME',
  ]);

  SK.GT_INLINE_TAGS = new Set([
    'A', 'B', 'STRONG', 'I', 'EM', 'SMALL', 'U', 'S',
    'SUB', 'SUP', 'MARK', 'DEL', 'INS', 'CITE', 'Q',
  ]);

  SK.BRACKET_ALIASES_OPEN = ['\u2770'];
  SK.BRACKET_ALIASES_CLOSE = ['\u2771'];

  SK.getSubtitleBatchType = function getSubtitleBatchType(engine, asr) {
    if (asr) {
      if (engine === 'openai-compat') return 'TRANSLATE_ASR_SUBTITLE_BATCH_CUSTOM';
      return 'TRANSLATE_ASR_SUBTITLE_BATCH';
    }
    if (engine === 'google')        return 'TRANSLATE_SUBTITLE_BATCH_GOOGLE';
    if (engine === 'openai-compat') return 'TRANSLATE_SUBTITLE_BATCH_CUSTOM';
    return 'TRANSLATE_SUBTITLE_BATCH';
  };

  SK.getGlossaryExtractType = function getGlossaryExtractType(engine) {
    if (engine === 'openai-compat') return 'EXTRACT_GLOSSARY_CUSTOM';
    return 'EXTRACT_GLOSSARY';
  };

  SK.resolveGlossaryEnabled = function resolveGlossaryEnabled(settings) {
    const gc = settings && settings.glossary;
    if (!gc) return false;
    return gc.enabled !== false;
  };

  SK.sanitizeMarkers = function sanitizeMarkers(text) {
    if (text == null) return text;
    return String(text)
      .replace(/\s*[<«]{1,6}\s*TRZX_SEP\s*[>»]{1,6}\s*/gi, ' ')
      .replace(/<<<TRZX_SEG-\d+>>>\s*/gi, '')
      .replace(/«\d+»\s*/g, '')
      .trim();
  };

  SK.DEFAULT_UNITS_PER_BATCH = 40;
  SK.DEFAULT_CHARS_PER_BATCH = 7000;
  SK.TARGET_LANGUAGES = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'es', 'fr', 'de'];
  SK.DEFAULT_MAX_CONCURRENT = 10;
  SK.DEFAULT_MAX_TOTAL_UNITS = 1000;
  SK.BATCH0_UNITS = 25;
  SK.BATCH0_CHARS = 3700;

  SK.BR_BLOCK_SPLIT_CHARS = 3500;

  SK.HOVER_PAGE_RETRANSLATE_MIN_CHARS = 200;

  SK.unitText = function unitText(unit) {
    if (!unit) return '';
    if (unit.kind === 'fragment') {
      let t = '';
      let n = unit.startNode;
      while (n) {
        t += n.textContent || '';
        if (n === unit.endNode) break;
        n = n.nextSibling;
      }
      return t.trim();
    }
    return (unit.el?.innerText || unit.text || '').trim();
  };

  const _untranslatedMemo = new Map();
  let _untranslatedMO = null;
  function _invalidateUntranslatedMemo() {
    _untranslatedMemo.clear();
    if (_untranslatedMO) { _untranslatedMO.disconnect(); _untranslatedMO = null; }
  }
  SK._invalidateUntranslatedMemo = _invalidateUntranslatedMemo;
  SK.hasSubstantialUntranslated = function hasSubstantialUntranslated(minChars = SK.HOVER_PAGE_RETRANSLATE_MIN_CHARS) {
    const key = minChars + '|' + (SK.STATE?.targetLanguage || '');
    if (_untranslatedMemo.has(key)) return _untranslatedMemo.get(key);
    const units = SK.collectParagraphs();
    let chars = 0;
    let result = false;
    for (const u of units) {
      if (u.el?.closest?.('[data-transit-dual-source]')) continue;
      chars += SK.unitText(u).length;
      if (chars >= minChars) { result = true; break; }
    }
    const docEl = document.documentElement;
    if (docEl && typeof MutationObserver === 'function') {
      if (!_untranslatedMO) {
        _untranslatedMO = new MutationObserver(_invalidateUntranslatedMemo);
        _untranslatedMO.observe(docEl, { childList: true, subtree: true, characterData: true, attributes: true });
      }
      _untranslatedMemo.set(key, result);
    }
    return result;
  };

  SK.SPA_OBSERVER_DEBOUNCE_MS = 1000;
  SK.SPA_OBSERVER_MAX_WAIT_MS = 2000;

  SK.SPA_OBSERVER_FAST_DEBOUNCE_MS = SK.SPA_OBSERVER_DEBOUNCE_MS;
  SK.SPA_OBSERVER_FAST_MAX_WAIT_MS = 500;
  SK.SPA_OBSERVER_FAST_HOSTS = [];
  SK.getObserverTiming = function getObserverTiming(hostnameOverride) {
    const host = (hostnameOverride ?? location.hostname ?? '').toLowerCase();
    if (!host) return { debounce: SK.SPA_OBSERVER_DEBOUNCE_MS, maxWait: SK.SPA_OBSERVER_MAX_WAIT_MS, host: '', profile: 'default' };
    const isFast = SK.SPA_OBSERVER_FAST_HOSTS.some(h => host === h || host.endsWith('.' + h));
    return isFast
      ? { debounce: SK.SPA_OBSERVER_FAST_DEBOUNCE_MS, maxWait: SK.SPA_OBSERVER_FAST_MAX_WAIT_MS, host, profile: 'fast' }
      : { debounce: SK.SPA_OBSERVER_DEBOUNCE_MS, maxWait: SK.SPA_OBSERVER_MAX_WAIT_MS, host, profile: 'default' };
  };
  SK.SPA_OBSERVER_MAX_UNITS = 50;
  SK.SPA_NAV_SETTLE_MS = 800;

  SK.PRESCAN_BATCH_WINDOW_MS = 100;
  SK.PRESCAN_ROOT_MARGIN = '1000px';
  SK.PRESCAN_HOSTS = ['x.com', 'twitter.com'];
  SK.PRESCAN_SELECTORS = {
    'x.com':       '[data-testid="tweetText"]:not([data-transit-translated])',
    'twitter.com': '[data-testid="tweetText"]:not([data-transit-translated])',
  };
  SK.getPrescanConfig = function getPrescanConfig(hostnameOverride) {
    const host = (hostnameOverride ?? location.hostname ?? '').toLowerCase();
    if (!host) return null;
    const matched = SK.PRESCAN_HOSTS.find(h => host === h || host.endsWith('.' + h));
    if (!matched) return null;
    const selector = SK.PRESCAN_SELECTORS[matched];
    if (!selector) return null;
    return { host, matched, selector, rootMargin: SK.PRESCAN_ROOT_MARGIN, batchWindowMs: SK.PRESCAN_BATCH_WINDOW_MS };
  };

  // Site translate scope: page translation only collects inside these roots (Gmail: subject + message bodies).
  SK.SCOPE_SELECTORS = {
    'mail.google.com': {
      content: 'h2[data-thread-perm-id], h2.hP, div.a3s',
      fallback: '[role="main"]',
    },
  };
  SK.getScopeRoots = function getScopeRoots(hostnameOverride, doc) {
    if (!hostnameOverride && window !== window.top) return null;
    const host = (hostnameOverride ?? location.hostname ?? '').toLowerCase();
    const cfg = SK.SCOPE_SELECTORS[host];
    if (!cfg) return null;
    const d = doc || document;
    let roots = Array.from(d.querySelectorAll(cfg.content));
    if (roots.length === 0 && cfg.fallback) roots = Array.from(d.querySelectorAll(cfg.fallback));
    return roots.filter((r) => !roots.some((o) => o !== r && o.contains(r)));
  };

  SK.GLOSSARY_SKIP_THRESHOLD_DEFAULT = 1;
  SK.GLOSSARY_BLOCKING_THRESHOLD_DEFAULT = 10;
  SK.GLOSSARY_TIMEOUT_DEFAULT = 60000;

  SK.RESCAN_DELAYS_MS = [1200, 3000];

  SK.CJK_CHAR = '[\\u3400-\\u9fff\\uf900-\\ufaff\\u3000-\\u303f\\uff00-\\uffef]';

  SK.LOCALE_FONT_PREPEND = {
    ja: {
      'sans-serif': '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", "Meiryo", "MS Gothic", "Noto Sans CJK JP", "Noto Sans JP"',
      'serif': '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "MS Mincho", "Noto Serif CJK JP", "Noto Serif JP"',
    },
    ko: {
      'sans-serif': '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR"',
      'serif': '"AppleMyungjo", "Batang", "BatangChe", "Gungsuh", "Noto Serif CJK KR", "Noto Serif KR"',
    },
    'zh-TW': {
      'sans-serif': '"PingFang TC", "Heiti TC", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC"',
      'serif': '"Songti TC", "LiSong Pro", "MingLiU", "PMingLiU", "Noto Serif CJK TC", "Noto Serif TC"',
    },
    'zh-CN': {
      'sans-serif': '"PingFang SC", "Heiti SC", "Microsoft YaHei", "DengXian", "Noto Sans CJK SC", "Noto Sans SC"',
      'serif': '"Songti SC", "STSong", "SimSun", "NSimSun", "Noto Serif CJK SC", "Noto Serif SC"',
    },
  };

  SK.detectFontStyle = function detectFontStyle(fontFamily) {
    if (!fontFamily || typeof fontFamily !== 'string') return 'sans-serif';
    const firstFont = (fontFamily.split(',')[0] || '').replace(/^["']|["']$/g, '').trim();
    if (!firstFont) return 'sans-serif';
    if (/sans-serif/i.test(firstFont)) return 'sans-serif';
    if (/serif|mincho|songti|sungti|\bsung\b|\bming\b|times|georgia|palatino|garamond|cambria|宋|明朝/i.test(firstFont)) {
      return 'serif';
    }
    return 'sans-serif';
  };

  SK.normalizeLangCode = function normalizeLangCode(lang) {
    if (!lang || typeof lang !== 'string') return null;
    const lower = lang.toLowerCase();
    if (lower === 'ja' || lower.startsWith('ja-')) return 'ja';
    if (lower === 'ko' || lower.startsWith('ko-')) return 'ko';
    if (lower.includes('hant') || lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo') return 'zh-TW';
    if (lower.includes('hans') || lower === 'zh-cn' || lower === 'zh-sg') return 'zh-CN';
    return null;
  };

  SK.TRANSLATION_WRAPPER_TAG = 'transit-translation';
  SK.DEFAULT_MARK_STYLE = 'tint';
  SK.VALID_MARK_STYLES = new Set(['tint', 'bar', 'dashed', 'none']);

  SK.DUAL_ACCENT_DEFAULT = 'auto';
  SK.DUAL_ACCENT_TOKENS = ['auto', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink'];
  SK.DUAL_ACCENT_HEX_MAP = {
    blue:   '#3B82F6',
    green:  '#10B981',
    yellow: '#F59E0B',
    orange: '#F97316',
    red:    '#EF4444',
    purple: '#A855F7',
    pink:   '#EC4899',
  };
  SK.DUAL_ACCENT_HEX_RE = /^#[0-9a-fA-F]{6}$/;
  SK.sanitizeDualAccent = function sanitizeDualAccent(value) {
    if (typeof value !== 'string') return 'auto';
    const v = value.trim();
    if (SK.DUAL_ACCENT_TOKENS.includes(v)) return v;
    if (SK.DUAL_ACCENT_HEX_RE.test(v)) return v.toUpperCase();
    return 'auto';
  };
  SK.dualAccentToRgb = function dualAccentToRgb(value) {
    const norm = SK.sanitizeDualAccent(value);
    if (norm === 'auto') return null;
    const hex = SK.DUAL_ACCENT_HEX_MAP[norm] || norm;
    if (!SK.DUAL_ACCENT_HEX_RE.test(hex)) return null;
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  };
  SK.BLOCK_DISPLAY_VALUES = new Set([
    'block', 'flex', 'grid', 'table', 'list-item', 'flow-root',
  ]);

  SK.sha1 = async function sha1(text) {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-1', buf);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  };

  let _styleMemo = null;
  SK.beginStyleMemo = function beginStyleMemo() { _styleMemo = new WeakMap(); };
  SK.endStyleMemo = function endStyleMemo() { _styleMemo = null; };
  SK.getCS = function getCS(el) {
    if (!el) return null;
    if (_styleMemo) {
      const hit = _styleMemo.get(el);
      if (hit !== undefined) return hit;
    }
    let cs = null;
    try { cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el) || null; } catch (_e) { cs = null; }
    if (_styleMemo) _styleMemo.set(el, cs);
    return cs;
  };

  SK.isVisible = function isVisible(el) {
    if (!el) return false;
    if (el.tagName === 'BODY') return true;
    const style = SK.getCS(el);
    if (style) {
      if (style.visibility === 'hidden' || style.display === 'none') return false;
    }
    let rect = null;
    if (el.offsetParent === null) {
      rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
    }
    if (style && style.position === 'absolute') {
      if (!rect) rect = el.getBoundingClientRect();
      if (rect.width <= 1 && rect.height <= 1) return false;
    }
    return true;
  };

  SK.containsMedia = function containsMedia(el) {
    return !!el.querySelector('img, picture, video, svg, canvas, audio');
  };

  SK.MEDIA_TAG_SELECTOR = 'img, picture, video, svg, canvas, audio, iframe, embed, object';
  SK.isMediaLikeElement = function isMediaLikeElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.matches?.(SK.MEDIA_TAG_SELECTOR)) return true;
    return el.tagName.includes('-') && (el.textContent || '').trim() === '';
  };
  SK.containsMediaLike = function containsMediaLike(el) {
    if (SK.isMediaLikeElement(el)) return true;
    if (el.querySelector && el.querySelector(SK.MEDIA_TAG_SELECTOR)) return true;
    if (!el.querySelectorAll) return false;
    for (const d of el.querySelectorAll('*')) {
      if (d.tagName.includes('-') && (d.textContent || '').trim() === '') return true;
    }
    return false;
  };

  SK.hasTextOutsideSvg = function hasTextOutsideSvg(el) {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      if (SK.hasSubstantiveText(t.nodeValue) && !t.parentElement?.closest('svg')) return true;
    }
    return false;
  };

  const _INTERACTIVE_SELECTOR = 'button, input, select, textarea';
  SK.isTextlessMediaWrapper = function isTextlessMediaWrapper(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (SK.isMediaLikeElement(el)) return false;
    if (!SK.containsMediaLike(el)) return false;
    if (el.querySelector(_INTERACTIVE_SELECTOR)) return false;
    return !SK.hasTextOutsideSvg(el);
  };

  SK.containsBlockDescendant = function containsBlockDescendant(el) {
    return !!el.querySelector(SK.BLOCK_TAG_SELECTOR);
  };

  SK.SUBSTANTIVE_CHAR_RE = /[\p{L}\p{N}]/u;

  SK.hasSubstantiveText = function hasSubstantiveText(txt) {
    return SK.SUBSTANTIVE_CHAR_RE.test(txt || '');
  };

  SK.hasSubstantiveContent = function hasSubstantiveContent(el) {
    return SK.hasSubstantiveText(el.innerText || el.textContent || '');
  };

  SK.isNoTranslateMarked = function isNoTranslateMarked(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tr = el.getAttribute('translate');
    if (tr != null && tr.trim().toLowerCase() === 'no') return true;
    return !!(el.classList && el.classList.contains('notranslate'));
  };

  const _ICON_FONT_RE = /icon|symbol|glyph/i;
  const _LIGATURE_TOKEN_RE = /^[A-Za-z0-9_-]{1,40}$/;
  SK.isIconFontLigature = function isIconFontLigature(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.children.length > 0) return false;
    const txt = (el.textContent || '').trim();
    if (!txt || !_LIGATURE_TOKEN_RE.test(txt)) return false;
    const _cs = SK.getCS(el);
    if (!_cs) return false;
    let ff = '';
    try { ff = _cs.fontFamily || ''; } catch (_e) { return false; }
    const first = (ff.split(',')[0] || '').replace(/^["'\s]+|["'\s]+$/g, '');
    return _ICON_FONT_RE.test(first);
  };

  const _PUA_RE = /\p{Co}/u;
  function isIconGlyphLeaf(el) {
    if (el.children.length > 0) return false;
    const win = el.ownerDocument?.defaultView;
    if (!win || !el.isConnected) return false;
    const txt = (el.textContent || '').trim();
    if (txt) return _PUA_RE.test(txt) && !SK.hasSubstantiveText(txt);
    return ['::before', '::after'].some((pseudo) => {
      const content = win.getComputedStyle(el, pseudo).content;
      return !!content && content !== 'none' && content !== 'normal';
    });
  }

  SK.isIconGlyphElement = function isIconGlyphElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (SK.containsMediaLike(el)) return false;
    if (el.children.length === 0) return isIconGlyphLeaf(el);
    if (SK.hasTextOutsideSvg(el) || el.querySelector(_INTERACTIVE_SELECTOR)) return false;
    for (const d of el.querySelectorAll('*')) {
      if (d.children.length === 0 && isIconGlyphLeaf(d)) return true;
    }
    return false;
  };

  SK.isAtomicPreserve = function isAtomicPreserve(el) {
    if (el.tagName === 'SUP' && el.classList && el.classList.contains('reference')) return true;
    if (el.tagName === 'HR') return true;
    if (SK.isNoTranslateMarked(el) || SK.isIconFontLigature(el)) return true;
    if (SK.isIconGlyphElement(el)) return true;
    return false;
  };

  SK.isPreservableInline = function isPreservableInline(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName;
    if (tag === 'SUP' && el.classList && el.classList.contains('reference')) return false;
    let matchesTag = false;
    if (SK.PRESERVE_INLINE_TAGS.has(tag)) {
      matchesTag = true;
    } else if (tag === 'SPAN') {
      if (el.hasAttribute('class')) matchesTag = true;
      else {
        const style = el.getAttribute('style');
        if (style && style.trim()) matchesTag = true;
      }
    }
    if (!matchesTag) return false;
    if (!SK.hasSubstantiveContent(el)) return false;
    return true;
  };

  SK.hasPreservableInline = function hasPreservableInline(el) {
    const all = el.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const n = all[i];
      if (n.tagName === 'CODE'
          && !(n.parentElement && n.parentElement.tagName === 'PRE')) return true;
      if (n.tagName === 'BUTTON' && SK.hasSubstantiveContent(n)) return true;
      if (SK.HARD_EXCLUDE_TAGS.has(n.tagName)) continue;
      if (SK.isAtomicPreserve(n)) return true;
      if (SK.isPreservableInline(n)) return true;
    }
    return false;
  };

  SK.isBlockMediaGroup = function isBlockMediaGroup(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (!SK.containsMediaLike(el)) return false;
    const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    if (!cs) return false;
    const d = cs.display;
    if (d === 'inline' || d === 'inline-block' || d === 'inline-flex'
        || d === 'inline-grid' || d === 'inline-table' || d === 'contents') return false;
    return true;
  };

  SK.isInlineRunNode = function isInlineRunNode(child) {
    if (child.nodeType === Node.TEXT_NODE) return true;
    if (child.nodeType !== Node.ELEMENT_NODE) return false;
    if (SK.HARD_EXCLUDE_TAGS.has(child.tagName)) return false;
    if (SK.BLOCK_TAGS_SET.has(child.tagName)) return false;
    if (SK.containsBlockDescendant(child)) return false;
    if (SK.isBlockMediaGroup(child)) return false;
    return true;
  };

  SK.collectVisibleTextNodes = function collectVisibleTextNodes(el) {
    const textNodes = [];
    const selfRejected = (p) => {
      if (SK.HARD_EXCLUDE_TAGS.has(p.tagName)) return true;
      if (p.tagName === 'PRE' && p.querySelector('code')) return true;
      const cs = p.ownerDocument?.defaultView?.getComputedStyle?.(p);
      return !!(cs && (cs.display === 'none' || cs.visibility === 'hidden'));
    };
    // 同一個祖先底下有很多文字節點; 每個祖先 (到 el 為止) 的結果只算一次.
    const chainRejected = new Map();
    const isRejected = (p) => {
      if (!p || p === el) return false;
      let r = chainRejected.get(p);
      if (r === undefined) {
        r = selfRejected(p) || isRejected(p.parentElement);
        chainRejected.set(p, r);
      }
      return r;
    };
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isRejected(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.trim()) textNodes.push(n);
    }
    return textNodes;
  };

  SK.findLongestTextNode = function findLongestTextNode(textNodes) {
    let main = textNodes[0];
    for (const t of textNodes) {
      if (t.nodeValue.length > main.nodeValue.length) main = t;
    }
    return main;
  };

  const _fwQueryCache = new WeakMap();
  SK.isFrameworkManaged = function isFrameworkManaged(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (_fwQueryCache.has(el)) return _fwQueryCache.get(el);
    let result = false;
    const handler = (e) => {
      const r = e?.detail?.result;
      if (r === 'react' || r === 'vue') result = true;
    };
    el.addEventListener('transit-fw-detect-response', handler, { once: true });
    try {
      el.dispatchEvent(new CustomEvent('transit-fw-detect-request', { bubbles: true }));
    } catch (_) {
    } finally {
      el.removeEventListener('transit-fw-detect-response', handler);
    }
    if (result) _fwQueryCache.set(el, result);
    return result;
  };

  SK.localTodayKey = function localTodayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  SK.maybeBuildWelcomeNotice = async function maybeBuildWelcomeNotice() {
    try {
      const { welcomeNotice } = await browser.storage.local.get('welcomeNotice');
      if (!welcomeNotice || !welcomeNotice.version) return null;
      if (welcomeNotice.dismissed === true) return null;
      if (welcomeNotice.lastNoticeShownDate === SK.localTodayKey()) return null;
      return { version: welcomeNotice.version };
    } catch {
      return null;
    }
  };

  function isWorthNotifying(latest, current) {
    const parse = v => {
      const c = String(v || '').replace(/^v/, '').split('-')[0];
      const p = c.split('.').map(s => parseInt(s, 10) || 0);
      while (p.length < 3) p.push(0);
      return p.slice(0, 3);
    };
    const a = parse(latest);
    const b = parse(current);
    if (a[0] > b[0]) return true;
    if (a[0] < b[0]) return false;
    return a[1] > b[1];
  }

  SK.maybeBuildUpdateNotice = async function maybeBuildUpdateNotice() {
    try {
      const [{ disableUpdateNotice }, { updateAvailable }] = await Promise.all([
        browser.storage.sync.get('disableUpdateNotice'),
        browser.storage.local.get('updateAvailable'),
      ]);
      if (disableUpdateNotice === true) return null;
      if (!updateAvailable || !updateAvailable.version) return null;
      if (updateAvailable.lastNoticeShownDate === SK.localTodayKey()) return null;
      const currentVersion = browser.runtime.getManifest().version;
      if (!isWorthNotifying(updateAvailable.version, currentVersion)) return null;
      const releaseUrl = updateAvailable.releaseUrl
        || `https://github.com/seanmars/transit/releases/tag/v${updateAvailable.version}`;
      return { version: updateAvailable.version, releaseUrl };
    } catch {
      return null;
    }
  };

  const _INSTANCE_PING = 'transit-instance-ping';
  const _INSTANCE_PONG = 'transit-instance-pong';
  SK.INSTANCE = {
    id: (globalThis.chrome?.runtime?.id) || ('anon-' + Math.random().toString(36).slice(2)),
    version: (() => { try { return browser.runtime.getManifest().version || '0'; } catch (_) { return '0'; } })(),
    stoodDown: false,
  };
  function _instanceCmp(a, b) {
    const va = String(a.version || '0').split('.').map(Number);
    const vb = String(b.version || '0').split('.').map(Number);
    const n = Math.max(va.length, vb.length);
    for (let i = 0; i < n; i++) {
      const x = Number.isFinite(va[i]) ? va[i] : -1;
      const y = Number.isFinite(vb[i]) ? vb[i] : -1;
      if (x !== y) return y - x;
    }
    return String(a.id).localeCompare(String(b.id));
  }
  SK._instanceCmp = _instanceCmp;
  function _instanceStandDown(reason, other) {
    if (SK.INSTANCE.stoodDown) return;
    SK.INSTANCE.stoodDown = true;
    SK.sendLog('info', 'system', 'instance stood down (another Transit on this page wins)', {
      reason, me: SK.INSTANCE.version, other: other ? `${other.version}@${other.id}` : null,
    });
    try { if (SK.YT?.active) SK.stopYouTubeTranslation?.(); } catch (_) {}
    try { SK.stopXSubtitles?.(); } catch (_) {}
  }
  window.addEventListener(_INSTANCE_PING, (e) => {
    const d = e.detail;
    if (!d || !d.id || d.id === SK.INSTANCE.id) return;
    if (!SK.isExtensionContextAlive()) return;
    window.dispatchEvent(new CustomEvent(_INSTANCE_PONG, {
      detail: { id: SK.INSTANCE.id, version: SK.INSTANCE.version, replyTo: d.id },
    }));
    if (_instanceCmp(d, SK.INSTANCE) < 0) _instanceStandDown('higher-ranked instance pinged', d);
  });
  SK.isInstanceLeader = function isInstanceLeader() {
    if (SK.INSTANCE.stoodDown) return false;
    const me = { id: SK.INSTANCE.id, version: SK.INSTANCE.version };
    const others = [];
    const onPong = (e) => { if (e.detail && e.detail.replyTo === me.id) others.push(e.detail); };
    window.addEventListener(_INSTANCE_PONG, onPong);
    try { window.dispatchEvent(new CustomEvent(_INSTANCE_PING, { detail: me })); }
    finally { window.removeEventListener(_INSTANCE_PONG, onPong); }
    if (others.length === 0) return true;
    const winner = [me, ...others].sort(_instanceCmp)[0];
    if (winner.id === me.id) return true;
    _instanceStandDown('lost election', winner);
    return false;
  };

}
