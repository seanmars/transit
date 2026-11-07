(function(SK) {
  if (!SK || SK.disabled) return;

  const PH_OPEN = SK.PH_OPEN;
  const PH_CLOSE = SK.PH_CLOSE;

  const _C = SK.CJK_CHAR;
  const _PH_TOKEN_SRC = PH_OPEN + '[*\\/]?\\d+' + PH_CLOSE;
  const RE_PH_TOKEN_G = new RegExp(_PH_TOKEN_SRC, 'g');
  const RE_PH_ANY_TOKEN_G = new RegExp(PH_OPEN + '\\*?\\/?\\d+' + PH_CLOSE, 'g');
  const RE_CJK_SP_OPEN = new RegExp('(' + _C + ')[ \\t]+(' + PH_OPEN + '\\d+' + PH_CLOSE + _C + ')', 'g');
  const RE_CJK_SP_CLOSE = new RegExp('(' + _C + PH_OPEN + '\\/\\d+' + PH_CLOSE + ')[ \\t]+(' + _C + ')', 'g');
  const RE_CJK_SP_ATOMIC_L = new RegExp('(' + _C + ')[ \\t]+(' + PH_OPEN + '\\*\\d+' + PH_CLOSE + ')', 'g');
  const RE_CJK_SP_ATOMIC_R = new RegExp('(' + PH_OPEN + '\\*\\d+' + PH_CLOSE + ')[ \\t]+(' + _C + ')', 'g');
  const RE_CJK_RUN_MID = new RegExp('(' + _C + ')((?:[ \\t]*(?:' + _PH_TOKEN_SRC + '))+[ \\t]*)(?=' + _C + ')', 'g');
  const RE_CJK_RUN_HEAD = new RegExp('^((?:[ \\t]*(?:' + _PH_TOKEN_SRC + '))+[ \\t]*)(?=' + _C + ')');
  const RE_CJK_RUN_TAIL = new RegExp('(' + _C + ')((?:[ \\t]*(?:' + _PH_TOKEN_SRC + '))+[ \\t]*)$');
  const RE_STRAY_HALF_CLOSE_G = new RegExp('[\\*\\/]\\d+' + PH_CLOSE, 'g');
  const RE_STRAY_BRACKETS_G = new RegExp('[' + PH_OPEN + PH_CLOSE +
    SK.BRACKET_ALIASES_OPEN.join('') + SK.BRACKET_ALIASES_CLOSE.join('') + ']', 'g');
  const RE_NORM_ANNOTATED_G = new RegExp(PH_OPEN + '\\s*(\\*?\\/?\\d+)[ \\t]+\\S[^' + PH_CLOSE + ']{0,28}' + PH_CLOSE, 'g');
  const RE_NORM_SPACED_G = new RegExp(PH_OPEN + '\\s*(\\*?\\/?\\d+)\\s*' + PH_CLOSE, 'g');
  const RE_NORM_MANGLED_CLOSE_G = new RegExp(PH_OPEN + '(\\*?\\/?\\d+)(?:[»›❱》〉≫]|(?=[^' + PH_CLOSE + '0-9])|$)', 'g');
  const RE_HALF_BROKEN_TOK_G = new RegExp(PH_OPEN + '(\\*)?(\\/)?(\\d+)' + PH_CLOSE, 'g');
  const RE_PAIRED_OCC_G = new RegExp(PH_OPEN + '(\\d+)' + PH_CLOSE + '([\\s\\S]*?)' + PH_OPEN + '\\/\\1' + PH_CLOSE, 'g');
  const RE_PARSE_SEGMENT_G = new RegExp(
    PH_OPEN + '(\\d+)' + PH_CLOSE + '([\\s\\S]*?)' + PH_OPEN + '\\/\\1' + PH_CLOSE
      + '|' + PH_OPEN + '\\*(\\d+)' + PH_CLOSE,
    'g'
  );
  const RE_BOUNDARY_G = /[。？！；，、.!?;,\n]/g;

  function shouldPreserveTextNewlines(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const cs = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    if (!cs) return false;
    const ws = cs.whiteSpace;
    return ws === 'pre' || ws === 'pre-wrap' || ws === 'pre-line' || ws === 'break-spaces';
  }
  SK._shouldPreserveTextNewlines = shouldPreserveTextNewlines;

  SK.serializeWithPlaceholders = function serializeWithPlaceholders(el) {
    return serializeNodeIterable(el.childNodes, {
      preserveNewlines: shouldPreserveTextNewlines(el),
    });
  };

  const GT_MAX_PAIRED_SLOTS = 5;

  function countPairedInlineForGT(topLevelNodes) {
    let count = 0;
    function walk(nodeList) {
      for (const child of nodeList) {
        if (count > GT_MAX_PAIRED_SLOTS) return;
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.tagName === 'CODE'
            && !(child.parentElement && child.parentElement.tagName === 'PRE')) continue;
        if (child.tagName === 'BUTTON' && SK.hasSubstantiveContent(child)) {
          count++;
          walk(child.childNodes);
          continue;
        }
        if (SK.HARD_EXCLUDE_TAGS.has(child.tagName)) continue;
        if (child.tagName === 'BR') continue;
        if (SK.isAtomicPreserve(child)) continue;
        if (child.tagName === 'A' && hasElementChild(child)) {
          const _p = child.parentElement;
          if (_p && SK.BLOCK_TAGS_SET.has(_p.tagName) && _p.children.length === 1) {
            count++;
            for (const ac of child.childNodes) {
              if (ac.nodeType !== Node.ELEMENT_NODE) continue;
              if (SK.HARD_EXCLUDE_TAGS.has(ac.tagName)) continue;
              if (ac.tagName === 'BR') continue;
              if (hasElementChild(ac) || !(ac.textContent || '').trim()) continue;
              walk([ac]);
            }
          }
          continue;
        }
        if (isGtAtomicMedia(child)) continue;
        if (SK.GT_INLINE_TAGS.has(child.tagName)) {
          count++;
          if (count > GT_MAX_PAIRED_SLOTS) return;
        }
        walk(child.childNodes);
        if (count > GT_MAX_PAIRED_SLOTS) return;
      }
    }
    walk(topLevelNodes);
    return count;
  }

  function isGtAtomicMedia(child) {
    return child.tagName === 'IMG' || SK.isMediaLikeElement(child) || SK.isTextlessMediaWrapper(child);
  }

  function hasElementChild(el) {
    if (!el || !el.childNodes) return false;
    for (const c of el.childNodes) {
      if (c.nodeType === Node.ELEMENT_NODE) return true;
    }
    return false;
  }

  function serializeNodeIterableForGoogle(topLevelNodes, opts) {
    const first = serializeNodeIterableForGoogleOnce(topLevelNodes, opts);
    if (allTextLockedInCodeSlots(first, /【[*\/]?\d+】/g)) {
      const codeCount = first.slots.filter(
        (s) => s && s.atomic && s.node && s.node.tagName === 'CODE'
      ).length;
      if (codeCount <= GT_MAX_PAIRED_SLOTS) {
        return serializeNodeIterableForGoogleOnce(topLevelNodes, { ...(opts || {}), codeAsPaired: true });
      }
    }
    return first;
  }

  function serializeNodeIterableForGoogleOnce(topLevelNodes, opts) {
    const slots = [];
    let out = '';
    const preserveNewlines = !!(opts && opts.preserveNewlines);
    const codeAsPaired = !!(opts && opts.codeAsPaired);
    const degrade = countPairedInlineForGT(topLevelNodes) > GT_MAX_PAIRED_SLOTS;
    function walk(nodeList) {
      for (const child of nodeList) {
        if (child.nodeType === Node.TEXT_NODE) {
          out += preserveNewlines
            ? child.nodeValue.replace(/\n/g, '')
            : child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === 'CODE'
              && !(child.parentElement && child.parentElement.tagName === 'PRE')) {
            if (codeAsPaired) {
              const idx = slots.length;
              slots.push(child.cloneNode(false));
              out += '【' + idx + '】';
              walk(child.childNodes);
              out += '【/' + idx + '】';
            } else {
              const idx = slots.length;
              slots.push({ atomic: true, node: child.cloneNode(true) });
              out += '【*' + idx + '】';
            }
            continue;
          }
          if (child.tagName === 'BUTTON' && SK.hasSubstantiveContent(child)) {
            if (!degrade) {
              const idx = slots.length;
              slots.push({ reuseNode: true, node: child });
              out += '【' + idx + '】';
              walk(child.childNodes);
              out += '【/' + idx + '】';
            } else {
              walk(child.childNodes);
            }
            continue;
          }
          if (child.tagName === 'BUTTON') {
            const idx = slots.length;
            slots.push({ atomic: true, reuseNode: true, node: child });
            out += '【*' + idx + '】';
            continue;
          }
          if (SK.HARD_EXCLUDE_TAGS.has(child.tagName)) continue;
          if (child.tagName === 'BR') { out += '\u0001'; continue; }
          if (SK.isAtomicPreserve(child)) {
            const idx = slots.length;
            slots.push({ atomic: true, node: child.cloneNode(true) });
            out += '【*' + idx + '】';
            continue;
          }
          if (!degrade && child.tagName === 'A' && hasElementChild(child)) {
            const _p = child.parentElement;
            if (_p && SK.BLOCK_TAGS_SET.has(_p.tagName) && _p.children.length === 1) {
              const idx = slots.length;
              slots.push(child.cloneNode(false));
              out += '【' + idx + '】';
              for (const ac of child.childNodes) {
                if (ac.nodeType === Node.TEXT_NODE) {
                  out += ac.nodeValue;
                } else if (ac.nodeType === Node.ELEMENT_NODE) {
                  if (SK.HARD_EXCLUDE_TAGS.has(ac.tagName)) continue;
                  if (ac.tagName === 'BR') { out += '\u0001'; continue; }
                  if (hasElementChild(ac) || !(ac.textContent || '').trim()) {
                    const aidx = slots.length;
                    slots.push({ atomic: true, node: ac.cloneNode(true) });
                    out += '【*' + aidx + '】';
                  } else {
                    walk([ac]);
                  }
                }
              }
              out += '【/' + idx + '】';
              continue;
            }
            const idx = slots.length;
            slots.push({ atomic: true, node: child.cloneNode(true) });
            out += '【*' + idx + '】';
            continue;
          }
          if (isGtAtomicMedia(child)) {
            const idx = slots.length;
            slots.push({ atomic: true, node: child.cloneNode(true) });
            out += '【*' + idx + '】';
            continue;
          }
          if (!degrade && SK.GT_INLINE_TAGS.has(child.tagName)) {
            const idx = slots.length;
            slots.push(child.cloneNode(false));
            out += '【' + idx + '】';
            walk(child.childNodes);
            out += '【/' + idx + '】';
            continue;
          }
          walk(child.childNodes);
        }
      }
    }
    walk(topLevelNodes);
    const normalized = out
      .replace(/\s+/g, ' ')
      .replace(/ *\u0001 */g, '\u0001')
      .replace(/\u0001{3,}/g, '\u0001\u0001')
      .replace(/\u0001/g, '\n')
      .trim();
    return { text: normalized, slots };
  }

  SK.serializeForGoogleTranslate = function serializeForGoogleTranslate(el) {
    return serializeNodeIterableForGoogle(el.childNodes, {
      preserveNewlines: shouldPreserveTextNewlines(el),
    });
  };

  SK.serializeFragmentForGoogleTranslate = function serializeFragmentForGoogleTranslate(unit) {
    const nodes = [];
    let cur = unit.startNode;
    while (cur) {
      nodes.push(cur);
      if (cur === unit.endNode) break;
      cur = cur.nextSibling;
    }
    const parent = unit.startNode && unit.startNode.parentElement;
    return serializeNodeIterableForGoogle(nodes, {
      preserveNewlines: shouldPreserveTextNewlines(parent),
    });
  };

  SK.restoreGoogleTranslateMarkers = function restoreGoogleTranslateMarkers(s) {
    var result = s
      .replace(/【\*(\d+)】/g, PH_OPEN + '*$1' + PH_CLOSE)
      .replace(/【(\d+)】/g,   PH_OPEN + '$1'  + PH_CLOSE)
      .replace(/【\/(\d+)】/g, PH_OPEN + '/$1' + PH_CLOSE);
    if (/\[\/\d+\]|\[\*\d+\]/.test(result)) {
      result = result
        .replace(/\[\*(\d+)\]/g, PH_OPEN + '*$1' + PH_CLOSE)
        .replace(/\[(\d+)\]/g,   PH_OPEN + '$1'  + PH_CLOSE)
        .replace(/\[\/(\d+)\]/g, PH_OPEN + '/$1' + PH_CLOSE);
    }
    return result;
  };

  SK.ensureCJKSlotSpacing = function ensureCJKSlotSpacing(s) {
    return s
      .replace(/([一-鿿㐀-䶿])(⟦\*?\d+⟧)/g, '$1 $2')
      .replace(/(⟦[/*]\d+⟧)([一-鿿㐀-䶿])/g, '$1 $2');
  };

  SK.serializeFragmentWithPlaceholders = function serializeFragmentWithPlaceholders(unit) {
    const nodes = [];
    let cur = unit.startNode;
    while (cur) {
      nodes.push(cur);
      if (cur === unit.endNode) break;
      cur = cur.nextSibling;
    }
    const parent = unit.startNode && unit.startNode.parentElement;
    return serializeNodeIterable(nodes, {
      preserveNewlines: shouldPreserveTextNewlines(parent),
      imgAsSlot: true,
    });
  };

  function allTextLockedInCodeSlots(result, tokenRe) {
    const residual = result.text.replace(tokenRe, '');
    if (/[\p{L}\p{N}]/u.test(residual)) return false;
    const codeSlots = result.slots.filter(
      (s) => s && s.atomic && s.node && s.node.tagName === 'CODE'
    );
    if (!codeSlots.length) return false;
    return codeSlots.some((s) => /[\p{L}\p{N}]/u.test(s.node.textContent || ''));
  }

  function serializeNodeIterable(topLevelNodes, opts) {
    const first = serializeNodeIterableOnce(topLevelNodes, opts);
    if (allTextLockedInCodeSlots(first, RE_PH_TOKEN_G)) {
      return serializeNodeIterableOnce(topLevelNodes, { ...(opts || {}), codeAsPaired: true });
    }
    return first;
  }

  function serializeNodeIterableOnce(topLevelNodes, opts) {
    const slots = [];
    let out = '';
    const preserveNewlines = !!(opts && opts.preserveNewlines);
    const imgAsSlot = !!(opts && opts.imgAsSlot);
    const codeAsPaired = !!(opts && opts.codeAsPaired);
    function walk(nodeList) {
      for (const child of nodeList) {
        if (child.nodeType === Node.TEXT_NODE) {
          out += preserveNewlines
            ? child.nodeValue.replace(/\n/g, "")
            : child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === 'CODE'
              && !(child.parentElement && child.parentElement.tagName === 'PRE')) {
            if (codeAsPaired) {
              const idx = slots.length;
              slots.push(child.cloneNode(false));
              out += PH_OPEN + idx + PH_CLOSE;
              walk(child.childNodes);
              out += PH_OPEN + '/' + idx + PH_CLOSE;
            } else {
              const idx = slots.length;
              slots.push({ atomic: true, node: child.cloneNode(true) });
              out += PH_OPEN + '*' + idx + PH_CLOSE;
            }
            continue;
          }
          if (child.tagName === 'BUTTON' && SK.hasSubstantiveContent(child)) {
            const idx = slots.length;
            slots.push({ reuseNode: true, node: child });
            out += PH_OPEN + idx + PH_CLOSE;
            walk(child.childNodes);
            out += PH_OPEN + '/' + idx + PH_CLOSE;
            continue;
          }
          if (child.tagName === 'BUTTON') {
            const idx = slots.length;
            slots.push({ atomic: true, reuseNode: true, node: child });
            out += PH_OPEN + '*' + idx + PH_CLOSE;
            continue;
          }
          if (SK.HARD_EXCLUDE_TAGS.has(child.tagName)) continue;
          if (child.tagName === 'PRE' && child.querySelector('code')) continue;
          if (child.tagName === 'BR') {
            out += '\u0001';
            continue;
          }
          if (imgAsSlot && (child.tagName === 'IMG' || SK.isMediaLikeElement(child)
              || SK.isTextlessMediaWrapper(child))) {
            const idx = slots.length;
            slots.push({ atomic: true, node: child.cloneNode(true) });
            out += PH_OPEN + '*' + idx + PH_CLOSE;
            continue;
          }
          if (SK.isAtomicPreserve(child)) {
            const idx = slots.length;
            slots.push({ atomic: true, node: child.cloneNode(true) });
            out += PH_OPEN + '*' + idx + PH_CLOSE;
            continue;
          }
          if (SK.isPreservableInline(child)) {
            const idx = slots.length;
            const shell = child.cloneNode(false);
            slots.push(shell);
            out += PH_OPEN + idx + PH_CLOSE;
            walk(child.childNodes);
            out += PH_OPEN + '/' + idx + PH_CLOSE;
          } else {
            walk(child.childNodes);
          }
        }
      }
    }
    walk(topLevelNodes);
    const normalized = out
      .replace(/\s+/g, ' ')
      .replace(/ *\u0001 */g, '\u0001')
      .replace(/\u0001{3,}/g, '\u0001\u0001')
      .replace(/\u0001/g, '\n')
      .trim();
    return { text: normalized, slots };
  }

  SK.collapseCjkSpacesAroundPlaceholders = function collapseCjkSpacesAroundPlaceholders(s) {
    if (!s) return s;
    s = s.replace(RE_CJK_SP_OPEN, '$1$2');
    s = s.replace(RE_CJK_SP_CLOSE, '$1$2');
    s = s.replace(RE_CJK_SP_ATOMIC_L, '$1$2');
    s = s.replace(RE_CJK_SP_ATOMIC_R, '$1$2');
    const stripRunSpaces = (run) => run.replace(/[ \t]+/g, '');
    s = s.replace(RE_CJK_RUN_MID, (m, a, run) => a + stripRunSpaces(run));
    s = s.replace(RE_CJK_RUN_HEAD, (m, run) => stripRunSpaces(run));
    s = s.replace(RE_CJK_RUN_TAIL, (m, a, run) => a + stripRunSpaces(run));
    return s;
  };

  SK.stripStrayPlaceholderMarkers = function stripStrayPlaceholderMarkers(s) {
    s = SK.normalizeLlmPlaceholders(s);
    s = s.replace(RE_PH_ANY_TOKEN_G, '');
    s = s.replace(RE_STRAY_HALF_CLOSE_G, '');
    s = s.replace(RE_STRAY_BRACKETS_G, '');
    return s;
  };

  SK.normalizeLlmPlaceholders = function normalizeLlmPlaceholders(s) {
    if (!s) return s;
    for (const alias of SK.BRACKET_ALIASES_OPEN) {
      if (s.includes(alias)) s = s.split(alias).join(PH_OPEN);
    }
    for (const alias of SK.BRACKET_ALIASES_CLOSE) {
      if (s.includes(alias)) s = s.split(alias).join(PH_CLOSE);
    }
    s = s.replace(RE_NORM_ANNOTATED_G, PH_OPEN + '$1' + PH_CLOSE);
    s = s.replace(RE_NORM_SPACED_G, PH_OPEN + '$1' + PH_CLOSE);
    return s.replace(RE_NORM_MANGLED_CLOSE_G, PH_OPEN + '$1' + PH_CLOSE);
  };

  SK.repairHalfBrokenPlaceholders = function repairHalfBrokenPlaceholders(text, slots) {
    if (!text || !Array.isArray(slots) || slots.length === 0) return text;
    if (text.indexOf(PH_OPEN) === -1) return text;

    const isPairedSlot = (slot) => !!slot && (
      slot.nodeType === Node.ELEMENT_NODE || (slot.reuseNode && !slot.atomic)
    );

    const tokRe = RE_HALF_BROKEN_TOK_G;
    tokRe.lastIndex = 0;
    const toks = [];
    let m;
    while ((m = tokRe.exec(text)) !== null) {
      toks.push({ star: !!m[1], close: !!m[2], n: Number(m[3]), start: m.index, end: m.index + m[0].length });
    }
    if (toks.length === 0) return text;

    const opens = new Map();
    const closes = new Map();
    for (const t of toks) {
      if (t.star) continue;
      if (t.close) closes.set(t.n, t);
      else if (!opens.has(t.n)) opens.set(t.n, t);
    }

    const BOUNDARY_RE = /[。？！；，、.!?;,\n]/;
    const insertions = [];
    const repairedNs = [];

    const brokenOpens = [...opens.keys()]
      .filter((n) => !closes.has(n) && isPairedSlot(slots[n]))
      .sort((a, b) => opens.get(a).start - opens.get(b).start);
    for (const n of brokenOpens) {
      const openTok = opens.get(n);
      let cursor = openTok.end;
      let pos = text.length;
      const after = toks.filter((t) => t.start >= openTok.end).sort((a, b) => a.start - b.start);
      for (let i = 0; i < after.length; i++) {
        const t = after[i];
        if (t.start < cursor) continue;
        const gap = text.slice(cursor, t.start);
        const bm = gap.match(BOUNDARY_RE);
        if (bm) { pos = cursor + bm.index; break; }
        if (t.star) { cursor = t.end; continue; }
        if (!t.close) {
          const c = closes.get(t.n);
          cursor = (c && c.start > t.start) ? c.end : t.end;
          continue;
        }
        const o = opens.get(t.n);
        if (o && o.start < openTok.start) { pos = t.start; break; }
        cursor = t.end;
      }
      if (pos === text.length) {
        const tail = text.slice(cursor);
        const bm = tail.match(BOUNDARY_RE);
        if (bm) pos = cursor + bm.index;
      }
      insertions.push({ pos, marker: PH_OPEN + '/' + n + PH_CLOSE, tieOrder: openTok.start });
      repairedNs.push(n);
    }

    const brokenCloses = [...closes.keys()]
      .filter((n) => !opens.has(n) && isPairedSlot(slots[n]));
    for (const n of brokenCloses) {
      const closeTok = closes.get(n);
      let pos = 0;
      const before = toks.filter((t) => t.end <= closeTok.start).sort((a, b) => b.end - a.end);
      const nearestTokEnd = before.length ? before[0].end : 0;
      const gap = text.slice(nearestTokEnd, closeTok.start);
      let lastBoundary = -1;
      const g = gap.match(RE_BOUNDARY_G);
      if (g) lastBoundary = gap.lastIndexOf(g[g.length - 1]);
      pos = lastBoundary >= 0 ? nearestTokEnd + lastBoundary + 1 : nearestTokEnd;
      insertions.push({ pos, marker: PH_OPEN + n + PH_CLOSE, tieOrder: -closeTok.start });
      repairedNs.push(n);
    }

    if (insertions.length === 0) return text;
    insertions.sort((a, b) => (b.pos - a.pos) || (a.tieOrder - b.tieOrder));
    let out = text;
    for (const ins of insertions) {
      out = out.slice(0, ins.pos) + ins.marker + out.slice(ins.pos);
    }
    SK.sendLog('info', 'translate', 'repaired half-broken placeholder pairs', {
      slots: repairedNs, preview: out.slice(0, 160),
    });
    return out;
  };

  SK.selectBestSlotOccurrences = function selectBestSlotOccurrences(text) {
    if (!text) return text;
    const re = RE_PAIRED_OCC_G;
    re.lastIndex = 0;
    const occurrences = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const inner = m[2];
      const innerStripped = inner.replace(RE_PH_ANY_TOKEN_G, '').trim();
      occurrences.push({
        idx: Number(m[1]),
        start: m.index,
        end: m.index + m[0].length,
        inner: inner,
        nonEmpty: innerStripped.length > 0,
      });
    }
    if (occurrences.length === 0) return text;
    const byIdx = new Map();
    for (const o of occurrences) {
      if (!byIdx.has(o.idx)) byIdx.set(o.idx, []);
      byIdx.get(o.idx).push(o);
    }
    const losers = [];
    let dupSlotCount = 0;
    for (const [, list] of byIdx) {
      if (list.length === 1) continue;
      dupSlotCount++;
      let winner = list.find(o => o.nonEmpty);
      if (!winner) winner = list[0];
      for (const o of list) if (o !== winner) losers.push(o);
    }
    if (losers.length === 0) return text;
    losers.sort((a, b) => b.start - a.start);
    let out = text;
    for (const l of losers) {
      out = out.slice(0, l.start) + l.inner + out.slice(l.end);
    }
    SK.sendLog('info', 'translate', 'graceful dedup: dup_slots=' + dupSlotCount +
      ' losers_demoted=' + losers.length +
      ' preview=' + JSON.stringify(out.slice(0, 200)));
    return out;
  };

  SK.deserializeWithPlaceholders = function deserializeWithPlaceholders(translation, slots, opts) {
    const cloneReuse = !!(opts && opts.cloneReuse);
    if (!translation) {
      return { frag: document.createDocumentFragment(), ok: false, matched: 0 };
    }

    translation = SK.normalizeLlmPlaceholders(translation);

    if (translation.includes('\\n')) {
      translation = translation.replace(/\\n/g, '\n');
    }

    translation = SK.collapseCjkSpacesAroundPlaceholders(translation);
    translation = SK.repairHalfBrokenPlaceholders(translation, slots);
    translation = SK.selectBestSlotOccurrences(translation);

    const matchedRef = { count: 0, used: new Set() };
    const frag = parseSegment(translation, slots, matchedRef, cloneReuse);
    const ok = matchedRef.count > 0;
    if (ok) {
      for (let i = 0; i < slots.length; i++) {
        if (matchedRef.used.has(i)) continue;
        const slot = slots[i];
        if (!slot || !slot.node) continue;
        if (slot.reuseNode) {
          frag.appendChild(cloneReuse ? slot.node.cloneNode(true) : slot.node);
        } else if (slot.atomic) {
          const n = slot.node.cloneNode(true);
          if (_isInlineImgNode(n)) _appendInlineImg(frag, n);
          else frag.appendChild(n);
        }
      }
    }
    return { frag, ok, matched: matchedRef.count };
  };

  function _cjkLatinTailEndsCjk(textValue) {
    return /[㐀-鿿豈-﫿ｦ-ﾟ]$/.test(textValue || '');
  }
  function _cjkLatinHeadStartsLatin(textValue) {
    const t = (textValue || '').replace(/^\s+/, '');
    return /^[A-Za-z0-9@#\-+/%&]/.test(t);
  }
  function _findTrailingTextNode(node) {
    let cur = node;
    while (cur && cur.nodeType === Node.ELEMENT_NODE) {
      if (cur.tagName === 'BR') return null;
      cur = cur.lastChild;
    }
    return cur && cur.nodeType === Node.TEXT_NODE ? cur : null;
  }
  function _maybePadCjkLatinSpace(frag, nextElement) {
    const last = frag.lastChild;
    if (!last) return;
    let tailText = '';
    if (last.nodeType === Node.TEXT_NODE) tailText = last.nodeValue || '';
    else if (last.nodeType === Node.ELEMENT_NODE) tailText = last.textContent || '';
    if (!tailText || /\s$/.test(tailText)) return;
    if (!_cjkLatinTailEndsCjk(tailText)) return;
    const headText = nextElement.textContent || '';
    if (!_cjkLatinHeadStartsLatin(headText)) return;
    if (last.nodeType === Node.TEXT_NODE) {
      last.nodeValue = tailText + ' ';
    } else {
      const trailing = _findTrailingTextNode(last);
      if (trailing) trailing.nodeValue = (trailing.nodeValue || '') + ' ';
    }
  }

  function _isInlineImgNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.tagName === 'IMG') return true;
    return !!node.querySelector('img') && !(node.textContent || '').trim();
  }

  function _appendInlineImg(frag, imgNode) {
    const last = frag.lastChild;
    if (last) {
      let tail = last.nodeType === Node.TEXT_NODE ? (last.nodeValue || '') : (last.textContent || '');
      if (tail && !/\s$/.test(tail)) {
        if (last.nodeType === Node.TEXT_NODE) last.nodeValue = tail + ' ';
        else { const t = _findTrailingTextNode(last); if (t) t.nodeValue = (t.nodeValue || '') + ' '; }
      }
    }
    frag.appendChild(imgNode);
    frag.appendChild(document.createTextNode(' '));
  }

  function parseSegment(text, slots, matchedRef, cloneReuse) {
    const frag = document.createDocumentFragment();
    if (!text) return frag;

    const re = RE_PARSE_SEGMENT_G;

    function pushText(s) {
      if (!s) return;
      const clean = SK.stripStrayPlaceholderMarkers(s);
      if (!clean) return;
      if (clean.includes('\n')) {
        const parts = clean.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) frag.appendChild(document.createTextNode(parts[i]));
          if (i < parts.length - 1) frag.appendChild(document.createElement('br'));
        }
      } else {
        frag.appendChild(document.createTextNode(clean));
      }
    }

    let cursor = 0;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > cursor) {
        pushText(text.slice(cursor, m.index));
      }
      if (m[3] !== undefined) {
        const idx = Number(m[3]);
        const slot = slots[idx];
        if (slot && matchedRef.used) matchedRef.used.add(idx);
        if (slot && slot.atomic && slot.node) {
          const cloned = (slot.reuseNode && !cloneReuse) ? slot.node : slot.node.cloneNode(true);
          if (_isInlineImgNode(cloned)) {
            _appendInlineImg(frag, cloned);
          } else {
            _maybePadCjkLatinSpace(frag, cloned);
            frag.appendChild(cloned);
          }
          matchedRef.count++;
        }
      } else {
        const idx = Number(m[1]);
        const inner = m[2];
        const slot = slots[idx];
        if (slot && matchedRef.used) matchedRef.used.add(idx);
        if (slot && slot.reuseNode && slot.node && cloneReuse) {
          const shell = slot.node.cloneNode(false);
          shell.appendChild(parseSegment(inner, slots, matchedRef, cloneReuse));
          _maybePadCjkLatinSpace(frag, shell);
          frag.appendChild(shell);
          matchedRef.count++;
        } else if (slot && slot.reuseNode && slot.node) {
          const reuse = slot.node;
          while (reuse.firstChild) reuse.removeChild(reuse.firstChild);
          const innerFrag = parseSegment(inner, slots, matchedRef, cloneReuse);
          reuse.appendChild(innerFrag);
          _maybePadCjkLatinSpace(frag, reuse);
          frag.appendChild(reuse);
          matchedRef.count++;
        } else if (slot && slot.nodeType === Node.ELEMENT_NODE) {
          const shell = slot.cloneNode(false);
          const innerFrag = parseSegment(inner, slots, matchedRef, cloneReuse);
          shell.appendChild(innerFrag);
          _maybePadCjkLatinSpace(frag, shell);
          frag.appendChild(shell);
          matchedRef.count++;
        } else if (slot && slot.atomic && slot.node) {
          const cloned = (slot.reuseNode && !cloneReuse) ? slot.node : slot.node.cloneNode(true);
          if (_isInlineImgNode(cloned)) {
            _appendInlineImg(frag, cloned);
          } else {
            _maybePadCjkLatinSpace(frag, cloned);
            frag.appendChild(cloned);
          }
          matchedRef.count++;
        } else {
          const innerFrag = parseSegment(inner, slots, matchedRef, cloneReuse);
          frag.appendChild(innerFrag);
        }
      }
      cursor = m.index + m[0].length;
      re.lastIndex = cursor;
    }
    if (cursor < text.length) {
      pushText(text.slice(cursor));
    }
    return frag;
  }

})(window.__SK);
