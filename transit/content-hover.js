(function (SK) {
  'use strict';
  if (!SK) return;
  if (SK.hoverTranslate) return;
  const STATE = SK.STATE;

  const REST_MS = 150;
  const MAX_SCOPE_HOPS = 4;
  const VALID_MODES = ['off', 'shift', 'alt', 'ctrl'];
  const MOD_EVENT_PROP = { shift: 'shiftKey', alt: 'altKey', ctrl: 'ctrlKey' };
  const MOD_KEY_NAME = { shift: 'Shift', alt: 'Alt', ctrl: 'Control' };
  const PENDING_ATTR = 'data-transit-hover-pending';
  const PENDING_OVERLAY_ID = 'transit-hover-pending-overlay';

  let mode = 'off';
  let displayMode = 'dual';
  let lastX = -1;
  let lastY = -1;
  let armed = false;
  let restTimer = null;
  let inflight = null;
  let rerunAfter = false;

  function normalizeMode(v) {
    return (typeof v === 'string' && VALID_MODES.includes(v)) ? v : 'off';
  }

  function normalizeDisplay(v) {
    return v === 'single' ? 'single' : 'dual';
  }

  function loadMode() {
    if (!browser || !browser.storage || !browser.storage.sync) return;
    try {
      browser.storage.sync.get(['hoverTranslateModifier', 'hoverTranslateMode']).then((s) => {
        mode = normalizeMode(s && s.hoverTranslateModifier);
        displayMode = normalizeDisplay(s && s.hoverTranslateMode);
      }).catch(() => {   });
    } catch (_) {   }
  }
  if (browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if ('hoverTranslateModifier' in changes) {
        mode = normalizeMode(changes.hoverTranslateModifier.newValue);
        if (mode === 'off') disarm();
      }
      if ('hoverTranslateMode' in changes) {
        displayMode = normalizeDisplay(changes.hoverTranslateMode.newValue);
      }
    });
  }

  function disarm() {
    armed = false;
    if (restTimer) { clearTimeout(restTimer); restTimer = null; }
  }

  function schedule() {
    if (restTimer) clearTimeout(restTimer);
    restTimer = setTimeout(() => { restTimer = null; fire(); }, REST_MS);
  }

  function onMouseMove(e) {
    lastX = e.clientX;
    lastY = e.clientY;
    if (mode === 'off') return;
    armed = !!e[MOD_EVENT_PROP[mode]];
    if (!armed) { if (restTimer) { clearTimeout(restTimer); restTimer = null; } return; }
    schedule();
  }

  function onKeyDown(e) {
    if (mode === 'off' || e.repeat) return;
    if (e.key !== MOD_KEY_NAME[mode]) return;
    armed = true;
    if (lastX >= 0) schedule();
  }

  function onKeyUp(e) {
    if (mode === 'off') return;
    if (e.key === MOD_KEY_NAME[mode]) disarm();
  }

  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    let guard = 0;
    while (el && el.shadowRoot && guard++ < 8) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  function isInlineDisplay(el) {
    const d = (SK.getCS ? SK.getCS(el) : getComputedStyle(el)).display || '';
    return d === 'inline' || d.startsWith('inline-') || d === 'contents';
  }

  function nearestBlock(el) {
    let n = el;
    while (n && n.nodeType === Node.ELEMENT_NODE && n !== document.body && isInlineDisplay(n)) {
      n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
    }
    return n && n.nodeType === Node.ELEMENT_NODE ? n : null;
  }

  function parentOf(el) {
    return el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
  }

  function rectContains(rects, x, y) {
    for (const r of rects) {
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }

  function unitContainsPoint(unit, target, x, y) {
    if (unit.kind === 'fragment') {
      try {
        const range = document.createRange();
        range.setStartBefore(unit.startNode);
        range.setEndAfter(unit.endNode);
        return rectContains(range.getClientRects(), x, y);
      } catch (_) { return false; }
    }
    return unit.el === target || (unit.el && unit.el.contains(target));
  }

  function closestComposed(el, selector) {
    let n = el;
    while (n && n.nodeType === Node.ELEMENT_NODE) {
      const hit = n.closest(selector);
      if (hit) return hit;
      const root = n.getRootNode ? n.getRootNode() : null;
      n = root && root.host ? root.host : null;
    }
    return null;
  }

  function collectScoped(scope, target) {
    let units = [];
    try {
      units = SK.collectParagraphs(scope, null, { includeRoot: true, pathTo: target }) || [];
    } catch (_) { return []; }
    if (STATE.translatedMode === 'dual' && SK.consolidateDualInlineUnits) {
      units = SK.consolidateDualInlineUnits(units);
    }
    return units;
  }

  function findUnitAt(x, y) {
    const target = deepElementFromPoint(x, y);
    if (!target || target === document.documentElement || target === document.body) return null;
    if (closestComposed(target, '#transit-toast-host, #transit-floating-host, [data-transit-translated], [data-transit-dual-source], ' + SK.TRANSLATION_WRAPPER_TAG)) return null;
    let scope = nearestBlock(target);
    for (let hop = 0; scope && hop < MAX_SCOPE_HOPS; hop++) {
      if (scope === document.body || scope === document.documentElement) break;
      const units = collectScoped(scope, target);
      const hit = units.find((u) => unitContainsPoint(u, target, x, y));
      if (hit) return hit;
      const up = parentOf(scope);
      scope = up ? nearestBlock(up) : null;
    }
    return null;
  }

  async function resolveRunner() {
    const ctx = STATE.translationContext;
    if (ctx && ctx.provider !== 'opencc-local') {
      return (units, signal) => SK.translateUnitsByProvider(units, { signal });
    }
    const plan = await SK.resolveTranslatePlan();
    const target = STATE.targetLanguage;
    const convertDirection = target === 'zh-TW' ? 'cn2twp' : (target === 'zh-CN' ? 'twp2cn' : null);
    return async (units, signal) => {
      const r = await SK.translateUnitsWithEngine(units, plan.engine, { signal, convertDirection });
      const fb = await SK.retryFailuresWithFallback(r.failures, plan.fallback, { signal, convertDirection, silent: true });
      return fb ? { ...r, done: r.done + fb.done, failures: fb.failures } : r;
    };
  }

  async function translateUnit(unit) {
    const el = unit.el;
    const runner = await resolveRunner();
    if (STATE.translating) return;
    const clearPending = showPending(unit);
    const signal = SK.getRescanSignal();
    try {
      const r = await runner([unit], signal);
      if (signal.aborted) return;
      const done = r?.done || 0;
      const failures = r?.failures || [];
      if (done > 0) {
        STATE.hoverTranslated = true;
        SK.sendLog?.('info', 'translate', 'hover translate done', { kind: unit.kind || 'element', tag: el?.tagName });
      } else if (failures.length) {
        SK.sendLog?.('warn', 'translate', 'hover translate failed', { error: failures[0]?.error });
        SK.showToast?.('error', SK.t('toast.partialFailed', { failed: 1, total: 1 }), {
          detail: String(failures[0]?.error || '').slice(0, 120), autoHideMs: 4000,
        });
      }
    } finally {
      clearPending();
    }
  }

  function showPending(unit) {
    const el = unit.el;
    if (unit.kind !== 'fragment') {
      if (el && el.setAttribute) { el.setAttribute(PENDING_ATTR, ''); ensurePendingStyle(); }
      return () => { if (el && el.removeAttribute) el.removeAttribute(PENDING_ATTR); };
    }
    let host = null;
    try {
      const range = document.createRange();
      range.setStartBefore(unit.startNode);
      range.setEndAfter(unit.endNode);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      const parent = document.documentElement;
      if (rects.length > 0 && parent) {
        host = document.createElement('div');
        host.id = PENDING_OVERLAY_ID;
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
        const sx = window.scrollX || 0;
        const sy = window.scrollY || 0;
        for (const r of rects) {
          const box = document.createElement('div');
          box.style.cssText = `position:absolute;left:${r.left + sx}px;top:${r.top + sy}px;width:${r.width}px;height:${r.height}px;`
            + 'outline:2px dashed rgba(64,128,255,.7);outline-offset:2px;';
          host.appendChild(box);
        }
        parent.appendChild(host);
      }
    } catch (_) {   }
    return () => { if (host && host.parentNode) host.parentNode.removeChild(host); };
  }

  async function fire() {
    if (!armed || mode === 'off') return;
    if (SK.INSTANCE?.stoodDown) return;
    if (SK.isInstanceLeader && !SK.isInstanceLeader()) return;
    if (STATE.translating) return;
    if (inflight) { rerunAfter = true; return; }
    inflight = (async () => {
      if (!SK.isPageTranslated()) {
        let settings = {};
        try { settings = await browser.storage.sync.get(null); } catch (_) {   }
        SK.applyTranslateDisplaySettings?.(settings);
      }
      if (!armed || STATE.translating) return;
      const prevMode = STATE.translatedMode;
      const wasTranslated = STATE.translated;
      STATE.translatedMode = displayMode;
      if (displayMode === 'dual') SK.ensureDualWrapperStyle?.();
      try {
        const unit = findUnitAt(lastX, lastY);
        if (!unit) return;
        await translateUnit(unit);
      } finally {
        if (!STATE.translating && STATE.translated === wasTranslated && STATE.translatedMode === displayMode) {
          STATE.translatedMode = prevMode;
        }
      }
    })().catch((err) => {
      SK.sendLog?.('warn', 'translate', 'hover translate error', { error: err?.message });
    }).finally(() => {
      inflight = null;
      if (rerunAfter) { rerunAfter = false; if (armed) schedule(); }
    });
    return inflight;
  }

  let _styleDone = false;
  function ensurePendingStyle() {
    if (_styleDone || !document.head) return;
    _styleDone = true;
    const st = document.createElement('style');
    st.id = 'transit-hover-style';
    st.textContent = `[${PENDING_ATTR}]{outline:2px dashed rgba(64,128,255,.7)!important;outline-offset:2px!important}`;
    document.head.appendChild(st);
  }

  window.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', disarm);

  SK.hoverTranslate = {
    installed: true,
    getMode: () => mode,
    getDisplayMode: () => displayMode,
    isArmed: () => armed,
    findUnitAt,
    fire,
  };
  loadMode();
})(window.__SK);
