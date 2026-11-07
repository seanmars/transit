(function(SK) {
  if (!SK || SK.disabled) return;

  const STATE = SK.STATE;

  let spaLastUrl = location.href;
  let spaObserver = null;
  let spaObserverDebounceTimer = null;
  let spaObserverMaxWaitTimer = null;
  let spaObserverRescanCount = 0;
  let contentGuardInterval = null;
  const GUARD_SWEEP_INTERVAL_MS = 1000;

  let contentGuardExternallyPaused = false;

  let guardIntersectionObserver = null;
  let guardVisibleSet = null;

  function resetForSpaNavigation() {
    if (STATE.translating && STATE.abortController) {
      STATE.abortController.abort();
      STATE.translating = false;
      STATE.abortController = null;
    }
    SK.exitEditModeIfActive?.();
    SK.cancelRescan();
    SK.abortRescanRuns?.();
    stopSpaObserver();
    let _spaStripped = 0;
    STATE.originalHTML.forEach((originalHTML, el) => {
      if (el.innerHTML !== originalHTML) el.innerHTML = originalHTML;
      el.removeAttribute('data-transit-translated');
      SK.restoreLocaleStyling?.(el);
      _spaStripped++;
    });
    if (STATE.translatedMode === 'dual' || (STATE.translationCache && STATE.translationCache.size > 0)) {
      SK.removeDualWrappers?.();
    }
    if (STATE.nodeValueMutateBackup && STATE.nodeValueMutateBackup.size > 0) {
      STATE.nodeValueMutateBackup.forEach((backup, el) => {
        backup.forEach(({ node, originalValue }) => {
          if (node) { try { node.nodeValue = originalValue; } catch (_) {} }
        });
        try {
          el.removeAttribute('data-transit-nodevalue-mutated');
          SK.restoreLocaleStyling?.(el);
        } catch (_) {}
      });
    }
    STATE.originalHTML.clear();
    STATE.translatedHTML.clear();
    STATE.translatedHTMLByText?.clear?.();
    STATE.originalText?.clear?.();
    STATE.translationCache?.clear?.();
    STATE.nodeValueMutateBackup?.clear?.();
    STATE.originalLang?.clear?.();
    STATE.originalFontFamily?.clear?.();
    STATE.hoverTranslated = false;
    SK.restoreDocLang?.();
    SK.sweepOrphanTranslationMarkers?.();
    STATE.translated = false;
    STATE._glossaryPromise = null;
    SK.safeSendMessage({ type: 'CLEAR_BADGE' }).catch(() => {});
    SK.hideToast();
    SK.sendLog('info', 'spa', 'SPA navigation detected, state reset', { url: location.href, stickyTranslate: STATE.stickyTranslate, strippedConnected: _spaStripped });
  }

  SK.isDomainWhitelisted = async function isDomainWhitelisted() {
    try {
      const { domainRules } = await browser.storage.sync.get('domainRules');
      if (!domainRules?.whitelist?.length) return false;
      return window.__SKDomain.matchDomain(location.hostname, domainRules.whitelist);
    } catch (err) {
      SK.sendLog('warn', 'system', 'isDomainWhitelisted: failed to read storage', { error: err.message });
      return false;
    }
  };

  const SPA_HASH_NAV_DETACH_RATIO = 0.2;

  async function handleSpaNavigation() {
    const newUrl = location.href;
    if (newUrl === spaLastUrl) return;
    const prevUrl = spaLastUrl;
    spaLastUrl = newUrl;
    try {
      const a = new URL(prevUrl);
      const b = new URL(newUrl);
      if (a.pathname === b.pathname && a.search === b.search) {
        const tracked = Array.from(document.querySelectorAll(
          '[data-transit-translated], [data-transit-dual-source]'));
        if (tracked.length > 0) {
          await new Promise(r => setTimeout(r, SK.SPA_NAV_SETTLE_MS));
          if (spaLastUrl !== newUrl) return;
          const detached = tracked.filter(el => !el.isConnected).length;
          if (detached / tracked.length < SPA_HASH_NAV_DETACH_RATIO) {
            SK.sendLog('info', 'spa', 'hash-only URL change with content intact, skipping SPA reset',
              { newUrl, oldUrl: prevUrl, tracked: tracked.length, detached });
            return;
          }
          SK.sendLog('info', 'spa', 'hash-only URL change with content swapped, treating as navigation',
            { newUrl, oldUrl: prevUrl, tracked: tracked.length, detached });
        }
      }
    } catch (_) {   }
    const wasSticky = STATE.stickyTranslate;
    const prevSlot = STATE.stickySlot;
    resetForSpaNavigation();

    await new Promise(r => setTimeout(r, SK.SPA_NAV_SETTLE_MS));
    if (spaLastUrl !== newUrl) {
      SK.sendLog('info', 'spa', 'SPA nav: superseded by newer navigation during settle, skipping', { staleUrl: newUrl, currentUrl: spaLastUrl });
      return;
    }

    if (wasSticky) {
      if (prevSlot != null && typeof SK.handleTranslate === 'function') {
        SK.sendLog('info', 'spa', 'SPA nav: sticky translate active, re-triggering translate', { url: location.href });
        SK.handleTranslate();
      } else {
        SK.sendLog('info', 'spa', 'SPA nav: sticky translate active, replay by provider (no preset slot)', { url: location.href, provider: STATE.translationContext?.provider || null });
        if (typeof SK.replayTranslateByProvider === 'function') {
          SK.replayTranslateByProvider();
        } else {
          SK.translatePage();
        }
      }
      return;
    }

    try {
      const { autoTranslate = false, autoConvertZh = true } = await browser.storage.sync.get(['autoTranslate', 'autoConvertZh']);
      if (autoTranslate && await SK.isDomainWhitelisted()) {
        SK.sendLog('info', 'spa', 'SPA nav: domain in auto-translate list, translating', { url: location.href });
        if (typeof SK.handleTranslate === 'function') {
          SK.handleTranslate();
        } else {
          SK.translatePage();
        }
        return;
      }
      if (autoConvertZh) {
        SK.sendLog('info', 'spa', 'SPA nav: autoConvertZh on, trying local zh-convert', { url: location.href });
        SK.autoConvertZhWithRetry();
        return;
      }
    } catch (err) {
      SK.sendLog('warn', 'spa', 'SPA nav: auto-translate list check failed', { error: err.message });
    }
  }

  window.addEventListener('popstate', () => handleSpaNavigation());
  window.addEventListener('hashchange', () => handleSpaNavigation());

  const SPA_URL_POLL_MS = 500;
  let spaUrlPollTimer = setInterval(() => {
    if (!globalThis.chrome?.runtime?.id) {
      clearInterval(spaUrlPollTimer);
      spaUrlPollTimer = null;
      return;
    }
    if (document.hidden) return;
    if (location.href !== spaLastUrl) {
      if (STATE.translated && !STATE.stickyTranslate && document.querySelector('[data-transit-translated]')) {
        SK.sendLog('info', 'spa', 'URL changed while translated content present — scroll-based update, skipping reset', { newUrl: location.href, oldUrl: spaLastUrl });
        spaLastUrl = location.href;
        return;
      }
      handleSpaNavigation();
    }
  }, SPA_URL_POLL_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && location.href !== spaLastUrl) {
      handleSpaNavigation();
    }
  });

  const SPA_OBSERVER_SEEN_TEXTS_TTL_MS = 30_000;
  const spaObserverSeenTexts = new Map();
  function isSeenTextRecent(text) {
    const ts = spaObserverSeenTexts.get(text);
    if (ts == null) return false;
    if (Date.now() - ts > SPA_OBSERVER_SEEN_TEXTS_TTL_MS) {
      spaObserverSeenTexts.delete(text);
      return false;
    }
    return true;
  }
  function sweepExpiredSeenTexts(now) {
    for (const [text, ts] of spaObserverSeenTexts) {
      if (now - ts > SPA_OBSERVER_SEEN_TEXTS_TTL_MS) spaObserverSeenTexts.delete(text);
    }
  }
  SK._spaObserverSeenTexts = spaObserverSeenTexts;
  SK._isSeenTextRecent = isSeenTextRecent;
  SK._SPA_OBSERVER_SEEN_TEXTS_TTL_MS = SPA_OBSERVER_SEEN_TEXTS_TTL_MS;
  SK._sweepExpiredSeenTexts = sweepExpiredSeenTexts;

  SK._spaDebug = function _spaDebug() {
    return {
      observerActive: !!spaObserver,
      debounceArmed: !!spaObserverDebounceTimer,
      maxWaitArmed: !!spaObserverMaxWaitTimer,
      rescanCount: spaObserverRescanCount,
      seenTextsSize: spaObserverSeenTexts.size,
      contentGuardActive: !!contentGuardInterval,
      contentGuardExternallyPaused: contentGuardExternallyPaused,
      guardVisibleSetSize: guardVisibleSet ? guardVisibleSet.size : null,
      stateTranslated: STATE.translated,
      stateTranslating: STATE.translating,
      stickyTranslate: STATE.stickyTranslate,
      partialModeActive: STATE.partialModeActive,
      mutationBatchesSeen: _dbgMutationBatchesSeen,
      hasNewContentTrueCount: _dbgHasNewContentTrueCount,
      debounceArmedCount: _dbgDebounceArmedCount,
      earlyReturnNotTranslated: _dbgEarlyReturnNotTranslated,
    };
  };

  SK.setContentGuardPaused = function setContentGuardPaused(paused) {
    const wasPaused = contentGuardExternallyPaused;
    contentGuardExternallyPaused = !!paused;
    SK.sendLog('info', 'spa', 'content guard ' + (contentGuardExternallyPaused ? 'paused' : 'resumed') + ' (JRead reader mode)');
    if (wasPaused && !contentGuardExternallyPaused && STATE.translated
        && STATE.translatedMode !== 'dual') {
      try { runContentGuardNvMutate(true); } catch (_) {}
    }
  };

  let _preClickListenerAdded = false;
  function addPreClickRestore() {
    if (_preClickListenerAdded) return;
    if (typeof window === 'undefined') return;
    _preClickListenerAdded = true;
    window.addEventListener('mousedown', (e) => {
      if (!STATE.nodeValueMutateBackup || STATE.nodeValueMutateBackup.size === 0) return;
      const target = e.target;
      if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
      const nvEl = target.closest?.('[data-transit-nodevalue-mutated]');
      if (!nvEl) return;
      if (nvEl.getAttribute('contenteditable') === 'true') return;
      const backup = STATE.nodeValueMutateBackup.get(nvEl);
      if (!backup) return;
      for (const entry of backup) {
        if (entry?.node?.isConnected && typeof entry.originalValue === 'string') {
          entry.node.nodeValue = entry.originalValue;
        }
      }
      nvEl.removeAttribute('data-transit-nodevalue-mutated');
      nvEl.removeAttribute('data-transit-translated');
      STATE.nodeValueMutateBackup.delete(nvEl);
      STATE.originalText.delete(nvEl);
      STATE.originalHTML?.delete?.(nvEl);
      const _restoredText = (nvEl.innerText || '').trim();
      if (_restoredText) spaObserverSeenTexts.delete(_restoredText);
      SK.sendLog?.('info', 'spa', 'pre-click restore: nodeValue mutate backup restored for click target');
      setTimeout(() => {
        if (!STATE.translated) return;
        triggerSpaObserverRescan();
      }, 500);
    }, { capture: true, passive: true });
  }

  SK.startSpaObserver = function startSpaObserver() {
    if (spaObserver) return;
    spaObserverRescanCount = 0;
    spaObserverSeenTexts.clear();
    addPreClickRestore();
    spaObserver = new MutationObserver(onSpaObserverMutations);
    spaObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    if (!contentGuardInterval) {
      contentGuardInterval = setInterval(runContentGuard, GUARD_SWEEP_INTERVAL_MS);
    }
    initGuardIntersectionObserver();
    startPrescanObserver();
    SK.sendLog('info', 'spa', 'SPA observer started');
  };

  function initGuardIntersectionObserver() {
    if (guardIntersectionObserver) return;
    if (typeof IntersectionObserver === 'undefined') return;
    guardVisibleSet = new Set();
    guardIntersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) guardVisibleSet.add(entry.target);
        else guardVisibleSet.delete(entry.target);
      }
    }, { rootMargin: '500px' });

    if (STATE.translatedHTML) {
      for (const el of STATE.translatedHTML.keys()) {
        if (el.isConnected) guardIntersectionObserver.observe(el);
      }
    }
    if (STATE.translationCache) {
      for (const el of STATE.translationCache.keys()) {
        if (el && el.isConnected) guardIntersectionObserver.observe(el);
      }
    }
  }
  SK.initGuardIntersectionObserver = initGuardIntersectionObserver;

  function teardownGuardIntersectionObserver() {
    if (guardIntersectionObserver) {
      guardIntersectionObserver.disconnect();
      guardIntersectionObserver = null;
    }
    guardVisibleSet = null;
  }

  let prescanIO = null;
  let prescanMO = null;
  let prescanScheduledTimer = null;
  let _dbgPrescanFires = 0;
  let _dbgPrescanScheduled = 0;
  let _dbgPrescanObserved = 0;

  function schedulePrescanRescan() {
    if (prescanScheduledTimer) return;
    _dbgPrescanScheduled++;
    prescanScheduledTimer = setTimeout(() => {
      prescanScheduledTimer = null;
      if (!STATE.translated) return;
      SK.sendLog?.('info', 'spa', 'prescan IO triggered rescan');
      triggerSpaObserverRescan();
    }, SK.PRESCAN_BATCH_WINDOW_MS || 100);
  }

  function startPrescanObserver() {
    if (prescanIO) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const config = typeof SK.getPrescanConfig === 'function' ? SK.getPrescanConfig() : null;
    if (!config) return;
    _dbgPrescanFires = 0;
    _dbgPrescanScheduled = 0;
    _dbgPrescanObserved = 0;

    prescanIO = new IntersectionObserver((entries) => {
      let fired = false;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        try { prescanIO.unobserve(e.target); } catch (_) {}
        try {
          const text = (e.target?.innerText || '').trim();
          if (text) spaObserverSeenTexts.delete(text);
        } catch (_) {}
        _dbgPrescanFires++;
        fired = true;
      }
      if (fired) schedulePrescanRescan();
    }, { rootMargin: config.rootMargin || '1000px' });

    try {
      const initial = document.querySelectorAll(config.selector);
      for (const el of initial) {
        prescanIO.observe(el);
        _dbgPrescanObserved++;
      }
    } catch (_) {   }

    prescanMO = new MutationObserver((muts) => {
      if (!prescanIO) return;
      for (const m of muts) {
        if (m.type !== 'childList') continue;
        for (const n of m.addedNodes) {
          if (!n || n.nodeType !== 1) continue;
          let matches;
          try {
            matches = n.matches?.(config.selector)
              ? [n]
              : (n.querySelectorAll ? n.querySelectorAll(config.selector) : []);
          } catch (_) { continue; }
          for (const t of matches) {
            try { prescanIO.observe(t); _dbgPrescanObserved++; } catch (_) {}
          }
        }
      }
    });
    prescanMO.observe(document.body, { childList: true, subtree: true });

    SK.sendLog?.('info', 'spa', 'prescan IO started', { host: config.host, initial: _dbgPrescanObserved });
  }

  function stopPrescanObserver() {
    if (prescanIO) { try { prescanIO.disconnect(); } catch (_) {} prescanIO = null; }
    if (prescanMO) { try { prescanMO.disconnect(); } catch (_) {} prescanMO = null; }
    if (prescanScheduledTimer) { clearTimeout(prescanScheduledTimer); prescanScheduledTimer = null; }
  }

  SK._prescanDebug = function _prescanDebug() {
    return {
      active: !!prescanIO,
      observed: _dbgPrescanObserved,
      fires: _dbgPrescanFires,
      scheduled: _dbgPrescanScheduled,
      scheduledTimerArmed: !!prescanScheduledTimer,
    };
  };
  SK._startPrescanObserver = startPrescanObserver;
  SK._stopPrescanObserver = stopPrescanObserver;

  const TRANSLATED_BY_TEXT_MAX = 1000;
  SK._TRANSLATED_BY_TEXT_MAX = TRANSLATED_BY_TEXT_MAX;
  SK._recordTranslatedByText = function _recordTranslatedByText(el, savedHTML) {
    if (!STATE.translatedHTMLByText) return;
    if (!el || !savedHTML) return;
    const orig = STATE.originalText && STATE.originalText.get(el);
    if (!orig) return;
    const m = STATE.translatedHTMLByText;
    if (m.has(orig)) m.delete(orig);
    m.set(orig, savedHTML);
    while (m.size > TRANSLATED_BY_TEXT_MAX) {
      m.delete(m.keys().next().value);
    }
  };

  SK.spaByTextReuse = function spaByTextReuse(units) {
    const reused = [];
    const remaining = [];
    if (!STATE.translatedHTMLByText || STATE.translatedHTMLByText.size === 0) {
      return { reused, remaining: units.slice() };
    }
    for (const unit of units) {
      if (unit.kind !== 'element' || !unit.el || !unit.el.isConnected) {
        remaining.push(unit);
        continue;
      }
      if (unit.el.hasAttribute('data-transit-translated')) {
        continue;
      }
      const text = (unit.el.textContent || '').trim();
      const savedHTML = STATE.translatedHTMLByText.get(text);
      if (!savedHTML) { remaining.push(unit); continue; }
      STATE.translatedHTMLByText.delete(text);
      STATE.translatedHTMLByText.set(text, savedHTML);
      try {
        SK.snapshotOnce?.(unit.el);
        unit.el.innerHTML = savedHTML;
        unit.el.setAttribute('data-transit-translated', '1');
        STATE.translatedHTML.set(unit.el, savedHTML);
        STATE.originalText?.set?.(unit.el, text);
        SK._guardObserveEl?.(unit.el);
        reused.push(unit);
      } catch (_) {
        remaining.push(unit);
      }
    }
    return { reused, remaining };
  };

  SK._guardObserveEl = function _guardObserveEl(el) {
    if (!el) return;
    if (!guardIntersectionObserver) return;
    if (!el.isConnected) return;
    try { guardIntersectionObserver.observe(el); } catch (_) {   }
  };

  function stopSpaObserver() {
    if (spaObserverDebounceTimer) {
      clearTimeout(spaObserverDebounceTimer);
      spaObserverDebounceTimer = null;
    }
    if (spaObserverMaxWaitTimer) {
      clearTimeout(spaObserverMaxWaitTimer);
      spaObserverMaxWaitTimer = null;
    }
    if (contentGuardInterval) {
      clearInterval(contentGuardInterval);
      contentGuardInterval = null;
    }
    if (spaObserver) {
      spaObserver.disconnect();
      spaObserver = null;
    }
    teardownGuardIntersectionObserver();
    stopPrescanObserver();
    spaObserverRescanCount = 0;
    spaObserverSeenTexts.clear();
  }
  SK.stopSpaObserver = stopSpaObserver;

  function runContentGuard() {
    if (!STATE.translated) return;
    if (document.hidden) return;
    if (contentGuardExternallyPaused) {
      if (STATE.translatedMode !== 'dual') runContentGuardNvMutate(false, true);
      return;
    }
    if (STATE.translatedMode === 'dual') {
      runContentGuardDual(false);
      return;
    }
    if (STATE.translationCache && STATE.translationCache.size > 0) {
      runContentGuardDual(false);
    }
    runContentGuardNvMutate(false);
    let restored = 0;
    const candidates = guardVisibleSet
      ? guardVisibleSet
      : STATE.translatedHTML.keys();
    for (const el of candidates) {
      const savedHTML = STATE.translatedHTML.get(el);
      if (savedHTML == null) continue;
      if (!el.isConnected) continue;
      if (el.innerHTML === savedHTML) continue;
      if (el.getAttribute('contenteditable') === 'true') continue;
      if (!guardVisibleSet) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -500 || rect.top > window.innerHeight + 500) continue;
      }
      el.innerHTML = savedHTML;
      restored++;
    }
    if (restored > 0) {
      SK.sendLog('info', 'guard', `Content guard restored ${restored} overwritten nodes`);
    }
  }

  const NV_GUARD_INTERVENE_MAX = 8;
  const NV_GUARD_INTERVENE_DECAY_MS = 60_000;
  const nvGuardInterveneCount = new WeakMap();
  function nvGuardTryIntervene(el) {
    const now = Date.now();
    const rec = nvGuardInterveneCount.get(el);
    const n = (rec && now - rec.lastT <= NV_GUARD_INTERVENE_DECAY_MS) ? rec.n : 0;
    if (n >= NV_GUARD_INTERVENE_MAX) return false;
    nvGuardInterveneCount.set(el, { n: n + 1, lastT: now });
    return true;
  }

  function nvRevertedToOrigText(origText, curText) {
    if (!origText || !curText) return false;
    if (curText === origText) return true;
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    return norm(curText) === norm(origText);
  }

  function nvMutateRevertedToOriginal(backup, origText, curText) {
    if (!origText || !curText) return false;
    if (curText.length > origText.length * 1.3) return false;
    return backup.some(e => {
      const ov = (e && typeof e.originalValue === 'string') ? e.originalValue.trim() : '';
      return ov.length >= 4 && curText.includes(ov);
    });
  }

  function nvTextEqualsPlain(curText, plain) {
    if (!curText || !plain) return false;
    return curText.replace(/\s+/g, '') === plain.replace(/\s+/g, '');
  }

  function nvBackupIntact(backup) {
    return !!(backup && backup.length > 0 && backup.every(e =>
      e && e.node && e.node.isConnected &&
      typeof e.translatedValue === 'string' && e.node.nodeValue === e.translatedValue));
  }

  function nvReapplySaved(el, rec) {
    if (!rec) return false;
    if (rec.raw && rec.slots
        && SK.tryInjectNodeValueMutate?.(el, rec.raw, rec.slots)) return true;
    return !!(rec.plain && SK.tryInjectNodeValueMutate?.(el, rec.plain, []));
  }

  function runContentGuardNvMutate(ignoreViewport, reapplyOnly) {
    if (!STATE.nodeValueMutateBackup || STATE.nodeValueMutateBackup.size === 0) return 0;
    let reapplied = 0;
    let unmarked = 0;
    for (const [el, backup] of STATE.nodeValueMutateBackup) {
      if (!el || !el.isConnected) continue;
      if (!backup || backup.length === 0) continue;
      if (el.getAttribute?.('contenteditable') === 'true') continue;
      const origText = STATE.originalText?.get?.(el);
      const savedTranslation = STATE.nvMutateTranslation?.get?.(el);
      const curText = (el.textContent || '').trim();
      if (nvBackupIntact(backup)
          || (savedTranslation && nvTextEqualsPlain(curText, savedTranslation.plain))) continue;
      const allDetached = backup.every(entry => !entry?.node?.isConnected);
      const reverted = nvMutateRevertedToOriginal(backup, origText, curText);
      const revertedToOrig = nvRevertedToOrigText(origText, curText);
      if (!allDetached && !reverted && !revertedToOrig) continue;
      if (!ignoreViewport) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -500 || rect.top > window.innerHeight + 500) continue;
      }
      if (!nvGuardTryIntervene(el)) continue;

      if (savedTranslation && (reverted || revertedToOrig)) {
        const prevBackup = STATE.nodeValueMutateBackup.get(el);
        STATE.nodeValueMutateBackup.delete(el);
        if (nvReapplySaved(el, savedTranslation)) {
          el.setAttribute('data-transit-nodevalue-mutated', '1');
          el.setAttribute('data-transit-translated', '1');
          reapplied++;
          continue;
        }
        if (reapplyOnly) {
          STATE.nodeValueMutateBackup.set(el, prevBackup);
          continue;
        }
      } else if (reapplyOnly) {
        continue;
      }
      el.removeAttribute('data-transit-nodevalue-mutated');
      el.removeAttribute('data-transit-translated');
      STATE.nodeValueMutateBackup.delete(el);
      STATE.originalText?.delete?.(el);
      STATE.originalHTML?.delete?.(el);
      const txt = (el.innerText || '').trim();
      if (txt) spaObserverSeenTexts.delete(txt);
      unmarked++;
    }
    if (reapplied > 0 || unmarked > 0) {
      SK.sendLog('info', 'guard',
        `Content guard nv-mutate: ${reapplied} reapplied, ${unmarked} unmarked for retranslation`);
    }
    if (unmarked > 0) {
      setTimeout(() => {
        if (!STATE.translated) return;
        triggerSpaObserverRescan();
      }, 100);
    }
    return reapplied + unmarked;
  }
  SK._testRunContentGuardNvMutate = function(reapplyOnly) { return runContentGuardNvMutate(true, !!reapplyOnly); };

  function runContentGuardDual(ignoreViewport) {
    if (!STATE.translationCache || STATE.translationCache.size === 0) return 0;
    let restored = 0;
    for (const [el, info] of STATE.translationCache) {
      if (!el || !el.isConnected) continue;
      const { wrapper, insertMode } = info;
      if (!wrapper) continue;
      if (wrapper.isConnected) continue;

      if (!ignoreViewport) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom < -500 || rect.top > window.innerHeight + 500) continue;
      }

      if (insertMode === 'append') {
        el.appendChild(wrapper);
      } else if (insertMode === 'afterend-block-ancestor') {
        const blockAncestor = SK.findBlockAncestor?.(el);
        if (blockAncestor && blockAncestor !== el.ownerDocument.body) {
          const wrapperTagUpper = SK.TRANSLATION_WRAPPER_TAG.toUpperCase();
          let insertPoint = blockAncestor;
          let sib = blockAncestor.nextElementSibling;
          while (sib && sib.tagName === wrapperTagUpper) {
            insertPoint = sib;
            sib = sib.nextElementSibling;
          }
          insertPoint.insertAdjacentElement('afterend', wrapper);
        } else {
          el.insertAdjacentElement('afterend', wrapper);
        }
      } else {
        el.insertAdjacentElement('afterend', wrapper);
      }
      restored++;
    }
    if (restored > 0) {
      SK.sendLog('info', 'guard', `Content guard re-appended ${restored} dual wrappers`);
    }
    return restored;
  }

  SK.testRunContentGuard = function testRunContentGuard() {
    if (!STATE.translated) return 0;
    if (STATE.translatedMode === 'dual') {
      return runContentGuardDual(true);
    }
    let restored = 0;
    if (STATE.translationCache && STATE.translationCache.size > 0) {
      restored += runContentGuardDual(true);
    }
    for (const [el, savedHTML] of STATE.translatedHTML) {
      if (!el.isConnected) continue;
      if (el.innerHTML === savedHTML) continue;
      if (el.getAttribute('contenteditable') === 'true') continue;
      el.innerHTML = savedHTML;
      restored++;
    }
    return restored;
  };

  SK._testRunContentGuardProd = function() { runContentGuard(); };

  let _dbgMutationBatchesSeen = 0;
  let _dbgHasNewContentTrueCount = 0;
  let _dbgDebounceArmedCount = 0;
  let _dbgEarlyReturnNotTranslated = 0;
  const _scopedRescanRoots = new Set();
  const SCOPED_RESCAN_MAX_ROOTS = 300;
  function onSpaObserverMutations(mutations) {
    _dbgMutationBatchesSeen++;
    if (contentGuardExternallyPaused) return;
    if (!STATE.translated) { _dbgEarlyReturnNotTranslated++; stopSpaObserver(); return; }

    const win = typeof window !== 'undefined' ? window : null;
    const deferredRestore = () => {
      const sinceInteraction = Date.now() - (SK._lastInteractionT || 0);
      if (sinceInteraction < SK.USER_INTERACTION_BLACKOUT_MS) {
        return;
      }
      restoreOnInnerMutation(mutations);
      reapplyOnDetachReattach(mutations);
    };
    if (win && typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(deferredRestore);
    } else {
      deferredRestore();
    }

    const hadDualExpandedUnmark = detectAndUnmarkExpandedDual(mutations);
    const hadNvMutateExpandedUnmark = detectAndUnmarkExpandedNodeValueMutate(mutations);

    let _scopedQueued = false;
    for (const m of mutations) {
      if (m.type !== 'childList' || m.addedNodes.length === 0) continue;
      if (m.removedNodes.length > 0) continue;
      const t = m.target;
      if (!t || t.nodeType !== Node.ELEMENT_NODE) continue;
      if (t.closest?.('.ytp-caption-window-container, .ytp-caption-segment')) continue;
      if (!t.closest?.('[data-transit-translated]')) continue;
      for (const n of m.addedNodes) {
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        if ((n.textContent || '').trim().length <= 10) continue;
        if (n.hasAttribute('data-transit-translated')) continue;
        if (_scopedRescanRoots.size >= SCOPED_RESCAN_MAX_ROOTS) break;
        SK.refreshAncestorSavedHTML?.(n);
        _scopedRescanRoots.add(n);
        _scopedQueued = true;
      }
    }
    if (_scopedQueued) {
      _dbgDebounceArmedCount++;
      armSpaObserverRescan();
    }

    const hasNewContent = hadDualExpandedUnmark || hadNvMutateExpandedUnmark || mutations.some(m =>
      m.type === 'childList' && m.addedNodes.length > 0 &&
      !(m.target.nodeType === 1 && m.target.closest?.('[data-transit-translated]')) &&
      !(m.target.nodeType === 1 && m.target.closest?.('.ytp-caption-window-container, .ytp-caption-segment')) &&
      Array.from(m.addedNodes).some(n =>
        n.nodeType === Node.ELEMENT_NODE && n.textContent.trim().length > 10 &&
        !n.classList?.contains('ytp-caption-segment') &&
        !n.closest?.('.ytp-caption-window-container')
      )
    );
    if (!hasNewContent) return;
    _dbgHasNewContentTrueCount++;
    _dbgDebounceArmedCount++;
    armSpaObserverRescan();
  }

  // 每個 mutation target 往上找最近一個在 tracked map 裡的元素.
  function collectTrackedAncestors(mutations, tracked) {
    const candidates = new Set();
    for (const m of mutations) {
      let t = m.target;
      if (!t) continue;
      if (t.nodeType !== Node.ELEMENT_NODE) t = t.parentElement;
      while (t && t.nodeType === Node.ELEMENT_NODE) {
        if (tracked.has(t)) { candidates.add(t); break; }
        t = t.parentElement;
      }
    }
    return candidates;
  }

  function detectAndUnmarkExpandedDual(mutations) {
    if (!STATE.translationCache || STATE.translationCache.size === 0) return false;
    if (!STATE.originalText) return false;

    const candidates = collectTrackedAncestors(mutations, STATE.translationCache);
    if (candidates.size === 0) return false;

    let unmarked = 0;
    for (const el of candidates) {
      if (!el.isConnected) continue;
      if (el.getAttribute?.('contenteditable') === 'true') continue;
      const origText = STATE.originalText.get(el);
      if (!origText) continue;
      const currentText = (el.textContent || '').trim();
      if (currentText.length <= origText.length * 1.5) continue;
      if (!currentText.startsWith(origText)) continue;

      const info = STATE.translationCache.get(el);
      if (info?.wrapper) {
        try { info.wrapper.remove(); } catch (_) {}
      }
      el.removeAttribute('data-transit-dual-source');
      STATE.translationCache.delete(el);
      STATE.originalText.delete(el);
      STATE.originalHTML?.delete?.(el);
      unmarked++;
    }
    if (unmarked > 0) {
      SK.sendLog('info', 'spa', `detect-expanded-dual: ${unmarked} element(s) unmarked for retranslation`);
    }
    return unmarked > 0;
  }
  SK._detectAndUnmarkExpandedDual = detectAndUnmarkExpandedDual;

  SK._testNvMutateStubSetup = function _testNvMutateStubSetup(el, origText, backupEntries) {
    if (!STATE.nodeValueMutateBackup) STATE.nodeValueMutateBackup = new Map();
    STATE.nodeValueMutateBackup.set(el, backupEntries);
    STATE.originalText.set(el, origText);
  };

  function detectAndUnmarkExpandedNodeValueMutate(mutations) {
    if (!STATE.nodeValueMutateBackup || STATE.nodeValueMutateBackup.size === 0) return false;
    if (!STATE.originalText) return false;

    const candidates = collectTrackedAncestors(mutations, STATE.nodeValueMutateBackup);
    if (candidates.size === 0) {
      for (const [el] of STATE.nodeValueMutateBackup) {
        if (!el.isConnected) continue;
        const origText = STATE.originalText.get(el);
        if (!origText) continue;
        const curLen = (el.textContent || '').trim().length;
        if (curLen > origText.length * 1.5) {
          candidates.add(el);
        }
      }
    }
    if (candidates.size === 0) return false;

    let unmarked = 0;
    for (const el of candidates) {
      if (!el.isConnected) continue;
      if (el.getAttribute?.('contenteditable') === 'true') continue;
      const origText = STATE.originalText.get(el);
      if (!origText) continue;

      let trigger = null;

      const currentText = (el.textContent || '').trim();
      if (currentText.length > origText.length * 1.5 && currentText.startsWith(origText)) {
        trigger = 'full-reset';
      }

      if (!trigger) {
        const backup = STATE.nodeValueMutateBackup.get(el);
        if (backup && backup.length > 0) {
          for (const entry of backup) {
            if (!entry || !entry.node || !entry.node.isConnected) continue;
            if (typeof entry.translatedValue !== 'string') continue;
            if (entry.node.nodeValue !== entry.translatedValue) {
              trigger = 'partial-reset';
              break;
            }
          }
        }
      }

      if (!trigger && currentText.length > origText.length * 1.5) {
        const backup = STATE.nodeValueMutateBackup.get(el);
        if (backup && backup.length > 0) {
          const hasRetainedTranslation = backup.some(entry =>
            entry?.node?.isConnected &&
            typeof entry.translatedValue === 'string' &&
            entry.node.nodeValue === entry.translatedValue
          );
          if (hasRetainedTranslation) {
            trigger = 'expanded-content';
          }
        }
      }

      if (!trigger && !el.hasAttribute('data-transit-nodevalue-mutated')) {
        trigger = 'attr-stripped';
      }

      if (!trigger) {
        const backupE = STATE.nodeValueMutateBackup.get(el);
        if (backupE && backupE.length > 0 &&
            backupE.every(entry => !entry?.node?.isConnected)) {
          trigger = 'nodes-replaced';
        }
      }

      if (!trigger) continue;

      {
        const _saved = STATE.nvMutateTranslation?.get?.(el);
        const _cur = (el.textContent || '').trim();
        const _backupNow = STATE.nodeValueMutateBackup.get(el);
        if (_saved && _backupNow
            && (nvRevertedToOrigText(origText, _cur) || nvMutateRevertedToOriginal(_backupNow, origText, _cur))
            && nvGuardTryIntervene(el)) {
          STATE.nodeValueMutateBackup.delete(el);
          if (nvReapplySaved(el, _saved)) {
            el.setAttribute('data-transit-nodevalue-mutated', '1');
            el.setAttribute('data-transit-translated', '1');
            SK.sendLog?.('info', 'spa', `detect-expanded-nv-mutate: reapplied translation (was ${trigger})`);
            continue;
          }
        }
      }

      const _backup = STATE.nodeValueMutateBackup.get(el);
      if (_backup) {
        for (const entry of _backup) {
          if (!entry?.node?.isConnected || typeof entry.originalValue !== 'string') continue;
          if (typeof entry.translatedValue === 'string' &&
              entry.node.nodeValue !== entry.translatedValue) {
            continue;
          }
          entry.node.nodeValue = entry.originalValue;
        }
      }

      el.removeAttribute('data-transit-nodevalue-mutated');
      el.removeAttribute('data-transit-translated');
      STATE.nodeValueMutateBackup.delete(el);
      STATE.originalText.delete(el);
      STATE.originalHTML?.delete?.(el);
      unmarked++;
      SK.sendLog?.('info', 'spa', `detect-expanded-nv-mutate: unmark via ${trigger}`);
    }
    if (unmarked > 0) {
      SK.sendLog('info', 'spa', `detect-expanded-nv-mutate: ${unmarked} element(s) unmarked for retranslation`);
    }
    return unmarked > 0;
  }
  SK._detectAndUnmarkExpandedNodeValueMutate = detectAndUnmarkExpandedNodeValueMutate;

  function armSpaObserverRescan() {
    const timing = (typeof SK.getObserverTiming === 'function')
      ? SK.getObserverTiming()
      : { debounce: SK.SPA_OBSERVER_DEBOUNCE_MS, maxWait: SK.SPA_OBSERVER_MAX_WAIT_MS };
    if (spaObserverDebounceTimer) clearTimeout(spaObserverDebounceTimer);
    spaObserverDebounceTimer = setTimeout(triggerSpaObserverRescan, timing.debounce);
    if (!spaObserverMaxWaitTimer) {
      spaObserverMaxWaitTimer = setTimeout(triggerSpaObserverRescan, timing.maxWait);
    }
  }

  function triggerSpaObserverRescan() {
    if (spaObserverDebounceTimer) { clearTimeout(spaObserverDebounceTimer); spaObserverDebounceTimer = null; }
    if (spaObserverMaxWaitTimer) { clearTimeout(spaObserverMaxWaitTimer); spaObserverMaxWaitTimer = null; }
    SK._idleGateReached = false;
    SK._idleGatePromise = null;
    spaObserverRescan();
  }
  SK._armSpaObserverRescan = armSpaObserverRescan;
  SK._SPA_OBSERVER_MAX_WAIT_MS = SK.SPA_OBSERVER_MAX_WAIT_MS;

  function reapplyOnDetachReattach(mutations) {
    if (!STATE.translatedHTML || STATE.translatedHTML.size === 0) return;
    if (!STATE.originalText) return;
    const removedTrans = [];
    const addedAll = [];
    for (const m of mutations) {
      if (m.type !== 'childList') continue;
      for (const r of m.removedNodes) {
        if (r.nodeType !== Node.ELEMENT_NODE) continue;
        const savedHTML = STATE.translatedHTML.get(r);
        if (savedHTML == null) continue;
        const originalText = STATE.originalText.get(r);
        if (!originalText) continue;
        removedTrans.push({ el: r, savedHTML, originalText });
      }
      for (const a of m.addedNodes) {
        if (a.nodeType !== Node.ELEMENT_NODE) continue;
        addedAll.push(a);
      }
    }
    if (removedTrans.length === 0 || addedAll.length === 0) return;
    let restored = 0;
    for (const r of removedTrans) {
      for (const added of addedAll) {
        const addedText = (added.textContent || '').trim();
        if (addedText !== r.originalText) continue;
        try {
          added.innerHTML = r.savedHTML;
        } catch (_) { continue; }
        added.setAttribute('data-transit-translated', '1');
        STATE.translatedHTML.delete(r.el);
        STATE.translatedHTML.set(added, r.savedHTML);
        STATE.originalText.delete(r.el);
        STATE.originalText.set(added, r.originalText);
        if (STATE.originalHTML.has(r.el)) {
          STATE.originalHTML.set(added, STATE.originalHTML.get(r.el));
          STATE.originalHTML.delete(r.el);
        }
        SK._guardObserveEl?.(added);
        restored++;
        break;
      }
    }
    if (restored > 0) {
      SK.sendLog('info', 'guard', `reapply on detach+reattach: ${restored} segments`);
    }
  }
  SK._reapplyOnDetachReattach = reapplyOnDetachReattach;

  const RESTORE_COOLDOWN_MS = 200;
  const _justRestoredAt = new WeakMap();
  function restoreOnInnerMutation(mutations) {
    if (!STATE.translatedHTML || STATE.translatedHTML.size === 0) return;
    const targets = new Set();
    for (const m of mutations) {
      if (m.type !== 'childList') continue;
      const t = m.target;
      if (!t || t.nodeType !== Node.ELEMENT_NODE) continue;
      if (!STATE.translatedHTML.has(t)) continue;
      targets.add(t);
    }
    if (targets.size === 0) return;
    const now = Date.now();
    let restored = 0;
    for (const target of targets) {
      const lastTs = _justRestoredAt.get(target);
      if (lastTs != null && now - lastTs < RESTORE_COOLDOWN_MS) continue;
      const savedHTML = STATE.translatedHTML.get(target);
      if (savedHTML == null) continue;
      if (!target.isConnected) continue;
      if (target.innerHTML === savedHTML) continue;
      if (target.getAttribute('contenteditable') === 'true') continue;
      target.innerHTML = savedHTML;
      _justRestoredAt.set(target, now);
      restored++;
    }
    if (restored > 0) {
      SK.sendLog('info', 'guard', `mutation-driven restore: ${restored} segments`);
    }
  }
  SK._restoreOnInnerMutation = restoreOnInnerMutation;

  SK.refreshAncestorSavedHTML = function refreshAncestorSavedHTML(el) {
    if (!STATE.translatedHTML || STATE.translatedHTML.size === 0) return;
    if (!el || !el.parentNode) return;
    const ancestors = [];
    let a = el.parentNode;
    while (a) {
      if (STATE.translatedHTML.has(a)) ancestors.push(a);
      a = a.parentNode;
    }
    for (const ancestor of ancestors) {
      STATE.translatedHTML.set(ancestor, ancestor.innerHTML);
    }
  };

  function pickRescanToast({ done, failedCount, pageUsage, totalRequested, isTinyRescan, isConvert = false }) {
    if (failedCount > 0) {
      return { type: 'error', msg: SK.t('toast.rescanPartialFailed', { failed: failedCount, total: totalRequested }) };
    }
    if (isTinyRescan) return { type: 'silent' };
    const hasAnyCacheHit = pageUsage && pageUsage.cacheHits > 0 && done > 0;
    if (hasAnyCacheHit) return { type: 'silent' };
    return { type: 'success', msg: isConvert ? SK.t('toast.zhConvertRescanDone', { done }) : SK.t('toast.rescanDone', { done }) };
  }
  SK._pickRescanToast = pickRescanToast;

  const unitText = (unit) => SK.unitText(unit);

  function capUnitsAndMarkSeen(units, now) {
    const capped = units.length > SK.SPA_OBSERVER_MAX_UNITS;
    const kept = capped ? units.slice(0, SK.SPA_OBSERVER_MAX_UNITS) : units;
    kept.forEach(unit => spaObserverSeenTexts.set(unitText(unit), now));
    return { kept, capped };
  }
  SK._capUnitsAndMarkSeen = capUnitsAndMarkSeen;

  async function spaObserverRescan() {
    spaObserverDebounceTimer = null;
    if (!STATE.translated) {
      SK.sendLog('info', 'spa', 'SPA rescan fired but STATE.translated=false, skipping');
      return;
    }
    if (STATE.partialModeActive) {
      SK.sendLog('info', 'spa', 'partialMode: skip SPA observer rescan');
      return;
    }
    spaObserverRescanCount++;
    sweepExpiredSeenTexts(Date.now());

    let newUnits = SK.collectParagraphs();
    if (_scopedRescanRoots.size > 0) {
      const roots = [..._scopedRescanRoots];
      _scopedRescanRoots.clear();
      const seenEls = new Set(newUnits.map((u) => u.el));
      let scopedAdded = 0;
      for (const root of roots) {
        if (!root.isConnected) continue;
        if (root.hasAttribute('data-transit-translated')) continue;
        if (!root.parentElement?.closest?.('[data-transit-translated]')) continue;
        if (roots.some((r) => r !== root && r.contains && r.contains(root))) continue;
        let scoped = [];
        try { scoped = SK.collectParagraphs(root, null, { includeRoot: true }) || []; } catch (_) {   }
        for (const u of scoped) {
          if (u.el && seenEls.has(u.el)) continue;
          if (u.el) seenEls.add(u.el);
          newUnits.push(u);
          scopedAdded++;
        }
      }
      if (scopedAdded > 0) {
        SK.sendLog('info', 'spa', 'A7 scoped rescan: 已翻譯容器內晚載內容補收', { roots: roots.length, units: scopedAdded });
      }
    }
    if (STATE.translatedMode === 'dual' && SK.consolidateDualInlineUnits) {
      newUnits = SK.consolidateDualInlineUnits(newUnits);
    }
    if (newUnits.length === 0) {
      SK.sendLog('info', 'spa', `SPA rescan #${spaObserverRescanCount}: collectParagraphs returned 0 units (all already attribute-marked or filtered)`);
      return;
    }

    {
      const { reused, remaining } = SK.spaByTextReuse(newUnits);
      if (reused.length > 0) {
        SK.sendLog('info', 'spa', `SPA rescan #${spaObserverRescanCount}: by-text reuse ${reused.length} units (no API call)`);
      }
      newUnits = remaining;
      if (newUnits.length === 0) {
        SK.sendLog('info', 'spa', `SPA rescan #${spaObserverRescanCount}: all units served from by-text cache, no API`);
        return;
      }
    }

    newUnits = newUnits.filter(unit => !isSeenTextRecent(unitText(unit)));
    if (newUnits.length === 0) {
      SK.sendLog('info', 'spa', 'SPA observer rescan: all units already seen in this session, skipping');
      return;
    }
    const now = Date.now();
    const totalFound = newUnits.length;
    const { kept, capped } = capUnitsAndMarkSeen(newUnits, now);
    newUnits = kept;
    if (capped) {
      SK.sendLog('warn', 'spa', 'SPA observer rescan capped', { found: totalFound, cap: SK.SPA_OBSERVER_MAX_UNITS });
      armSpaObserverRescan();
    }

    SK.sendLog('info', 'spa', `SPA observer rescan #${spaObserverRescanCount}`, { newUnits: newUnits.length });
    const _watchdog_t0 = performance.now();
    const totalChars = newUnits.reduce((sum, u) => sum + (unitText(u).length || 0), 0);
    const isTinyRescan = newUnits.length <= 2 && totalChars < 200;
    let loadingShown = false;
    let watchdogTimer = null;
    const isConvertRescan = STATE.translationContext?.provider === 'opencc-local';
    const rescanProgressText = (d, t) => (isConvertRescan
      ? SK.t('toast.zhConvertNew', { done: d, total: t })
      : SK.t('toast.translateNew', { done: d, total: t }));
    const tryShowLoadingToast = (d, t) => {
      if (loadingShown || isTinyRescan) return;
      loadingShown = true;
      SK.showToast('loading', rescanProgressText(d, t), { progress: d / t, startTimer: true });
      watchdogTimer = setTimeout(() => {
        const diag = {
          rescanId: spaObserverRescanCount,
          dt: Math.round(performance.now() - _watchdog_t0),
          prescan: typeof SK._prescanDebug === 'function' ? SK._prescanDebug() : null,
          spa: typeof SK._spaDebug === 'function' ? SK._spaDebug() : null,
          stateTranslating: STATE.translating,
          hasAbort: !!STATE.abortController,
          newUnitsSample: newUnits.slice(0, 3).map(u => (u.el?.innerText || '').trim().slice(0, 40)),
        };
        SK.sendLog('warn', 'spa', 'rescan watchdog: 30s no progress', diag);
      }, 30000);
    };
    let _progressClosed = false;
    const _RESCAN_TIMEOUT_MS = 8000;
    try {
      const { done, failures, pageUsage } = await Promise.race([
        SK.translateUnitsByProvider(newUnits, {
          onProgress: (d, t) => {
            if (_progressClosed) return;
            tryShowLoadingToast(d, t);
            if (loadingShown) {
              SK.showToast('loading', rescanProgressText(d, t), { progress: d / t });
            }
          },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('SK_RESCAN_TIMEOUT')), _RESCAN_TIMEOUT_MS)),
      ]);
      _progressClosed = true;
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
      if (!STATE.translated) return;
      if (done > 0) {
        SK.sendLog('info', 'spa', `SPA observer rescan #${spaObserverRescanCount} done`, { done, failures: failures.length });
        const failedCount = failures.length;
        const decision = pickRescanToast({ done, failedCount, pageUsage, totalRequested: newUnits.length, isTinyRescan, isConvert: isConvertRescan });
        if (decision.type === 'silent') {
          if (loadingShown) SK.hideToast();
        } else if (decision.type === 'error') {
          SK.showToast('error', decision.msg, { stopTimer: true });
        } else {
          SK.showToast('success', decision.msg, { progress: 1, stopTimer: true, autoHideMs: 2000 });
        }
      }
    } catch (err) {
      _progressClosed = true;
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
      if (err.message === 'SK_RESCAN_TIMEOUT') {
        SK.sendLog('warn', 'spa', `SPA rescan ${_RESCAN_TIMEOUT_MS / 1000}s timeout, silent hide`, { units: newUnits.length });
        if (loadingShown) SK.hideToast();
      } else {
        SK.sendLog('warn', 'spa', 'SPA observer rescan failed', { error: err.message });
        SK.showToast('error', SK.t('toast.translateNewFailed', { error: err.message }), { stopTimer: true });
      }
    }
  }

  window.addEventListener('beforeunload', () => {
    if (STATE.translating && STATE.abortController) {
      STATE.abortController.abort();
    }
  });

})(window.__SK);
