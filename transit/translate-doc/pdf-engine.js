import * as pdfjsLib from '../lib/vendor/pdfjs/pdf.min.mjs';
import { pageMayHaveColoredBackground } from './pdf-oplist.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/vendor/pdfjs/pdf.worker.min.mjs');

export const LIMITS = Object.freeze({
  hardMaxPages: 300,
  hardMaxBytes: 50 * 1024 * 1024,
});

const SCANNED_PDF_TEXT_THRESHOLD = 50;
const GARBLED_FONT_NON_PRINTABLE_RATIO = 0.5;
const TINY_RUN_MIN_FONT_SIZE = 1.5;
const ROTATED_PAGE_DOMINANT_RATIO = 0.8;

const VIEWPORT_OUTSIDE_TOLERANCE_PT = 4;

function matMul(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function normalizeCjkCompat(str) {
  if (!str) return str;
  let out = '';
  let changed = false;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x2e80 && cp <= 0x2fdf) || (cp >= 0xf900 && cp <= 0xfaff)) { out += ch.normalize('NFKC'); changed = true; }
    else out += ch;
  }
  return changed ? out : str;
}

export class PdfParseError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

export function preflightFile(file) {
  if (!file) return { level: 'error', message: '未選取檔案' };
  const isPdfMime = file.type === 'application/pdf' || file.type === '';
  const isPdfExt = /\.pdf$/i.test(file.name || '');
  if (!isPdfMime && !isPdfExt) {
    return { level: 'error', message: '檔案類型不符，請選擇 PDF' };
  }
  if (file.size > LIMITS.hardMaxBytes) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return { level: 'error', message: `檔案 ${mb} MB 超過 ${LIMITS.hardMaxBytes / 1024 / 1024} MB 上限，請先拆分後再上傳` };
  }
  return { level: 'ok' };
}

export async function parsePdf(file, onProgress = () => {}, options = {}) {
  onProgress({ stage: 'reading' });
  const buffer = await file.arrayBuffer();

  onProgress({ stage: 'opening' });
  let pdfDoc;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: buffer,
      disableFontFace: false,
    });
    pdfDoc = await loadingTask.promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') {
      throw new PdfParseError('encrypted', '此 PDF 受密碼保護或加密，請先解除保護', err);
    }
    if (err && err.name === 'InvalidPDFException') {
      throw new PdfParseError('invalid', '檔案不是有效的 PDF', err);
    }
    throw new PdfParseError('open-failed', `無法開啟 PDF:${err && err.message ? err.message : String(err)}`, err);
  }

  try {
    return await extractRawDoc(pdfDoc, file, onProgress, options);
  } catch (err) {
    closeDocument(pdfDoc);
    throw err;
  }
}

function viewportInfo(page, viewport) {
  return {
    width: viewport.width,
    height: viewport.height,
    transform: Array.isArray(viewport.transform) ? viewport.transform.slice() : null,
    rotation: ((page.rotate % 360) + 360) % 360,
  };
}

async function extractRawDoc(pdfDoc, file, onProgress, options) {
  const { signal } = options || {};
  const pageCount = pdfDoc.numPages;
  if (pageCount > LIMITS.hardMaxPages) {
    throw new PdfParseError('too-many-pages', `PDF 共 ${pageCount} 頁,超過 ${LIMITS.hardMaxPages} 頁上限`);
  }

  const pages = [];
  let totalChars = 0;
  let nonPrintable = 0;
  let printable = 0;
  let droppedRotatedTotal = 0;
  let keptRunsTotal = 0;

  let title = file.name || '';
  try {
    const meta = await pdfDoc.getMetadata();
    if (meta && meta.info && meta.info.Title) {
      title = meta.info.Title;
    }
  } catch (_) {
  }

  let firstPageSize = { width: 0, height: 0 };

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    if (signal && signal.aborted) {
      throw new PdfParseError('aborted', '已取消解析');
    }
    onProgress({ stage: 'page', current: pageIndex + 1, total: pageCount });
    const page = await pdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1.0 });
    if (pageIndex === 0) {
      firstPageSize = { width: viewport.width, height: viewport.height };
    }

    let textContent;
    try {
      textContent = await page.getTextContent({
        includeMarkedContent: false,
      });
    } catch (err) {
      pages.push({
        pageIndex,
        viewport: viewportInfo(page, viewport),
        textRuns: [],
        textRunError: err && err.message ? err.message : String(err),
      });
      page.cleanup();
      continue;
    }

    let linkRectsCanvas = [];
    try {
      const annotations = await page.getAnnotations();
      for (const a of annotations) {
        if (a.subtype !== 'Link') continue;
        const url = a.url || a.unsafeUrl || null;
        if (!url || !Array.isArray(a.rect) || a.rect.length !== 4) continue;
        const r = viewport.convertToViewportRectangle(a.rect);
        const left = Math.min(r[0], r[2]);
        const right = Math.max(r[0], r[2]);
        const top = Math.min(r[1], r[3]);
        const bottom = Math.max(r[1], r[3]);
        linkRectsCanvas.push({ left, top, right, bottom, url });
      }
    } catch (_) {
    }

    const ITALIC_RE = /Italic|Oblique|-It\b|-Obl\b/i;
    const BOLD_RE = /Bold|Black|Heavy|Demi|Semi/i;
    const styleIsItalic = {};
    const styleIsBold = {};
    if (textContent.styles) {
      for (const fn of Object.keys(textContent.styles)) {
        const s = textContent.styles[fn];
        const family = (s && s.fontFamily) || '';
        styleIsItalic[fn] = ITALIC_RE.test(family);
        styleIsBold[fn] = BOLD_RE.test(family);
      }
    }
    let mayHaveColoredBackground;
    try {
      const opList = await page.getOperatorList();
      mayHaveColoredBackground = pageMayHaveColoredBackground(opList);
      for (const fn of Object.keys(styleIsItalic)) {
        if (styleIsItalic[fn] && styleIsBold[fn]) continue;
        try {
          const font = await new Promise((resolve) => page.commonObjs.get(fn, resolve));
          const name = (font && font.name) || '';
          if (!styleIsItalic[fn]) {
            styleIsItalic[fn] = (font && font.italic === true) || ITALIC_RE.test(name);
          }
          if (!styleIsBold[fn]) {
            styleIsBold[fn] = (font && font.bold === true) || BOLD_RE.test(name);
          }
        } catch {
        }
      }
    } catch (_) {
    }

    const textRuns = [];
    let droppedOutsideViewport = 0;
    let droppedRotated = 0;
    let droppedTiny = 0;
    for (const item of textContent.items) {
      if (typeof item.str !== 'string' || item.str.length === 0) continue;
      if (item.str.trim().length === 0) continue;

      const m = matMul(viewport.transform, item.transform);
      if (Math.abs(m[1]) > Math.abs(m[0]) * 0.09) {
        droppedRotated++;
        continue;
      }
      const fontSize = Math.hypot(m[2], m[3]);
      if (fontSize < TINY_RUN_MIN_FONT_SIZE) {
        droppedTiny++;
        continue;
      }
      const left = m[4];
      const baselineY = m[5];
      const top = baselineY - fontSize;
      const right = left + (item.width || 0);
      const bottom = baselineY;

      if (
        right < -VIEWPORT_OUTSIDE_TOLERANCE_PT ||
        left > viewport.width + VIEWPORT_OUTSIDE_TOLERANCE_PT ||
        bottom < -VIEWPORT_OUTSIDE_TOLERANCE_PT ||
        top > viewport.height + VIEWPORT_OUTSIDE_TOLERANCE_PT
      ) {
        droppedOutsideViewport++;
        continue;
      }

      const styleEntry = textContent.styles && textContent.styles[item.fontName];
      const fontFamily = styleEntry && styleEntry.fontFamily ? styleEntry.fontFamily : '';
      const ascent = styleEntry && typeof styleEntry.ascent === 'number' ? styleEntry.ascent : null;
      const descent = styleEntry && typeof styleEntry.descent === 'number' ? styleEntry.descent : null;

      let linkUrl = null;
      if (linkRectsCanvas.length > 0) {
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        for (const lr of linkRectsCanvas) {
          if (cx >= lr.left && cx <= lr.right && cy >= lr.top && cy <= lr.bottom) {
            linkUrl = lr.url;
            break;
          }
        }
      }
      const isItalic = !!styleIsItalic[item.fontName];
      const isBold = !!styleIsBold[item.fontName];

      keptRunsTotal++;
      textRuns.push({
        text: normalizeCjkCompat(item.str),
        bbox: [left, top, right, bottom],
        fontSize,
        fontName: item.fontName || '',
        fontFamily,
        ascent,
        descent,
        hasEOL: !!item.hasEOL,
        dir: item.dir || 'ltr',
        isItalic,
        isBold,
        linkUrl,
      });

      totalChars += item.str.length;
      for (const ch of item.str) {
        const cp = ch.codePointAt(0);
        if (cp < 32 || cp === 127) {
          nonPrintable++;
        } else {
          printable++;
        }
      }
    }
    if (droppedOutsideViewport > 0) {
      console.log(`[Transit] page ${pageIndex + 1}: 丟棄 ${droppedOutsideViewport} 個 viewport 外的 text run`);
    }
    if (droppedRotated > 0) {
      console.log(`[Transit] page ${pageIndex + 1}: 丟棄 ${droppedRotated} 個旋轉 / 直排 text run(bbox 假設不適用,不送翻)`);
      droppedRotatedTotal += droppedRotated;
    }

    pages.push({
      pageIndex,
      viewport: viewportInfo(page, viewport),
      textRuns,
      mayHaveColoredBackground,
    });
    page.cleanup();
  }

  const warnings = [];
  if (totalChars < SCANNED_PDF_TEXT_THRESHOLD) {
    if (droppedRotatedTotal > 0 && droppedRotatedTotal >= (droppedRotatedTotal + keptRunsTotal) * ROTATED_PAGE_DOMINANT_RATIO) {
      throw new PdfParseError('rotated-content', '此 PDF 的文字整頁旋轉（頁面未設定旋轉屬性），目前不支援翻譯');
    }
    throw new PdfParseError('scanned', '此 PDF 為掃描影像或無可抽取文字，本工具不支援 OCR');
  }
  const totalCharsForRatio = printable + nonPrintable;
  if (totalCharsForRatio > 0) {
    const nonPrintableRatio = nonPrintable / totalCharsForRatio;
    if (nonPrintableRatio > GARBLED_FONT_NON_PRINTABLE_RATIO) {
      warnings.push({
        code: 'garbled-fonts',
        message: '此 PDF 字型映射不完整，翻譯品質可能受影響',
      });
    }
  }
  if (droppedRotatedTotal > 0) {
    warnings.push({
      code: 'rotated-text-dropped',
      message: `此 PDF 含 ${droppedRotatedTotal} 段旋轉或直排文字，該部分維持原文不翻譯`,
    });
  }

  return {
    meta: {
      title,
      filename: file.name,
      bytes: file.size,
      pageCount,
      pageSize: firstPageSize,
    },
    pages,
    stats: {
      totalChars,
      totalRuns: pages.reduce((sum, p) => sum + (p.textRuns ? p.textRuns.length : 0), 0),
    },
    warnings,
    pdfDoc,
  };
}

export async function renderPageToCanvas(pdfDoc, pageIndex, canvas, scale = 1.5) {
  const page = await pdfDoc.getPage(pageIndex + 1);
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssViewport = page.getViewport({ scale });
  const renderViewport = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
  page.cleanup();
  return { width: cssViewport.width, height: cssViewport.height, scale };
}

export function closeDocument(pdfDoc) {
  if (pdfDoc && typeof pdfDoc.destroy === 'function') {
    try { pdfDoc.destroy(); } catch (_) {   }
  }
}

