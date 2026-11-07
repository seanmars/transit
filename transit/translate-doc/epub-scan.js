const ANNOTATED_RE = /^(.+)（(.+)）\s*$/;

const RE_ASCII_ONLY = /^[\x20-\x7E]+$/;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileTermMatcher(term) {
  if (!term) return () => false;
  if (RE_ASCII_ONLY.test(term)) {
    const re = new RegExp(`(?<![A-Za-z])${escapeRe(term)}(?![A-Za-z])`);
    return (text) => !!text && re.test(text);
  }
  return (text) => !!text && text.includes(term);
}

function sourceHasTerm(text, term) {
  return compileTermMatcher(term)(text);
}

export { sourceHasTerm, compileTermMatcher };

const CJK_EDGE_RE = /[㐀-鿿豈-﫿]/;
const LATIN_EDGE_RE = /[A-Za-z0-9]/;

function spliceCjkAware(text, start, end, replacement, ctx = {}) {
  let before = text.slice(0, start);
  let after = text.slice(end);
  let mid = replacement;
  const repFirst = replacement[0] || '';
  const repLast = replacement[replacement.length - 1] || '';
  const prev = before ? before[before.length - 1] : (ctx.prevChar || '');
  if (prev) {
    if (CJK_EDGE_RE.test(prev) && LATIN_EDGE_RE.test(repFirst)) {
      mid = ' ' + mid;
    } else if (before && prev === ' ' && CJK_EDGE_RE.test(repFirst)) {
      const beyond = before.length >= 2 ? before[before.length - 2] : (ctx.prevChar || '');
      if (beyond && CJK_EDGE_RE.test(beyond)) before = before.slice(0, -1);
    }
  }
  const next = after ? after[0] : (ctx.nextChar || '');
  if (next) {
    if (LATIN_EDGE_RE.test(repLast) && CJK_EDGE_RE.test(next)) {
      mid = mid + ' ';
    } else if (after && next === ' ' && CJK_EDGE_RE.test(repLast)) {
      const beyond = after.length >= 2 ? after[1] : (ctx.nextChar || '');
      if (beyond && CJK_EDGE_RE.test(beyond)) after = after.slice(1);
    }
  }
  return { text: before + mid + after, nextFrom: before.length + mid.length };
}

const RE_CJK_THEN_LATIN = new RegExp(`(${CJK_EDGE_RE.source})(${LATIN_EDGE_RE.source})`, 'g');
const RE_LATIN_THEN_CJK = new RegExp(`(${LATIN_EDGE_RE.source})(${CJK_EDGE_RE.source})`, 'g');

const FW_PUNCT_RE = /[、-〿！-／：-＠［-｀｛-｠]/;
const TEXT_EDGE_RE = new RegExp(`(?:${CJK_EDGE_RE.source}|${LATIN_EDGE_RE.source})`);
const RE_SPACE_BEFORE_FW_PUNCT = new RegExp(`(${TEXT_EDGE_RE.source})[ \\t]+(?=${FW_PUNCT_RE.source})`, 'g');
const RE_SPACE_AFTER_FW_PUNCT = new RegExp(`(${FW_PUNCT_RE.source})[ \\t]+(?=${TEXT_EDGE_RE.source})`, 'g');

export function addCjkLatinSpacing(text, ctx = {}) {
  if (!text) return { text, count: 0 };
  let count = 0;
  const bump = (_, a, b) => {
    count++;
    return `${a} ${b}`;
  };
  const drop = (_, a) => {
    count++;
    return a;
  };
  let out = text.replace(RE_CJK_THEN_LATIN, bump);
  out = out.replace(RE_LATIN_THEN_CJK, bump);
  out = out.replace(RE_SPACE_BEFORE_FW_PUNCT, drop);
  out = out.replace(RE_SPACE_AFTER_FW_PUNCT, drop);
  const prev = ctx.prevChar || '';
  const first = out[0] || '';
  if (prev && ((CJK_EDGE_RE.test(prev) && LATIN_EDGE_RE.test(first))
      || (LATIN_EDGE_RE.test(prev) && CJK_EDGE_RE.test(first)))) {
    out = ' ' + out;
    count++;
  } else if (prev) {
    const lead = out.match(/^[ \t]+/);
    if (lead) {
      const after = out[lead[0].length] || '';
      if ((FW_PUNCT_RE.test(prev) && TEXT_EDGE_RE.test(after))
          || (TEXT_EDGE_RE.test(prev) && FW_PUNCT_RE.test(after))) {
        out = out.slice(lead[0].length);
        count++;
      }
    }
  }
  return { text: out, count };
}

export function replaceTermInText(text, term, replacement, ctx = {}) {
  if (!text || !term || typeof replacement !== 'string' || term === replacement) {
    return { text, count: 0 };
  }
  const re = RE_ASCII_ONLY.test(term)
    ? new RegExp(`(?<![A-Za-z])${escapeRe(term)}(?![A-Za-z])`, 'g')
    : null;
  let out = text;
  let count = 0;
  let from = 0;
  while (from <= out.length) {
    let idx = -1;
    if (re) {
      re.lastIndex = from;
      const m = re.exec(out);
      idx = m ? m.index : -1;
    } else {
      idx = out.indexOf(term, from);
    }
    if (idx === -1) break;
    const chBefore = idx > 0 ? out[idx - 1] : (ctx.prevChar || '');
    const chAfter = out[idx + term.length] || (ctx.nextChar || '');
    if ((ctx.skipAnnotated
        && (chBefore === '（' || chBefore === '(') && (chAfter === '）' || chAfter === ')'))
      || (ctx.skipTitleAdjacent && (chBefore === '《' || chAfter === '》'))) {
      from = idx + term.length;
      continue;
    }
    const spliced = spliceCjkAware(out, idx, idx + term.length, replacement, ctx);
    out = spliced.text;
    count++;
    from = spliced.nextFrom;
  }
  return { text: out, count };
}

function doneBlocks(chapters) {
  const out = [];
  for (const ch of chapters) {
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'done') continue;
      if (typeof b.plainText !== 'string' || typeof b.translation !== 'string') continue;
      out.push({ ch, b });
    }
  }
  return out;
}

export function checkGlossaryCompliance(chapters, glossary, { maxViolations = 200 } = {}) {
  const violations = [];
  if (!Array.isArray(glossary) || glossary.length === 0) return violations;
  const blocks = doneBlocks(chapters);
  for (const entry of glossary) {
    if (!entry || typeof entry.source !== 'string' || !entry.source.trim()) continue;
    const source = entry.source.trim();
    let expected;
    let annotation = null;
    if (entry.noTranslate === true) {
      expected = source;
    } else {
      if (typeof entry.target !== 'string' || !entry.target.trim()) continue;
      const m = entry.target.trim().match(ANNOTATED_RE);
      expected = (m ? m[1] : entry.target).trim();
      if (m) annotation = m[2].trim() || null;
    }
    if (!expected) continue;
    const hasTerm = compileTermMatcher(source);
    for (const { ch, b } of blocks) {
      if (!hasTerm(b.plainText)) continue;
      if (b.translation.includes(expected)) continue;
      violations.push({
        source,
        expected,
        annotation,
        noTranslate: entry.noTranslate === true,
        chapterIndex: ch.index,
        chapterTitle: ch.title || '',
        blockId: b.blockId,
        excerpt: excerptAround(b.plainText, source),
      });
      if (violations.length >= maxViolations) return violations;
    }
  }
  return violations;
}

function excerptAround(text, term, radius = 60) {
  const idx = text.indexOf(term);
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

const RE_LATIN_NAME = /[A-Z][A-Za-z'\u2019-]+(?:\s+[A-Z][A-Za-z'\u2019-]+)*/g;
const RE_KATAKANA = /[ァ-ヺー・]{2,}/g;

export function mineCandidates(chapters, glossary, { minBlocks = 2, maxCandidates = 120 } = {}) {
  const blocks = doneBlocks(chapters);
  if (blocks.length === 0) return [];

  const lowerWords = new Set();
  for (const { b } of blocks) {
    for (const m of b.plainText.matchAll(/(?<![A-Za-z])[a-z][a-z'\u2019-]*/g)) {
      lowerWords.add(m[0]);
    }
  }
  const glossSources = new Set(
    (Array.isArray(glossary) ? glossary : [])
      .filter((e) => e && typeof e.source === 'string')
      .map((e) => e.source.trim().toLowerCase()),
  );

  const map = new Map();
  const addHit = (term, ch, b) => {
    let rec = map.get(term);
    if (!rec) {
      rec = { blocks: new Map(), count: 0 };
      map.set(term, rec);
    }
    rec.count++;
    if (!rec.blocks.has(b.blockId)) {
      rec.blocks.set(b.blockId, { chapterIndex: ch.index, blockId: b.blockId });
    }
  };

  const corpusParts = [];
  for (const { ch, b } of blocks) {
    corpusParts.push(b.plainText);
    for (const m of b.plainText.matchAll(RE_LATIN_NAME)) addHit(m[0], ch, b);
    for (const m of b.plainText.matchAll(RE_KATAKANA)) addHit(m[0], ch, b);
  }
  const corpus = corpusParts.join('\n');

  const followedByCapMap = new Map();
  {
    const reToken = /(?<![A-Za-z])[A-Z][A-Za-z'\u2019-]*/g;
    const reFollow = /\.?\s+[A-Z0-9]/y;
    for (const m of corpus.matchAll(reToken)) {
      reFollow.lastIndex = m.index + m[0].length;
      if (reFollow.test(corpus)) {
        followedByCapMap.set(m[0], (followedByCapMap.get(m[0]) || 0) + 1);
      }
    }
  }

  const out = [];
  for (const [term, rec] of map) {
    if (rec.blocks.size < minBlocks) continue;
    if (glossSources.has(term.toLowerCase())) continue;
    const isLatin = RE_ASCII_ONLY.test(term);
    const isSingleWord = isLatin && !/\s/.test(term);
    if (isSingleWord) {
      if (term.length < 3) continue;
      if (lowerWords.has(term.toLowerCase())) continue;
      const followedByCap = followedByCapMap.get(term) || 0;
      if (rec.count > 1 && followedByCap / rec.count > 0.5) continue;
    }
    out.push({ term, blocks: [...rec.blocks.values()], count: rec.count });
  }
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, maxCandidates);
}

export function buildScanBatches(candidates, blockById, {
  samplePerTerm = 6, maxItemsPerBatch = 30, maxCharsPerBatch = 12000, sampleChars = 600,
} = {}) {
  const batches = [];
  let cur = { items: [] };
  let curChars = 0;
  for (const cand of candidates) {
    const picked = spreadPick(cand.blocks, samplePerTerm);
    const samples = [];
    for (const ref of picked) {
      const b = blockById.get(ref.blockId);
      if (!b || typeof b.translation !== 'string' || !b.translation) continue;
      samples.push({ blockId: ref.blockId, text: b.translation.slice(0, sampleChars) });
    }
    if (samples.length < 2) continue;
    const chars = samples.reduce((n, s) => n + s.text.length, cand.term.length);
    if (cur.items.length >= maxItemsPerBatch || (curChars + chars > maxCharsPerBatch && cur.items.length > 0)) {
      batches.push(cur);
      cur = { items: [] };
      curChars = 0;
    }
    cur.items.push({ term: cand.term, samples });
    curChars += chars;
  }
  if (cur.items.length > 0) batches.push(cur);
  return batches;
}

function spreadPick(arr, k) {
  if (k <= 1) return arr.length ? [arr[0]] : [];
  if (arr.length <= k) return arr.slice();
  const out = [];
  for (let i = 0; i < k; i++) {
    out.push(arr[Math.round((i * (arr.length - 1)) / (k - 1))]);
  }
  return [...new Map(out.map((x) => [x.blockId, x])).values()];
}

export function aggregateRenderings(collected) {
  const byTerm = new Map();
  for (const { items, results } of collected) {
    if (!Array.isArray(items) || !Array.isArray(results)) continue;
    for (const item of items) {
      const res = results.find((r) => r && r.term === item.term);
      if (!res || !Array.isArray(res.renderings)) continue;
      for (let i = 0; i < item.samples.length; i++) {
        const raw = res.renderings[i];
        if (typeof raw !== 'string') continue;
        const rendering = raw.trim();
        if (!rendering) continue;
        if (!item.samples[i].text.includes(rendering)) continue;
        let renderMap = byTerm.get(item.term);
        if (!renderMap) {
          renderMap = new Map();
          byTerm.set(item.term, renderMap);
        }
        let ids = renderMap.get(rendering);
        if (!ids) {
          ids = new Set();
          renderMap.set(rendering, ids);
        }
        ids.add(item.samples[i].blockId);
      }
    }
  }
  const cases = [];
  for (const [term, renderMap] of byTerm) {
    if (renderMap.size < 2) continue;
    const merged = new Map();
    for (const [text, ids] of renderMap) {
      const key = text.replace(/[0-9０-９\s]/g, '');
      let rec = merged.get(key);
      if (!rec) {
        rec = { text, repCount: 0, ids: new Set() };
        merged.set(key, rec);
      }
      if (ids.size > rec.repCount) {
        rec.text = text;
        rec.repCount = ids.size;
      }
      for (const id of ids) rec.ids.add(id);
    }
    if (merged.size < 2) continue;
    const renderings = [...merged.values()]
      .map((r) => ({ text: r.text, blockIds: [...r.ids], count: r.ids.size }))
      .sort((a, b) => b.count - a.count);
    const distinct = renderings.filter((r, i) =>
      !renderings.some((other, j) => j < i && (other.text.includes(r.text) || r.text.includes(other.text))));
    if (distinct.length < 2) continue;
    cases.push({ term, renderings: distinct });
  }
  cases.sort((a, b) => b.renderings[0].count - a.renderings[0].count);
  return cases;
}
