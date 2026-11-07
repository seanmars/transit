import * as pdfjsLib from '../lib/vendor/pdfjs/pdf.min.mjs';
import { TRANSLATABLE_TYPES } from './block-types.js';
import { pageMayHaveColoredBackground } from './pdf-oplist.js';
import { loadRemoteFontForLanguage, remoteFontKeyFor } from '../lib/font-loader.js';
import { getSettings } from '../lib/storage.js';

const FONT_PATH_REGULAR = 'lib/vendor/fonts/NotoSansTC-Regular.ttf';
const FONT_PATH_BOLD = 'lib/vendor/fonts/NotoSansTC-Bold.ttf';

async function loadFontBytes(path, cacheRef) {
  if (cacheRef.value) return cacheRef.value;
  const url = chrome.runtime.getURL(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`字型載入失敗：${res.status} (${path})`);
  cacheRef.value = await res.arrayBuffer();
  return cacheRef.value;
}
const regularRef = { value: null };
const boldRef = { value: null };
const loadCJKRegularBytes = () => loadFontBytes(FONT_PATH_REGULAR, regularRef);
const loadCJKBoldBytes = () => loadFontBytes(FONT_PATH_BOLD, boldRef);
const remoteFontBytesByKey = new Map();

async function resolveCjkFontBytes(targetLanguage, onProgress) {
  let lang = targetLanguage;
  if (!lang) {
    try { lang = (await getSettings()).targetLanguage || 'zh-TW'; } catch { lang = 'zh-TW'; }
  }
  const key = remoteFontKeyFor(lang);
  if (key) {
    let remote = remoteFontBytesByKey.get(key) || null;
    if (!remote) {
      const r = await loadRemoteFontForLanguage(lang, {
        onProgress: (p) => onProgress({ stage: 'font', remote: true, fontKey: key, ...p }),
      });
      if (r && r.regular) { remote = r; remoteFontBytesByKey.set(key, r); }
    }
    if (remote) return { regular: remote.regular, bold: remote.bold, source: key, fallback: false };
    console.warn(`[Transit] ${key} 字型抓不到，譯文退回內建 Noto Sans TC（該語言專用字可能顯示方框）`);
    const regular = await loadCJKRegularBytes();
    let bold = null;
    try { bold = await loadCJKBoldBytes(); } catch { bold = null; }
    return { regular, bold, source: 'builtin', fallback: true };
  }
  const regular = await loadCJKRegularBytes();
  let bold = null;
  try { bold = await loadCJKBoldBytes(); } catch { bold = null; }
  return { regular, bold, source: 'builtin', fallback: false };
}

function matMulAffine(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
function invertAffine(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}
function applyAffine(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function transformRect(m, rect) {
  const pts = [applyAffine(m, rect[0], rect[1]), applyAffine(m, rect[2], rect[1]), applyAffine(m, rect[0], rect[3]), applyAffine(m, rect[2], rect[3])];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export async function buildBilingualPdf(originalArrayBuffer, layoutDoc, options = {}) {
  const { onProgress = () => {} } = options;
  if (!window.PDFLib) throw new Error('pdf-lib 未載入(index.html <script> 標籤少？)');
  if (!window.fontkit) throw new Error('fontkit 未載入');
  const { PDFDocument, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = window.PDFLib;

  onProgress({ stage: 'init' });
  const newDoc = await PDFDocument.create();
  newDoc.registerFontkit(window.fontkit);

  onProgress({ stage: 'font' });
  const fontSel = await resolveCjkFontBytes(options.targetLanguage, onProgress);
  const cjkFontRegular = await newDoc.embedFont(fontSel.regular, { subset: true });
  let cjkFontBold;
  try {
    if (!fontSel.bold) throw new Error('no bold font');
    cjkFontBold = await newDoc.embedFont(fontSel.bold, { subset: true });
  } catch (boldErr) {
    console.warn('[transit] CJK Bold font unavailable — falling back to Regular', boldErr);
    cjkFontBold = cjkFontRegular;
  }

  onProgress({ stage: 'parsing' });
  const origDoc = await PDFDocument.load(originalArrayBuffer.slice(0), { ignoreEncryption: true, password: '' });
  const pageCount = layoutDoc.pages.length;
  const origPages = origDoc.getPages().slice(0, pageCount);
  const embeddedPages = await newDoc.embedPages(origPages);

  const sharedPdfDoc = options.pdfDoc || layoutDoc.pdfDoc || null;
  let pdfMetaByPage = Array.isArray(layoutDoc._overlayMeta) && layoutDoc._overlayMeta.length >= pageCount
    ? layoutDoc._overlayMeta
    : null;
  if (!pdfMetaByPage) {
    pdfMetaByPage = await extractPdfMetaForOverlay(originalArrayBuffer, pageCount, layoutDoc, sharedPdfDoc);
    if (pdfMetaByPage.length >= pageCount) layoutDoc._overlayMeta = pdfMetaByPage;
  }

  for (let i = 0; i < pageCount; i++) {
    onProgress({ stage: 'page', current: i + 1, total: pageCount });
    const layoutPage = layoutDoc.pages[i];
    const pageH = layoutPage.viewport.height;
    const meta = resolveOverlayMeta(pdfMetaByPage[i], layoutPage);
    const embedded = embeddedPages[i];
    const origPage = origPages[i];
    const mb = origPage.getMediaBox();
    const cb = origPage.getCropBox();
    const newPage = newDoc.addPage([mb.width, mb.height]);
    newPage.setMediaBox(mb.x, mb.y, mb.width, mb.height);
    if (cb && (cb.x !== mb.x || cb.y !== mb.y || cb.width !== mb.width || cb.height !== mb.height)) {
      newPage.setCropBox(cb.x, cb.y, cb.width, cb.height);
    }
    if (meta.rotation) newPage.setRotation(degrees(meta.rotation));
    newPage.drawPage(embedded, { x: mb.x, y: mb.y, width: embedded.width, height: embedded.height });
    const hasTransform = Array.isArray(meta.viewportTransform) && meta.viewportTransform.length === 6;
    const overlayMatrix = hasTransform
      ? matMulAffine(invertAffine(meta.viewportTransform), [1, 0, 0, -1, 0, pageH])
      : [1, 0, 0, 1, 0, 0];
    const rotated = hasTransform;
    if (rotated) newPage.pushOperators(pushGraphicsState(), concatTransformationMatrix(...overlayMatrix));
    let translatedLinkRects = drawTranslatedOverlay(newPage, layoutPage, cjkFontRegular, cjkFontBold, meta.items, meta.blockColors || {});
    if (rotated) {
      newPage.pushOperators(popGraphicsState());
      translatedLinkRects = translatedLinkRects.map((l) => ({ url: l.url, rect: transformRect(overlayMatrix, l.rect) }));
    }
    const coveredUrls = new Set(translatedLinkRects.map((l) => l.url));
    const fallbackLinks = meta.links.filter((l) => !coveredUrls.has(l.url));
    addLinkAnnotations(newDoc, newPage, [...translatedLinkRects, ...fallbackLinks]);
  }

  onProgress({ stage: 'saving' });
  const pdfBytes = await newDoc.save();
  const baseName = (layoutDoc.meta.filename || 'document').replace(/\.pdf$/i, '');
  const filename = `${baseName}-transit.pdf`;
  return { bytes: pdfBytes, filename, byteLength: pdfBytes.byteLength, fontSource: fontSel.source, fontFallback: fontSel.fallback };
}

export function resolveOverlayMeta(extracted, layoutPage) {
  if (extracted) return extracted;
  const vp = (layoutPage && layoutPage.viewport) || {};
  const transform = Array.isArray(vp.transform) && vp.transform.length === 6 ? vp.transform.slice() : null;
  const rotation = Number.isFinite(vp.rotation) ? ((vp.rotation % 360) + 360) % 360 : 0;
  return { links: [], items: [], blockColors: {}, rotation, viewportTransform: transform };
}

export async function downloadBilingualPdf(originalArrayBuffer, layoutDoc, options = {}) {
  let result;
  if (options.prebuiltBytes) {
    const baseName = (layoutDoc.meta.filename || 'document').replace(/\.pdf$/i, '');
    result = {
      bytes: options.prebuiltBytes,
      filename: `${baseName}-transit.pdf`,
      byteLength: options.prebuiltBytes.byteLength,
    };
  } else {
    result = await buildBilingualPdf(originalArrayBuffer, layoutDoc, options);
  }
  const fontFallback = !!result.fontFallback;
  const blob = new Blob([result.bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { filename: result.filename, byteLength: result.byteLength, fontFallback, fontSource: result.fontSource || null };
}

const ITALIC_SKEW = Math.tan(12 * Math.PI / 180);
const ATOMIC_CHUNK_MAX_CHARS = 14;
const LINK_RGB = [0, 0.27, 0.55];
const LINK_RGB_ON_DARK = [0.55, 0.78, 1];
const UNDERLINE_OFFSET_RATIO = 0.12;
const UNDERLINE_THICKNESS_RATIO = 0.06;

export function uniformBlockStyle(block) {
  const src = block && block.styleSegments;
  if (!Array.isArray(src) || src.length === 0) return null;
  let isBold = null;
  let isItalic = null;
  for (const s of src) {
    if (!s || typeof s.text !== 'string' || s.text.trim().length === 0) continue;
    if (isBold === null) {
      isBold = !!s.isBold;
      isItalic = !!s.isItalic;
      continue;
    }
    if (!!s.isBold !== isBold || !!s.isItalic !== isItalic) return null;
  }
  if (isBold === null) return null;
  return (isBold || isItalic) ? { isBold, isItalic } : null;
}

export function drawTranslatedOverlay(page, layoutPage, fontRegular, fontBold, items, blockColors = {}) {
  const { rgb, setTextRenderingMode, TextRenderingMode } = window.PDFLib;
  const pageH = layoutPage.viewport.height;
  const translatedLinkRects = [];
  let clippedBlocks = 0;
  let droppedPieces = 0;
  const maskColorOf = (block) => {
    const c = blockColors[block.blockId];
    return c && c.bg ? rgb(c.bg[0] / 255, c.bg[1] / 255, c.bg[2] / 255) : rgb(1, 1, 1);
  };
  const isDarkBg = (block) => {
    const c = blockColors[block.blockId];
    return !!(c && c.bg && (0.299 * c.bg[0] + 0.587 * c.bg[1] + 0.114 * c.bg[2]) < 128);
  };
  const textColorOf = (block) => {
    const c = blockColors[block.blockId];
    if (c && c.fg) return rgb(c.fg[0] / 255, c.fg[1] / 255, c.fg[2] / 255);
    return isDarkBg(block) ? rgb(1, 1, 1) : rgb(0, 0, 0);
  };
  const linkColorOf = (block) => (isDarkBg(block)
    ? rgb(LINK_RGB_ON_DARK[0], LINK_RGB_ON_DARK[1], LINK_RGB_ON_DARK[2])
    : rgb(LINK_RGB[0], LINK_RGB[1], LINK_RGB[2]));

  const prepared = [];
  for (const block of layoutPage.blocks) {
    if (!TRANSLATABLE_TYPES.has(block.type)) continue;
    if (!block.translation || block.translation.trim().length === 0) continue;

    const [origX0, origY0, origX1, origY1] = block.bbox;
    if (origX1 <= origX0 || origY1 <= origY0) continue;

    let segs = Array.isArray(block.translationSegments) && block.translationSegments.length > 0
      ? block.translationSegments
      : [{ text: block.translation, isBold: false, isItalic: false, linkUrl: null }];

    segs = segs.map((s) => (s.text && s.text.includes('\n')
      ? { ...s, text: s.text.replace(/\s*\n+\s*/g, ' ') }
      : s));

    const uniform = uniformBlockStyle(block);
    if (uniform && segs.every((s) => !s.isBold && !s.isItalic)) {
      segs = segs.map((s) => ({ ...s, isBold: uniform.isBold, isItalic: uniform.isItalic }));
    }

    const fit = fitSegmentsToBox(
      segs, fontRegular, fontBold, block.fontSize, block, layoutPage,
    );
    prepared.push({ block, fit });
  }

  for (const { block, fit } of prepared) {
    const isCellBlock = block._isCellBlock === true;
    if (isCellBlock) {
      const [bx0, by0, bx1, by1] = block.bbox;
      const buf = 0.5;
      const fs = block.fontSize || 10;
      const padX = fs * 0.1;
      const padTop = fs * 0.1;
      const padBottomCell = Math.max(1.5, fs * 0.25);
      let drewItemMask = false;
      for (const it of (items || [])) {
        const [ix0, iy0, ix1, iy1] = it.bbox;
        if (ix1 < bx0 || ix0 > bx1 || iy1 < by0 || iy0 > by1) continue;
        const mx0 = Math.max(ix0 - padX, bx0 + buf);
        const mx1 = Math.min(ix1 + padX, bx1 - buf);
        const my0 = Math.max(iy0 - padTop, by0 + buf);
        const my1 = Math.min(iy1 + padBottomCell, by1 - buf);
        if (mx1 <= mx0 || my1 <= my0) continue;
        page.drawRectangle({
          x: mx0,
          y: pageH - my1,
          width: mx1 - mx0,
          height: my1 - my0,
          color: maskColorOf(block),
          borderWidth: 0,
        });
        drewItemMask = true;
      }
      if (!drewItemMask) {
        const fbuf = 1;
        const insetW = (bx1 - bx0) - fbuf * 2;
        const insetH = (by1 - by0) - fbuf * 2;
        const useInset = insetW > 0 && insetH > 0;
        page.drawRectangle({
          x: useInset ? bx0 + fbuf : bx0,
          y: useInset ? pageH - (by1 - fbuf) : pageH - by1,
          width: useInset ? insetW : (bx1 - bx0),
          height: useInset ? insetH : (by1 - by0),
          color: maskColorOf(block),
          borderWidth: 0,
        });
      }
    } else {
      const drawn = computeDrawnExtent(fit, fontRegular, fontBold);
      const f = fit.finalBox;
      const [bx0, by0, bx1, by1] = block.bbox;
      const baseBox = {
        x0: Math.min(bx0, f.x0),
        y0: Math.min(by0, f.y0),
        x1: Math.max(bx1, Math.min(f.x1, f.x0 + drawn.w)),
        y1: Math.max(by1, Math.min(f.y1, f.y0 + drawn.h)),
      };
      const maskBox = expandBoxToCoverItems(baseBox, block, items);
      const padBottom = Math.max(2, (block.fontSize || 12) * 0.3);
      const { x0: mx0, y0: my0, x1: mx1, y1: my1 } = maskBox;
      const pdfMaskBottom = pageH - (my1 + padBottom);
      page.drawRectangle({
        x: mx0,
        y: pdfMaskBottom,
        width: mx1 - mx0,
        height: (my1 - my0) + padBottom,
        color: maskColorOf(block),
        borderWidth: 0,
      });
    }
  }

  for (const { block, fit } of prepared) {
    const { fontSize, lineHeight, lines, finalBox } = fit;
    const { x0, y0, y1 } = finalBox;
    const pdfTop = pageH - y0;
    const pdfBottom = pageH - y1;

    let cy = pdfTop - fontSize;
    let visibleCount = 0;
    for (let k = 0, y = cy; k < lines.length; k++, y -= lineHeight) { if (y - fontSize * DESCENT_RATIO < pdfBottom - FIT_HEIGHT_TOLERANCE_PT) break; visibleCount++; }
    if (visibleCount === 0 && lines.length > 0) visibleCount = 1;
    const clipped = visibleCount < lines.length;
    if (clipped) clippedBlocks++;
    let invisible = false;
    for (const [lineIdx, line] of lines.entries()) {
      if (lineIdx >= visibleCount && !invisible) {
        page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
        invisible = true;
        cy += lineHeight;
      }
      const isLastVisible = clipped && lineIdx === visibleCount - 1;
      let cx = x0;
      const pieces = isLastVisible && line.pieces.length
        ? [...line.pieces.slice(0, -1), { ...line.pieces[line.pieces.length - 1], text: line.pieces[line.pieces.length - 1].text + '…' }]
        : line.pieces;
      for (const piece of pieces) {
        if (!piece.text) continue;
        const pieceFont = piece.isBold ? fontBold : fontRegular;
        const color = piece.linkUrl ? linkColorOf(block) : textColorOf(block);
        const opts = { font: pieceFont, size: fontSize, color };
        if (piece.isItalic) {
          opts.matrix = [1, 0, ITALIC_SKEW, 1, cx, cy];
        } else {
          opts.x = cx;
          opts.y = cy;
        }
        try {
          page.drawText(piece.text, opts);
        } catch (err) {
          droppedPieces++;
          console.warn('[Transit] drawText 跳過：', piece.text.slice(0, 30), err.message);
        }
        let pieceWidth;
        try { pieceWidth = pieceFont.widthOfTextAtSize(piece.text, fontSize); }
        catch { pieceWidth = piece.text.length * fontSize * 0.5; }
        if (piece.linkUrl) {
          const underlineY = cy - fontSize * UNDERLINE_OFFSET_RATIO;
          try {
            page.drawLine({
              start: { x: cx, y: underlineY },
              end: { x: cx + pieceWidth, y: underlineY },
              thickness: fontSize * UNDERLINE_THICKNESS_RATIO,
              color: linkColorOf(block),
            });
          } catch (_) {   }
          translatedLinkRects.push({
            url: piece.linkUrl,
            rect: [cx, cy - fontSize * 0.2, cx + pieceWidth, cy + fontSize * 0.9],
          });
        }
        cx += pieceWidth;
      }
      if (!invisible) cy -= lineHeight;
    }
    if (invisible) page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
  }
  if (clippedBlocks > 0) console.info(`[Transit] 譯文塞不下截斷 ${clippedBlocks} 塊（末行「…」+ 隱形文字補齊文字層）`);
  if (droppedPieces > 0) console.warn(`[Transit] drawText 失敗跳過 ${droppedPieces} 個 piece（mask 已蓋、該段文字缺席）`);
  return translatedLinkRects;
}

function computeDrawnExtent(fit, fontRegular, fontBold) {
  const { fontSize, lineHeight, lines } = fit;
  let maxW = 0;
  for (const line of lines) {
    let w = 0;
    for (const p of line.pieces) {
      const font = p.isBold ? fontBold : fontRegular;
      try { w += font.widthOfTextAtSize(p.text, fontSize); }
      catch { w += p.text.length * fontSize * 0.5; }
    }
    if (w > maxW) maxW = w;
  }
  const visualRatio = lines.length === 1 ? SINGLE_LINE_VISUAL_RATIO : FIRST_LINE_VISUAL_RATIO;
  const h = lines.length > 0 ? fontSize * visualRatio + (lines.length - 1) * lineHeight : 0;
  return { w: maxW, h };
}

const MIN_FONT_SIZE = 5;
const MIN_SCALE = 0.5;
const PHASE_A_SCALES = [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7];
const PHASE_D_SCALES = [0.65, 0.55, 0.5];
const FIRST_LINE_VISUAL_RATIO = 1.21;
const DESCENT_RATIO = 0.21;
const FIT_HEIGHT_TOLERANCE_PT = 1;
const SINGLE_LINE_VISUAL_RATIO = 1.0;

function fitSegmentsToBox(segments, fontRegular, fontBold, originalFontSize, currentBlock, layoutPage) {
  const fullText = segments.map((s) => s.text).join('');
  const isCJKText = hasCJK(fullText);
  const lineSkipRatio = isCJKText ? 1.5 : 1.3;
  const tightSkips = (isCJKText ? [1.3, 1.15] : [1.15]).filter((r) => r < lineSkipRatio);
  const tightestSkip = tightSkips.length ? tightSkips[tightSkips.length - 1] : lineSkipRatio;
  const [origX0, origY0, origX1, origY1] = currentBlock.bbox;
  let box = { x0: origX0, y0: origY0, x1: origX1, y1: origY1 };

  const minFontSize = Math.min(MIN_FONT_SIZE, originalFontSize > 0 ? originalFontSize : MIN_FONT_SIZE);
  function tryFit(b, scale, skip = lineSkipRatio) {
    const fontSize = Math.max(minFontSize, originalFontSize * scale);
    const lineHeight = fontSize * skip;
    const blockW = b.x1 - b.x0;
    const blockH = b.y1 - b.y0;
    if (blockW <= 0 || blockH <= 0) return null;
    const lines = wrapSegmentsToWidth(segments, fontRegular, fontBold, fontSize, blockW);
    if (lines.atomicSplit) return null;
    const visualRatio = lines.length === 1 ? SINGLE_LINE_VISUAL_RATIO : FIRST_LINE_VISUAL_RATIO;
    const requiredH = fontSize * visualRatio + (lines.length - 1) * lineHeight;
    if (requiredH <= blockH + FIT_HEIGHT_TOLERANCE_PT) return { fontSize, lineHeight, lines, finalBox: b };
    return null;
  }

  const isCellBlock = currentBlock._isCellBlock === true;

  const expandedRight = isCellBlock ? -Infinity : getMaxRightX(currentBlock, layoutPage);
  const expandedBottom = isCellBlock ? -Infinity : getMaxBottomY(currentBlock, layoutPage);
  const canExpandRight = expandedRight > box.x1 + 0.5;
  const canExpandDown = expandedBottom > box.y1 + 0.5;
  const variants = [box];
  if (canExpandDown) variants.push({ ...box, y1: expandedBottom });
  if (canExpandRight) variants.push({ ...box, x1: expandedRight });
  if (canExpandRight && canExpandDown) {
    variants.push({ x0: box.x0, y0: box.y0, x1: expandedRight, y1: expandedBottom });
  }

  for (const v of variants) {
    const r = tryFit(v, 1.0);
    if (r) return r;
  }

  for (const scale of PHASE_A_SCALES) {
    if (scale === 1.0) continue;
    const r = tryFit(box, scale);
    if (r) return r;
  }

  if (canExpandDown) {
    const expanded = { ...box, y1: expandedBottom };
    for (const scale of PHASE_A_SCALES) {
      if (scale === 1.0) continue;
      const r = tryFit(expanded, scale);
      if (r) return r;
    }
    box = expanded;
  }

  if (canExpandRight) {
    const expanded = { ...box, x1: expandedRight };
    for (const scale of PHASE_A_SCALES) {
      if (scale === 1.0) continue;
      const r = tryFit(expanded, scale);
      if (r) return r;
    }
    box = expanded;
  }

  for (const skip of tightSkips) {
    for (const scale of PHASE_A_SCALES) {
      const r = tryFit(box, scale, skip);
      if (r) return r;
    }
  }

  for (const scale of PHASE_D_SCALES) {
    const r = tryFit(box, scale, tightestSkip);
    if (r) return r;
  }

  const fontSize = Math.max(minFontSize, originalFontSize * MIN_SCALE);
  const lineHeight = fontSize * tightestSkip;
  const lines = wrapSegmentsToWidth(segments, fontRegular, fontBold, fontSize, box.x1 - box.x0);
  return { fontSize, lineHeight, lines, finalBox: box, overflow: true };
}

function isCJKCodePoint(cp) {
  return (cp >= 0x3000 && cp <= 0x9FFF)
    || (cp >= 0x3400 && cp <= 0x4DBF)
    || (cp >= 0xF900 && cp <= 0xFAFF)
    || (cp >= 0xFF00 && cp <= 0xFFEF);
}

function hasCJK(text) {
  for (const ch of text) {
    if (isCJKCodePoint(ch.codePointAt(0))) return true;
  }
  return false;
}

function getMaxBottomY(currentBlock, layoutPage) {
  const [cx0, , cx1, cy1] = currentBlock.bbox;
  const pageH = layoutPage.viewport.height;
  let minBlockerY0 = pageH;
  for (const b of layoutPage.blocks) {
    if (b === currentBlock) continue;
    if (!Array.isArray(b.bbox) || b.bbox.length !== 4) continue;
    const [bx0, by0, bx1] = b.bbox;
    if (by0 <= cy1) continue;
    if (bx0 >= cx1 || bx1 <= cx0) continue;
    if (by0 < minBlockerY0) minBlockerY0 = by0;
  }
  return Math.max(cy1, minBlockerY0 - 2);
}

function getMaxRightX(currentBlock, layoutPage) {
  const [, cy0, cx1, cy1] = currentBlock.bbox;
  const pageW = layoutPage.viewport.width;
  let minBlockerX0 = pageW;
  let contentRight = cx1;
  for (const b of layoutPage.blocks) {
    if (b === currentBlock) continue;
    if (!Array.isArray(b.bbox) || b.bbox.length !== 4) continue;
    const [bx0, by0, bx1, by1] = b.bbox;
    if (bx1 > contentRight) contentRight = bx1;
    if (bx0 <= cx1) continue;
    if (by0 >= cy1 || by1 <= cy0) continue;
    if (bx0 < minBlockerX0) minBlockerX0 = bx0;
  }
  return Math.max(cx1, Math.min(minBlockerX0 - 5, contentRight));
}

function expandBoxToCoverItems(finalBox, block, items) {
  if (!items || items.length === 0) return finalBox;
  const [bx0, by0, bx1, by1] = block.bbox;
  let { x0, y0, x1, y1 } = finalBox;
  for (const it of items) {
    const [ix0, iy0, ix1, iy1] = it.bbox;
    if (ix1 < bx0 || ix0 > bx1 || iy1 < by0 || iy0 > by1) continue;
    if (Math.max(ix0, bx0) < x0) x0 = Math.max(ix0, bx0);
    if (Math.max(iy0, by0) < y0) y0 = Math.max(iy0, by0);
    if (Math.min(ix1, bx1) > x1) x1 = Math.min(ix1, bx1);
    if (Math.min(iy1, by1) > y1) y1 = Math.min(iy1, by1);
  }
  return { x0, y0, x1, y1 };
}

const SAMPLE_MAX_PIXELS = 2_000_000;
const SAMPLE_RING_INNER = 1;
const SAMPLE_RING_OUTER = 4;
const SAMPLE_BG_MIN_SHARE = 0.6;
const SAMPLE_FG_MIN_DIST = 80;
const SAMPLE_FG_MIN_SHARE = 0.45;
const SAMPLE_FG_MIN_PIXELS = 12;
function quantKey(r, g, b) { return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4); }
function keyToRgb(k) { return [((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17]; }
function modeOf(counts, total) {
  let bestK = -1; let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; bestK = k; }
  return bestK < 0 ? null : { rgb: keyToRgb(bestK), key: bestK, share: bestN / total, count: bestN };
}
function forEachRingPixel(w, h, x0, y0, x1, y1, fn) {
  for (let y = y0 - SAMPLE_RING_OUTER; y <= y1 + SAMPLE_RING_OUTER; y++) {
    if (y < 0 || y >= h) continue;
    for (let x = x0 - SAMPLE_RING_OUTER; x <= x1 + SAMPLE_RING_OUTER; x++) {
      if (x < 0 || x >= w) continue;
      const inside = x >= x0 - SAMPLE_RING_INNER && x <= x1 + SAMPLE_RING_INNER && y >= y0 - SAMPLE_RING_INNER && y <= y1 + SAMPLE_RING_INNER;
      if (!inside) fn((y * w + x) * 4);
    }
  }
}
function exactModeColor(img, w, h, pixels) {
  const counts = new Map(); let n = 0;
  for (const [x, y] of pixels) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 4;
    const k = (img[i] << 16) | (img[i + 1] << 8) | img[i + 2];
    counts.set(k, (counts.get(k) || 0) + 1); n++;
  }
  if (!n) return null;
  let bk = -1; let bn = 0;
  for (const [k, c] of counts) if (c > bn) { bn = c; bk = k; }
  return { rgb: [(bk >> 16) & 255, (bk >> 8) & 255, bk & 255], share: bn / n, n };
}
const SAMPLE_SIDE_BAND = 6;
const SAMPLE_EXACT_MIN_SHARE = 0.5;
const SAMPLE_SIDE_MIN_PIXELS = 20;
function sampleBlockColors(img, w, h, bbox, scale) {
  const x0 = Math.floor(bbox[0] * scale); const y0 = Math.floor(bbox[1] * scale);
  const x1 = Math.ceil(bbox[2] * scale); const y1 = Math.ceil(bbox[3] * scale);
  const side = [];
  for (let y = y0; y <= y1; y++) {
    for (let d = SAMPLE_RING_INNER; d <= SAMPLE_SIDE_BAND; d++) { side.push([x0 - d, y]); side.push([x1 + d, y]); }
  }
  let bg = null;
  const sideMode = exactModeColor(img, w, h, side);
  if (sideMode && sideMode.n >= SAMPLE_SIDE_MIN_PIXELS && sideMode.share >= SAMPLE_EXACT_MIN_SHARE) bg = sideMode.rgb;
  if (!bg) {
    const ringPx = [];
    forEachRingPixel(w, h, x0, y0, x1, y1, (i) => { ringPx.push([(i / 4) % w, Math.floor(i / 4 / w)]); });
    const ringMode = exactModeColor(img, w, h, ringPx);
    if (ringMode && ringMode.share >= SAMPLE_EXACT_MIN_SHARE) bg = ringMode.rgb;
    if (!bg) {
      const ring = new Map(); let ringN = 0;
      forEachRingPixel(w, h, x0, y0, x1, y1, (i) => {
        const k = quantKey(img[i], img[i + 1], img[i + 2]);
        ring.set(k, (ring.get(k) || 0) + 1); ringN++;
      });
      if (ringN === 0) return { bg: null, fg: null };
      const bgMode = modeOf(ring, ringN);
      if (!bgMode || bgMode.share < SAMPLE_BG_MIN_SHARE) return { bg: null, fg: null };
      const acc = [0, 0, 0]; let accN = 0;
      forEachRingPixel(w, h, x0, y0, x1, y1, (i) => {
        if (quantKey(img[i], img[i + 1], img[i + 2]) !== bgMode.key) return;
        acc[0] += img[i]; acc[1] += img[i + 1]; acc[2] += img[i + 2]; accN++;
      });
      bg = accN ? acc.map((v) => Math.round(v / accN)) : bgMode.rgb;
    }
  }
  const fgCounts = new Map(); let fgN = 0;
  for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const i = (y * w + x) * 4;
      if (Math.hypot(img[i] - bg[0], img[i + 1] - bg[1], img[i + 2] - bg[2]) < SAMPLE_FG_MIN_DIST) continue;
      const k = quantKey(img[i], img[i + 1], img[i + 2]);
      fgCounts.set(k, (fgCounts.get(k) || 0) + 1); fgN++;
    }
  }
  let fg = null;
  if (fgN >= SAMPLE_FG_MIN_PIXELS) {
    const m = modeOf(fgCounts, fgN);
    if (m && m.share >= SAMPLE_FG_MIN_SHARE) fg = m.rgb;
  }
  const isWhiteBg = bg[0] > 245 && bg[1] > 245 && bg[2] > 245;
  const isBlackFg = !!fg && fg[0] < 48 && fg[1] < 48 && fg[2] < 48;
  return { bg: isWhiteBg ? null : bg, fg: isBlackFg ? null : fg };
}
async function renderPageSamples(page, viewport, layoutPage) {
  const blocks = ((layoutPage && layoutPage.blocks) || []).filter((b) => TRANSLATABLE_TYPES.has(b.type) && b.translation && Array.isArray(b.bbox));
  if (blocks.length === 0) return {};
  const area = viewport.width * viewport.height;
  const scale = area > SAMPLE_MAX_PIXELS ? Math.sqrt(SAMPLE_MAX_PIXELS / area) : 1;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const out = {};
  for (const b of blocks) out[b.blockId] = sampleBlockColors(img, canvas.width, canvas.height, b.bbox, scale);
  canvas.width = 0; canvas.height = 0;
  return out;
}

async function extractPdfMetaForOverlay(arrayBuffer, pageCount, layoutDoc = null, sharedPdfDoc = null) {
  let pdfDoc = sharedPdfDoc;
  const owned = !sharedPdfDoc;
  try {
    if (!pdfDoc) {
      const task = pdfjsLib.getDocument({
        data: arrayBuffer.slice(0),
        disableFontFace: false,
        password: '',
      });
      pdfDoc = await task.promise;
    }
    const out = [];
    const n = Math.min(pageCount, pdfDoc.numPages);
    for (let i = 0; i < n; i++) {
      let page = null;
      try {
        page = await pdfDoc.getPage(i + 1);
        out.push(await extractPageMetaForOverlay(page, i, layoutDoc));
      } catch (err) {
        console.warn(`[Transit] 第 ${i + 1} 頁 overlay metadata 抽取失敗，該頁不含 link / 底色：`, err && err.message);
        out.push(null);
      } finally {
        if (page) { try { page.cleanup(); } catch (_) {   } }
      }
    }
    return out;
  } catch (err) {
    console.warn('[Transit] extractPdfMetaForOverlay 失敗,譯文 PDF 將不含 link / 底色:', err && err.message);
    return [];
  } finally {
    if (owned && pdfDoc) { try { await pdfDoc.destroy(); } catch (_) {   } }
  }
}

async function extractPageMetaForOverlay(page, i, layoutDoc) {
  const viewport = page.getViewport({ scale: 1 });

  const annotations = await page.getAnnotations();
  const links = annotations
    .filter((a) => a.subtype === 'Link')
    .map((a) => ({ rect: a.rect, url: a.url || a.unsafeUrl || null }))
    .filter((l) => !!l.url);

  const tc = await page.getTextContent();

  const items = tc.items
    .filter((it) => typeof it.str === 'string' && it.str.trim().length > 0)
    .map((it) => {
      const m = pdfjsLib.Util.transform(viewport.transform, it.transform);
      const fontSize = Math.hypot(m[2], m[3]);
      const left = m[4];
      const baselineY = m[5];
      const top = baselineY - fontSize;
      const right = left + (it.width || 0);
      const bottom = baselineY;
      return {
        str: it.str,
        bbox: [left, top, right, bottom],
      };
    });

  let blockColors = {};
  try {
    const layoutPage = layoutDoc && layoutDoc.pages ? layoutDoc.pages[i] : null;
    const mayColor = (layoutPage && typeof layoutPage.mayHaveColoredBackground === 'boolean')
      ? layoutPage.mayHaveColoredBackground
      : pageMayHaveColoredBackground(await page.getOperatorList());
    if (mayColor) {
      blockColors = await renderPageSamples(page, viewport, layoutPage);
    }
  } catch (err) {
    console.warn('[Transit] 底色取樣失敗，該頁維持白底黑字：', err && err.message);
  }
  return { links, items, blockColors, rotation: ((page.rotate % 360) + 360) % 360, viewportTransform: viewport.transform.slice() };
}

function addLinkAnnotations(newDoc, newPage, links) {
  if (!links || links.length === 0) return;
  const { PDFName, PDFString } = window.PDFLib;
  const ctx = newDoc.context;
  for (const link of links) {
    if (!link.url || !Array.isArray(link.rect) || link.rect.length !== 4) continue;
    const annotDict = ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: link.rect,
      Border: [0, 0, 0],
    });
    const actionDict = ctx.obj({
      Type: 'Action',
      S: 'URI',
    });
    actionDict.set(PDFName.of('URI'), PDFString.of(link.url));
    annotDict.set(PDFName.of('A'), actionDict);
    const annotRef = ctx.register(annotDict);
    newPage.node.addAnnot(annotRef);
  }
}

const FORBIDDEN_LINE_START = '、。，：；！？」』）〕】》〉,.;:!?)]}';

export function wrapSegmentsToWidth(segments, fontRegular, fontBold, fontSize, maxWidth) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const chunks = [];
  for (const seg of segments) {
    if (!seg || !seg.text) continue;
    let buf = '';
    const flushBuf = () => {
      if (buf) {
        chunks.push({
          text: buf,
          isBold: !!seg.isBold,
          isItalic: !!seg.isItalic,
          linkUrl: seg.linkUrl || null,
          isWS: false,
        });
        buf = '';
      }
    };
    for (const ch of seg.text) {
      const cp = ch.codePointAt(0);
      const isCJK = isCJKCodePoint(cp);
      const isWS = /\s/.test(ch);
      if (isCJK || isWS) {
        flushBuf();
        chunks.push({
          text: ch,
          isBold: !!seg.isBold,
          isItalic: !!seg.isItalic,
          linkUrl: seg.linkUrl || null,
          isWS,
        });
      } else {
        buf += ch;
      }
    }
    flushBuf();
  }

  function fontFor(c) { return c.isBold ? fontBold : fontRegular; }
  function widthOf(c) {
    try { return fontFor(c).widthOfTextAtSize(c.text, fontSize); }
    catch { return c.text.length * fontSize * 0.5; }
  }

  const sizedChunks = [];
  let atomicSplit = false;
  for (const c of chunks) {
    if (!c.isWS && c.text.length > 1 && widthOf(c) > maxWidth) {
      if (c.text.length <= ATOMIC_CHUNK_MAX_CHARS) atomicSplit = true;
      for (const ch of c.text) sizedChunks.push({ ...c, text: ch });
    } else {
      sizedChunks.push(c);
    }
  }

  const lineChunks = [];
  let current = [];
  let currentWidth = 0;
  for (const c of sizedChunks) {
    const w = widthOf(c);
    if (current.length === 0 && c.isWS) continue;
    if (currentWidth + w > maxWidth && current.length > 0) {
      lineChunks.push(current);
      current = c.isWS ? [] : [c];
      currentWidth = c.isWS ? 0 : w;
    } else {
      current.push(c);
      currentWidth += w;
    }
  }
  if (current.length > 0) lineChunks.push(current);

  const lines = lineChunks.map((cs) => ({ pieces: mergeChunksToPieces(cs) }));
  const out = applyCJKPunctuationRulesPieces(lines);
  if (atomicSplit) out.atomicSplit = true;
  return out;
}

function mergeChunksToPieces(chunks) {
  const pieces = [];
  for (const c of chunks) {
    const last = pieces[pieces.length - 1];
    if (last && last.isBold === c.isBold && last.isItalic === c.isItalic && last.linkUrl === c.linkUrl) {
      last.text += c.text;
    } else {
      pieces.push({ text: c.text, isBold: c.isBold, isItalic: c.isItalic, linkUrl: c.linkUrl });
    }
  }
  return pieces;
}

function applyCJKPunctuationRulesPieces(lines) {
  if (!lines || lines.length < 2) return lines;
  const out = lines.map((l) => ({ pieces: l.pieces.map((p) => ({ ...p })) }));
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 1; i < out.length; i++) {
      const line = out[i];
      const firstP = line.pieces[0];
      if (!firstP || !firstP.text) continue;
      const firstCh = firstP.text[0];
      if (!FORBIDDEN_LINE_START.includes(firstCh)) continue;
      const prevLine = out[i - 1];
      const prevLast = prevLine.pieces[prevLine.pieces.length - 1];
      if (prevLast && prevLast.isBold === firstP.isBold && prevLast.isItalic === firstP.isItalic && prevLast.linkUrl === firstP.linkUrl) {
        prevLast.text += firstCh;
      } else {
        prevLine.pieces.push({
          text: firstCh, isBold: firstP.isBold, isItalic: firstP.isItalic, linkUrl: firstP.linkUrl,
        });
      }
      firstP.text = firstP.text.slice(1);
      if (firstP.text.length === 0) line.pieces.shift();
      moved = true;
    }
    if (!moved) break;
  }
  return out
    .map((l) => ({ pieces: l.pieces.filter((p) => p.text.length > 0) }))
    .filter((l) => l.pieces.length > 0);
}

