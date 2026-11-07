(function(SK) {
  if (!SK || SK.disabled) return;

  const STATE = SK.STATE;

  SK.snapshotOnce = function snapshotOnce(el) {
    if (!STATE.originalHTML.has(el)) {
      STATE.originalHTML.set(el, el.innerHTML);
    }
    if (!STATE.originalText.has(el)) {
      STATE.originalText.set(el, (el.textContent || '').trim());
    }
    if (!STATE.originalLang.has(el)) {
      STATE.originalLang.set(el, el.hasAttribute('lang') ? el.getAttribute('lang') : null);
    }
    if (!STATE.originalFontFamily.has(el)) {
      STATE.originalFontFamily.set(el, el.style.fontFamily || '');
    }
  };

  function recordNvMutateTranslation(el, plain, raw, slots) {
    if (!el || !plain) return;
    if (!STATE.nvMutateTranslation) STATE.nvMutateTranslation = new WeakMap();
    const hasSlots = !!(raw && slots && slots.length > 0);
    STATE.nvMutateTranslation.set(el, {
      plain,
      raw: hasSlots ? raw : null,
      slots: hasSlots ? slots : null,
    });
  }

  function applyTargetLocaleStyling(el) {
    const target = STATE.targetLanguage;
    if (!target || typeof target !== 'string') return;
    el.setAttribute('lang', target);

    const localeMap = SK.LOCALE_FONT_PREPEND && SK.LOCALE_FONT_PREPEND[target];
    if (!localeMap) return;

    const doc = el.ownerDocument;
    const _langBackup = STATE.docLangBackup;
    const pageLang = SK.normalizeLangCode?.(
      _langBackup ? _langBackup.orig : doc?.documentElement?.lang,
    );
    if (!pageLang || pageLang === target) return;

    const current = el.style.fontFamily || '';
    let base = current;
    if (!base) {
      const win = el.ownerDocument?.defaultView;
      const cs = win?.getComputedStyle?.(el);
      base = cs?.fontFamily || '';
    }

    const originalForDetect = STATE.originalFontFamily.has(el)
      ? (STATE.originalFontFamily.get(el) || base)
      : base;
    const style = SK.detectFontStyle?.(originalForDetect) || 'sans-serif';
    const prepend = localeMap[style] || localeMap['sans-serif'];
    if (!prepend) return;

    const stripQuotes = (s) => s.replace(/^["']|["']$/g, '').trim();
    const firstOf = (s) => stripQuotes((s.split(',')[0] || '').trim());
    if (firstOf(current) === firstOf(prepend)) return;

    el.style.fontFamily = base ? `${prepend}, ${base}` : prepend;
  }

  SK.applyDocTargetLang = function applyDocTargetLang() {
    const target = STATE.targetLanguage;
    if (!target || typeof target !== 'string') return;
    const root = document.documentElement;
    if (!root) return;
    if (STATE.docLangBackup === undefined) {
      STATE.docLangBackup = { orig: root.hasAttribute('lang') ? root.getAttribute('lang') : null };
    }
    root.setAttribute('lang', target);
  };

  SK.restoreDocLang = function restoreDocLang() {
    if (STATE.docLangBackup === undefined) return;
    const root = document.documentElement;
    if (root) {
      if (STATE.docLangBackup.orig === null) root.removeAttribute('lang');
      else root.setAttribute('lang', STATE.docLangBackup.orig);
    }
    STATE.docLangBackup = undefined;
  };

  SK.restoreLocaleStyling = function restoreLocaleStyling(el) {
    if (STATE.originalLang.has(el)) {
      const orig = STATE.originalLang.get(el);
      if (orig === null) el.removeAttribute('lang');
      else el.setAttribute('lang', orig);
    }
    if (STATE.originalFontFamily.has(el)) {
      el.style.fontFamily = STATE.originalFontFamily.get(el);
    }
  };

  function isSerializeTransparent(child) {
    const tag = child.tagName;
    if (tag === 'CODE' || tag === 'BUTTON' || tag === 'BR') return false;
    if (SK.HARD_EXCLUDE_TAGS.has(tag)) return false;
    if (tag === 'PRE' && child.querySelector('code')) return false;
    if (SK.isMediaLikeElement(child)) return false;
    if (SK.isAtomicPreserve(child) || SK.isPreservableInline(child)) return false;
    return true;
  }

  function descendSoleTransparentWrapper(target) {
    let cur = target;
    for (let depth = 0; depth < 8; depth++) {
      let only = null;
      let blocked = false;
      for (const n of cur.childNodes) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (only) { blocked = true; break; }
          only = n;
        } else if (n.nodeType === Node.TEXT_NODE && n.nodeValue && n.nodeValue.trim()) {
          blocked = true; break;
        }
      }
      if (blocked || !only) break;
      if (!isSerializeTransparent(only)) break;
      if (!(only.textContent || '').trim()) break;
      cur = only;
    }
    return cur;
  }

  function resolveWriteTarget(el) {
    return descendSoleTransparentWrapper(resolveFontSizeTarget(el));
  }

  function resolveFontSizeTarget(el) {
    const win = el.ownerDocument?.defaultView;
    const cs = win?.getComputedStyle?.(el);
    const px = cs ? parseFloat(cs.fontSize) : NaN;
    if (Number.isFinite(px) && px < 1) {
      const walker = el.ownerDocument.createTreeWalker(
        el,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode(node) {
            if (node === el) return NodeFilter.FILTER_SKIP;
            if (SK.isPreservableInline(node) || SK.isAtomicPreserve(node)) {
              return NodeFilter.FILTER_REJECT;
            }
            const dcs = win?.getComputedStyle?.(node);
            const dpx = dcs ? parseFloat(dcs.fontSize) : NaN;
            if (Number.isFinite(dpx) && dpx >= 1) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
          },
        }
      );
      const found = walker.nextNode();
      if (found) return found;
    }
    return el;
  }

  function injectIntoTarget(target, content) {
    const isString = typeof content === 'string';

    const isHeading = /^H[1-6]$/.test(target.tagName);
    const hasContainerChild = Array.from(target.children).some(c =>
      SK.CONTAINER_TAGS.has(c.tagName));
    const textBearingChildCount = Array.from(target.children).filter(c =>
      (c.textContent || '').trim().length > 0).length;
    const hasEmptyPlaceholderChild = Array.from(target.children).some(c =>
      c.children.length > 0 && (c.textContent || '').trim().length === 0
      && !SK.isAtomicPreserve(c));
    const containsMediaOrPlaceholder = SK.containsMedia(target) || hasEmptyPlaceholderChild;
    const contentHasMedia = !isString && SK.containsMediaLike(content);
    if (containsMediaOrPlaceholder && !contentHasMedia && textBearingChildCount <= 1
        && (isHeading || !hasContainerChild || hasEmptyPlaceholderChild)) {
      if (!isString) {
        let fragHasBr = false;
        const fw = document.createTreeWalker(content, NodeFilter.SHOW_ELEMENT);
        let fn;
        while ((fn = fw.nextNode())) {
          if (fn.tagName === 'BR') { fragHasBr = true; break; }
        }
        if (fragHasBr) {
          const oldBrs = target.querySelectorAll('br');
          for (const br of oldBrs) if (br.parentNode) br.parentNode.removeChild(br);
        }
      }
      const node = isString ? target.ownerDocument.createTextNode(content) : content;
      const textNodes = SK.collectVisibleTextNodes(target);
      if (textNodes.length === 0) {
        target.appendChild(node);
        return;
      }
      const main = SK.findLongestTextNode(textNodes);
      for (const t of textNodes) {
        if (t === main) continue;
        t.nodeValue = '';
        let p = t.parentNode;
        while (p && p !== target) {
          if (p.textContent.trim() === '' && !SK.containsMedia(p)) {
            const gp = p.parentNode;
            if (!gp) break;
            gp.removeChild(p);
            p = gp;
          } else {
            break;
          }
        }
      }
      const parent = main.parentNode;
      if (parent) {
        parent.insertBefore(node, main);
        parent.removeChild(main);
      } else {
        target.appendChild(node);
      }
      return;
    }

    const isMediaOnlyNode = (n) => n.nodeType === Node.ELEMENT_NODE
      && !SK.hasTextOutsideSvg(n)
      && SK.containsMediaLike(n);
    const countMediaLike = (root) => Array.from(root.querySelectorAll('*'))
      .filter(SK.isMediaLikeElement).length;
    const contentCoversMedia = contentHasMedia
      && countMediaLike(content) >= countMediaLike(target);
    const node = isString ? target.ownerDocument.createTextNode(content) : content;
    let insertRef = null;
    let removedAny = false;
    for (const child of Array.from(target.childNodes)) {
      if (!contentCoversMedia && isMediaOnlyNode(child)) {
        if (removedAny && !insertRef) insertRef = child;
        continue;
      }
      target.removeChild(child);
      removedAny = true;
    }
    target.insertBefore(node, insertRef);
  }

  function buildFragmentFromTextWithBr(text) {
    const frag = document.createDocumentFragment();
    const parts = text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) frag.appendChild(document.createTextNode(parts[i]));
      if (i < parts.length - 1) frag.appendChild(document.createElement('br'));
    }
    return frag;
  }

  function plainTextFallback(el, cleaned) {
    if (cleaned && cleaned.includes('\n')) {
      const frag = buildFragmentFromTextWithBr(cleaned);
      replaceNodeInPlace(el, frag);
      return;
    }
    const target = resolveWriteTarget(el);
    injectIntoTarget(target, cleaned);
  }

  function replaceTextInPlace(el, translation) {
    if (translation && translation.includes('\n')) {
      const frag = buildFragmentFromTextWithBr(translation);
      replaceNodeInPlace(el, frag);
      return;
    }
    const target = resolveWriteTarget(el);
    injectIntoTarget(target, translation);
  }

  function replaceNodeInPlace(el, frag) {
    const target = resolveWriteTarget(el);
    injectIntoTarget(target, frag);
  }

  function tryRecoverLinkSlots(el, text, slots) {
    const linkSlotIdxs = [];
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s && s.nodeType === Node.ELEMENT_NODE && s.tagName === 'A') {
        linkSlotIdxs.push(i);
      }
    }
    if (linkSlotIdxs.length === 0) return null;

    const originalAnchors = Array.from(el.querySelectorAll('a'));

    let remaining = text;
    const parts = [];
    let anyFound = false;
    let slotPtr = 0;

    for (const anchor of originalAnchors) {
      const linkText = (anchor.textContent || '').trim();
      if (linkText.length < 2) continue;
      const pos = remaining.indexOf(linkText);
      if (pos === -1) continue;

      const matchIdx = linkSlotIdxs[slotPtr];
      if (matchIdx === undefined) continue;

      if (pos > 0) parts.push({ type: 'text', content: remaining.slice(0, pos) });
      parts.push({ type: 'link', content: linkText, slotIdx: matchIdx });
      remaining = remaining.slice(pos + linkText.length);
      anyFound = true;
      slotPtr++;
    }

    if (!anyFound) return null;
    if (remaining) parts.push({ type: 'text', content: remaining });

    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (part.type === 'text') {
        if (part.content) frag.appendChild(document.createTextNode(part.content));
      } else {
        const shell = slots[part.slotIdx].cloneNode(false);
        shell.appendChild(document.createTextNode(part.content));
        frag.appendChild(shell);
      }
    }
    return frag;
  }

  function _revertEcho(el, translation) {
    var origHTML = STATE.originalHTML.get(el);
    var nvBackup = STATE.nodeValueMutateBackup?.get(el);
    if (nvBackup && nvBackup.length > 0) {
      for (var bi = 0; bi < nvBackup.length; bi++) {
        var b = nvBackup[bi];
        if (b && b.node && b.node.nodeValue !== b.originalValue) b.node.nodeValue = b.originalValue;
      }
    } else if (origHTML != null && el.innerHTML !== origHTML) {
      el.innerHTML = origHTML;
    }
    var origLang = STATE.originalLang.get(el);
    if (origLang === null) el.removeAttribute('lang');
    else if (origLang != null) el.setAttribute('lang', origLang);
    el.removeAttribute('data-transit-nodevalue-mutated');
    var origFont = STATE.originalFontFamily.get(el);
    if (origFont != null) el.style.fontFamily = origFont;
    el.setAttribute('data-transit-translated', '1');
    STATE.nodeValueMutateBackup?.delete(el);
    STATE.nvMutateTranslation?.delete?.(el);
    SK._recordTranslatedByText?.(el, el.innerHTML);
    SK.sendLog('warn', 'inject', 'echo detected: translation identical to source, marked translated (rescan will not re-send)',
      { text: (el.textContent || '').substring(0, 80),
        translationHead: (translation || '').substring(0, 80) });
  }

  const ANNOTATED_TARGET_RE = /^(.+)（(.+)）\s*$/;
  const AD_CJK_EDGE_RE = /[㐀-鿿豈-﫿]/;
  const AD_LATIN_EDGE_RE = /[A-Za-z0-9]/;

  function _adSplice(text, start, end, keep) {
    const before = text.slice(0, start);
    const after = text.slice(end);
    let mid = keep;
    if (before && AD_CJK_EDGE_RE.test(before[before.length - 1]) && AD_LATIN_EDGE_RE.test(mid[0] || '')) {
      mid = ' ' + mid;
    }
    if (after && AD_LATIN_EDGE_RE.test(mid[mid.length - 1] || '') && AD_CJK_EDGE_RE.test(after[0])) {
      mid = mid + ' ';
    }
    return before + mid + after;
  }

  SK.setAnnotationDedupeRules = function setAnnotationDedupeRules(glossary) {
    if (STATE._annotationDedupeSrc === glossary) return;
    STATE._annotationDedupeSrc = glossary || null;
    const rules = [];
    for (const e of glossary || []) {
      if (!e || typeof e.target !== 'string' || typeof e.source !== 'string') continue;
      const m = e.target.match(ANNOTATED_TARGET_RE);
      if (!m) continue;
      const stripTitle = (s) => {
        const t = s.trim();
        const w = t.match(/^《(.+)》$/);
        return w ? w[1].trim() : t;
      };
      const src = stripTitle(e.source);
      const keep = (src && stripTitle(m[1]) === src) ? m[2] : m[1];
      if (!keep) continue;
      rules.push({ full: e.target, keep, seen: false, keptEl: null });
    }
    STATE._annotationDedupeRules = rules.length > 0 ? rules : null;
  };

  SK.clearAnnotationDedupeRules = function clearAnnotationDedupeRules() {
    STATE._annotationDedupeRules = null;
    STATE._annotationDedupeSrc = null;
  };

  SK.trimAnnotationDedupe = function trimAnnotationDedupe(translation, holderEl) {
    const rules = STATE._annotationDedupeRules;
    if (!rules || typeof translation !== 'string' || !translation) return translation;
    let out = translation;
    for (const rule of rules) {
      if (!out.includes(rule.full)) continue;
      const isKeeperEl = !rule.seen || (holderEl != null && rule.keptEl === holderEl);
      let keptThisString = false;
      let from = 0;
      while (true) {
        const idx = out.indexOf(rule.full, from);
        if (idx === -1) break;
        if (isKeeperEl && !keptThisString) {
          keptThisString = true;
          rule.seen = true;
          if (holderEl != null) rule.keptEl = holderEl;
          from = idx + rule.full.length;
          continue;
        }
        out = _adSplice(out, idx, idx + rule.full.length, rule.keep);
        rule.seen = true;
        from = idx + rule.keep.length + 2;
      }
    }
    return out;
  };

  SK.injectTranslation = function injectTranslation(unit, translation, slots) {
    if (!translation) return;
    if (translation.includes('\\n')) translation = translation.replace(/\\n/g, '\n');

    if ((!slots || slots.length === 0) && typeof translation === 'string'
        && SK.stripStrayPlaceholderMarkers) {
      translation = SK.stripStrayPlaceholderMarkers(translation);
    }

    if (typeof translation === 'string' && STATE._annotationDedupeRules) {
      translation = SK.trimAnnotationDedupe(translation, unit.el || null);
    }

    if (SK.isWrongLanguageOutput && SK.isWrongLanguageOutput(translation, SK.STATE?.targetLanguage)) {
      return;
    }

    var _preText = (unit.kind !== 'fragment' && unit.el)
      ? (unit.el.textContent || '').trim() : null;

    if (unit.el && unit.el.nodeType === 1 && typeof translation === 'string'
        && STATE.translatedMode !== 'dual') {
      var _cs = unit.el.ownerDocument?.defaultView?.getComputedStyle?.(unit.el);
      if (_cs && _cs.display.startsWith('inline')) {
        if (!/\s$/.test(translation)) {
          var _next = unit.el.nextSibling;
          while (_next && _next.nodeType === 3 && !_next.nodeValue?.trim()) _next = _next.nextSibling;
          if (_next && _next.nodeType === 1) translation += ' ';
        }
        if (!/^\s/.test(translation)) {
          var _prev = unit.el.previousSibling;
          while (_prev && _prev.nodeType === 3 && !_prev.nodeValue?.trim()) _prev = _prev.previousSibling;
          if (_prev && _prev.nodeType === 1) translation = ' ' + translation;
        }
      }
    }

    if (unit && unit.el && unit.el.parentElement) {
      let anc = unit.el.parentElement;
      while (anc && anc !== document.body) {
        if (anc.hasAttribute && anc.hasAttribute('data-transit-nodevalue-mutated')) return;
        anc = anc.parentElement;
      }
    }

    if (STATE.translatedMode !== 'dual' && unit.el && unit.el.nodeType === 1) {
      if (unit.el.closest && unit.el.closest('[data-transit-dual-source]')) return;
      if (unit.kind !== 'fragment' && unit.el.querySelector && unit.el.querySelector('[data-transit-dual-source]')) return;
    }

    if (STATE.translatedMode === 'dual' && unit.kind !== 'fragment' && SK.injectDual) {
      SK.injectDual(unit, translation, slots);
      return;
    }

    // 雙語模式下, 已有譯文 wrapper 的元素內不可再就地替換 fragment, 否則原文會被譯文覆蓋.
    if (STATE.translatedMode === 'dual' && unit.kind === 'fragment'
        && unit.startNode?.parentElement?.closest?.('[data-transit-dual-source]')) {
      return;
    }

    if (STATE.translatedMode !== 'dual' && unit.kind !== 'fragment'
        && SK.injectDual && SK.isFrameworkManaged?.(unit.el)) {
      if (unit.el.hasAttribute) {
        if (unit.el.hasAttribute('data-transit-translated')
            || unit.el.hasAttribute('data-transit-dual-source')
            || unit.el.hasAttribute('data-transit-nodevalue-mutated')) return;
        let anc = unit.el.parentElement;
        while (anc && anc !== document.body) {
          if (anc.hasAttribute && (
            anc.hasAttribute('data-transit-translated') ||
            anc.hasAttribute('data-transit-dual-source') ||
            anc.hasAttribute('data-transit-nodevalue-mutated')
          )) return;
          anc = anc.parentElement;
        }
        if (unit.el.querySelector && unit.el.querySelector(
          '[data-transit-translated], [data-transit-dual-source], [data-transit-nodevalue-mutated]'
        )) return;
      }

      SK.snapshotOnce(unit.el);

      if (SK.tryInjectNodeValueMutate?.(unit.el, translation, slots)) {
        if (_preText != null && (unit.el.textContent || '').trim() === _preText) {
          _revertEcho(unit.el, translation); return;
        }
        unit.el.setAttribute('data-transit-nodevalue-mutated', '1');
        unit.el.setAttribute('data-transit-translated', '1');
        SK._recordTranslatedByText?.(unit.el, unit.el.innerHTML);
        recordNvMutateTranslation(unit.el,
          slots && slots.length > 0 && SK.stripStrayPlaceholderMarkers
            ? SK.stripStrayPlaceholderMarkers(translation).trim()
            : translation,
          translation, slots);
        return;
      }

      if (slots && slots.length > 0 && SK.stripStrayPlaceholderMarkers
          && slots.every(s => s && s.nodeType === Node.ELEMENT_NODE
            && !s.atomic && !s.reuseNode)) {
        const plainTranslation = SK.stripStrayPlaceholderMarkers(translation).trim();
        let a35AnchorsOk = true;
        if (unit.el.querySelector && unit.el.querySelector('a')) {
          const tns0 = SK.collectVisibleTextNodes?.(unit.el) || [];
          a35AnchorsOk = tns0.length > 0
            && !(tns0[0].parentElement && tns0[0].parentElement.closest('a'));
        }
        if (plainTranslation && a35AnchorsOk && SK.tryInjectNodeValueMutate?.(unit.el, plainTranslation, [])) {
          if (_preText != null && (unit.el.textContent || '').trim() === _preText) {
            _revertEcho(unit.el, translation); return;
          }
          unit.el.setAttribute('data-transit-nodevalue-mutated', '1');
          unit.el.setAttribute('data-transit-translated', '1');
          SK._recordTranslatedByText?.(unit.el, unit.el.innerHTML);
          recordNvMutateTranslation(unit.el, plainTranslation);
          SK.sendLog('info', 'inject', 'A3.5 plain-text nv-mutate fallback (styling-only / prose-link slots)',
            { text: (unit.el.textContent || '').substring(0, 60) });
          return;
        }
      }

      SK.ensureDualWrapperStyle?.();
      SK.injectDual(unit, translation, slots);
      return;
    }

    if (unit.kind === 'fragment') {
      return injectFragmentTranslation(unit, translation, slots);
    }
    const el = unit.el;
    SK.snapshotOnce(el);

    if (slots && slots.length > 0) {
      const { frag, ok } = SK.deserializeWithPlaceholders(translation, slots);
      if (ok) {
        replaceNodeInPlace(el, frag);
      } else {
        const cleaned = SK.stripStrayPlaceholderMarkers(translation);
        const recovered = tryRecoverLinkSlots(el, cleaned, slots);
        if (recovered) {
          replaceNodeInPlace(el, recovered);
        } else {
          plainTextFallback(el, cleaned);
        }
      }
    } else {
      replaceTextInPlace(el, translation);
    }

    if (_preText != null && (el.textContent || '').trim() === _preText) {
      _revertEcho(el, translation); return;
    }
    el.setAttribute('data-transit-translated', '1');
    applyTargetLocaleStyling(el);
    STATE.translatedHTML.set(el, el.innerHTML);
    SK.refreshAncestorSavedHTML?.(el);
    SK._guardObserveEl?.(el);
    SK._recordTranslatedByText?.(el, el.innerHTML);
  };

  function injectFragmentTranslation(unit, translation, slots) {
    if (!translation) return;
    const { el, startNode, endNode } = unit;

    if (!startNode || startNode.parentNode !== el) return;

    SK.snapshotOnce(el);

    let newContent;
    if (slots && slots.length > 0) {
      const { frag, ok } = SK.deserializeWithPlaceholders(translation, slots);
      if (ok) {
        newContent = frag;
      } else {
        const cleaned = SK.stripStrayPlaceholderMarkers(translation);
        newContent = cleaned.includes('\n')
          ? buildFragmentFromTextWithBr(cleaned)
          : document.createTextNode(cleaned);
      }
    } else {
      if (translation.includes('\n')) {
        newContent = buildFragmentFromTextWithBr(translation);
      } else {
        newContent = document.createTextNode(translation);
      }
    }

    const anchor = (endNode && endNode.parentNode === el) ? endNode.nextSibling : null;
    const toRemove = [];
    let cur = startNode;
    while (cur) {
      toRemove.push(cur);
      if (cur === endNode) break;
      cur = cur.nextSibling;
    }
    for (const n of toRemove) {
      if (n.parentNode === el) el.removeChild(n);
    }
    el.insertBefore(newContent, anchor);
    el.setAttribute('data-transit-translated', '1');
    applyTargetLocaleStyling(el);
    STATE.translatedHTML.set(el, el.innerHTML);
    SK.refreshAncestorSavedHTML?.(el);
    SK._guardObserveEl?.(el);
  }

  SK._resolveWriteTarget = resolveWriteTarget;
  SK._injectIntoTarget = injectIntoTarget;

  function getVisibleText(el) {
    const win = el.ownerDocument?.defaultView;
    if (!win) return el.textContent || '';
    let text = '';
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const selfHiddenMemo = new Map();
    const isSelfHidden = (p) => {
      const hit = selfHiddenMemo.get(p);
      if (hit !== undefined) return hit;
      let h = false;
      const cs = win.getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden') h = true;
      else {
        if (cs.position === 'absolute') {
          const r = p.getBoundingClientRect();
          if (r.width <= 1 && r.height <= 1) h = true;
        }
        if (!h) {
          const r2 = p.getBoundingClientRect();
          if (r2.width === 0 && r2.height === 0) h = true;
        }
      }
      selfHiddenMemo.set(p, h);
      return h;
    };
    let n;
    while ((n = walker.nextNode())) {
      let p = n.parentElement;
      let hidden = false;
      while (p && p !== el.parentElement) {
        if (isSelfHidden(p)) { hidden = true; break; }
        p = p.parentElement;
      }
      if (!hidden) text += n.nodeValue || '';
    }
    return text;
  }

  SK._getVisibleText = getVisibleText;

  function findBlockAncestor(el) {
    const win = el.ownerDocument?.defaultView;
    const selfCs = win?.getComputedStyle?.(el);
    if (selfCs && SK.BLOCK_DISPLAY_VALUES.has(selfCs.display)) return el;
    let cur = el.parentElement;
    while (cur && cur !== el.ownerDocument.body) {
      const cs = win?.getComputedStyle?.(cur);
      if (cs && SK.BLOCK_DISPLAY_VALUES.has(cs.display)) return cur;
      cur = cur.parentElement;
    }
    return cur;
  }
  SK.findBlockAncestor = findBlockAncestor;

  function buildDualInner(originalTag, originalEl, translation, slots) {
    let innerTag;
    if (/^H[1-6]$/.test(originalTag)) {
      innerTag = 'div';
    } else if (originalTag === 'LI' || originalTag === 'TD' || originalTag === 'TH') {
      innerTag = 'div';
    } else if (originalTag === 'PRE') {
      innerTag = 'div';
    } else if (SK.BLOCK_TAGS_SET.has(originalTag) || originalTag === 'DIV' || originalTag === 'SECTION' || originalTag === 'ARTICLE' || originalTag === 'MAIN' || originalTag === 'ASIDE') {
      innerTag = originalTag.toLowerCase();
    } else {
      innerTag = 'div';
    }
    const inner = document.createElement(innerTag);

    const win = originalEl.ownerDocument?.defaultView;
    const cs = win?.getComputedStyle?.(originalEl);
    if (cs) {
      if (cs.fontFamily && originalTag !== 'PRE') inner.style.fontFamily = cs.fontFamily;
      if (cs.fontSize)      inner.style.fontSize      = cs.fontSize;
      if (cs.fontWeight)    inner.style.fontWeight    = cs.fontWeight;
      if (cs.lineHeight)    inner.style.lineHeight    = cs.lineHeight;
      if (cs.letterSpacing) inner.style.letterSpacing = cs.letterSpacing;
      if (cs.color)         inner.style.color         = cs.color;
    }

    inner.style.padding = '0';
    inner.style.margin = '0';

    applyTargetLocaleStyling(inner);

    if (slots && slots.length > 0) {
      const result = SK.deserializeWithPlaceholders(translation, slots, { cloneReuse: true });
      if (result.ok) {
        inner.appendChild(result.frag);
      } else {
        const cleaned = SK.stripStrayPlaceholderMarkers(translation);
        const recovered = tryRecoverLinkSlots(originalEl, cleaned, slots);
        if (recovered) {
          inner.appendChild(recovered);
        } else {
          inner.appendChild(document.createTextNode(cleaned));
        }
      }
    } else if (translation.includes('\n')) {
      inner.appendChild(buildFragmentFromTextWithBr(translation));
    } else {
      inner.appendChild(document.createTextNode(translation));
    }
    return inner;
  }

  function findExistingWrapperAtInsertionPoint(original, tag, translation) {
    const wrapperTagUpper = SK.TRANSLATION_WRAPPER_TAG.toUpperCase();
    const winDoc = original.ownerDocument;
    let candidate = null;
    if (tag === 'LI' || tag === 'TD' || tag === 'TH') {
      candidate = original.lastElementChild;
    } else if (
      SK.BLOCK_TAGS_SET.has(tag) ||
      tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'ASIDE'
    ) {
      candidate = original.nextElementSibling;
    } else {
      const blockAncestor = findBlockAncestor(original);
      const anchor = (blockAncestor && blockAncestor !== winDoc.body) ? blockAncestor : original;
      const expected = (SK.stripStrayPlaceholderMarkers
        ? SK.stripStrayPlaceholderMarkers(translation)
        : translation).trim();
      let sib = anchor.nextElementSibling;
      while (sib && sib.tagName === wrapperTagUpper) {
        if (sib.textContent.trim() === expected) return sib;
        sib = sib.nextElementSibling;
      }
      return null;
    }
    if (!candidate || candidate.tagName !== wrapperTagUpper) return null;
    const expected = (SK.stripStrayPlaceholderMarkers
      ? SK.stripStrayPlaceholderMarkers(translation)
      : translation).trim();
    if (candidate.textContent.trim() !== expected) return null;
    return candidate;
  }

  function detectThemeForElement(el) {
    const win = el.ownerDocument?.defaultView;
    if (!win) return 'light';
    let node = el;
    while (node && node !== el.ownerDocument.documentElement) {
      const cs = win.getComputedStyle(node);
      const m = cs.backgroundColor && cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map(s => parseFloat(s.trim()));
        const [r, g, b, a] = [parts[0], parts[1], parts[2], parts.length === 4 ? parts[3] : 1];
        if (a > 0.5 && [r, g, b].every(n => Number.isFinite(n))) {
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          return luma < 128 ? 'dark' : 'light';
        }
      }
      node = node.parentElement;
    }
    const rootCs = win.getComputedStyle(el.ownerDocument.documentElement);
    const m2 = rootCs.backgroundColor && rootCs.backgroundColor.match(/rgba?\(([^)]+)\)/);
    if (m2) {
      const parts = m2[1].split(',').map(s => parseFloat(s.trim()));
      const [r, g, b, a] = [parts[0], parts[1], parts[2], parts.length === 4 ? parts[3] : 1];
      if (a > 0.5 && [r, g, b].every(n => Number.isFinite(n))) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        return luma < 128 ? 'dark' : 'light';
      }
    }
    return 'light';
  }
  SK._detectThemeForElement = detectThemeForElement;

  function neutralizeInheritedFlip(wrapper) {
    const win = wrapper.ownerDocument?.defaultView;
    if (!win) return;
    const root = wrapper.ownerDocument.documentElement;
    let netA = 1, netD = 1;
    let node = wrapper.parentElement;
    while (node && node !== root) {
      const t = win.getComputedStyle(node).transform;
      if (t && t !== 'none') {
        const m = /^matrix\(([^)]+)\)$/.exec(t);
        if (!m) return;
        const p = m[1].split(',').map(Number);
        const [a, b, c, d] = p;
        if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) return;
        netA *= a; netD *= d;
      }
      node = node.parentElement;
    }
    if (netA >= 0 && netD >= 0) return;
    const parts = [];
    if (netA < 0) parts.push('scaleX(-1)');
    if (netD < 0) parts.push('scaleY(-1)');
    wrapper.style.transform = parts.join(' ');
  }
  SK._neutralizeInheritedFlip = neutralizeInheritedFlip;

  SK.injectDual = function injectDual(unit, translation, slots) {
    if (!translation) return;
    if (unit.kind === 'fragment') {
      return injectFragmentTranslation(unit, translation, slots);
    }
    const original = unit.el;
    if (!original || !original.parentNode) return;
    if (original.hasAttribute('data-transit-dual-source')) return;

    let anc = original.parentElement;
    while (anc && anc !== original.ownerDocument.body) {
      if (anc.hasAttribute && anc.hasAttribute('data-transit-dual-source')) return;
      anc = anc.parentElement;
    }
    if (original.querySelector && original.querySelector('[data-transit-dual-source]')) return;

    const tag = original.tagName;

    const existingWrapper = findExistingWrapperAtInsertionPoint(original, tag, translation);
    if (existingWrapper) {
      for (const [oldKey, info] of STATE.translationCache) {
        if (info.wrapper === existingWrapper) {
          STATE.translationCache.delete(oldKey);
          STATE.translationCache.set(original, info);
          SK._guardObserveEl?.(original);
          break;
        }
      }
      original.setAttribute('data-transit-dual-source', '1');
      return;
    }

    const normalizeWs = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const originalText = normalizeWs(getVisibleText(original));
    let translationText;
    if (slots && slots.length > 0 && translation) {
      const dsResult = SK.deserializeWithPlaceholders(translation, slots, { cloneReuse: true });
      translationText = dsResult.ok
        ? (dsResult.frag.textContent || '')
        : (SK.stripStrayPlaceholderMarkers ? SK.stripStrayPlaceholderMarkers(translation) : translation);
    } else {
      translationText = SK.stripStrayPlaceholderMarkers
        ? SK.stripStrayPlaceholderMarkers(translation || '')
        : (translation || '');
    }
    const translationStripped = normalizeWs(translationText);
    if (originalText && translationStripped === originalText) {
      original.setAttribute('data-transit-dual-source', '1');
      return;
    }

    const NUMERIC_METRIC_RE = /^[\d.\s,KMB%+\-]+$/;
    if (originalText.length > 0 && originalText.length < 30 && NUMERIC_METRIC_RE.test(originalText)) {
      original.setAttribute('data-transit-dual-source', '1');
      return;
    }

    if (originalText.length >= 5 && originalText.length <= 200
        && translationStripped.length > originalText.length * 5) {
      original.setAttribute('data-transit-dual-source', '1');
      return;
    }

    SK.snapshotOnce(original);

    const inner = buildDualInner(tag, original, translation, slots);
    const wrapper = original.ownerDocument.createElement(SK.TRANSLATION_WRAPPER_TAG);
    const mark = SK.currentMarkStyle && SK.VALID_MARK_STYLES.has(SK.currentMarkStyle)
      ? SK.currentMarkStyle
      : SK.DEFAULT_MARK_STYLE;
    wrapper.setAttribute('data-sk-mark', mark);
    wrapper.setAttribute('data-sk-theme', detectThemeForElement(original));
    const rgb = SK.dualAccentToRgb?.(SK.currentDualAccent);
    if (rgb) {
      wrapper.setAttribute('data-sk-accent', 'custom');
      wrapper.style.setProperty('--sk-accent-rgb', `${rgb.r} ${rgb.g} ${rgb.b}`);
    }
    wrapper.appendChild(inner);

    const winLayout = original.ownerDocument?.defaultView;
    const csLayout = winLayout?.getComputedStyle?.(original);
    const isNonZero = (v) => v && v !== '0px';
    if (csLayout) {
      if (isNonZero(csLayout.marginLeft))   wrapper.style.marginLeft   = csLayout.marginLeft;
      if (isNonZero(csLayout.marginRight))  wrapper.style.marginRight  = csLayout.marginRight;
      if (isNonZero(csLayout.paddingLeft))  wrapper.style.paddingLeft  = csLayout.paddingLeft;
      if (isNonZero(csLayout.paddingRight)) wrapper.style.paddingRight = csLayout.paddingRight;
      if (csLayout.maxWidth && csLayout.maxWidth !== 'none') wrapper.style.maxWidth = csLayout.maxWidth;

      const isAppendMode = (tag === 'LI' || tag === 'TD' || tag === 'TH');
      if (!isAppendMode) {
        const pb = parseFloat(csLayout.paddingBottom) || 0;
        const mb = parseFloat(csLayout.marginBottom)  || 0;
        if (pb > 0) wrapper.style.marginTop = `-${pb}px`;
        if (pb + mb > 0) wrapper.style.marginBottom = `${pb + mb}px`;
      }
    }

    let insertMode;
    if (tag === 'LI' || tag === 'TD' || tag === 'TH') {
      original.appendChild(wrapper);
      insertMode = 'append';
    } else if (
      SK.BLOCK_TAGS_SET.has(tag) ||
      tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'ASIDE'
    ) {
      original.insertAdjacentElement('afterend', wrapper);
      insertMode = 'afterend';
    } else {
      const blockAncestor = findBlockAncestor(original);
      if (blockAncestor && blockAncestor !== original.ownerDocument.body) {
        const wrapperTagUpper = SK.TRANSLATION_WRAPPER_TAG.toUpperCase();
        let insertPoint = blockAncestor;
        let sib = blockAncestor.nextElementSibling;
        while (sib && sib.tagName === wrapperTagUpper) {
          insertPoint = sib;
          sib = sib.nextElementSibling;
        }
        insertPoint.insertAdjacentElement('afterend', wrapper);
        insertMode = 'afterend-block-ancestor';
      } else {
        original.insertAdjacentElement('afterend', wrapper);
        insertMode = 'afterend';
      }
    }

    neutralizeInheritedFlip(wrapper);

    original.setAttribute('data-transit-dual-source', '1');
    STATE.translationCache.set(original, { wrapper, insertMode });
    SK._guardObserveEl?.(original);
  };

  function extractA3Seq(rootEl, imgIsInline = false) {
    const seq = [];
    for (const child of rootEl.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.nodeValue && child.nodeValue.trim()) {
          seq.push({ type: 'text', node: child });
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (imgIsInline && child.tagName === 'IMG') {
        seq.push({ type: 'inline', node: child, tag: 'IMG' });
        continue;
      }
      if (SK.isPreservableInline?.(child)) {
        seq.push({ type: 'inline', node: child, tag: child.tagName });
      } else {
        const inner = extractA3Seq(child, imgIsInline);
        for (const item of inner) seq.push(item);
      }
    }
    return seq;
  }

  function extractA3SeqSpanUnwrapped(rootEl, imgIsInline = false) {
    const seq = [];
    for (const child of rootEl.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.nodeValue && child.nodeValue.trim()) {
          seq.push({ type: 'text', node: child });
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (imgIsInline && child.tagName === 'IMG') {
        seq.push({ type: 'inline', node: child, tag: 'IMG' });
        continue;
      }
      if (child.tagName === 'SPAN') {
        const inner = extractA3SeqSpanUnwrapped(child, imgIsInline);
        for (const item of inner) seq.push(item);
      } else if (SK.isPreservableInline?.(child)) {
        seq.push({ type: 'inline', node: child, tag: child.tagName });
      } else {
        const inner = extractA3SeqSpanUnwrapped(child, imgIsInline);
        for (const item of inner) seq.push(item);
      }
    }
    return seq;
  }

  function targetContainerToText(targetContainer) {
    let s = '';
    for (const child of targetContainer.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        s += child.nodeValue;
      } else if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'BR') {
        s += '\n';
      }
    }
    return s;
  }

  function targetContainerHasBr(container) {
    if (!container || !container.childNodes) return false;
    for (const child of container.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'BR') return true;
    }
    return false;
  }

  function preserveWsTextMutate(srcVal, tgtVal) {
    const srcLead = (srcVal.match(/^\s+/) || [''])[0];
    const srcTrail = (srcVal.match(/\s+$/) || [''])[0];
    const tgtLead = ((tgtVal || '').match(/^\s+/) || [''])[0];
    const tgtTrail = ((tgtVal || '').match(/\s+$/) || [''])[0];
    const tgtStripped = (tgtVal || '').replace(/^\s+|\s+$/g, '');
    return (tgtLead || srcLead) + tgtStripped + (tgtTrail || srcTrail);
  }

  function collectA3Mutations(sourceContainer, targetContainer, mutations) {
    const imgIsInline = !!targetContainer.querySelector?.('img');
    const sourceSeq = extractA3Seq(sourceContainer, imgIsInline);
    const targetSeq = extractA3Seq(targetContainer, imgIsInline);
    if (sourceSeq.length === 1 && sourceSeq[0].type === 'text' &&
        targetSeq.every(t => t.type === 'text')) {
      const sourceHasNewline = /\n/.test(sourceSeq[0].node.nodeValue || '');
      if (targetSeq.length > 1
          || (targetSeq.length >= 1 && sourceHasNewline && targetContainerHasBr(targetContainer))) {
        mutations.push({
          node: sourceSeq[0].node,
          newValue: targetContainerToText(targetContainer),
        });
        return true;
      }
    }
    const sourceAllInline = sourceSeq.length > 0 && sourceSeq.every(s => s.type === 'inline');
    if (sourceAllInline && targetSeq.length !== sourceSeq.length) {
      const tightened = [];
      let prepend = '';
      for (const item of targetSeq) {
        if (item.type === 'text') {
          prepend += item.node.nodeValue || '';
        } else {
          tightened.push({ inline: item, prepend });
          prepend = '';
        }
      }
      if (tightened.length === sourceSeq.length) {
        let allTagOk = true;
        for (let i = 0; i < sourceSeq.length; i++) {
          if (sourceSeq[i].tag !== tightened[i].inline.tag) { allTagOk = false; break; }
        }
        if (allTagOk) {
          for (let i = 0; i < sourceSeq.length; i++) {
            const s = sourceSeq[i];
            const t = tightened[i].inline;
            const pre = tightened[i].prepend;
            const innerMutations = [];
            const innerOk = collectA3Mutations(s.node, t.node, innerMutations);
            if (innerOk) {
              if (pre && innerMutations.length > 0) {
                innerMutations[0].newValue = pre + innerMutations[0].newValue;
              }
              for (const m of innerMutations) mutations.push(m);
            }
          }
          return true;
        }
      }
    }

    if (sourceSeq.length === targetSeq.length) {
      let strictOk = true;
      const strictMutations = [];
      for (let i = 0; i < sourceSeq.length; i++) {
        const s = sourceSeq[i];
        const t = targetSeq[i];
        if (s.type !== t.type) { strictOk = false; break; }
        if (s.type === 'text') {
          strictMutations.push({
            node: s.node,
            newValue: preserveWsTextMutate(s.node.nodeValue || '', t.node.nodeValue || ''),
          });
        } else if (s.type === 'inline') {
          if (s.tag !== t.tag) { strictOk = false; break; }
          const innerMutations = [];
          const innerOk = collectA3Mutations(s.node, t.node, innerMutations);
          if (innerOk) {
            for (const m of innerMutations) strictMutations.push(m);
          }
        }
      }
      if (strictOk) {
        for (const m of strictMutations) mutations.push(m);
        return true;
      }
    }

    const srcSpanU = extractA3SeqSpanUnwrapped(sourceContainer, imgIsInline);
    const tgtSpanU = extractA3SeqSpanUnwrapped(targetContainer, imgIsInline);
    if (srcSpanU.length === tgtSpanU.length && srcSpanU.length > 0) {
      const unwrapMutations = [];
      let unwrapOk = true;
      for (let i = 0; i < srcSpanU.length; i++) {
        const s = srcSpanU[i];
        const t = tgtSpanU[i];
        if (s.type !== t.type) { unwrapOk = false; break; }
        if (s.type === 'text') {
          unwrapMutations.push({
            node: s.node,
            newValue: preserveWsTextMutate(s.node.nodeValue || '', t.node.nodeValue || ''),
          });
        } else {
          if (s.tag !== t.tag) { unwrapOk = false; break; }
          const innerMutations = [];
          const innerOk = collectA3Mutations(s.node, t.node, innerMutations);
          if (innerOk) {
            for (const m of innerMutations) unwrapMutations.push(m);
          }
        }
      }
      if (unwrapOk) {
        for (const m of unwrapMutations) mutations.push(m);
        return true;
      }
    }

    function segment(seq) {
      const segs = [];
      let cur = [];
      for (const item of seq) {
        if (item.type === 'text') cur.push(item);
        else { segs.push(cur); segs.push(item); cur = []; }
      }
      segs.push(cur);
      return segs;
    }
    const srcSegs = segment(srcSpanU);
    const tgtSegs = segment(tgtSpanU);
    if (srcSegs.length === tgtSegs.length && srcSegs.length > 1) {
      const segMutations = [];
      let segOk = true;
      let lastProseMutationIdx = -1;
      let pendingLeadText = '';
      for (let i = 0; i < srcSegs.length; i++) {
        const ss = srcSegs[i];
        const ts = tgtSegs[i];
        if (i % 2 === 1) {
          if (ss.tag !== ts.tag) { segOk = false; break; }
          const inner = [];
          const innerOk = collectA3Mutations(ss.node, ts.node, inner);
          if (innerOk) {
            if (pendingLeadText && inner.length > 0) {
              inner[0].newValue = pendingLeadText + inner[0].newValue;
              pendingLeadText = '';
            }
            for (const m of inner) segMutations.push(m);
          }
          continue;
        }
        if (ss.length === 0 && ts.length === 0) continue;
        if (ss.length === 0 && ts.length > 0) {
          if (lastProseMutationIdx >= 0) {
            const overflow = ts.map(t => (t.node.nodeValue || '')).join('');
            segMutations[lastProseMutationIdx].newValue += overflow;
            continue;
          }
          pendingLeadText += ts.map(t => (t.node.nodeValue || '')).join('');
          continue;
        }
        if (ts.length === 0 && ss.length > 0) {
          const totalLen = ss.reduce((acc, item) => acc + (item.node.nodeValue || '').length, 0);
          if (totalLen <= 12) {
            for (const item of ss) {
              segMutations.push({ node: item.node, newValue: '' });
            }
            continue;
          }
          segOk = false; break;
        }
        if (ss.length === ts.length) {
          for (let j = 0; j < ss.length; j++) {
            segMutations.push({
              node: ss[j].node,
              newValue: preserveWsTextMutate(ss[j].node.nodeValue || '', ts[j].node.nodeValue || ''),
            });
          }
          if (pendingLeadText) {
            const firstIdx = segMutations.length - ss.length;
            segMutations[firstIdx].newValue = pendingLeadText + segMutations[firstIdx].newValue;
            pendingLeadText = '';
          }
          lastProseMutationIdx = segMutations.length - 1;
        } else {
          const ssJoined = ss.map(s => s.node.nodeValue || '').join('');
          const srcLead = (ssJoined.match(/^\s+/) || [''])[0];
          const srcTrail = (ssJoined.match(/\s+$/) || [''])[0];
          const sep = /\n\n/.test(ssJoined) ? '\n\n' : '\n';
          const tgtJoined = ts
            .map(t => (t.node.nodeValue || '').replace(/^\s+|\s+$/g, ''))
            .join(sep);
          segMutations.push({ node: ss[0].node, newValue: pendingLeadText + srcLead + tgtJoined + srcTrail });
          pendingLeadText = '';
          for (let j = 1; j < ss.length; j++) {
            segMutations.push({ node: ss[j].node, newValue: '' });
          }
          lastProseMutationIdx = segMutations.length - ss.length;
        }
      }
      if (pendingLeadText) segOk = false;
      if (segOk) {
        for (const m of segMutations) mutations.push(m);
        return true;
      }
    }

    return false;
  }

  SK.tryInjectNodeValueMutate = function tryInjectNodeValueMutate(el, translation, slots) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (!translation || typeof translation !== 'string') return false;

    if (slots && slots.length > 0) {
      if (!SK.deserializeWithPlaceholders) return false;
      const { frag, ok } = SK.deserializeWithPlaceholders(translation, slots, { cloneReuse: true });
      if (!ok || !frag) return false;
      if (extractA3Seq(el).length === 0) return false;
      const mutations = [];
      const aligned = collectA3Mutations(el, frag, mutations);
      if (!aligned) return false;
      if (mutations.length === 0) return false;
      if (mutations.some(m => !m.node.isConnected)) return false;
      if (!STATE.nodeValueMutateBackup) STATE.nodeValueMutateBackup = new Map();
      if (!STATE.nodeValueMutateBackup.has(el)) {
        STATE.nodeValueMutateBackup.set(el,
          mutations.map(m => ({
            node: m.node,
            originalValue: m.node.nodeValue,
            translatedValue: m.newValue,
          }))
        );
      }
      for (const m of mutations) m.node.nodeValue = m.newValue;
      return true;
    }

    if (typeof translation === 'string' && SK.stripStrayPlaceholderMarkers) {
      translation = SK.stripStrayPlaceholderMarkers(translation);
    }

    const textNodes = SK.collectVisibleTextNodes?.(el);
    if (!textNodes || textNodes.length === 0) return false;
    if (textNodes.some(n => !n.isConnected)) return false;

    if (!STATE.nodeValueMutateBackup) STATE.nodeValueMutateBackup = new Map();

    if (textNodes.length === 1) {
      const node = textNodes[0];
      if (!STATE.nodeValueMutateBackup.has(el)) {
        STATE.nodeValueMutateBackup.set(el, [{ node, originalValue: node.nodeValue, translatedValue: translation }]);
      }
      node.nodeValue = translation;
      return true;
    }

    const chunks = translation.split(/\n+/).filter(s => s.length > 0);
    if (chunks.length !== textNodes.length) {
      if (chunks.length > 0 && chunks.length < textNodes.length) {
        if (!STATE.nodeValueMutateBackup) STATE.nodeValueMutateBackup = new Map();
        if (!STATE.nodeValueMutateBackup.has(el)) {
          STATE.nodeValueMutateBackup.set(el,
            textNodes.map((node, i) => ({
              node,
              originalValue: node.nodeValue,
              translatedValue: i === 0 ? translation : '',
            }))
          );
        }
        textNodes[0].nodeValue = translation;
        for (let i = 1; i < textNodes.length; i++) {
          textNodes[i].nodeValue = '';
        }
        return true;
      }
      return false;
    }

    if (!STATE.nodeValueMutateBackup.has(el)) {
      const backup = textNodes.map((node, i) => ({ node, originalValue: node.nodeValue, translatedValue: chunks[i] }));
      STATE.nodeValueMutateBackup.set(el, backup);
    }
    for (let i = 0; i < textNodes.length; i++) {
      textNodes[i].nodeValue = chunks[i];
    }
    return true;
  };

  SK.removeDualWrappers = function removeDualWrappers() {
    const tag = SK.TRANSLATION_WRAPPER_TAG;
    document.querySelectorAll(tag).forEach(n => n.remove());
    document.querySelectorAll('[data-transit-dual-source]').forEach(el => {
      el.removeAttribute('data-transit-dual-source');
    });
    if (STATE.translationCache) {
      STATE.translationCache.forEach(({ wrapper }, original) => {
        try { wrapper?.remove?.(); } catch (_) {}
        try { original?.removeAttribute?.('data-transit-dual-source'); } catch (_) {}
      });
    }
  };

  SK.ensureDualWrapperStyle = function ensureDualWrapperStyle() {
    if (document.getElementById('transit-dual-style')) return;
    const tag = SK.TRANSLATION_WRAPPER_TAG;
    const style = document.createElement('style');
    style.id = 'transit-dual-style';
    style.textContent =
      `${tag} { display: block; margin-top: 0.5em; margin-bottom: 0.5em; box-sizing: border-box; }\n` +
      `${tag}[data-sk-mark="tint"]   { background-color: #FFF8E1; padding: 4px 8px; border-radius: 4px; }\n` +
      `${tag}[data-sk-mark="bar"]    { border-left: 3px solid #9CA3AF; padding-left: 8px; }\n` +
      `${tag}[data-sk-mark="dashed"] { text-decoration: underline wavy #C7CDD3; text-decoration-thickness: 1px; text-underline-offset: 4px; }\n` +
      `${tag}[data-sk-mark="none"]   {}\n` +
      `${tag}[data-sk-mark="tint"][data-sk-theme="dark"]   { background-color: rgba(255, 255, 255, 0.14); }\n` +
      `${tag}[data-sk-mark="bar"][data-sk-theme="dark"]    { border-left-color: #B7BDC4; }\n` +
      `${tag}[data-sk-mark="dashed"][data-sk-theme="dark"] { text-decoration-color: #B7BDC4; }\n` +
      `${tag}[data-sk-accent="custom"][data-sk-mark="tint"]   { background-color: rgb(var(--sk-accent-rgb) / 0.15); }\n` +
      `${tag}[data-sk-accent="custom"][data-sk-mark="tint"][data-sk-theme="dark"] { background-color: rgb(var(--sk-accent-rgb) / 0.22); }\n` +
      `${tag}[data-sk-accent="custom"][data-sk-mark="bar"]    { border-left-color: rgb(var(--sk-accent-rgb)); }\n` +
      `${tag}[data-sk-accent="custom"][data-sk-mark="dashed"] { text-decoration-color: rgb(var(--sk-accent-rgb)); }\n`;
    (document.head || document.documentElement).appendChild(style);
  };

})(window.__SK);
