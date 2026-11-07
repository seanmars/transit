const SAME_LINE_Y_TOLERANCE = 2;

const SUPERSCRIPT_MAX_HEIGHT_RATIO = 0.75;
const SUP_APPENDAGE_MAX_CHARS = 6;

const SAME_LINE_MAX_X_GAP_FACTOR = 2;

const VERTICAL_GAP_FACTOR = 1.5;

const LINE_FONT_SIZE_DELTA_FACTOR = 0.5;

const LEFT_SHIFT_SPLIT_FACTOR = 6;
const ALIGN_TOLERANCE_FACTOR = 2;

const DOMINANT_FONT_NAME_PURITY_RATIO = 0.95;

const COLUMN_MIN_GAP_RATIO = 0.3;

const SILHOUETTE_BIAS_TO_FEWER_COLUMNS = 0.08;

const MIN_COLUMN_LINE_RATIO = 0.18;

const KMEANS_MAX_ITERS = 30;

const HEADING_FONT_SIZE_FACTOR = 1.2;
const HEADING_MAX_CHARS = 200;

const FOOTNOTE_FONT_SIZE_FACTOR = 0.85;
const FOOTNOTE_BOTTOM_THRESHOLD = 0.75;

const PAGE_NUMBER_EDGE_RATIO = 0.1;

const TABLE_MIN_LINES = 4;
const TABLE_MAX_AVG_CHARS = 35;

const LIST_SUBSPLIT_MIN_LINES = 2;
const LIST_SUBSPLIT_MARKER_RATIO = 0.5;
const LIST_MARKER_RE = /^\s*(?:[•·*]\s*|[-–—](?:\s|(?=[A-Za-z一-鿿「『（(]))|\d+[.)]\s|\([a-zA-Z0-9]+\)\s)/;

const WRAP_MERGE_MAX_LEFT_DELTA_FACTOR = 1;
const WRAP_MERGE_MIN_X_OVERLAP_RATIO = 0.7;

const NARROW_BLOCK_MAX_RIGHT_RATIO = 0.25;

const FORM_ROW_MAX_X_GAP_FACTOR = 12;

const FORM_SUBSPLIT_MIN_LINES = 2;
const FORM_SUBSPLIT_LABEL_RATIO = 0.4;
const FORM_LABEL_RE = /[:：]\s*$|^[A-Za-z一-鿿][\w\s一-鿿]{0,30}?[:：]\s*\S/;

const TABLE_CELL_MIN_RUNS = 3;
const TABLE_CELL_GAP_FACTOR = 1.2;

export function analyzeLayout(rawDoc) {
  const pages = rawDoc.pages.map((rawPage) => analyzePage(rawPage));
  return {
    meta: rawDoc.meta,
    pages,
    stats: rawDoc.stats,
    warnings: rawDoc.warnings,
    pdfDoc: rawDoc.pdfDoc,
  };
}

function analyzePage(rawPage) {
  const out = {
    pageIndex: rawPage.pageIndex,
    viewport: rawPage.viewport,
    blocks: [],
    medianLineHeight: 0,
    columnCount: 1,
  };
  if (typeof rawPage.mayHaveColoredBackground === 'boolean') out.mayHaveColoredBackground = rawPage.mayHaveColoredBackground;
  const runs = (rawPage.textRuns || []).slice();
  if (runs.length === 0) return out;

  const runHeights = runs
    .map((r) => r.bbox[3] - r.bbox[1])
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const medianLineHeight = runHeights.length > 0
    ? runHeights[Math.floor(runHeights.length / 2)]
    : 12;
  out.medianLineHeight = medianLineHeight;

  const initialLines = groupIntoLines(runs, medianLineHeight);
  if (initialLines.length === 0) return out;

  const mergedLines = mergeLabelValueRows(initialLines, medianLineHeight);

  const cellSplitLines = splitLinesAtCellGaps(mergedLines, medianLineHeight);

  const lines = absorbSupSubLines(cellSplitLines, medianLineHeight);

  markSiblingsInRow(lines, medianLineHeight);

  const pageWidth = rawPage.viewport.width || 0;
  const columnAssignments = detectColumns(lines, pageWidth);
  out.columnCount = columnAssignments.columnCount;

  const initialBlocks = splitIntoBlocksByAssignment(
    lines, columnAssignments.assignment, columnAssignments.columnCount, medianLineHeight);

  const afterHeadingSplit = [];
  for (const b of initialBlocks) {
    afterHeadingSplit.push(...maybeSplitHeadingsAcrossBlock(b, medianLineHeight));
  }

  const afterListSplit = [];
  for (const b of afterHeadingSplit) {
    const subBlocks = maybeSubsplitListBlock(b);
    afterListSplit.push(...subBlocks);
  }

  const colLefts = new Array(columnAssignments.columnCount).fill(Infinity);
  const colRights = new Array(columnAssignments.columnCount).fill(-Infinity);
  for (let i = 0; i < lines.length; i++) {
    const c = columnAssignments.assignment[i];
    if (lines[i].bbox[0] < colLefts[c]) colLefts[c] = lines[i].bbox[0];
    if (lines[i].bbox[2] > colRights[c]) colRights[c] = lines[i].bbox[2];
  }
  const afterNarrowSplit = [];
  for (const b of afterListSplit) {
    afterNarrowSplit.push(...maybeSplitNarrowMultilineBlock(b, colLefts, colRights));
  }

  const afterFormSplit = [];
  for (const b of afterNarrowSplit) {
    afterFormSplit.push(...maybeSubsplitFormBlock(b));
  }

  const blocks = [];
  for (const b of afterFormSplit) {
    blocks.push(...maybeSubsplitTableRowCells(b, medianLineHeight));
  }

  blocks.sort((a, b) => {
    if (a.column !== b.column) return a.column - b.column;
    return a.bbox[1] - b.bbox[1];
  });
  blocks.forEach((b, i) => { b.readingOrder = i; });

  blocks.forEach((b, i) => { b.blockId = `p${rawPage.pageIndex}-b${i}`; });

  const bodyFontSize = computeBodyFontSize(blocks);
  const ctx = {
    bodyFontSize,
    pageWidth: rawPage.viewport.width,
    pageHeight: rawPage.viewport.height,
  };
  for (const b of blocks) {
    b.type = classifyBlockType(b, ctx);
  }

  const exploded = [];
  for (const b of blocks) {
    if (b.type !== 'table' || !Array.isArray(b._lines) || b._lines.length < 2) {
      exploded.push(b);
      continue;
    }
    for (const l of b._lines) {
      if (!l.plainText || !l.plainText.trim()) continue;
      const lineBlock = buildBlockFromLines([toLineLike(l)], b.column);
      const cells = maybeSubsplitTableRowCells(lineBlock, medianLineHeight);
      for (const c of cells) c.type = classifyBlockType(c, ctx);
      exploded.push(...cells);
    }
  }
  const rowSplit = splitRowPairedBlocks(exploded, medianLineHeight, ctx);

  const merged = mergeWrapFragments(rowSplit, medianLineHeight);

  merged.sort((a, b) => {
    if (a.column !== b.column) return a.column - b.column;
    return a.bbox[1] - b.bbox[1];
  });
  merged.forEach((b, i) => {
    b.readingOrder = i;
    b.blockId = `p${rawPage.pageIndex}-b${i}`;
  });

  const tail = merged.filter((b) => b.type === 'footnote' || b.type === 'page-number');
  if (tail.length > 0 && tail.length < merged.length) {
    const head = merged.filter((b) => b.type !== 'footnote' && b.type !== 'page-number');
    const reordered = [...head, ...tail];
    reordered.forEach((b, i) => { b.readingOrder = i; });
    out.blocks = reordered;
  } else {
    out.blocks = merged;
  }
  out.bodyFontSize = bodyFontSize;
  return out;
}

function computeBodyFontSize(blocks) {
  const weighted = [];
  for (const b of blocks) {
    if (!b.fontSize) continue;
    for (let i = 0; i < b.lineCount; i++) weighted.push(b.fontSize);
  }
  if (weighted.length === 0) return 12;
  weighted.sort((a, b) => a - b);
  return weighted[Math.floor(weighted.length / 2)];
}

function classifyBlockType(block, ctx) {
  const { plainText = '', bbox, fontSize = 0, lineCount = 1 } = block;
  const { bodyFontSize, pageHeight, pageWidth } = ctx;
  const trimmed = plainText.trim();
  if (trimmed.length === 0) return 'paragraph';

  const blockTop = bbox[1];
  const blockBottom = bbox[3];
  const blockMidY = (blockTop + blockBottom) / 2;
  const blockWidth = bbox[2] - bbox[0];

  const pageNumRe = /^(?:page\s+)?(\d+|\d+\s*\/\s*\d+|\d+\s+of\s+\d+)\.?$/i;
  if (lineCount === 1 && pageNumRe.test(trimmed)) {
    const inTopEdge = blockMidY < pageHeight * PAGE_NUMBER_EDGE_RATIO;
    const inBottomEdge = blockMidY > pageHeight * (1 - PAGE_NUMBER_EDGE_RATIO);
    if (inTopEdge || inBottomEdge) return 'page-number';
  }

  const footnoteMarkerRe = /^(?:[0-9]+[.)]|[0-9]{1,3}\s+\S|[\^*†‡§])/;
  if (
    fontSize > 0 &&
    bodyFontSize > 0 &&
    fontSize < bodyFontSize * FOOTNOTE_FONT_SIZE_FACTOR &&
    blockTop > pageHeight * FOOTNOTE_BOTTOM_THRESHOLD &&
    footnoteMarkerRe.test(trimmed)
  ) {
    return 'footnote';
  }

  if (
    fontSize > 0 &&
    bodyFontSize > 0 &&
    fontSize > bodyFontSize * HEADING_FONT_SIZE_FACTOR &&
    trimmed.length < HEADING_MAX_CHARS
  ) {
    return 'heading';
  }

  const firstChar = trimmed.charAt(0);
  if ('•·-–—*'.includes(firstChar)) return 'list-item';
  if (/^\d+[.)]\s/.test(trimmed)) return 'list-item';
  if (/^\(?[a-zA-Z]\)\s/.test(trimmed)) return 'list-item';

  if (lineCount >= TABLE_MIN_LINES && (block._devLines || []).length > 0) {
    const lines = block._devLines;
    const avgChars = lines.reduce((s, l) => s + (l.text || '').length, 0) / lines.length;
    if (avgChars < TABLE_MAX_AVG_CHARS) {
      let leftJumps = 0;
      for (let i = 1; i < lines.length; i++) {
        const dl = Math.abs(lines[i].bbox[0] - lines[i - 1].bbox[0]);
        if (dl > blockWidth * 0.2) leftJumps++;
      }
      if (leftJumps >= Math.max(2, Math.floor(lines.length * 0.25))) {
        return 'table';
      }
    }
  }

  return 'paragraph';
}

function groupIntoLines(runs, medianLineHeight) {
  const sorted = runs.slice().sort((a, b) => a.bbox[1] - b.bbox[1]);
  const sameLineMaxXGap = medianLineHeight * SAME_LINE_MAX_X_GAP_FACTOR;

  const lines = [];
  let i = 0;
  while (i < sorted.length) {
    const refTop = sorted[i].bbox[1];
    let j = i;
    while (j + 1 < sorted.length && Math.abs(sorted[j + 1].bbox[1] - refTop) <= SAME_LINE_Y_TOLERANCE) {
      j++;
    }
    const row = sorted.slice(i, j + 1).sort((a, b) => a.bbox[0] - b.bbox[0]);
    let rowY1 = row[0].bbox[3];
    for (const r of row) { if (r.bbox[3] > rowY1) rowY1 = r.bbox[3]; }
    let currentLine = newLineFromRun(row[0]);
    for (let k = 1; k < row.length; k++) {
      const run = row[k];
      const xGap = run.bbox[0] - currentLine.bbox[2];
      if (xGap <= sameLineMaxXGap
          || residualGapAfterSupFill(currentLine.bbox[2], run.bbox[0], sorted, refTop, rowY1) <= sameLineMaxXGap) {
        currentLine.runs.push(run);
        currentLine.bbox = unionBBox(currentLine.bbox, run.bbox);
      } else {
        lines.push(finalizeLine(currentLine));
        currentLine = newLineFromRun(run);
      }
    }
    lines.push(finalizeLine(currentLine));
    i = j + 1;
  }
  return lines;
}

function newLineFromRun(run) {
  return {
    runs: [run],
    bbox: run.bbox.slice(),
    refTop: run.bbox[1],
  };
}

function splitLinesAtCellGaps(lines, medianLineHeight) {
  const gapThreshold = (medianLineHeight || 12) * TABLE_CELL_GAP_FACTOR;
  const formMaxGap = FORM_ROW_MAX_X_GAP_FACTOR * (medianLineHeight || 12);
  const bucketH = Math.max(1, medianLineHeight || 12);
  let yBuckets = null;
  const linesOverlappingY = (y0, y1) => {
    if (!yBuckets) {
      yBuckets = new Map();
      for (const l of lines) {
        const b0 = Math.floor(l.bbox[1] / bucketH), b1 = Math.floor(l.bbox[3] / bucketH);
        for (let b = b0; b <= b1; b++) {
          let arr = yBuckets.get(b);
          if (!arr) { arr = []; yBuckets.set(b, arr); }
          arr.push(l);
        }
      }
    }
    const b0 = Math.floor(y0 / bucketH), b1 = Math.floor(y1 / bucketH);
    if (b0 === b1) return yBuckets.get(b0) || [];
    const seen = new Set();
    const res = [];
    for (let b = b0; b <= b1; b++) {
      const arr = yBuckets.get(b);
      if (!arr) continue;
      for (const l of arr) { if (!seen.has(l)) { seen.add(l); res.push(l); } }
    }
    return res;
  };
  const out = [];
  for (const line of lines) {
    const runs = (line.runs || []);
    if (line._formRowMerged || runs.length < 2) {
      out.push(line);
      continue;
    }
    const isSupOccupiedGap = (x0, x1) => {
      const ly0 = line.bbox[1], ly1 = line.bbox[3];
      const otherRuns = [];
      for (const other of linesOverlappingY(ly0, ly1)) {
        if (other === line) continue;
        if (other.bbox[3] < ly0 || other.bbox[1] > ly1) continue;
        for (const r of (other.runs || [])) otherRuns.push(r);
      }
      return residualGapAfterSupFill(x0, x1, otherRuns, ly0, ly1) <= gapThreshold;
    };
    const sorted = runs.slice().sort((a, b) => a.bbox[0] - b.bbox[0]);
    const groups = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].bbox[0] - sorted[i - 1].bbox[2];
      const prevText = ((sorted[i - 1].text || '')).trim();
      const isFormBoundary = /[:：]$/.test(prevText) && gap <= formMaxGap;
      const groupText = groups[groups.length - 1].map((r) => r.text || '').join('').trim();
      const isListMarker = /^(?:[-•·*–—]|\d+[.)]|\([a-zA-Z0-9]+\))$/.test(groupText);
      if (gap > gapThreshold && !isFormBoundary && !isListMarker
          && !isSupOccupiedGap(sorted[i - 1].bbox[2], sorted[i].bbox[0])) groups.push([sorted[i]]);
      else groups[groups.length - 1].push(sorted[i]);
    }
    if (groups.length < 2) {
      out.push(line);
      continue;
    }
    for (const g of groups) {
      const nl = newLineFromRun(g[0]);
      for (let i = 1; i < g.length; i++) {
        nl.runs.push(g[i]);
        nl.bbox = unionBBox(nl.bbox, g[i].bbox);
      }
      out.push(finalizeLine(nl));
    }
  }
  return out;
}

function residualGapAfterSupFill(x0, x1, runs, rowY0, rowY1) {
  const rh = rowY1 - rowY0;
  if (!(rh > 0)) return x1 - x0;
  const ivs = [];
  for (const r of runs) {
    const rb = r.bbox;
    if (rb[2] <= x0 || rb[0] >= x1) continue;
    const h = rb[3] - rb[1];
    if (!(h > 0 && h <= rh * SUPERSCRIPT_MAX_HEIGHT_RATIO)) continue;
    const cy = (rb[1] + rb[3]) / 2;
    if (cy < rowY0 || cy > rowY1) continue;
    ivs.push([Math.max(x0, rb[0]), Math.min(x1, rb[2])]);
  }
  if (ivs.length === 0) return x1 - x0;
  ivs.sort((a, b) => a[0] - b[0]);
  let maxGap = 0;
  let cursor = x0;
  for (const [a, b] of ivs) {
    if (a > cursor && a - cursor > maxGap) maxGap = a - cursor;
    if (b > cursor) cursor = b;
  }
  if (x1 - cursor > maxGap) maxGap = x1 - cursor;
  return maxGap;
}

function absorbSupSubLines(lines, medianLineHeight) {
  const mlh = medianLineHeight || 12;
  const absorbedIdx = new Set();
  const hostExtraRuns = new Map();
  for (let si = 0; si < lines.length; si++) {
    const s = lines[si];
    const sTxt = (s.plainText || '').trim();
    if (!sTxt || sTxt.length > SUP_APPENDAGE_MAX_CHARS) continue;
    const sFs = s.fontSize || 0;
    if (!(sFs > 0)) continue;
    const cy = (s.bbox[1] + s.bbox[3]) / 2;
    let host = -1;
    let hostOverlap = -Infinity;
    for (let hi = 0; hi < lines.length; hi++) {
      if (hi === si || absorbedIdx.has(hi)) continue;
      const h = lines[hi];
      const hFs = h.fontSize || 0;
      if (!(hFs > 0 && sFs <= hFs * SUPERSCRIPT_MAX_HEIGHT_RATIO)) continue;
      if (!(cy >= h.bbox[1] && cy <= h.bbox[3])) continue;
      if (!(s.bbox[0] >= h.bbox[0] - mlh && s.bbox[2] <= h.bbox[2] + mlh)) continue;
      const overlap = Math.min(s.bbox[2], h.bbox[2]) - Math.max(s.bbox[0], h.bbox[0]);
      if (overlap > hostOverlap) { hostOverlap = overlap; host = hi; }
    }
    if (host < 0) continue;
    absorbedIdx.add(si);
    if (!hostExtraRuns.has(host)) hostExtraRuns.set(host, []);
    hostExtraRuns.get(host).push(...(s.runs || []));
    const carried = hostExtraRuns.get(si);
    if (carried) {
      hostExtraRuns.get(host).push(...carried);
      hostExtraRuns.delete(si);
    }
  }
  if (absorbedIdx.size === 0) return lines;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (absorbedIdx.has(i)) continue;
    const extra = hostExtraRuns.get(i);
    if (!extra) { out.push(lines[i]); continue; }
    const l = lines[i];
    const merged = { runs: l.runs.concat(extra), bbox: l.bbox.slice(), refTop: l.refTop };
    for (const r of extra) merged.bbox = unionBBox(merged.bbox, r.bbox);
    const fl = finalizeLine(merged);
    if (l._formRowMerged) fl._formRowMerged = true;
    out.push(fl);
  }
  return out;
}

function finalizeLine(line) {
  line.runs.sort((a, b) => a.bbox[0] - b.bbox[0]);
  const fontSizes = line.runs.map((r) => r.fontSize || 0).filter((s) => s > 0);
  const dominantFontSize = fontSizes.length > 0
    ? fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length
    : 0;
  const fontCounts = new Map();
  let totalChars = 0;
  for (const r of line.runs) {
    const fn = r.fontName || '';
    if (!fn) continue;
    const n = r.text ? r.text.length : 0;
    fontCounts.set(fn, (fontCounts.get(fn) || 0) + n);
    totalChars += n;
  }
  let dominantFontName = '';
  if (totalChars > 0) {
    let maxChars = 0;
    let candidate = '';
    for (const [fn, n] of fontCounts) {
      if (n > maxChars) { maxChars = n; candidate = fn; }
    }
    if (maxChars / totalChars >= DOMINANT_FONT_NAME_PURITY_RATIO) {
      dominantFontName = candidate;
    }
  }
  return {
    runs: line.runs,
    bbox: line.bbox,
    fontSize: dominantFontSize,
    dominantFontName,
    plainText: line.runs.map((r) => r.text).join(''),
  };
}

function detectColumns(lines, pageWidth) {
  const xs = lines.map((l) => l.bbox[0]);

  const candidates = [];
  for (let k = 1; k <= 3; k++) {
    if (xs.length < k) break;
    const result = kmeans1d(xs, k);
    if (!result) continue;
    const minGap = pageWidth > 0 ? pageWidth * COLUMN_MIN_GAP_RATIO * (2 / k) : 0;
    if (k > 1 && minPairwiseGap(result.centers) < minGap) continue;
    if (k > 1) {
      const counts = new Array(k).fill(0);
      for (const a of result.assignment) counts[a]++;
      const minRatio = Math.min(...counts) / xs.length;
      if (minRatio < MIN_COLUMN_LINE_RATIO) continue;
    }
    const score = k === 1 ? 0 : silhouetteScore(xs, result.assignment, result.centers);
    candidates.push({ k, ...result, score });
  }

  if (candidates.length === 0) {
    return {
      columnCount: 1,
      assignment: lines.map(() => 0),
      centers: [0],
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  let chosen = candidates[0];
  for (const c of candidates) {
    if (c.k < chosen.k && (chosen.score - c.score) < SILHOUETTE_BIAS_TO_FEWER_COLUMNS) {
      chosen = c;
    }
  }

  const order = chosen.centers
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c - b.c)
    .map((e) => e.i);
  const idMap = new Map();
  order.forEach((origId, newId) => idMap.set(origId, newId));
  const assignment = chosen.assignment.map((id) => idMap.get(id));

  return {
    columnCount: chosen.k,
    assignment,
    centers: chosen.centers.slice().sort((a, b) => a - b),
  };
}

function kmeans1d(values, k) {
  if (k === 1) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { centers: [mean], assignment: values.map(() => 0) };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const uniq = sorted.filter((v, i) => i === 0 || v !== sorted[i - 1]);
  if (uniq.length < k) return null;
  let centers = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((i + 0.5) * uniq.length / k);
    centers.push(uniq[Math.min(idx, uniq.length - 1)]);
  }

  let assignment = new Array(values.length).fill(0);
  for (let iter = 0; iter < KMEANS_MAX_ITERS; iter++) {
    let changed = false;
    for (let i = 0; i < values.length; i++) {
      let bestK = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = Math.abs(values[i] - centers[c]);
        if (d < bestD) { bestD = d; bestK = c; }
      }
      if (assignment[i] !== bestK) {
        assignment[i] = bestK;
        changed = true;
      }
    }
    const sums = new Array(k).fill(0);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < values.length; i++) {
      sums[assignment[i]] += values[i];
      counts[assignment[i]] += 1;
    }
    const newCenters = centers.slice();
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) newCenters[c] = sums[c] / counts[c];
    }
    centers = newCenters;
    if (!changed) break;
  }

  const counts = new Array(k).fill(0);
  for (const a of assignment) counts[a]++;
  if (counts.some((c) => c === 0)) return null;

  return { centers, assignment };
}

function minPairwiseGap(centers) {
  let minGap = Infinity;
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const d = Math.abs(centers[i] - centers[j]);
      if (d < minGap) minGap = d;
    }
  }
  return minGap === Infinity ? 0 : minGap;
}

function silhouetteScore(values, assignment, centers) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const own = assignment[i];
    const a = Math.abs(values[i] - centers[own]);
    let b = Infinity;
    for (let c = 0; c < centers.length; c++) {
      if (c === own) continue;
      const d = Math.abs(values[i] - centers[c]);
      if (d < b) b = d;
    }
    if (b === Infinity) continue;
    const denom = Math.max(a, b);
    if (denom > 0) {
      sum += (b - a) / denom;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

const SIBLING_ROW_MIN_X_GAP_FACTOR = 8;

function markSiblingsInRow(lines, medianLineHeight) {
  const minGap = SIBLING_ROW_MIN_X_GAP_FACTOR * (medianLineHeight || 12);
  const sortedIdx = lines.map((_, i) => i).sort((a, b) => lines[a].bbox[1] - lines[b].bbox[1]);
  let groupStart = 0;
  while (groupStart < sortedIdx.length) {
    let groupEnd = groupStart;
    const refTop = lines[sortedIdx[groupStart]].bbox[1];
    while (groupEnd + 1 < sortedIdx.length &&
      Math.abs(lines[sortedIdx[groupEnd + 1]].bbox[1] - refTop) <= SAME_LINE_Y_TOLERANCE) {
      groupEnd++;
    }
    const groupSize = groupEnd - groupStart + 1;
    if (groupSize === 2) {
      const a = lines[sortedIdx[groupStart]];
      const b = lines[sortedIdx[groupEnd]];
      const left = a.bbox[0] < b.bbox[0] ? a : b;
      const right = a.bbox[0] < b.bbox[0] ? b : a;
      const xGap = right.bbox[0] - left.bbox[2];
      if (xGap >= minGap) {
        a.siblingsInRow = true;
        b.siblingsInRow = true;
        a.siblingLine = b;
        b.siblingLine = a;
      }
    }
    groupStart = groupEnd + 1;
  }
}

export function splitIntoBlocksByAssignment(lines, assignment, columnCount, medianLineHeight) {
  const initialBlocks = [];
  const colOf = new Map();
  lines.forEach((l, i) => colOf.set(l, assignment[i]));
  for (const l of lines) {
    if (l.siblingsInRow && l.siblingLine) l.siblingColumn = colOf.has(l.siblingLine) ? colOf.get(l.siblingLine) : null;
  }
  for (let colIdx = 0; colIdx < columnCount; colIdx++) {
    const colLines = lines.filter((_, i) => assignment[i] === colIdx);
    colLines.sort((a, b) => a.bbox[1] - b.bbox[1]);
    const colBlocks = splitColumnIntoBlocks(colLines, medianLineHeight, colIdx);
    initialBlocks.push(...colBlocks);
  }
  return initialBlocks;
}

function splitColumnIntoBlocks(colLines, medianLineHeight, columnIdx) {
  if (colLines.length === 0) return [];
  const blocks = [];
  let currentLines = [colLines[0]];
  for (let i = 1; i < colLines.length; i++) {
    const prev = colLines[i - 1];
    const cur = colLines[i];
    const prevSib = prev.siblingsInRow && (prev.siblingColumn == null || prev.siblingColumn === columnIdx);
    const curSib = cur.siblingsInRow && (cur.siblingColumn == null || cur.siblingColumn === columnIdx);
    if (prevSib || curSib) {
      blocks.push(buildBlockFromLines(currentLines, columnIdx));
      currentLines = [cur];
      continue;
    }
    const gap = cur.bbox[1] - prev.bbox[3];
    const fontDelta = Math.abs((cur.fontSize || 0) - (prev.fontSize || 0));
    const splitOnGap = gap > VERTICAL_GAP_FACTOR * medianLineHeight;
    const splitOnFont = fontDelta > LINE_FONT_SIZE_DELTA_FACTOR * medianLineHeight;
    const splitOnSameRow = (cur.bbox[1] - prev.bbox[1]) < medianLineHeight * 0.5;
    const leftDelta = Math.abs(cur.bbox[0] - prev.bbox[0]);
    const centerDelta = Math.abs((cur.bbox[0] + cur.bbox[2]) - (prev.bbox[0] + prev.bbox[2])) / 2;
    const rightDelta = Math.abs(cur.bbox[2] - prev.bbox[2]);
    const alignTol = ALIGN_TOLERANCE_FACTOR * medianLineHeight;
    const splitOnLeftShift = leftDelta > LEFT_SHIFT_SPLIT_FACTOR * medianLineHeight
      && centerDelta > alignTol && rightDelta > alignTol;
    if (splitOnGap || splitOnFont || splitOnLeftShift || splitOnSameRow) {
      blocks.push(buildBlockFromLines(currentLines, columnIdx));
      currentLines = [cur];
    } else {
      currentLines.push(cur);
    }
  }
  blocks.push(buildBlockFromLines(currentLines, columnIdx));
  return blocks;
}

function toLineLike(l) {
  return {
    bbox: l.bbox,
    runs: l.runs || [],
    fontSize: l.fontSize,
    plainText: l.plainText,
    dominantFontName: l.dominantFontName,
  };
}

function buildBlockFromLines(lines, columnIdx) {
  let bbox = lines[0].bbox.slice();
  for (let i = 1; i < lines.length; i++) bbox = unionBBox(bbox, lines[i].bbox);

  const { styleSegments, linkUrls } = buildStyleSegments(lines);

  const plainText = styleSegments.map((s) => s.text).join('').replace(/\s+/g, ' ').trim();

  const fs = lines.map((l) => l.fontSize).filter((s) => s > 0);
  const fontSize = fs.length > 0 ? fs.reduce((a, b) => a + b, 0) / fs.length : 0;

  const runCount = lines.reduce((sum, l) => sum + l.runs.length, 0);

  const internalLines = lines.map((l) => ({
    bbox: l.bbox,
    plainText: l.plainText || '',
    fontSize: l.fontSize || 0,
    dominantFontName: l.dominantFontName || '',
    runs: l.runs || [],
  }));

  return {
    blockId: '',
    type: 'paragraph',
    bbox,
    column: columnIdx,
    readingOrder: 0,
    plainText,
    styleSegments,
    linkUrls,
    fontSize,
    lineCount: lines.length,
    runCount,
    _lines: internalLines,
    _devLines: internalLines.map((l) => ({ bbox: l.bbox, text: l.plainText.slice(0, 60) })),
  };
}

export { buildStyleSegments };
function buildStyleSegments(lines) {
  const segments = [];
  let cur = null;
  let prevRun = null;
  for (let li = 0; li < lines.length; li++) {
    const runs = (lines[li] && lines[li].runs) || [];
    for (const r of runs) {
      if (!r || !r.text) continue;
      if (cur && prevRun && Array.isArray(r.bbox) && Array.isArray(prevRun.bbox)) {
        const gap = r.bbox[0] - prevRun.bbox[2];
        const fontSize = r.fontSize || prevRun.fontSize || 12;
        const prevEnd = cur.text.slice(-1);
        const curStart = r.text[0];
        if (gap > fontSize * 0.1 && !/\s/.test(prevEnd) && !/\s/.test(curStart)) {
          cur.text += ' ';
        }
      }
      const isBold = !!r.isBold;
      const isItalic = !!r.isItalic;
      const linkUrl = r.linkUrl || null;
      if (
        cur && cur.isBold === isBold && cur.isItalic === isItalic && cur.linkUrl === linkUrl
      ) {
        cur.text += r.text;
      } else {
        if (cur) segments.push(cur);
        cur = { text: r.text, isBold, isItalic, linkUrl };
      }
      prevRun = r;
    }
    if (li < lines.length - 1 && cur) cur.text += ' ';
    prevRun = null;
  }
  if (cur) segments.push(cur);
  for (const s of segments) s.text = s.text.replace(/\s+/g, ' ');
  if (segments.length > 0) {
    segments[0].text = segments[0].text.replace(/^\s+/, '');
    segments[segments.length - 1].text = segments[segments.length - 1].text.replace(/\s+$/, '');
  }
  const filtered = segments.filter((s) => s.text.length > 0);
  const linkUrls = [];
  for (const s of filtered) {
    if (s.linkUrl && !linkUrls.includes(s.linkUrl)) linkUrls.push(s.linkUrl);
  }
  return { styleSegments: filtered, linkUrls };
}

const HEADING_SHAPED_MIN_CHARS = 3;
const HEADING_SHAPED_MAX_CHARS = 60;
const HEADING_REST_PURITY_RATIO = 0.5;

const HEADING_PRECEDING_GAP_FACTOR = 1.0;

function maybeSplitHeadingsAcrossBlock(block, medianLineHeight) {
  const lines = block._lines || [];
  if (lines.length < 2) return [block];

  const fontCounts = new Map();
  let totalChars = 0;
  for (const l of lines) {
    const fn = l.dominantFontName;
    if (!fn) continue;
    const n = (l.plainText || '').length;
    fontCounts.set(fn, (fontCounts.get(fn) || 0) + n);
    totalChars += n;
  }
  if (totalChars === 0) return [block];
  let majorityFn = '';
  let majorityMax = 0;
  for (const [fn, n] of fontCounts) {
    if (n > majorityMax) { majorityMax = n; majorityFn = fn; }
  }
  if (!majorityFn || majorityMax / totalChars < HEADING_REST_PURITY_RATIO) return [block];

  const headingIdxs = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.dominantFontName || l.dominantFontName === majorityFn) continue;
    const txt = l.plainText || '';
    if (txt.length < HEADING_SHAPED_MIN_CHARS || txt.length > HEADING_SHAPED_MAX_CHARS) continue;
    if (i > 0) {
      const gapBefore = l.bbox[1] - lines[i - 1].bbox[3];
      if (gapBefore < medianLineHeight * HEADING_PRECEDING_GAP_FACTOR) continue;
    }
    headingIdxs.push(i);
  }
  if (headingIdxs.length === 0) return [block];

  const segments = [];
  let cursor = 0;
  for (const idx of headingIdxs) {
    if (idx > cursor) segments.push(lines.slice(cursor, idx));
    segments.push([lines[idx]]);
    cursor = idx + 1;
  }
  if (cursor < lines.length) segments.push(lines.slice(cursor));

  return segments
    .filter((seg) => seg.length > 0)
    .map((seg) =>
      buildBlockFromLines(
        seg.map(toLineLike),
        block.column
      )
    );
}

function maybeSubsplitListBlock(block) {
  const lines = block._lines || [];
  if (lines.length < LIST_SUBSPLIT_MIN_LINES) return [block];

  const isMarker = lines.map((l) => LIST_MARKER_RE.test(l.plainText || ''));
  let firstMarker = isMarker.indexOf(true);
  if (firstMarker < 0) return [block];
  const listLines = lines.length - firstMarker;
  const markerCount = isMarker.filter(Boolean).length;
  if (listLines < LIST_SUBSPLIT_MIN_LINES || markerCount < listLines * LIST_SUBSPLIT_MARKER_RATIO) return [block];
  if (firstMarker > 2) return [block];

  const groups = [];
  let current = [];
  for (let i = 0; i < lines.length; i++) {
    if (isMarker[i] && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(lines[i]);
  }
  if (current.length > 0) groups.push(current);

  if (groups.length < 2) return [block];

  const totalLines = lines.length;
  const parentRunCount = block.runCount || 0;
  return groups.map((g) => {
    const lineLikes = g.map(toLineLike);
    const subBlock = buildBlockFromLines(lineLikes, block.column);
    subBlock.runCount = Math.round(parentRunCount * (g.length / totalLines));
    return subBlock;
  });
}

function mergeLabelValueRows(lines, medianLineHeight) {
  if (lines.length < 2) return lines;
  const maxXGap = FORM_ROW_MAX_X_GAP_FACTOR * (medianLineHeight || 12);
  const sorted = lines.slice().sort((a, b) => a.bbox[1] - b.bbox[1]);
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    const refTop = sorted[i].bbox[1];
    let j = i;
    while (j + 1 < sorted.length && Math.abs(sorted[j + 1].bbox[1] - refTop) <= SAME_LINE_Y_TOLERANCE) {
      j++;
    }
    const row = sorted.slice(i, j + 1).sort((a, b) => a.bbox[0] - b.bbox[0]);
    const consumed = new Set();
    for (let k = 0; k < row.length; k++) {
      if (consumed.has(k)) continue;
      const a = row[k];
      const aText = (a.plainText || '').trim();
      if (/[:：]\s*$/.test(aText)) {
        for (let l = k + 1; l < row.length; l++) {
          if (consumed.has(l)) continue;
          const b = row[l];
          const xGap = b.bbox[0] - a.bbox[2];
          if (xGap < 0 || xGap > maxXGap) continue;
          a.plainText = aText + ' ' + (b.plainText || '');
          a.runs = [...(a.runs || []), ...(b.runs || [])];
          a.bbox = unionBBox(a.bbox, b.bbox);
          a._formRowMerged = true;
          consumed.add(l);
          break;
        }
      }
      out.push(a);
    }
    i = j + 1;
  }
  return out;
}

function maybeSubsplitFormBlock(block) {
  const lines = block._lines || [];
  if (lines.length < FORM_SUBSPLIT_MIN_LINES) return [block];
  const labelLines = lines.filter((l) => FORM_LABEL_RE.test(l.plainText || ''));
  if (labelLines.length < lines.length * FORM_SUBSPLIT_LABEL_RATIO) return [block];
  return lines.map((l) => buildBlockFromLines([toLineLike(l)], block.column));
}

function maybeSubsplitTableRowCells(block, medianLineHeight) {
  if (block.lineCount !== 1) return [block];
  const lines = block._lines || [];
  if (lines.length !== 1) return [block];
  const line = lines[0];
  const runs = (line.runs || []).slice();
  if (runs.length < TABLE_CELL_MIN_RUNS) return [block];

  runs.sort((a, b) => a.bbox[0] - b.bbox[0]);
  const gapThreshold = (medianLineHeight || 12) * TABLE_CELL_GAP_FACTOR;

  const groups = [[runs[0]]];
  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1];
    const cur = runs[i];
    const gap = cur.bbox[0] - prev.bbox[2];
    if (gap > gapThreshold) {
      groups.push([cur]);
    } else {
      groups[groups.length - 1].push(cur);
    }
  }
  if (groups.length < 2) return [block];

  return groups.map((group) => {
    let bbox = group[0].bbox.slice();
    for (let i = 1; i < group.length; i++) bbox = unionBBox(bbox, group[i].bbox);
    const text = group.map((r) => r.text).join('');
    const lineLikes = [{
      bbox,
      runs: group,
      fontSize: line.fontSize,
      plainText: text,
      dominantFontName: line.dominantFontName,
    }];
    const sub = buildBlockFromLines(lineLikes, block.column);
    sub._isCellBlock = true;
    return sub;
  });
}

function splitRowPairedBlocks(blocks, medianLineHeight, ctx) {
  const singles = blocks.filter((b) => b.lineCount === 1);
  const out = [];
  for (const b of blocks) {
    const lines = b._lines || [];
    if (
      (b.type !== 'paragraph' && b.type !== 'list-item')
      || lines.length < 2 || lines.length > 8
    ) {
      out.push(b);
      continue;
    }
    const partnerIds = [];
    let ok = true;
    for (const l of lines) {
      const ly0 = l.bbox[1];
      const ly1 = l.bbox[3];
      const lh = Math.max(1, ly1 - ly0);
      let best = null;
      let bestDx = Infinity;
      for (const s of singles) {
        if (s === b) continue;
        if (!(s.bbox[0] >= b.bbox[2] - 1 || s.bbox[2] <= b.bbox[0] + 1)) continue;
        const ov = Math.min(s.bbox[3], ly1) - Math.max(s.bbox[1], ly0);
        if (ov < lh * 0.6) continue;
        const dx = s.bbox[0] >= b.bbox[2] - 1 ? s.bbox[0] - b.bbox[2] : b.bbox[0] - s.bbox[2];
        if (dx < bestDx) { bestDx = dx; best = s; }
      }
      if (!best) { ok = false; break; }
      partnerIds.push(best);
    }
    if (!ok || new Set(partnerIds).size !== lines.length) {
      out.push(b);
      continue;
    }
    for (const l of lines) {
      if (!l.plainText || !l.plainText.trim()) continue;
      const lineBlock = buildBlockFromLines([toLineLike(l)], b.column);
      lineBlock.type = classifyBlockType(lineBlock, ctx);
      out.push(lineBlock);
    }
  }
  return out;
}

function mergeWrapFragments(blocks, medianLineHeight) {
  const mlh = medianLineHeight || 12;
  const gapMin = -0.25 * mlh;
  const gapMax = VERTICAL_GAP_FACTOR * mlh;
  const leftTol = WRAP_MERGE_MAX_LEFT_DELTA_FACTOR * mlh;
  const fontTol = LINE_FONT_SIZE_DELTA_FACTOR * mlh;

  const wordCount = (b) => ((b.plainText || '').trim().split(/\s+/).filter(Boolean).length);
  const canBeHead = (b) => (b.type === 'paragraph' || b.type === 'list-item')
    && wordCount(b) >= 4
    && !(b.plainText || '').includes('://');
  const canBeTail = (b) => b.type === 'paragraph'
    && /^[a-z]/.test((b.plainText || '').trim())
    && wordCount(b) >= 2
    && !FORM_LABEL_RE.test((b.plainText || '').trim())
    && !/[:：]\s*$/.test((b.plainText || '').trim())
    && !(b.plainText || '').includes('://');

  const consumed = new Set();
  const out = [];
  const sorted = blocks.slice().sort((a, b) => {
    if (a.column !== b.column) return a.column - b.column;
    return a.bbox[1] - b.bbox[1];
  });
  for (let i = 0; i < sorted.length; i++) {
    if (consumed.has(i)) continue;
    let cur = sorted[i];
    if (canBeHead(cur)) {
      let extended = true;
      while (extended) {
        extended = false;
        for (let j = i + 1; j < sorted.length; j++) {
          if (consumed.has(j)) continue;
          const cand = sorted[j];
          if (cand.column !== cur.column) continue;
          const gap = cand.bbox[1] - cur.bbox[3];
          if (gap > gapMax) break;
          if (gap < gapMin) continue;
          if (!canBeTail(cand)) continue;
          if (Math.abs(cand.bbox[0] - cur.bbox[0]) > leftTol) continue;
          const overlap = Math.min(cur.bbox[2], cand.bbox[2]) - Math.max(cur.bbox[0], cand.bbox[0]);
          const narrower = Math.min(cur.bbox[2] - cur.bbox[0], cand.bbox[2] - cand.bbox[0]);
          if (narrower <= 0 || overlap < narrower * WRAP_MERGE_MIN_X_OVERLAP_RATIO) continue;
          if (Math.abs((cur.fontSize || 0) - (cand.fontSize || 0)) > fontTol) continue;
          const mergedBlock = buildBlockFromLines(
            [...(cur._lines || []), ...(cand._lines || [])].map(toLineLike),
            cur.column
          );
          mergedBlock.type = cur.type;
          if (cur._isCellBlock || cand._isCellBlock) mergedBlock._isCellBlock = true;
          consumed.add(j);
          cur = mergedBlock;
          extended = true;
          break;
        }
      }
    }
    out.push(cur);
  }
  return out;
}

function maybeSplitNarrowMultilineBlock(block, colLefts, colRights) {
  const lines = block._lines || [];
  if (lines.length < 2) return [block];
  const colLeft = colLefts[block.column];
  const colRight = colRights[block.column];
  const colWidth = colRight - colLeft;
  if (!isFinite(colWidth) || colWidth <= 0) return [block];

  let maxLineRight = -Infinity;
  for (const l of lines) {
    if (l.bbox[2] > maxLineRight) maxLineRight = l.bbox[2];
  }
  const ratio = (maxLineRight - colLeft) / colWidth;
  if (ratio >= NARROW_BLOCK_MAX_RIGHT_RATIO) return [block];

  return lines.map((l) => buildBlockFromLines([toLineLike(l)], block.column));
}

export { maybeSplitNarrowMultilineBlock, mergeLabelValueRows, maybeSubsplitFormBlock, maybeSubsplitTableRowCells, groupIntoLines, splitLinesAtCellGaps, mergeWrapFragments, maybeSubsplitListBlock, splitRowPairedBlocks };

function unionBBox(a, b) {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ];
}

