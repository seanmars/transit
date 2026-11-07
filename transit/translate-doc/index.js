import { parsePdf, preflightFile, renderPageToCanvas, closeDocument, PdfParseError } from './pdf-engine.js';
import { analyzeLayout } from './layout-analyzer.js';
import { translateDocument, segmentsToMarkdown, markdownToSegments, collectGlossaryInputParts, clearTcCacheForTexts, stripPlaceholderTokens, sha1Hex } from './translate.js';
import { TRANSLATABLE_TYPES } from './block-types.js';
import { renderReader, buildPlainTextDump } from './reader.js';
import { downloadBilingualPdf, buildBilingualPdf } from './pdf-renderer.js';
import { formatMoney } from '../lib/format.js';
import { getCachedRate, FALLBACK_USD_TWD_RATE } from '../lib/exchange-rate.js';
import {
  parseEpub, preflightEpubFile, estimateChapterCostUSD, cjkRatioOfBlocks, EPUB_LIMITS,
  buildBookGlossaryRounds, mergeBookGlossaries, glossaryGroupOf, normalizeNameSeparators,
  BOOK_GLOSSARY_MAX_TERMS,
} from './epub-engine.js';
import { buildTranslatedEpub, translatedEpubFilename, computeAnnotationDedupe } from './epub-writer.js';
import { resolveBlockFragment } from './block-output.js';
import {
  checkGlossaryCompliance, mineCandidates, buildScanBatches, aggregateRenderings, compileTermMatcher,
  replaceTermInText, addCjkLatinSpacing,
} from './epub-scan.js';
import {
  loadEpubSession, saveEpubSession, deleteEpubSession, collectSessionBlocks, hydrateSessionBlocks,
  collectSessionFailures,
} from './epub-session-db.js';
import {
  detectDocFileKind, preflightDocFile, parseDocFile, DocFileParseError,
  buildTranslatedDocText, buildTranslatedHtmlDoc, translatedDocFilename, parseGlossaryCsv,
  applyGlossaryAnnotationCleanup,
  editedHtmlToPlain,
} from './doc-file-engine.js';
import {
  detectSubtitleFormat, parseSubtitleFile, buildTranslatedSubtitleText,
  translatedSubtitleFilename, subtitleMimeType, subtitlePromptHint, stripCueTrailingPeriod,
  fixCjkSpacingAroundPlaceholders, SUBTITLE_FORMAT_LABELS,
} from './subtitle-engine.js';
import {
  detectDocxFile, preflightDocxFile, parseDocxFile, buildTranslatedDocx,
  translatedDocxFilename, DocxParseError, DOCX_MIME,
} from './docx-engine.js';
import { getSettings } from '../lib/storage.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEBUG_RENDER_SCALE = 1.5;

const $ = (id) => document.getElementById(id);

const BOOK_DOC_KINDS = new Set(['epub', 'txt', 'md', 'html', 'subtitle', 'docx']);
const isBookDoc = (doc) => !!doc && BOOK_DOC_KINDS.has(doc.kind);

const t = (key, params) => {
  const i18n = window.__SK?.i18n;
  if (i18n && typeof i18n.t === 'function') return i18n.t(key, params);
  return key;
};

const kindKey = (suffix) => (currentDoc?.kind === 'epub' ? 'doc.epub.' : 'doc.book.') + suffix;
const chapterKey = (suffix) => (((currentDoc?.chapters?.length || 0) > 1) ? 'doc.epub.' : 'doc.book.') + suffix;

function setI18nText(el, key) {
  if (!el) return;
  el.setAttribute('data-i18n', key);
  el.textContent = t(key);
}
function setI18nTitle(el, key) {
  if (!el) return;
  el.setAttribute('data-i18n-attr-title', key);
  el.title = t(key);
}

const stages = {
  upload: $('stage-upload'),
  parsing: $('stage-parsing'),
  result: $('stage-result'),
  translating: $('stage-translating'),
  reader: $('stage-reader'),
  edit: $('stage-edit'),
  glossary: $('stage-glossary'),
  debug: $('stage-debug'),
  chapters: $('stage-chapters'),
  epubPreview: $('stage-epub-preview'),
  scan: $('stage-scan'),
};

let parseAbortController = null;
let parseGeneration = 0;
let translateAbortController = null;
let currentDoc = null;
let currentPdfDoc = null;
let currentDebugPage = 0;
let currentReaderHandle = null;
let readerGeneration = 0;
let currentModelOverride = null;
let currentEngine = 'gemini';
let currentOriginalArrayBuffer = null;
let currentPageRange = null;
let lastTranslateSummary = null;
let currentArticleGlossary = null;
let glossaryEntryStage = 'result';
let epubCumulativeCostUSD = 0;
let epubScanState = null;
let epubScanGen = 0;
let epubScanIgnored = new Map();
let epubScanIgnoredDrift = new Set();
let epubBookHash = null;
let currentBookForbidden = [];
let currentDocExtraPrompt = '';
let epubPreviewCompare = false;
let epubPreviewScope = null;

function showStage(name) {
  for (const [key, el] of Object.entries(stages)) {
    el.hidden = key !== name;
  }
}

function setVersionFooter() {
  try {
    const v = chrome.runtime.getManifest().version;
    $('footer-version').textContent = `Transit v${v}`;
  } catch (_) {
  }
}

function showError(msg) {
  const el = $('upload-error');
  el.textContent = msg;
  el.hidden = false;
  showStage('upload');
}

function clearError() {
  const el = $('upload-error');
  el.textContent = '';
  el.hidden = true;
}

function clearResultError() {
  const el = $('result-error');
  if (!el) return;
  el.textContent = '';
  el.hidden = true;
}

function showReaderError(msg) {
  const el = $('reader-error');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function clearReaderError() {
  const el = $('reader-error');
  if (!el) return;
  el.textContent = '';
  el.hidden = true;
}

function setParsingDetail(text) {
  $('parsing-detail').textContent = text;
}

function releaseCurrentDoc() {
  flushPendingSessionSave();
  readerGeneration++;
  if (currentReaderHandle) {
    try { currentReaderHandle.destroy(); } catch (_) {   }
    currentReaderHandle = null;
  }
  if (currentPdfDoc) {
    closeDocument(currentPdfDoc);
    currentPdfDoc = null;
  }
  currentDoc = null;
  currentDebugPage = 0;
  currentModelOverride = null;
  currentEngine = 'gemini';
  currentOriginalArrayBuffer = null;
  currentPageRange = null;
  lastTranslateSummary = null;
  currentArticleGlossary = null;
  epubCumulativeCostUSD = 0;
  epubBookHash = null;
  _sessionSavedSig = new Map();
  currentBookForbidden = [];
  currentDocExtraPrompt = '';
  epubPreviewScope = null;
  epubScanGen++;
  epubScanState = null;
  epubScanIgnored = new Map();
  epubScanIgnoredDrift = new Set();
  if (window.__skLayoutDoc) delete window.__skLayoutDoc;
  if (window.__skEpubDoc) delete window.__skEpubDoc;
}

window.__skAutoFixCjkSpacing = (doc) => autoFixCjkSpacing(doc);

window.__skInstallVerify = async () => {
  if (!window.__skVerify) {
    const m = await import('./dev-verify.js');
    window.__skVerify = m.createVerify({
      getCurrentDoc: () => currentDoc,
      getCurrentOriginalArrayBuffer: () => currentOriginalArrayBuffer,
    });
  }
  return true;
};

async function handleFile(file) {
  clearError();
  clearResultError();

  if (/\.epub$/i.test(file.name || '') || (file.type || '') === 'application/epub+zip') {
    return handleBookFile(file, 'epub');
  }
  if (detectDocxFile(file)) return handleBookFile(file, 'docx');
  const subtitleFormat = detectSubtitleFormat(file);
  if (subtitleFormat) return handleBookFile(file, 'subtitle', subtitleFormat);
  const docFileKind = detectDocFileKind(file);
  if (docFileKind) return handleBookFile(file, docFileKind);

  const pre = preflightFile(file);
  if (pre.level === 'error') {
    showError(pre.message);
    return;
  }
  releaseCurrentDoc();

  if (parseAbortController) parseAbortController.abort();
  const myGen = ++parseGeneration;
  parseAbortController = new AbortController();
  const parseSignal = parseAbortController.signal;

  showStage('parsing');
  setParsingDetail(t('doc.parsing.detail.fileContent'));

  let rawDoc = null;
  try {
    const buf = await file.arrayBuffer();
    if (myGen !== parseGeneration) return;
    currentOriginalArrayBuffer = buf;
    rawDoc = await parsePdf(file, (progress) => {
      switch (progress.stage) {
        case 'reading':
          setParsingDetail(t('doc.parsing.detail.fileContent'));
          break;
        case 'opening':
          setParsingDetail(t('doc.parsing.detail.openDoc'));
          break;
        case 'page':
          setParsingDetail(t('doc.parsing.detail.extractPage', { current: progress.current, total: progress.total }));
          break;
        default:
          break;
      }
    }, { signal: parseSignal });
    if (myGen !== parseGeneration) {
      closeDocument(rawDoc.pdfDoc);
      return;
    }

    setParsingDetail(t('doc.parsing.detail.layout'));
    const doc = analyzeLayout(rawDoc);
    currentDoc = doc;
    currentPdfDoc = rawDoc.pdfDoc;

    window.__skLastParseError = null;
    window.__skLayoutDoc = {
      meta: doc.meta,
      stats: doc.stats,
      warnings: doc.warnings,
      pages: doc.pages.map((p) => ({
        pageIndex: p.pageIndex,
        viewport: p.viewport,
        columnCount: p.columnCount,
        medianLineHeight: p.medianLineHeight,
        bodyFontSize: p.bodyFontSize,
        mayHaveColoredBackground: p.mayHaveColoredBackground,
        blocks: p.blocks,
      })),
    };
    if (window.__skKeepRawPages) {
      window.__skLayoutDoc._rawPages = rawDoc.pages.map((p) => ({
        pageIndex: p.pageIndex,
        viewport: p.viewport,
        textRuns: p.textRuns,
      }));
    }

    const totalBlocks = doc.pages.reduce((sum, p) => sum + p.blocks.length, 0);
    console.group('[Transit] PDF 版面分析完成');
    console.log('meta:', doc.meta);
    console.log('stats:', doc.stats);
    console.log('warnings:', doc.warnings);
    console.log('總 block 數：', totalBlocks);
    console.log('pages:', doc.pages);
    if (doc.pages[0]) {
      console.log('首頁 blocks:', doc.pages[0].blocks);
    }
    console.groupEnd();

    $('result-filename').textContent = doc.meta.filename || t('doc.result.unnamed');
    $('result-pages').textContent = t('doc.result.pageCount', { n: doc.meta.pageCount });
    $('result-chars').textContent = doc.stats.totalChars.toLocaleString('en-US');
    resetPageRange(doc.meta.pageCount);

    if (doc.warnings.length > 0) {
      const warnEl = $('upload-error');
      warnEl.textContent = doc.warnings.map((w) => t('doc.parsing.warn', { message: w.message })).join(' / ');
      warnEl.hidden = false;
    }

    showStage('result');
  } catch (err) {
    if (myGen !== parseGeneration || (err instanceof PdfParseError && err.code === 'aborted')) {
      if (rawDoc && rawDoc.pdfDoc && rawDoc.pdfDoc !== currentPdfDoc) closeDocument(rawDoc.pdfDoc);
      return;
    }
    window.__skLastParseError = {
      code: err instanceof PdfParseError ? err.code : 'exception',
      message: (err && err.message) || String(err),
    };
    if (err instanceof PdfParseError) {
      showError(err.message);
    } else {
      console.error('[Transit] PDF 解析失敗', err);
      showError(t('doc.parsing.fail', { error: (err && err.message) || String(err) }));
    }
    if (rawDoc && rawDoc.pdfDoc && rawDoc.pdfDoc !== currentPdfDoc) closeDocument(rawDoc.pdfDoc);
    releaseCurrentDoc();
  } finally {
    if (myGen === parseGeneration) parseAbortController = null;
  }
}

function blockHue(readingOrder) {
  return (readingOrder * 137.508) % 360;
}

const BLOCK_TYPE_COLORS = {
  heading: [0, 75, 50],
  paragraph: [210, 70, 50],
  'list-item': [140, 60, 42],
  footnote: [40, 60, 45],
  'page-number': [0, 0, 60],
  table: [280, 60, 50],
  formula: [320, 60, 45],
  caption: [180, 60, 40],
  figure: [0, 0, 75],
};

function blockColorForType(type) {
  const c = BLOCK_TYPE_COLORS[type] || BLOCK_TYPE_COLORS.paragraph;
  return {
    stroke: `hsl(${c[0]}, ${c[1]}%, ${c[2]}%)`,
    fill: `hsl(${c[0]}, ${c[1]}%, ${c[2] + 10}%)`,
  };
}

function blockColorForOrder(order) {
  const hue = blockHue(order);
  return {
    stroke: `hsl(${hue}, 70%, 45%)`,
    fill: `hsl(${hue}, 70%, 55%)`,
  };
}

function renderTypeLegend(blocks) {
  const el = $('debug-type-legend');
  if (!el) return;
  const counts = {};
  for (const b of blocks) counts[b.type] = (counts[b.type] || 0) + 1;
  const order = ['heading', 'paragraph', 'list-item', 'footnote', 'page-number', 'table', 'formula', 'caption', 'figure'];
  el.innerHTML = '';
  for (const t of order) {
    if (!counts[t]) continue;
    const span = document.createElement('span');
    const color = BLOCK_TYPE_COLORS[t];
    span.style.color = `hsl(${color[0]}, ${color[1]}%, ${color[2]}%)`;
    const swatch = document.createElement('i');
    span.appendChild(swatch);
    span.appendChild(document.createTextNode(`${t} (${counts[t]})`));
    el.appendChild(span);
  }
}

function setBlockDetail(block) {
  const el = $('debug-detail');
  el.innerHTML = '';
  if (!block) {
    el.innerHTML = `<span class="debug-detail-empty">${t('doc.debug.detail.empty')}</span>`;
    return;
  }
  const idSpan = document.createElement('span');
  idSpan.className = 'debug-detail-id';
  const statusSuffix = block.translationStatus ? ` · ${block.translationStatus}` : '';
  idSpan.textContent = `#${block.readingOrder} ${block.blockId} · ${block.type}${statusSuffix}`;
  const metaSpan = document.createElement('span');
  metaSpan.className = 'debug-detail-meta';
  metaSpan.textContent = t('doc.debug.metadata', { col: block.column, lines: block.lineCount, size: block.fontSize.toFixed(1) });

  el.appendChild(idSpan);
  el.appendChild(metaSpan);
  el.appendChild(document.createElement('br'));

  const previewText = (txt) =>
    !txt ? t('doc.debug.empty') : (txt.length > 280 ? txt.slice(0, 280) + '…' : txt);

  const origLabel = document.createElement('span');
  origLabel.style.color = 'var(--text-faint)';
  origLabel.textContent = t('doc.debug.original');
  el.appendChild(origLabel);
  const origText = document.createElement('span');
  origText.textContent = ' ' + previewText(block.plainText);
  el.appendChild(origText);

  if (block.translation) {
    el.appendChild(document.createElement('br'));
    const trLabel = document.createElement('span');
    trLabel.style.color = 'var(--primary)';
    trLabel.textContent = t('doc.debug.translation');
    el.appendChild(trLabel);
    const trText = document.createElement('span');
    trText.textContent = ' ' + previewText(block.translation);
    el.appendChild(trText);
  } else if (block.translationError) {
    el.appendChild(document.createElement('br'));
    const errLabel = document.createElement('span');
    errLabel.style.color = 'var(--error-text)';
    errLabel.textContent = t('doc.debug.translateFail', { error: block.translationError });
    el.appendChild(errLabel);
  }
}

let _debugCanvasCache = null;

async function renderDebugPage() {
  if (!currentDoc || !currentPdfDoc) return;
  const pageIndex = currentDebugPage;
  const layoutPage = currentDoc.pages[pageIndex];
  if (!layoutPage) return;

  const total = currentDoc.pages.length;
  $('debug-page-indicator').textContent = t('doc.debug.pageIndicator', { current: pageIndex + 1, total });
  $('debug-prev').disabled = pageIndex === 0;
  $('debug-next').disabled = pageIndex >= total - 1;
  const bodyFs = layoutPage.bodyFontSize ? `${layoutPage.bodyFontSize.toFixed(1)}pt` : 'N/A';
  $('debug-page-stats').textContent =
    t('doc.debug.pageStats', { blocks: layoutPage.blocks.length, cols: layoutPage.columnCount }) +
    ` · medianLineHeight ${layoutPage.medianLineHeight.toFixed(1)}pt · body fontSize ${bodyFs}`;
  renderTypeLegend(layoutPage.blocks);

  const canvas = $('debug-canvas');
  let renderInfo;
  if (_debugCanvasCache
      && _debugCanvasCache.pdfDoc === currentPdfDoc
      && _debugCanvasCache.pageIndex === pageIndex) {
    renderInfo = _debugCanvasCache.renderInfo;
  } else {
    try {
      renderInfo = await renderPageToCanvas(currentPdfDoc, pageIndex, canvas, DEBUG_RENDER_SCALE);
    } catch (err) {
      console.error('[Transit] render page 失敗', err);
      return;
    }
    canvas.style.width = `${renderInfo.width}px`;
    canvas.style.height = `${renderInfo.height}px`;
    _debugCanvasCache = { pdfDoc: currentPdfDoc, pageIndex, renderInfo };
  }

  const svg = $('debug-svg');
  svg.setAttribute('width', String(renderInfo.width));
  svg.setAttribute('height', String(renderInfo.height));
  svg.setAttribute('viewBox', `0 0 ${renderInfo.width} ${renderInfo.height}`);
  svg.style.width = `${renderInfo.width}px`;
  svg.style.height = `${renderInfo.height}px`;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const showBbox = $('debug-show-bbox').checked;
  const showOrder = $('debug-show-order').checked;
  const isolateRaw = $('debug-isolate-input').value.trim();
  const isolateOrder = isolateRaw === '' ? null : Number.parseInt(isolateRaw, 10);

  const scale = renderInfo.scale;

  setBlockDetail(null);

  for (const block of layoutPage.blocks) {
    if (isolateOrder !== null && !Number.isNaN(isolateOrder) && block.readingOrder !== isolateOrder) continue;

    const [left, top, right, bottom] = block.bbox;
    const rectX = left * scale;
    const rectY = top * scale;
    const rectW = Math.max(1, (right - left) * scale);
    const rectH = Math.max(1, (bottom - top) * scale);

    const colorMode = $('debug-color-mode')?.value || 'type';
    const { stroke, fill } = colorMode === 'type'
      ? blockColorForType(block.type)
      : blockColorForOrder(block.readingOrder);

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'debug-block-group');
    group.dataset.blockId = block.blockId;

    if (showBbox) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(rectX));
      rect.setAttribute('y', String(rectY));
      rect.setAttribute('width', String(rectW));
      rect.setAttribute('height', String(rectH));
      rect.setAttribute('class', 'debug-block-rect');
      rect.setAttribute('stroke', stroke);
      rect.setAttribute('fill', fill);
      group.appendChild(rect);
    }

    if (showOrder) {
      const labelText = `#${block.readingOrder}`;
      const padX = 4;
      const labelH = 13;
      const estW = labelText.length * 7 + padX * 2;
      const labelX = Math.max(0, rectX + rectW - estW);
      const labelY = rectY;

      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', String(labelX));
      bg.setAttribute('y', String(labelY));
      bg.setAttribute('width', String(estW));
      bg.setAttribute('height', String(labelH));
      bg.setAttribute('rx', '2');
      bg.setAttribute('class', 'debug-block-label-bg');
      bg.setAttribute('fill', '#fff');
      bg.setAttribute('stroke', stroke);
      group.appendChild(bg);

      const txt = document.createElementNS(SVG_NS, 'text');
      txt.setAttribute('x', String(labelX + padX));
      txt.setAttribute('y', String(labelY + labelH - 3));
      txt.setAttribute('class', 'debug-block-label');
      txt.setAttribute('fill', stroke);
      txt.textContent = labelText;
      group.appendChild(txt);
    }

    group.addEventListener('mouseenter', () => setBlockDetail(block));
    group.addEventListener('mouseleave', () => setBlockDetail(null));
    group.addEventListener('click', () => {
      if (group.classList.contains('is-active')) {
        group.classList.remove('is-active');
        setBlockDetail(null);
      } else {
        svg.querySelectorAll('.debug-block-group.is-active').forEach((g) => g.classList.remove('is-active'));
        group.classList.add('is-active');
        setBlockDetail(block);
      }
    });

    svg.appendChild(group);
  }
}

function bindUploadUI() {
  const dropzone = $('dropzone');
  const fileInput = $('file-input');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) {
      handleFile(file);
      fileInput.value = '';
    }
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
}

function bindResultUI() {
  $('reupload-btn').addEventListener('click', () => {
    clearError();
    releaseCurrentDoc();
    showStage('upload');
  });
  $('cancel-btn').addEventListener('click', () => {
    parseGeneration++;
    if (parseAbortController) {
      parseAbortController.abort();
      parseAbortController = null;
    }
    releaseCurrentDoc();
    showStage('upload');
  });
  $('translate-btn').addEventListener('click', () => startTranslate());
  bindPageRangeUI();
}

function resetPageRange(pageCount) {
  const total = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 1;
  currentPageRange = { from: 1, to: total, total };
  syncPageRangeInputs();
}

function syncPageRangeInputs() {
  const fromEl = $('page-range-from');
  const toEl = $('page-range-to');
  if (!fromEl || !toEl || !currentPageRange) return;
  const { from, to, total } = currentPageRange;
  fromEl.max = String(total);
  toEl.max = String(total);
  fromEl.value = String(from);
  toEl.value = String(to);
}

function applyPageRangeInput(which) {
  if (!currentPageRange) return;
  const { total } = currentPageRange;
  const raw = parseInt($(which === 'from' ? 'page-range-from' : 'page-range-to').value, 10);
  if (!Number.isFinite(raw)) return;
  const v = Math.min(Math.max(raw, 1), total);
  if (which === 'from') {
    currentPageRange.from = v;
    if (currentPageRange.to < v) currentPageRange.to = v;
  } else {
    currentPageRange.to = v;
    if (currentPageRange.from > v) currentPageRange.from = v;
  }
}

function bindPageRangeUI() {
  const fromEl = $('page-range-from');
  const toEl = $('page-range-to');
  const allBtn = $('page-range-all-btn');
  if (!fromEl || !toEl || !allBtn) return;
  fromEl.addEventListener('change', () => { applyPageRangeInput('from'); syncPageRangeInputs(); });
  toEl.addEventListener('change', () => { applyPageRangeInput('to'); syncPageRangeInputs(); });
  allBtn.addEventListener('click', () => {
    if (!currentPageRange) return;
    currentPageRange.from = 1;
    currentPageRange.to = currentPageRange.total;
    syncPageRangeInputs();
  });
}

function pageRangeIsFullDoc() {
  if (!currentPageRange) return true;
  const { from, to, total } = currentPageRange;
  return from <= 1 && to >= total;
}

function pageInCurrentRange(page) {
  if (!currentPageRange) return true;
  const n = (page && Number.isInteger(page.pageIndex)) ? page.pageIndex + 1 : 1;
  return n >= currentPageRange.from && n <= currentPageRange.to;
}

function bindTranslatingUI() {
  $('translate-cancel-btn').addEventListener('click', () => {
    if (translateAbortController) {
      translateAbortController.abort();
    }
  });
}

const GLOSSARY_INPUT_MAX_CHARS = 60_000;

async function extractGlossaryForDoc(doc, { forceRefresh = false } = {}) {
  const parts = collectGlossaryInputParts(doc, GLOSSARY_INPUT_MAX_CHARS, pageInCurrentRange);
  const compressedText = parts.join('\n');
  if (compressedText.length < 200) {
    console.log('[Transit] glossary skipped (text too short)', { chars: compressedText.length });
    return null;
  }
  const inputHash = await sha1Hex(compressedText);
  console.log('[Transit] glossary extracting', { chars: compressedText.length, hash: inputHash.slice(0, 8) });
  const presetModel = currentModelOverride || (await resolveDocEngine()).modelOverride || null;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'EXTRACT_GLOSSARY',
      payload: { compressedText, inputHash, forceRefresh, modelOverride: presetModel },
    });
    if (res?.ok && Array.isArray(res.glossary) && res.glossary.length > 0) {
      return res.glossary.map((e) => ({ ...e, target: normalizeNameSeparators(e.target) }));
    }
    if (res?.ok) {
      console.log('[Transit] glossary returned empty');
      return null;
    }
    console.warn('[Transit] glossary not ok', res?.error);
    return null;
  } catch (err) {
    console.warn('[Transit] glossary extract failed', err && err.message);
    return null;
  }
}

// 文件翻譯只用 LLM: translateDoc.engine 是 gemini 或 openai-compat (由 getSettings 正規化)
async function resolveDocEngine() {
  try {
    const td = (await getSettings()).translateDoc || {};
    const engine = td.engine === 'openai-compat' ? 'openai-compat' : 'gemini';
    return { engine, modelOverride: (engine === 'gemini' && td.model) ? td.model : undefined };
  } catch (_) {
    return { engine: 'gemini', modelOverride: undefined };
  }
}

function updateDocModelVisibility() {
  const row = $('settings-doc-model-row');
  if (row) row.hidden = $('settings-doc-engine').value !== 'gemini';
}

async function resolveDocBatchSize() {
  try {
    const s = await getSettings();
    const n = s.translateDoc?.batchSize;
    if (Number.isInteger(n) && n >= 1 && n <= 100) return n;
  } catch (_) {   }
  return 50;
}

async function openSettingsDialog() {
  const dlg = $('translate-settings-dialog');
  const clearSection = $('settings-clear-doc-cache-btn')?.closest('.settings-section');
  if (clearSection) clearSection.hidden = isBookDoc(currentDoc);
  try {
    const td = (await getSettings()).translateDoc || {};
    $('settings-doc-engine').value = td.engine === 'openai-compat' ? 'openai-compat' : 'gemini';
    const modelSel = $('settings-doc-model');
    if (td.model && [...modelSel.options].some((o) => o.value === td.model)) modelSel.value = td.model;
  } catch (_) {   }
  updateDocModelVisibility();
  $('settings-doc-batch-size').value = String(await resolveDocBatchSize());
  const extraPromptEl = $('settings-doc-extra-prompt');
  if (extraPromptEl) extraPromptEl.value = currentDocExtraPrompt;
  const spacingSection = $('settings-epub-paragraph-spacing')?.closest('.settings-section');
  if (spacingSection) spacingSection.hidden = currentDoc?.kind !== 'epub';
  const scanSection = $('settings-epub-consistency-scan')?.closest('.settings-section');
  if (scanSection) scanSection.hidden = !isBookDoc(currentDoc);
  const autofixSection = $('settings-epub-autofix-spacing')?.closest('.settings-section');
  if (autofixSection) autofixSection.hidden = !isBookDoc(currentDoc);
  const periodSection = $('settings-subtitle-strip-period')?.closest('.settings-section');
  if (periodSection) periodSection.hidden = currentDoc?.kind !== 'subtitle';
  try {
    const s = await getSettings();
    $('settings-epub-paragraph-spacing').checked = s.translateDoc?.epubParagraphSpacing === true;
    const scanCb = $('settings-epub-consistency-scan');
    if (scanCb) scanCb.checked = s.translateDoc?.consistencyScan !== false;
    const fixCb = $('settings-epub-autofix-spacing');
    if (fixCb) fixCb.checked = s.translateDoc?.epubAutoFixSpacing !== false;
    const periodCb = $('settings-subtitle-strip-period');
    if (periodCb) periodCb.checked = s.translateDoc?.subtitleStripPeriod !== false;
  } catch (_) {   }
  dlg.showModal();
}

function bindSettingsDialogUI() {
  const dlg = $('translate-settings-dialog');
  $('translate-settings-cancel-btn').addEventListener('click', () => dlg.close());
  $('settings-doc-engine').addEventListener('change', updateDocModelVisibility);
  $('translate-settings-save-btn').addEventListener('click', async () => {
    try {
      const raw = parseInt($('settings-doc-batch-size').value, 10);
      const batchSize = Number.isInteger(raw) ? Math.min(100, Math.max(1, raw)) : 50;
      const epubParagraphSpacing = $('settings-epub-paragraph-spacing')?.checked === true;
      const { translateDoc = {} } = await chrome.storage.sync.get('translateDoc');
      const docEngine = $('settings-doc-engine').value === 'openai-compat' ? 'openai-compat' : 'gemini';
      const merged = {
        ...translateDoc, batchSize, epubParagraphSpacing,
        engine: docEngine,
        model: docEngine === 'gemini' ? ($('settings-doc-model').value || null) : null,
      };
      const scanCb = $('settings-epub-consistency-scan');
      if (scanCb) merged.consistencyScan = scanCb.checked === true;
      const fixCb = $('settings-epub-autofix-spacing');
      if (fixCb) merged.epubAutoFixSpacing = fixCb.checked === true;
      const periodCb = $('settings-subtitle-strip-period');
      if (periodCb) merged.subtitleStripPeriod = periodCb.checked === true;
      await chrome.storage.sync.set({ translateDoc: merged });
      await refreshSubtitleStripPeriod();
      if (currentDoc?.kind === 'subtitle' && epubPreviewScope && stages.epubPreview && !stages.epubPreview.hidden) renderEpubPreview();
    } catch (_) {   }
    const extraPromptEl = $('settings-doc-extra-prompt');
    if (extraPromptEl) {
      const next = extraPromptEl.value.trim();
      if (next !== currentDocExtraPrompt) {
        currentDocExtraPrompt = next;
        if (isBookDoc(currentDoc)) scheduleEpubSessionSave();
      }
    }
    clearResultError();
    if (isBookDoc(currentDoc)) await renderChapterList();
    dlg.close();
  });
  $('settings-clear-doc-cache-btn').addEventListener('click', async () => {
    const btn = $('settings-clear-doc-cache-btn');
    const status = $('settings-clear-doc-cache-status');
    if (btn.disabled) return;
    if (!currentDoc) {
      status.textContent = t('doc.settings.cache.notLoaded');
      setTimeout(() => { status.textContent = ''; }, 3000);
      return;
    }
    btn.disabled = true;
    status.textContent = t('doc.settings.cache.clearing');
    try {
      const r = await clearCurrentDocCache();
      status.textContent = t('doc.settings.cache.cleared', { removed: r.removedKeyCount, total: r.translatableSegmentCount });
    } catch (err) {
      console.error('[Transit] 清除本篇 cache 失敗', err);
      status.textContent = t('doc.settings.cache.failed', { error: (err && err.message) || t('doc.settings.unknownErr') });
    }
    setTimeout(() => {
      btn.disabled = false;
      status.textContent = '';
    }, 4000);
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  $('result-settings-btn').addEventListener('click', () => openSettingsDialog());
  $('reader-settings-btn').addEventListener('click', () => openSettingsDialog());

  $('settings-open-doc-options-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('translate-doc/settings.html') });
    dlg.close();
  });
}

async function clearCurrentDocCache() {
  if (!currentDoc) return { removedKeyCount: 0, translatableSegmentCount: 0 };
  const segTexts = [];
  for (const page of currentDoc.pages) {
    for (const block of page.blocks) {
      if (!TRANSLATABLE_TYPES.has(block.type)) continue;
      const t = block.plainText && block.plainText.trim();
      if (!t) continue;
      segTexts.push({ block, text: block.plainText });
    }
  }
  if (segTexts.length === 0) return { removedKeyCount: 0, translatableSegmentCount: 0 };
  const removedKeyCount = await clearTcCacheForTexts(segTexts.map((s) => s.text));
  for (const { block } of segTexts) {
    block.translation = undefined;
    block.translationStatus = undefined;
    block.translationError = undefined;
  }
  return { removedKeyCount, translatableSegmentCount: segTexts.length };
}

function bindSummaryDialogUI() {
  const dlg = $('translate-summary-dialog');
  $('translate-summary-close-btn').addEventListener('click', () => dlg.close());
  $('translate-summary-overlay-btn').addEventListener('click', () => {
    dlg.close();
    if (!currentDoc) return;
    currentDebugPage = 0;
    showStage('debug');
    renderDebugPage();
  });
  $('summary-retry-btn').addEventListener('click', async () => {
    if (!currentReaderHandle) return;
    const btn = $('summary-retry-btn');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = t('doc.summary.retrying');
    try {
      const r = await currentReaderHandle.retryAllFailed();
      btn.textContent = t('doc.summary.retried', { success: r.success, total: r.total });
    } catch (err) {
      console.error('[Transit] retryAll 失敗', err);
      btn.textContent = t('doc.summary.retryFailed');
    }
    setTimeout(() => {
      btn.textContent = orig;
      refreshSummaryFailedDisplay();
    }, 1500);
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
}

function refreshSummaryFailedDisplay() {
  const failed = countCurrentFailedBlocks();
  $('translated-failed').textContent = failed > 0 ? t('doc.summary.failedSegments', { n: failed }) : '0';
  const btn = $('summary-retry-btn');
  btn.hidden = failed === 0;
  btn.disabled = false;
  refreshSummaryButtonAlert();
}

function bindReaderUI() {
  $('reader-edit-btn').addEventListener('click', () => openEditor());
  $('reader-reupload-btn').addEventListener('click', () => {
    releaseCurrentDoc();
    showStage('upload');
  });
  $('reader-copy-btn').addEventListener('click', async () => {
    if (!currentDoc) return;
    const txt = buildPlainTextDump(currentDoc);
    const btn = $('reader-copy-btn');
    const orig = btn.textContent;
    try {
      await navigator.clipboard.writeText(txt);
      btn.textContent = t('doc.reader.copy.copied', { size: (txt.length / 1024).toFixed(1) });
    } catch (err) {
      console.error('clipboard 失敗', err);
      btn.textContent = t('doc.reader.copy.failed');
    }
    setTimeout(() => { btn.textContent = orig; }, 2500);
  });
  $('reader-sync-toggle').addEventListener('change', (e) => {
    if (currentReaderHandle) {
      currentReaderHandle.setSyncEnabled(e.target.checked);
    }
  });
  $('reader-zoom-out').addEventListener('click', () => stepZoom(-0.1));
  $('reader-zoom-in').addEventListener('click', () => stepZoom(+0.1));
  $('reader-summary-btn').addEventListener('click', async () => {
    if (!lastTranslateSummary) return;
    await fillSummaryDialog(lastTranslateSummary);
    $('translate-summary-dialog').showModal();
  });
  $('reader-download-pdf-btn').addEventListener('click', async () => {
    if (!currentDoc || !currentOriginalArrayBuffer) return;
    const btn = $('reader-download-pdf-btn');
    if (btn.disabled) return;
    btn.disabled = true;
    const orig = btn.textContent;
    try {
      const cachedBytes = currentReaderHandle && currentReaderHandle.getTranslatedPdfBytes
        ? currentReaderHandle.getTranslatedPdfBytes()
        : null;
      let result;
      if (cachedBytes) {
        btn.textContent = t('doc.reader.download.writing');
        result = await downloadBilingualPdf(currentOriginalArrayBuffer, currentDoc, {
          prebuiltBytes: cachedBytes,
        });
      } else {
        btn.textContent = t('doc.reader.download.generating');
        result = await downloadBilingualPdf(currentOriginalArrayBuffer, currentDoc, {
          pdfDoc: currentPdfDoc,
          onProgress: (p) => {
            if (p.stage === 'page') {
              btn.textContent = t('doc.reader.download.processingPage', { current: p.current, total: p.total });
            } else if (p.stage === 'saving') {
              btn.textContent = t('doc.reader.download.writing');
            } else if (p.stage === 'font') {
              btn.textContent = p.remote && p.total
                ? t('doc.reader.download.downloadingFont', { received: (p.received / 1048576).toFixed(1), total: (p.total / 1048576).toFixed(1) })
                : t('doc.reader.download.loadingFont');
            }
          },
        });
      }
      if (result && result.fontFallback) showReaderError(t('doc.reader.fontFallback'));
      const sizeMB = (result.byteLength / 1024 / 1024).toFixed(1);
      btn.textContent = t('doc.reader.download.done', { size: sizeMB });
    } catch (err) {
      console.error('[Transit] 下載譯文 PDF 失敗', err);
      btn.textContent = t('doc.reader.download.failed', { error: (err && err.message) || t('doc.settings.unknownErr') });
    }
    setTimeout(() => {
      btn.textContent = orig;
      btn.disabled = false;
    }, 3000);
  });
}

async function openReader() {
  if (!currentDoc || !currentPdfDoc || !currentOriginalArrayBuffer) return;
  showStage('reader');
  await new Promise((r) => requestAnimationFrame(r));
  if (currentReaderHandle) {
    try { currentReaderHandle.destroy(); } catch (_) {   }
    currentReaderHandle = null;
  }
  const myGen = ++readerGeneration;
  let handle = null;
  try {
    handle = await renderReader(
      currentDoc,
      currentPdfDoc,
      currentOriginalArrayBuffer,
      $('reader-col-original'),
      $('reader-col-translated'),
      {
        modelOverride: currentModelOverride,
        engine: currentEngine,
        glossary: injectableArticleGlossary(),
        extraPrompt: currentDocExtraPrompt || null,
        onFontFallback: () => showReaderError(t('doc.reader.fontFallback')),
      },
    );
  } catch (err) {
    console.error('[Transit] openReader 失敗', err);
    if (myGen === readerGeneration) {
      showReaderError(t('doc.reader.buildFailed', { error: (err && err.message) || String(err) }));
      refreshSummaryButtonAlert();
    }
    return false;
  }
  if (myGen !== readerGeneration) {
    try { handle?.destroy(); } catch (_) {   }
    return false;
  }
  currentReaderHandle = handle;
  if (currentReaderHandle) {
    currentReaderHandle.setSyncEnabled($('reader-sync-toggle').checked);
    $('reader-zoom-level').textContent = `${Math.round(currentReaderHandle.getZoom() * 100)}%`;
  }
  refreshSummaryButtonAlert();
  return true;
}

function countCurrentFailedBlocks() {
  if (!currentDoc) return 0;
  let n = 0;
  for (const page of currentDoc.pages) {
    for (const block of page.blocks) {
      if (TRANSLATABLE_TYPES.has(block.type) && block.translationStatus === 'failed') n++;
    }
  }
  return n;
}

function refreshSummaryButtonAlert() {
  const btn = $('reader-summary-btn');
  if (!btn) return;
  const failed = countCurrentFailedBlocks();
  btn.classList.toggle('has-failed-alert', failed > 0);
  btn.title = failed > 0
    ? t('doc.reader.btn.summary.title.failed', { n: failed })
    : t('doc.reader.btn.summary.title');
}

function stepZoom(delta) {
  if (!currentReaderHandle) return;
  const cur = currentReaderHandle.getZoom();
  const next = currentReaderHandle.setZoom(cur + delta);
  $('reader-zoom-level').textContent = `${Math.round(next * 100)}%`;
}

function bindDebugUI() {
  $('debug-prev').addEventListener('click', () => {
    if (currentDebugPage > 0) {
      currentDebugPage--;
      renderDebugPage();
    }
  });
  $('debug-next').addEventListener('click', () => {
    if (currentDoc && currentDebugPage < currentDoc.pages.length - 1) {
      currentDebugPage++;
      renderDebugPage();
    }
  });
  $('debug-show-bbox').addEventListener('change', () => renderDebugPage());
  $('debug-show-order').addEventListener('change', () => renderDebugPage());
  $('debug-isolate-input').addEventListener('input', () => renderDebugPage());
  $('debug-color-mode').addEventListener('change', () => renderDebugPage());

  $('debug-copy-json-btn').addEventListener('click', async () => {
    if (!currentDoc) return;
    const dump = {
      meta: currentDoc.meta,
      stats: currentDoc.stats,
      warnings: currentDoc.warnings,
      pages: currentDoc.pages.map((p) => ({
        pageIndex: p.pageIndex,
        viewport: p.viewport,
        columnCount: p.columnCount,
        medianLineHeight: p.medianLineHeight,
        blocks: p.blocks,
      })),
    };
    const json = JSON.stringify(dump, null, 2);
    const btn = $('debug-copy-json-btn');
    const orig = btn.textContent;
    try {
      await navigator.clipboard.writeText(json);
      btn.textContent = t('doc.debug.copy.copied', { size: (json.length / 1024).toFixed(1) });
    } catch (err) {
      console.error('clipboard 失敗', err);
      console.log('[Transit] dump JSON:', json);
      btn.textContent = t('doc.debug.copy.failed');
    }
    setTimeout(() => { btn.textContent = orig; }, 2500);
  });
  $('debug-back-btn').addEventListener('click', () => {
    if (currentReaderHandle && lastTranslateSummary) {
      showStage('reader');
    } else {
      showStage('result');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (stages.debug.hidden) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      $('debug-prev').click();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      $('debug-next').click();
    }
  });
}

async function init() {
  await initI18n();
  setVersionFooter();
  bindUploadUI();
  bindResultUI();
  bindTranslatingUI();
  bindSummaryDialogUI();
  bindSettingsDialogUI();
  bindReaderUI();
  bindEditUI();
  bindGlossaryUI();
  bindDebugUI();
  bindChaptersUI();
  bindEpubPreviewUI();
  bindScanUI();
  showStage('upload');
}

async function initI18n() {
  const I18N = window.__SK?.i18n;
  if (!I18N) return;
  let uiLang = 'auto';
  try {
    const stored = await chrome.storage.sync.get(['uiLanguage']);
    if (typeof stored.uiLanguage === 'string') uiLang = stored.uiLanguage;
  } catch (_) {   }
  const dictLang = I18N.getUiLanguage(uiLang);
  window.__SK = window.__SK || {};
  window.__SK.STATE = window.__SK.STATE || {};
  window.__SK.STATE.uiLanguage = dictLang;
  I18N.applyI18n(document, dictLang);
  I18N.subscribeUiLanguageChange((newUi) => {
    window.__SK.STATE.uiLanguage = newUi;
    I18N.applyI18n(document, newUi);
  });
}

function openEditor() {
  if (!currentDoc) return;
  const list = $('edit-list');
  list.innerHTML = '';
  for (const page of currentDoc.pages) {
    const header = document.createElement('div');
    header.className = 'edit-page-header';
    header.textContent = t('doc.edit.pageHeader', { n: page.pageIndex + 1 });
    list.appendChild(header);

    let translatableInPage = 0;
    for (const block of page.blocks) {
      if (!TRANSLATABLE_TYPES.has(block.type)) continue;
      if (!block.plainText || !block.plainText.trim()) continue;
      translatableInPage++;

      const row = document.createElement('div');
      row.className = 'edit-block';
      row.dataset.blockId = block.blockId;
      if (block.translationStatus === 'failed') row.classList.add('edit-block--failed');

      const original = document.createElement('div');
      original.className = 'edit-original';
      original.textContent = block.plainText;
      row.appendChild(original);

      const wrap = document.createElement('div');
      wrap.className = 'edit-translation-wrap';

      const overlay = document.createElement('div');
      overlay.className = 'edit-highlight-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      wrap.appendChild(overlay);

      const initialMd = (Array.isArray(block.translationSegments) && block.translationSegments.length > 0)
        ? segmentsToMarkdown(block.translationSegments)
        : (block.translation || '');

      const textarea = document.createElement('textarea');
      textarea.className = 'edit-translation';
      textarea.rows = Math.max(3, Math.min(30, Math.ceil((initialMd.length || 1) / 25)));
      textarea.defaultValue = initialMd;
      if (block.translationStatus === 'failed') {
        textarea.placeholder = t('doc.edit.placeholder.failed');
      }
      textarea.addEventListener('scroll', () => {
        overlay.scrollTop = textarea.scrollTop;
        overlay.scrollLeft = textarea.scrollLeft;
      });
      textarea.addEventListener('input', () => {
        if ($('edit-find-input') && !$('edit-find-bar').hidden) {
          recomputeFindMatches({ keepIndex: true });
        }
      });
      wrap.appendChild(textarea);

      row.appendChild(wrap);

      list.appendChild(row);
    }

    if (translatableInPage === 0) {
      const empty = document.createElement('div');
      empty.className = 'edit-empty';
      empty.textContent = t('doc.edit.empty');
      list.appendChild(empty);
    }
  }
  showStage('edit');
  list.scrollTop = 0;
  requestAnimationFrame(() => {
    for (const ta of list.querySelectorAll('.edit-translation')) {
      fitTextareaHeight(ta);
    }
  });
}

function fitTextareaHeight(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(60, ta.scrollHeight) + 'px';
}

async function saveEdits() {
  if (!currentDoc) return;
  const blockMap = new Map();
  for (const page of currentDoc.pages) {
    for (const block of page.blocks) blockMap.set(block.blockId, block);
  }
  const rows = $('edit-list').querySelectorAll('.edit-block');
  for (const row of rows) {
    const block = blockMap.get(row.dataset.blockId);
    if (!block) continue;
    const ta = row.querySelector('textarea');
    const text = ta.value;
    if (text === ta.defaultValue) continue;
    if (!text.trim()) {
      block.translation = '';
      block.translationSegments = [];
    } else {
      const { segments, linkUrls } = markdownToSegments(text);
      block.translationSegments = segments;
      block.translation = segments.map((s) => s.text).join('');
      if (linkUrls.length > 0) {
        const existing = new Set(Array.isArray(block.linkUrls) ? block.linkUrls : []);
        for (const u of linkUrls) existing.add(u);
        block.linkUrls = [...existing];
      }
    }
    block.translationStatus = 'done';
    block.translationError = null;
    block.userEdited = true;
  }
  await openReader();
}

function bindEditUI() {
  $('edit-cancel-btn').addEventListener('click', () => {
    if (currentDoc && currentReaderHandle) showStage('reader');
    else showStage('upload');
  });
  $('edit-save-btn').addEventListener('click', async () => {
    const btn = $('edit-save-btn');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('doc.edit.btn.generating');
    try {
      await saveEdits();
    } catch (err) {
      console.error('[Transit] saveEdits 失敗', err);
      btn.textContent = t('doc.edit.btn.failed');
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500);
      return;
    }
    btn.textContent = orig;
    btn.disabled = false;
  });
  bindFindReplaceUI();
  document.addEventListener('keydown', (e) => {
    if (stages.edit.hidden) return;
    const findBarOpen = !$('edit-find-bar').hidden;
    if (e.key === 'Escape' && findBarOpen) {
      e.preventDefault();
      closeFindBar();
      return;
    }
    const isFindShortcut = (e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F');
    if (isFindShortcut) {
      e.preventDefault();
      openFindBar();
      return;
    }
    const isFindNext = e.key === 'F3' || ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G'));
    if (isFindNext && findBarOpen && findMatches.length > 0) {
      e.preventDefault();
      findStep(e.shiftKey ? -1 : 1);
    }
  });
}

let findMatches = [];
let findCurrentIndex = -1;

function getEditTextareas() {
  return Array.from($('edit-list').querySelectorAll('.edit-translation'));
}

function recomputeFindMatches({ keepIndex = false } = {}) {
  const findStr = $('edit-find-input').value;
  const oldIdx = findCurrentIndex;
  findMatches = [];
  if (!findStr) {
    findCurrentIndex = -1;
    clearMatchHighlight();
    updateFindCounter();
    return;
  }
  for (const ta of getEditTextareas()) {
    const v = ta.value;
    let i = 0;
    while ((i = v.indexOf(findStr, i)) !== -1) {
      findMatches.push({ textarea: ta, start: i, end: i + findStr.length });
      i += findStr.length;
    }
  }
  if (findMatches.length === 0) {
    findCurrentIndex = -1;
  } else if (keepIndex && oldIdx >= 0) {
    findCurrentIndex = Math.min(oldIdx, findMatches.length - 1);
  } else {
    findCurrentIndex = 0;
  }
  updateFindCounter();
  if (findCurrentIndex >= 0) markMatch(findCurrentIndex);
  else clearMatchHighlight();
}

function updateFindCounter() {
  const total = findMatches.length;
  const cur = findCurrentIndex >= 0 ? findCurrentIndex + 1 : 0;
  $('edit-find-count').textContent = `${cur} / ${total}`;
  const empty = total === 0;
  $('edit-find-prev-btn').disabled = empty;
  $('edit-find-next-btn').disabled = empty;
  $('edit-replace-btn').disabled = empty;
  $('edit-replace-all-btn').disabled = !$('edit-find-input').value;
}

function clearMatchHighlight() {
  for (const ta of getEditTextareas()) {
    const wrap = ta.parentElement;
    if (wrap) wrap.classList.remove('edit-translation-wrap--current');
    const overlay = wrap && wrap.querySelector('.edit-highlight-overlay');
    if (overlay) overlay.innerHTML = '';
  }
}

function escapeOverlayHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildOverlayHTML(text, marks) {
  if (!text) return '';
  if (!marks || marks.length === 0) return escapeOverlayHTML(text);
  let out = '';
  let cursor = 0;
  for (const m of marks) {
    if (m.start > cursor) out += escapeOverlayHTML(text.slice(cursor, m.start));
    out += `<mark${m.isCurrent ? ' class="is-current"' : ''}>${escapeOverlayHTML(text.slice(m.start, m.end))}</mark>`;
    cursor = m.end;
  }
  if (cursor < text.length) out += escapeOverlayHTML(text.slice(cursor));
  if (text.endsWith('\n')) out += '​';
  return out;
}

function renderAllOverlays() {
  const byTa = new Map();
  findMatches.forEach((m, gi) => {
    if (!byTa.has(m.textarea)) byTa.set(m.textarea, []);
    byTa.get(m.textarea).push({ start: m.start, end: m.end, isCurrent: gi === findCurrentIndex });
  });
  for (const ta of getEditTextareas()) {
    const wrap = ta.parentElement;
    if (!wrap) continue;
    const overlay = wrap.querySelector('.edit-highlight-overlay');
    if (!overlay) continue;
    const marks = byTa.get(ta) || [];
    overlay.innerHTML = buildOverlayHTML(ta.value, marks);
    overlay.scrollTop = ta.scrollTop;
    overlay.scrollLeft = ta.scrollLeft;
  }
}

function markMatch(idx) {
  const m = findMatches[idx];
  if (!m) return;
  for (const ta of getEditTextareas()) {
    const wrap = ta.parentElement;
    if (wrap) wrap.classList.remove('edit-translation-wrap--current');
  }
  const wrap = m.textarea.parentElement;
  if (wrap) wrap.classList.add('edit-translation-wrap--current');
  m.textarea.scrollIntoView({ block: 'center', behavior: 'smooth' });
  try { m.textarea.setSelectionRange(m.start, m.end); } catch (_) {   }
  renderAllOverlays();
}

function findStep(direction) {
  if (findMatches.length === 0) return;
  findCurrentIndex = (findCurrentIndex + direction + findMatches.length) % findMatches.length;
  updateFindCounter();
  markMatch(findCurrentIndex);
}

function replaceCurrent() {
  if (findCurrentIndex < 0 || findMatches.length === 0) return;
  const m = findMatches[findCurrentIndex];
  if (!m) return;
  const replaceStr = $('edit-replace-input').value;
  const v = m.textarea.value;
  m.textarea.value = v.slice(0, m.start) + replaceStr + v.slice(m.end);
  recomputeFindMatches({ keepIndex: true });
}

function replaceAll() {
  const findStr = $('edit-find-input').value;
  const replaceStr = $('edit-replace-input').value;
  if (!findStr) return;
  let total = 0;
  for (const ta of getEditTextareas()) {
    const v = ta.value;
    if (!v.includes(findStr)) continue;
    let c = 0;
    let i = 0;
    while ((i = v.indexOf(findStr, i)) !== -1) {
      c++;
      i += findStr.length;
    }
    if (c > 0) {
      ta.value = v.split(findStr).join(replaceStr);
      total += c;
    }
  }
  $('edit-find-count').textContent = t('doc.edit.find.replaceCount', { n: total });
  clearMatchHighlight();
  setTimeout(() => recomputeFindMatches(), 2000);
}

function openFindBar() {
  const bar = $('edit-find-bar');
  bar.hidden = false;
  const input = $('edit-find-input');
  input.focus();
  input.select();
  recomputeFindMatches();
}

function closeFindBar() {
  $('edit-find-bar').hidden = true;
  findMatches = [];
  findCurrentIndex = -1;
  clearMatchHighlight();
}

function bindFindReplaceUI() {
  $('edit-find-input').addEventListener('input', () => recomputeFindMatches());
  $('edit-find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findStep(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFindBar();
    }
  });
  $('edit-replace-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      replaceCurrent();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFindBar();
    }
  });
  $('edit-find-prev-btn').addEventListener('click', () => findStep(-1));
  $('edit-find-next-btn').addEventListener('click', () => findStep(1));
  $('edit-replace-btn').addEventListener('click', replaceCurrent);
  $('edit-replace-all-btn').addEventListener('click', replaceAll);
  $('edit-find-close-btn').addEventListener('click', closeFindBar);
}

let translateInFlight = false;
async function startTranslate() {
  if (translateInFlight) return;
  translateInFlight = true;
  try {
    return await _startTranslateImpl();
  } finally {
    translateInFlight = false;
  }
}

async function _startTranslateImpl() {
  if (!currentDoc) return;

  if (isBookDoc(currentDoc)) return startEpubTranslate();

  const { engine, modelOverride } = await resolveDocEngine();

  clearResultError();
  currentModelOverride = modelOverride;
  currentEngine = engine;

  showStage('translating');
  resetProgress();

  const glossary = injectableArticleGlossary();
  if (glossary) {
    console.log('[Transit] using article glossary:', glossary.length, 'terms');
  }

  translateAbortController = new AbortController();
  let summary;
  try {
    summary = await translateDocument(currentDoc, {
      modelOverride,
      engine,
      glossary,
      signal: translateAbortController.signal,
      onProgress: setProgress,
      batchSize: await resolveDocBatchSize(),
      extraPrompt: await docExtraPromptForLlm(),
      blockFilter: pageRangeIsFullDoc() ? undefined : ((block, page) => pageInCurrentRange(page)),
    });
  } catch (err) {
    console.error('[Transit] translateDocument 失敗', err);
    summary = failedSummary(err);
  }
  translateAbortController = null;

  lastTranslateSummary = summary;

  if (window.__skLayoutDoc) {
    window.__skLayoutDoc.translateSummary = summary;
  }

  const opened = await openReader();
  if (summary.error) showReaderError(summary.error);
  else if (opened) clearReaderError();
}

async function openGlossaryEditor(fromStage = 'result') {
  if (!currentDoc) return;
  glossaryEntryStage = fromStage;
  const isBook = isBookDoc(currentDoc);
  const actionBtn = $('glossary-translate-btn');
  const actionKey = (isBook && fromStage === 'chapters') ? 'doc.glossary.btn.save' : 'doc.glossary.btn.translate';
  actionBtn.setAttribute('data-i18n', actionKey);
  actionBtn.textContent = t(actionKey);
  $('book-forbidden-section').hidden = !isBook;
  setI18nText($('book-forbidden-title'), kindKey('forbidden.title'));
  setI18nText($('book-forbidden-hint'), kindKey('forbidden.hint'));
  if (isBook) buildBookForbiddenTable(currentBookForbidden);
  showStage('glossary');
  if (currentArticleGlossary === null) {
    setGlossaryState(t('doc.glossary.state.loading'), 'is-loading');
    try {
      const extracted = isBook
        ? await extractGlossaryForBook(currentDoc)
        : await extractGlossaryForDoc(currentDoc);
      currentArticleGlossary = Array.isArray(extracted) ? extracted : [];
      if (isBook && currentArticleGlossary.length > 0) {
        await savePersistedBookGlossary(currentArticleGlossary);
      }
    } catch (err) {
      console.warn('[Transit] glossary extract failed', err && err.message);
      currentArticleGlossary = [];
    }
  }
  buildGlossaryTable(currentArticleGlossary);
}

function setGlossaryState(text, modifier = 'is-empty') {
  clearGlossaryEntries();
  const div = document.createElement('div');
  div.className = `glossary-state ${modifier}`;
  div.textContent = text;
  $('glossary-grid').appendChild(div);
  $('glossary-count').textContent = t('doc.glossary.countZero');
}

function clearGlossaryEntries() {
  const grid = $('glossary-grid');
  for (const el of [...grid.children]) {
    if (!el.classList.contains('g-header')) el.remove();
  }
}

const GLOSSARY_GROUPS = ['person', 'place', 'other'];

let glossarySortKey = 'source';
let glossarySortDir = 1;

function glossaryComparator(a, b) {
  const av = ((glossarySortKey === 'target' ? a.target : a.source) || '').toLowerCase();
  const bv = ((glossarySortKey === 'target' ? b.target : b.source) || '').toLowerCase();
  return av.localeCompare(bv) * glossarySortDir;
}

function refreshGlossarySortArrows() {
  for (const [id, key] of [['g-sort-source', 'source'], ['g-sort-target', 'target']]) {
    const arrow = $(id)?.querySelector('.g-sort-arrow');
    if (arrow) arrow.textContent = (glossarySortKey === key) ? (glossarySortDir === 1 ? '▲' : '▼') : '';
  }
}

function appendGlossaryGroupHeader(group, count) {
  const div = document.createElement('div');
  div.className = 'glossary-group-header';
  div.dataset.group = group;
  const label = document.createElement('span');
  label.textContent = `${t('doc.glossary.group.' + group)}（${count}）`;
  div.appendChild(label);
  if (group === 'person') {
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'g-opt glossary-person-toggle';
    toggleLabel.title = t('doc.glossary.personNoTranslate.title');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'glossary-person-notrans';
    cb.addEventListener('change', onPersonNoTransToggle);
    toggleLabel.append(cb, document.createTextNode(t('doc.glossary.personNoTranslate')));
    div.appendChild(toggleLabel);
  }
  $('glossary-grid').appendChild(div);
}

function onPersonNoTransToggle(e) {
  const on = e.target.checked;
  for (const src of $('glossary-grid').querySelectorAll('.g-source[data-gtype="person"]')) {
    const cb = src.nextElementSibling?.nextElementSibling?.querySelector('.g-notranslate');
    if (cb && cb.checked !== on) {
      cb.checked = on;
      cb.dispatchEvent(new Event('change'));
    }
  }
}

function buildGlossaryTable(entries) {
  refreshGlossarySortArrows();
  clearGlossaryEntries();
  if (!entries || entries.length === 0) {
    setGlossaryState(t('doc.glossary.state.empty'), 'is-empty');
    syncPersonNoTransToggle();
    return;
  }
  const buckets = { person: [], place: [], other: [] };
  for (const e of entries) buckets[glossaryGroupOf(e)].push(e);
  for (const group of GLOSSARY_GROUPS) {
    const list = buckets[group];
    if (list.length === 0) continue;
    list.sort(glossaryComparator);
    appendGlossaryGroupHeader(group, list.length);
    for (const e of list) appendGlossaryRow(e, { skipUpdateCount: true, group });
  }
  updateGlossaryCount();
  syncPersonNoTransToggle();
}

function syncPersonNoTransToggle() {
  const cb = $('glossary-person-notrans');
  if (!cb) return;
  const personSources = [...$('glossary-grid').querySelectorAll('.g-source[data-gtype="person"]')];
  cb.checked = personSources.length > 0 && personSources.every((src) => {
    const opts = src.nextElementSibling?.nextElementSibling;
    return opts?.querySelector('.g-notranslate')?.checked === true;
  });
}

const ANNOTATED_TARGET_RE = /^(.+)（(.+)）\s*$/;
const TITLE_WRAP_RE = /^《(.+)》$/;

function appendGlossaryRow(entry = { source: '', target: '' }, { skipUpdateCount = false, group = null } = {}) {
  const grid = $('glossary-grid');
  const placeholder = grid.querySelector('.glossary-state');
  if (placeholder) placeholder.remove();

  const sourceInput = document.createElement('input');
  sourceInput.type = 'text';
  sourceInput.className = 'g-source';
  sourceInput.placeholder = t('doc.glossary.placeholder.source');
  sourceInput.value = entry.source || '';
  sourceInput.dataset.gtype = group || glossaryGroupOf(entry);
  if (typeof entry.type === 'string' && entry.type) sourceInput.dataset.rawtype = entry.type;

  const targetInput = document.createElement('input');
  targetInput.type = 'text';
  targetInput.className = 'g-target';
  targetInput.placeholder = t('doc.glossary.placeholder.target');
  targetInput.value = entry.target || '';

  const optionsDiv = document.createElement('div');
  optionsDiv.className = 'g-options';

  const noTransLabel = document.createElement('label');
  noTransLabel.className = 'g-opt';
  const noTransCb = document.createElement('input');
  noTransCb.type = 'checkbox';
  noTransCb.className = 'g-notranslate';
  noTransCb.checked = entry.noTranslate === true;
  noTransLabel.append(noTransCb, document.createTextNode(t('doc.glossary.opt.noTranslate')));
  noTransLabel.title = t('doc.glossary.opt.noTranslate.title');

  const dedupeLabel = document.createElement('label');
  dedupeLabel.className = 'g-opt g-dedupe-wrap';
  const dedupeCb = document.createElement('input');
  dedupeCb.type = 'checkbox';
  dedupeCb.className = 'g-dedupe';
  dedupeCb.checked = entry.dedupeAnnotation === true;
  dedupeLabel.append(dedupeCb, document.createTextNode(t('doc.glossary.opt.dedupe')));
  dedupeLabel.title = t('doc.glossary.opt.dedupe.title');

  const keepSelect = document.createElement('select');
  keepSelect.className = 'g-dedupe-keep';
  const optSource = document.createElement('option');
  optSource.value = 'source';
  optSource.textContent = t('doc.glossary.opt.keepSource');
  const optTarget = document.createElement('option');
  optTarget.value = 'target';
  optTarget.textContent = t('doc.glossary.opt.keepTarget');
  keepSelect.append(optSource, optTarget);
  keepSelect.value = entry.dedupeKeep === 'target' ? 'target' : 'source';

  optionsDiv.append(noTransLabel, dedupeLabel, keepSelect);

  const refreshOptionVisibility = () => {
    const noTrans = noTransCb.checked;
    targetInput.disabled = noTrans;
    const isAnnotated = !noTrans && ANNOTATED_TARGET_RE.test(targetInput.value.trim());
    dedupeLabel.hidden = !isAnnotated;
    keepSelect.hidden = !(isAnnotated && dedupeCb.checked);
  };
  refreshOptionVisibility();

  const syncAnnotatedTargetOrder = () => {
    const m = targetInput.value.trim().match(ANNOTATED_TARGET_RE);
    if (!m) return;
    const src = sourceInput.value.trim();
    if (!src) return;
    const stripTitle = (s) => (s.match(TITLE_WRAP_RE)?.[1].trim() ?? s);
    const tok1 = m[1].trim();
    const tok2 = m[2].trim();
    const srcBare = stripTitle(src);
    let sourceTok = null;
    let targetTok = null;
    if (stripTitle(tok1) === srcBare) { sourceTok = stripTitle(tok1); targetTok = stripTitle(tok2); }
    else if (stripTitle(tok2) === srcBare) { sourceTok = stripTitle(tok2); targetTok = stripTitle(tok1); }
    else return;
    const hadTitleMarks = TITLE_WRAP_RE.test(tok1) || TITLE_WRAP_RE.test(tok2);
    const wrap = (s) => (hadTitleMarks ? `《${s}》` : s);
    const sourceFirst = dedupeCb.checked && keepSelect.value === 'source';
    const next = sourceFirst ? `${wrap(sourceTok)}（${targetTok}）` : `${wrap(targetTok)}（${sourceTok}）`;
    if (next !== targetInput.value.trim()) {
      targetInput.value = next;
      refreshOptionVisibility();
    }
  };

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'glossary-row-delete';
  delBtn.textContent = t('doc.glossary.btn.delete');

  delBtn.addEventListener('click', () => {
    sourceInput.remove();
    targetInput.remove();
    optionsDiv.remove();
    delBtn.remove();
    if (!grid.querySelector('.g-source')) setGlossaryState(t('doc.glossary.state.empty'), 'is-empty');
    else updateGlossaryCount();
  });
  sourceInput.addEventListener('input', updateGlossaryCount);
  targetInput.addEventListener('input', () => { refreshOptionVisibility(); updateGlossaryCount(); });
  noTransCb.addEventListener('change', () => { refreshOptionVisibility(); syncPersonNoTransToggle(); });
  dedupeCb.addEventListener('change', () => { refreshOptionVisibility(); syncAnnotatedTargetOrder(); });
  keepSelect.addEventListener('change', syncAnnotatedTargetOrder);

  grid.append(sourceInput, targetInput, optionsDiv, delBtn);
  if (!skipUpdateCount) updateGlossaryCount();
}

function readGlossaryTable() {
  const out = [];
  for (const sourceInput of $('glossary-grid').querySelectorAll('.g-source')) {
    const source = sourceInput.value.trim();
    const targetInput = sourceInput.nextElementSibling;
    const target = (targetInput && targetInput.classList.contains('g-target'))
      ? targetInput.value.trim() : '';
    const optionsDiv = targetInput ? targetInput.nextElementSibling : null;
    const hasOptions = !!(optionsDiv && optionsDiv.classList.contains('g-options'));
    const noTranslate = hasOptions && optionsDiv.querySelector('.g-notranslate')?.checked === true;
    if (!source || (!target && !noTranslate)) continue;
    const entry = { source, target: normalizeNameSeparators(target || source) };
    const rawType = sourceInput.dataset.rawtype
      || (sourceInput.dataset.gtype && sourceInput.dataset.gtype !== 'other' ? sourceInput.dataset.gtype : '');
    if (rawType) entry.type = rawType;
    if (hasOptions) {
      if (noTranslate) entry.noTranslate = true;
      const dedupeCb = optionsDiv.querySelector('.g-dedupe');
      if (!entry.noTranslate && dedupeCb?.checked && ANNOTATED_TARGET_RE.test(target)) {
        entry.dedupeAnnotation = true;
        entry.dedupeKeep = optionsDiv.querySelector('.g-dedupe-keep')?.value === 'target'
          ? 'target' : 'source';
      }
    }
    out.push(entry);
  }
  return out;
}

function injectableArticleGlossary() {
  if (!Array.isArray(currentArticleGlossary) || currentArticleGlossary.length === 0) return null;
  return currentArticleGlossary.map((e) => (
    e.noTranslate
      ? { source: e.source, target: e.source }
      : { source: e.source, target: normalizeNameSeparators(e.target) }
  ));
}

function updateGlossaryCount() {
  $('glossary-count').textContent = t('doc.glossary.count', { n: readGlossaryTable().length });
}

function exportGlossaryJSON() {
  const entries = readGlossaryTable();
  if (entries.length === 0) {
    alert(t('doc.glossary.alert.empty'));
    return;
  }
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const baseName = (currentDoc?.meta?.filename || 'glossary').replace(/\.(pdf|epub|txt|md|markdown|html?)$/i, '');
  a.download = `${baseName}-glossary.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

function askGlossaryImportMode(existingCount, newCount) {
  return new Promise((resolve) => {
    const dlg = $('glossary-import-dialog');
    $('glossary-import-desc').textContent = t('doc.glossary.import.desc', { existing: existingCount, new: newCount });
    const done = (mode) => { dlg.close(); resolve(mode); };
    $('glossary-import-merge-btn').onclick = () => done('merge');
    $('glossary-import-overwrite-btn').onclick = () => done('overwrite');
    $('glossary-import-cancel-btn').onclick = () => done(null);
    dlg.oncancel = () => resolve(null);
    dlg.showModal();
  });
}

async function handleGlossaryFileImport(file) {
  if (!file) return;
  try {
    const text = await file.text();
    let valid;
    const isCsvFile = /\.csv$/i.test(file.name || '') || (file.type || '') === 'text/csv';
    if (isCsvFile) {
      valid = parseGlossaryCsv(text);
      if (!valid) throw new Error(t('doc.glossary.alert.invalidCsv'));
    } else {
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        const csvFallback = parseGlossaryCsv(text);
        if (!csvFallback) throw new Error(t('doc.glossary.alert.invalidJson'));
        data = null;
        valid = csvFallback;
      }
      if (data !== null) {
        if (!Array.isArray(data)) throw new Error(t('doc.glossary.alert.invalidJson'));
        valid = data
          .filter((e) => e && typeof e.source === 'string' && typeof e.target === 'string')
          .map((e) => {
            const entry = { source: e.source, target: e.target };
            if (typeof e.type === 'string' && e.type.trim()) entry.type = e.type.trim().slice(0, 32);
            if (e.noTranslate === true) entry.noTranslate = true;
            if (e.dedupeAnnotation === true) {
              entry.dedupeAnnotation = true;
              entry.dedupeKeep = e.dedupeKeep === 'target' ? 'target' : 'source';
            }
            return entry;
          });
      }
    }
    if (valid.length === 0) throw new Error(t('doc.glossary.alert.noEntries'));
    const existing = readGlossaryTable();
    let next = valid;
    let mergeInfo = null;
    if (existing.length > 0) {
      const mode = await askGlossaryImportMode(existing.length, valid.length);
      if (!mode) return;
      if (mode === 'merge') {
        mergeInfo = mergeBookGlossaries([valid, existing]);
        next = mergeInfo.entries;
      }
    }
    buildGlossaryTable(next);
    if (mergeInfo) {
      let msg = t('doc.glossary.import.mergeResult', { n: mergeInfo.entries.length, conflicts: mergeInfo.conflicts });
      if (mergeInfo.dropped > 0) {
        msg += '\n' + t('doc.glossary.import.mergeDropped', { cap: BOOK_GLOSSARY_MAX_TERMS, dropped: mergeInfo.dropped });
      }
      alert(msg);
    }
  } catch (err) {
    alert(t('doc.glossary.alert.importFail', { error: err.message || err }));
  }
}

async function reextractGlossary() {
  const existing = readGlossaryTable();
  if (existing.length > 0) {
    if (!confirm(t('doc.glossary.confirm.reextract', { n: existing.length }))) return;
  }
  const btn = $('glossary-reextract-btn');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = t('doc.glossary.btn.extracting');
  setGlossaryState(t('doc.glossary.state.loading'), 'is-loading');
  try {
    const extracted = isBookDoc(currentDoc)
      ? await extractGlossaryForBook(currentDoc, { forceRefresh: true })
      : await extractGlossaryForDoc(currentDoc, { forceRefresh: true });
    if (Array.isArray(extracted) && extracted.length > 0) {
      buildGlossaryTable(extracted);
    } else {
      buildGlossaryTable([]);
      alert(t('doc.glossary.alert.noExtract'));
    }
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

function bindGlossaryUI() {
  $('extract-glossary-btn').addEventListener('click', () => openGlossaryEditor('result'));
  $('edit-glossary-btn').addEventListener('click', () => openGlossaryEditor('edit'));
  $('glossary-add-row-btn').addEventListener('click', () => appendGlossaryRow());
  $('glossary-import-btn').addEventListener('click', () => {
    const fileInput = $('glossary-import-file');
    fileInput.value = '';
    fileInput.click();
  });
  $('glossary-import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    handleGlossaryFileImport(file);
  });
  $('glossary-export-btn').addEventListener('click', exportGlossaryJSON);
  $('glossary-reextract-btn').addEventListener('click', reextractGlossary);
  $('glossary-clear-btn').addEventListener('click', async () => {
    const existing = readGlossaryTable();
    if (existing.length > 0 && !confirm(t('doc.glossary.confirm.clear', { n: existing.length }))) return;
    currentArticleGlossary = [];
    buildGlossaryTable([]);
    if (isBookDoc(currentDoc)) await savePersistedBookGlossary([]);
  });
  $('glossary-cancel-btn').addEventListener('click', () => {
    if (glossaryEntryStage === 'chapters' && isBookDoc(currentDoc)) showStage('chapters');
    else if (glossaryEntryStage === 'edit' && currentReaderHandle) showStage('edit');
    else if (glossaryEntryStage === 'reader' && currentReaderHandle) showStage('reader');
    else showStage('result');
  });
  $('glossary-translate-btn').addEventListener('click', async () => {
    currentArticleGlossary = readGlossaryTable();
    if (isBookDoc(currentDoc)) {
      currentBookForbidden = readBookForbiddenTable();
      await savePersistedBookGlossary(currentArticleGlossary);
      await renderChapterList();
      showStage('chapters');
      return;
    }
    if (glossaryEntryStage === 'edit') {
      if (!confirm(t('doc.glossary.confirm.translateUnsaved'))) return;
    } else if (currentReaderHandle) {
      if (!confirm(t('doc.glossary.confirm.translate'))) return;
    }
    await startTranslate();
  });
  const onSortHeaderClick = (key) => {
    if (glossarySortKey === key) glossarySortDir = -glossarySortDir;
    else { glossarySortKey = key; glossarySortDir = 1; }
    buildGlossaryTable(readGlossaryTable());
  };
  $('g-sort-source').addEventListener('click', () => onSortHeaderClick('source'));
  $('g-sort-target').addEventListener('click', () => onSortHeaderClick('target'));
  $('book-forbidden-add-btn').addEventListener('click', () => appendBookForbiddenRow());
}

async function fillSummaryDialog(summary) {
  if (!summary) return;
  const filename = (currentDoc && currentDoc.meta && currentDoc.meta.filename) || t('doc.settings.preset.unnamed');
  $('translated-filename').textContent = filename;
  $('translated-count').textContent = `${summary.translatedBlocks - summary.failedBlocks} / ${summary.totalBlocks}`;
  refreshSummaryFailedDisplay();
  const cacheHits = summary.cacheHits || 0;
  $('translated-cache-hits').textContent = cacheHits > 0 && summary.totalBlocks > 0
    ? t('doc.summary.cacheHitRate', { n: cacheHits, percent: ((cacheHits / summary.totalBlocks) * 100).toFixed(0) })
    : '0';
  $('translated-input-tokens').textContent = summary.cumulativeInputTokens.toLocaleString('en-US');
  $('translated-output-tokens').textContent = summary.cumulativeOutputTokens.toLocaleString('en-US');
  $('translated-cost').textContent = await formatCostStr(summary.cumulativeCostUSD);
}

async function formatCostStr(usd) {
  try {
    const [{ displayCurrency = 'TWD' }, rateInfo] = await Promise.all([
      chrome.storage.sync.get('displayCurrency'),
      getCachedRate(),
    ]);
    return formatMoney(usd, { currency: displayCurrency, rate: rateInfo?.rate || FALLBACK_USD_TWD_RATE });
  } catch (_) {
    return formatMoney(usd, { currency: 'USD' });
  }
}

function resetProgress() {
  setProgress({
    totalBlocks: 0,
    translatedBlocks: 0,
    failedBlocks: 0,
    estimatedRemainingSec: 0,
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    cumulativeCostUSD: 0,
  });
}

function failedSummary(err) {
  return {
    totalBlocks: 0,
    translatedBlocks: 0,
    failedBlocks: 0,
    cumulativeInputTokens: 0,
    cumulativeBilledInputTokens: 0,
    cumulativeOutputTokens: 0,
    cumulativeCostUSD: 0,
    cancelled: false,
    error: (err && err.message) || String(err),
  };
}

function setProgress(p) {
  const ratio = p.totalBlocks > 0 ? (p.translatedBlocks / p.totalBlocks) : 0;
  $('translate-progress-fill').style.width = `${(ratio * 100).toFixed(1)}%`;
  $('translate-progress-count').textContent = t('doc.translating.progress.count', { translated: p.translatedBlocks, total: p.totalBlocks });
  $('translate-progress-eta').textContent = p.estimatedRemainingSec > 0
    ? t('doc.translating.progress.eta', { time: formatSec(p.estimatedRemainingSec) })
    : '';
  $('translate-progress-cost').textContent = p.cumulativeCostUSD > 0
    ? t('doc.translating.progress.cost', { cost: p.cumulativeCostUSD.toFixed(4) })
    : '';
  if (p.failedBlocks > 0) {
    $('translate-progress-failed').textContent = t('doc.translating.progress.failed', { n: p.failedBlocks });
    $('translate-progress-failed').hidden = false;
  } else {
    $('translate-progress-failed').hidden = true;
  }
}

function formatSec(sec) {
  if (sec < 60) return t('doc.translating.timeSec', { n: sec });
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return t('doc.translating.timeMinSec', { m, s });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

function showChaptersError(msg) {
  const el = $('chapters-error');
  el.textContent = msg;
  el.hidden = false;
}

function clearChaptersError() {
  const el = $('chapters-error');
  el.textContent = '';
  el.hidden = true;
}

async function handleBookFile(file, kind, subtitleFormat = null) {
  const pre = kind === 'epub' ? preflightEpubFile(file)
    : kind === 'docx' ? preflightDocxFile(file) : preflightDocFile(file);
  if (pre.level === 'error') {
    showError(t('doc.epub.error.' + pre.code));
    return;
  }

  releaseCurrentDoc();

  if (parseAbortController) parseAbortController.abort();
  const myGen = ++parseGeneration;
  parseAbortController = new AbortController();
  const parseSignal = parseAbortController.signal;

  showStage('parsing');
  setParsingDetail(kind === 'epub' ? t('doc.epub.parsing.unzip') : t('doc.parsing.detail.fileContent'));

  let decodeOpts = {};
  try { decodeOpts = { targetLanguage: (await getSettings()).targetLanguage || '' }; } catch (_) {   }

  try {
    const doc = kind === 'epub'
      ? await parseEpub(file, (p) => {
        if (myGen !== parseGeneration) return;
        if (p.stage === 'chapters') {
          setParsingDetail(t('doc.epub.parsing.chapters', { current: p.current, total: p.total }));
        }
      }, { signal: parseSignal })
      : kind === 'docx'
        ? await parseDocxFile(file, () => {}, {
          signal: parseSignal,
          chapterTitles: {
            headers: t('doc.docx.chapters.headers'),
            notes: t('doc.docx.chapters.notes'),
            comments: t('doc.docx.chapters.comments'),
          },
        })
        : kind === 'subtitle'
          ? await parseSubtitleFile(file, subtitleFormat, decodeOpts)
          : await parseDocFile(file, kind, decodeOpts);
    if (myGen !== parseGeneration) return;

    currentDoc = doc;
    window.__skEpubDoc = doc;

    epubBookHash = await sha1Hex(
      doc.chapters.map((c) => c.blocks.map((b) => b.plainText).join('\n')).join('\n'));
    if (myGen !== parseGeneration) return;

    const session = await loadEpubSession(epubBookHash);
    if (myGen !== parseGeneration) return;
    if (session) {
      const restored = hydrateSessionBlocks(doc, session.blocks);
      if (Array.isArray(session.glossary)) {
        currentArticleGlossary = session.glossary;
      }
      if (Array.isArray(session.forbidden)) currentBookForbidden = session.forbidden;
      if (typeof session.extraPrompt === 'string') currentDocExtraPrompt = session.extraPrompt;
      if (Number.isFinite(session.costUSD)) epubCumulativeCostUSD = session.costUSD;
      if (Array.isArray(session.scanIgnored)) epubScanIgnored = hydrateScanIgnored(session.scanIgnored);
      if (Array.isArray(session.scanIgnoredDrift)) epubScanIgnoredDrift = new Set(session.scanIgnoredDrift.filter((x) => typeof x === 'string'));
      if (restored > 0) {
        for (const c of doc.chapters) {
          if (chapterDoneState(c) === 'done') c.selected = false;
        }
      }
      console.log('[Transit] epub session restored:', {
        blocks: restored,
        glossary: (currentArticleGlossary || []).length,
        forbidden: currentBookForbidden.length,
      });
    }
    if (kind === 'epub' && !session && currentArticleGlossary === null) {
      const persisted = await loadPersistedBookGlossary();
      if (myGen !== parseGeneration) return;
      if (Array.isArray(persisted) && persisted.length > 0) {
        currentArticleGlossary = persisted;
        console.log('[Transit] legacy book glossary restored:', persisted.length, 'terms');
      }
    }

    await renderChapterList();
    if (myGen !== parseGeneration) return;
    showStage('chapters');
  } catch (err) {
    if (myGen !== parseGeneration || (err && err.code === 'aborted')) return;
    console.error('[Transit] 書籍式文件解析失敗', kind, err);
    if (err && err.name === 'EpubParseError') {
      showError(t('doc.epub.error.' + err.code));
    } else if (err instanceof DocxParseError) {
      showError(t('doc.docx.error.' + err.code, null, t('doc.file.error.parse')));
    } else if (err instanceof DocFileParseError) {
      showError(t('doc.file.error.' + err.code));
    } else if (kind === 'epub') {
      showError(t('doc.epub.error.bad-zip'));
    } else {
      showError(t('doc.file.error.parse'));
    }
  } finally {
    if (myGen === parseGeneration) parseAbortController = null;
  }
}

function chapterDoneState(ch) {
  if (ch.parseFailed) return 'unparsed';
  if (ch.blocks.length === 0) return 'empty';
  let done = 0, failed = 0;
  for (const b of ch.blocks) {
    if (b.translationStatus === 'done') done++;
    else if (b.translationStatus === 'failed') failed++;
  }
  if (done === ch.blocks.length) return 'done';
  if (failed > 0) return 'failed';
  if (done > 0) return 'partial';
  return 'none';
}

function epubHasAnyTranslation() {
  return !!(isBookDoc(currentDoc)
    && currentDoc.chapters.some((c) => c.blocks.some((b) => b.translationStatus === 'done')));
}

function chapterCjkRatio(ch) {
  if (Number.isFinite(ch.cjkRatio)) return ch.cjkRatio;
  ch.cjkRatio = cjkRatioOfBlocks(ch.blocks || []);
  return ch.cjkRatio;
}
function chaptersCjkRatio(chapters) {
  let chars = 0;
  let cjk = 0;
  for (const ch of chapters) {
    chars += ch.charCount || 0;
    cjk += (ch.charCount || 0) * chapterCjkRatio(ch);
  }
  return chars > 0 ? cjk / chars : 0;
}

function formatUsdApprox(usd) {
  if (usd == null || !Number.isFinite(usd)) return '—';
  return '≈ $' + (usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2));
}

async function renderChapterList() {
  const doc = currentDoc;
  if (!isBookDoc(doc)) return;

  $('chapters-book-title').textContent = doc.meta.title;
  $('chapters-author').textContent = doc.meta.author || '—';
  $('chapters-author-row').hidden = !doc.meta.author;
  $('chapters-epub-version').textContent = doc.kind === 'epub'
    ? (doc.meta.epubVersion ? `EPUB ${doc.meta.epubVersion}` : 'EPUB')
    : doc.kind === 'subtitle'
      ? (SUBTITLE_FORMAT_LABELS[doc.subtitleFormat] || '—')
      : ({ txt: 'TXT', md: 'Markdown', html: 'HTML', docx: 'Word (DOCX)' }[doc.kind] || '—');
  $('chapters-count').textContent = String(doc.meta.chapterCount);
  $('chapters-chars').textContent = doc.stats.totalChars.toLocaleString('en-US');

  const hasChapterUI = doc.chapters.length > 1;
  $('chapters-count-row').hidden = !hasChapterUI;
  const selectActions = document.querySelector('#stage-chapters .chapters-select-actions');
  if (selectActions) selectActions.hidden = !hasChapterUI;
  $('chapters-list').hidden = !hasChapterUI;
  $('chapters-exclude-matter-btn').hidden = doc.kind !== 'epub';
  const trBtn = $('chapters-translate-btn');
  const trKey = hasChapterUI ? 'doc.epub.btn.translateSelected' : 'doc.result.btn.translate';
  trBtn.setAttribute('data-i18n', trKey);
  trBtn.textContent = t(trKey);

  const { modelOverride } = await resolveDocEngine();
  const settings = await getSettings();
  const estModel = modelOverride || settings.geminiConfig?.model || '';

  const list = $('chapters-list');
  list.replaceChildren();
  for (const ch of doc.chapters) {
    const row = document.createElement('div');
    row.className = 'chapter-row';
    const state = chapterDoneState(ch);
    const disabled = state === 'unparsed' || state === 'empty';

    const label = document.createElement('label');
    label.className = 'chapter-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = ch.selected && !disabled;
    cb.disabled = disabled;
    cb.addEventListener('change', () => {
      ch.selected = cb.checked;
      updateChapterSummaryLine(estModel, settings);
    });
    const titleSpan = document.createElement('span');
    titleSpan.className = 'chapter-title' + (ch.suggestSkip ? ' is-matter' : '');
    titleSpan.textContent = `${ch.index + 1}. ${ch.title}`;
    label.append(cb, titleSpan);

    const charsSpan = document.createElement('span');
    charsSpan.className = 'chapter-chars';
    charsSpan.textContent = ch.charCount > 0 ? ch.charCount.toLocaleString('en-US') : '—';

    const costSpan = document.createElement('span');
    costSpan.className = 'chapter-cost';
    costSpan.textContent = ch.charCount > 0
      ? formatUsdApprox(estimateChapterCostUSD(ch.charCount, estModel, settings, chapterCjkRatio(ch)))
      : '';

    const statusSpan = document.createElement('span');
    statusSpan.className = 'chapter-status';
    statusSpan.dataset.state = state;
    statusSpan.textContent = t('doc.epub.status.' + state);

    row.append(label, charsSpan, costSpan, statusSpan);

    if (state === 'done' || state === 'partial' || state === 'failed') {
      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'chapter-preview-btn';
      previewBtn.textContent = t('doc.epub.btn.preview');
      previewBtn.addEventListener('click', () => openEpubPreview(ch));
      row.appendChild(previewBtn);
    }
    list.appendChild(row);
  }

  updateChapterSummaryLine(estModel, settings);

  $('chapters-download-btn').hidden = !epubHasAnyTranslation();
  $('chapters-preview-all-btn').hidden = !epubHasAnyTranslation();
  const dlBtn = $('chapters-download-btn');
  const dlKey = doc.kind === 'epub' ? 'doc.epub.btn.download' : 'doc.book.btn.download';
  dlBtn.setAttribute('data-i18n', dlKey);
  dlBtn.textContent = t(dlKey);
  const glossBtn = $('chapters-glossary-btn');
  const glossKey = kindKey((Array.isArray(currentArticleGlossary) && currentArticleGlossary.length > 0)
    ? 'btn.glossaryEdit' : 'btn.glossary');
  setI18nText(glossBtn, glossKey);
  setI18nTitle(glossBtn, kindKey('btn.glossary.title'));
  setI18nText($('chapters-preview-all-btn'), kindKey('btn.previewAll'));
  setI18nText($('chapters-discard-btn'), kindKey('btn.discard'));
  setI18nTitle($('chapters-discard-btn'), kindKey('btn.discard.title'));
  setI18nTitle($('chapters-export-session-btn'), kindKey('btn.exportSession.title'));
  setI18nTitle($('chapters-import-session-btn'), kindKey('btn.importSession.title'));
  setI18nText($('chapters-cumulative-label'), kindKey('row.cumulativeCost'));
  $('chapters-discard-btn').hidden = !epubHasAnyTranslation();
  $('chapters-export-session-btn').hidden = !epubHasAnyTranslation();
  const isEpub2 = /^2(\.|$)/.test(doc.meta.epubVersion || '');
  $('epub-output-format-wrap').hidden = !(isEpub2 && epubHasAnyTranslation());
  const dualWrap = $('epub-dual-wrap');
  const dualNs = doc.kind === 'subtitle' ? 'doc.subtitle.dual.' : 'doc.epub.dual.';
  setI18nTitle(dualWrap, doc.kind === 'docx' ? 'doc.docx.dual.title' : dualNs + 'title');
  setI18nText($('epub-dual-label'), dualNs + 'label');
  setI18nText($('epub-dual-opt-single'), dualNs + 'single');
  setI18nText($('epub-dual-opt-dual'), dualNs + 'dual');
  dualWrap.hidden = !((doc.kind === 'epub' || doc.kind === 'subtitle' || doc.kind === 'docx') && epubHasAnyTranslation());
  const cumRow = $('chapters-cumulative-row');
  if (epubCumulativeCostUSD > 0) {
    cumRow.hidden = false;
    $('chapters-cumulative-cost').textContent = await formatCostStr(epubCumulativeCostUSD);
  } else {
    cumRow.hidden = true;
  }
  renderScanBanner();
}

function selectedEpubChapters() {
  if (!isBookDoc(currentDoc)) return [];
  return currentDoc.chapters.filter((c) => c.selected && !c.parseFailed && c.blocks.length > 0);
}

function updateChapterSummaryLine(estModel, settings) {
  const sel = selectedEpubChapters();
  const chars = sel.reduce((acc, c) => acc + c.charCount, 0);
  const cost = estimateChapterCostUSD(chars, estModel, settings, chaptersCjkRatio(sel));
  $('chapters-selected-summary').textContent = t(chapterKey('selectedSummary'), {
    chapters: sel.length,
    chars: chars.toLocaleString('en-US'),
    cost: formatUsdApprox(cost),
  });
}

async function startEpubTranslate() {
  const doc = currentDoc;
  let selected = selectedEpubChapters();
  if (selected.length === 0 && doc.chapters.length === 1) {
    for (const c of doc.chapters) c.selected = !c.parseFailed && c.blocks.length > 0;
    selected = selectedEpubChapters();
  }
  if (selected.length === 0) {
    showChaptersError(t('doc.epub.error.none-selected'));
    showStage('chapters');
    return;
  }

  const { engine, modelOverride } = await resolveDocEngine();
  clearChaptersError();

  const selChars = selected.reduce((acc, c) => acc + c.charCount, 0);
  if (selChars > EPUB_LIMITS.softWarnChars) {
    const settings = await getSettings();
    const est = estimateChapterCostUSD(selChars, modelOverride || settings.geminiConfig?.model || '', settings, chaptersCjkRatio(selected));
    if (!confirm(t(chapterKey('confirm.softWarn'), {
      chars: selChars.toLocaleString('en-US'),
      cost: formatUsdApprox(est),
    }))) return;
  }

  const retranslateIdx = new Set(
    selected.filter((c) => chapterDoneState(c) === 'done').map((c) => c.index),
  );
  if (retranslateIdx.size > 0) {
    if (!confirm(t(chapterKey('confirm.retranslate')))) return;
    await clearEpubBlocksCache(selected.filter((c) => retranslateIdx.has(c.index)));
  }

  currentModelOverride = modelOverride;
  currentEngine = engine;

  showStage('translating');
  resetProgress();

  const glossary = injectableArticleGlossary();
  if (glossary) {
    console.log('[Transit] using book glossary:', glossary.length, 'terms');
  }

  const selIdx = new Set(selected.map((c) => c.index));
  translateAbortController = new AbortController();
  let costAccounted = 0;
  const onEpubProgress = (p) => {
    setProgress(p);
    const cost = Number.isFinite(p.cumulativeCostUSD) ? p.cumulativeCostUSD : 0;
    if (cost > costAccounted) {
      epubCumulativeCostUSD += cost - costAccounted;
      costAccounted = cost;
      if (currentDoc === doc) scheduleEpubSessionSave();
    }
  };
  let summary;
  try {
    summary = await translateDocument(doc, {
      modelOverride,
      engine,
      glossary,
      signal: translateAbortController.signal,
      onProgress: onEpubProgress,
      blockFilter: (block, page) => selIdx.has(page.chapterIndex)
        && (retranslateIdx.has(page.chapterIndex) || block.translationStatus !== 'done'),
      filterGlossary: true,
      extraForbiddenTerms: currentBookForbidden.length > 0 ? currentBookForbidden : null,
      batchSize: await resolveDocBatchSize(),
      extraPrompt: await docExtraPromptForLlm(),
    });
  } catch (err) {
    console.error('[Transit] translateDocument(epub) 失敗', err);
    summary = failedSummary(err);
  }
  translateAbortController = null;
  lastTranslateSummary = summary;
  epubCumulativeCostUSD += Math.max(0, (summary.cumulativeCostUSD || 0) - costAccounted);

  const stripped = applyGlossaryAnnotationCleanup(currentDoc, currentArticleGlossary);
  if (stripped > 0) console.log('[Transit] 術語表對照清理：', stripped, '處');

  for (const c of selected) {
    if (chapterDoneState(c) === 'done') c.selected = false;
  }

  await persistEpubSession();

  await renderChapterList();
  if (summary.error) showChaptersError(summary.error);
  showStage('chapters');

  maybeRunConsistencyScan(doc);
}

async function clearEpubBlocksCache(chapters, { all = false } = {}) {
  const texts = [];
  for (const ch of chapters) {
    for (const b of ch.blocks) {
      if (!all && b.translationStatus !== 'done') continue;
      const text = b.epubSerializedText || b.plainText;
      if (text) texts.push(text);
    }
  }
  const removed = await clearTcCacheForTexts(texts);
  console.log('[Transit] retranslate cache cleared:', removed, 'keys');
  return removed;
}

async function downloadTranslatedEpub() {
  if (!epubHasAnyTranslation()) return;
  if (currentDoc.kind !== 'epub') return downloadTranslatedDocFile();
  const btn = $('chapters-download-btn');
  btn.disabled = true;
  try {
    await autoFixCjkSpacing(currentDoc);
    const settings = await getSettings();
    const upgradeTo3 = !$('epub-output-format-wrap').hidden
      && $('epub-output-format').value === 'epub3';
    const bilingual = !$('epub-dual-wrap').hidden && $('epub-dual-mode').value === 'dual';
    const { bytes } = buildTranslatedEpub(currentDoc, settings.targetLanguage || 'zh-TW', {
      upgradeTo3,
      glossary: currentArticleGlossary,
      paragraphSpacing: settings.translateDoc?.epubParagraphSpacing === true,
      bilingual,
    });
    const blob = new Blob([bytes], { type: 'application/epub+zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = translatedEpubFilename(currentDoc.meta.filename, { bilingual });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  } catch (err) {
    console.error('[Transit] 譯本 EPUB 產出失敗', err);
    showChaptersError(t('doc.epub.error.build-failed', { error: (err && err.message) || String(err) }));
  } finally {
    btn.disabled = false;
  }
}

async function downloadTranslatedDocFile() {
  const btn = $('chapters-download-btn');
  btn.disabled = true;
  try {
    await autoFixCjkSpacing(currentDoc);
    const settings = await getSettings();
    const dedupe = computeAnnotationDedupe(currentDoc, currentArticleGlossary);
    const kind = currentDoc.kind;
    if (kind === 'docx') {
      const bilingual = !$('epub-dual-wrap').hidden && $('epub-dual-mode').value === 'dual';
      const { bytes } = buildTranslatedDocx(currentDoc, settings.targetLanguage || 'zh-TW', { bilingual, dedupe });
      const blob = new Blob([bytes], { type: DOCX_MIME });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = translatedDocxFilename(currentDoc.meta.filename, { bilingual });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
      return;
    }
    let text;
    let mime;
    let filename;
    if (kind === 'subtitle') {
      const bilingual = !$('epub-dual-wrap').hidden && $('epub-dual-mode').value === 'dual';
      await refreshSubtitleStripPeriod();
      text = buildTranslatedSubtitleText(currentDoc, dedupe, { bilingual, stripPeriod: subtitleStripPeriodOn });
      mime = subtitleMimeType(currentDoc.subtitleFormat);
      filename = translatedSubtitleFilename(currentDoc.meta.filename, currentDoc.subtitleFormat, { bilingual, targetLanguage: settings.targetLanguage || 'zh-TW' });
    } else {
      text = kind === 'html'
        ? await buildTranslatedHtmlDoc(currentDoc, settings.targetLanguage || 'zh-TW', dedupe)
        : buildTranslatedDocText(currentDoc, dedupe);
      mime = kind === 'html' ? 'text/html' : kind === 'md' ? 'text/markdown' : 'text/plain';
      filename = translatedDocFilename(currentDoc.meta.filename, kind);
    }
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  } catch (err) {
    console.error('[Transit] 譯文檔產出失敗', err);
    showChaptersError(t('doc.book.error.build-failed', { error: (err && err.message) || String(err) }));
  } finally {
    btn.disabled = false;
  }
}

async function openEpubPreview(scope) {
  epubPreviewScope = scope;
  const fixed = await autoFixCjkSpacing(currentDoc);
  await refreshSubtitleStripPeriod();
  renderEpubPreview();
  showStage('epubPreview');
  if (fixed.hits > 0) {
    $('epub-sr-status').textContent = t('doc.epub.sr.fixSpacingResult', { hits: fixed.hits, blocks: fixed.blocks });
  }
}

async function docExtraPromptForLlm() {
  const user = currentDocExtraPrompt || '';
  if (currentDoc?.kind !== 'subtitle') return user || null;
  let targetLanguage = 'zh-TW';
  try { targetLanguage = (await getSettings()).targetLanguage || 'zh-TW'; } catch (_) {   }
  await refreshSubtitleStripPeriod();
  const hint = subtitlePromptHint(targetLanguage, { stripPeriod: subtitleStripPeriodOn });
  return user ? `${hint}\n\n${user}` : hint;
}

let subtitleStripPeriodOn = false;
async function refreshSubtitleStripPeriod() {
  let on = false;
  try {
    const s = await getSettings();
    on = String(s.targetLanguage || '').startsWith('zh') && s.translateDoc?.subtitleStripPeriod !== false;
  } catch (_) {   }
  subtitleStripPeriodOn = on;
  return on;
}

const _cjkFixSigByBlock = new WeakMap();
function _cjkFixSignature(b) {
  const str = `${b.translationStatus}\u0001${b.translationRaw ?? ''}\u0001${b.editedHtml ?? ''}\u0001${b.translation ?? ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${str.length}:${h}`;
}

async function autoFixCjkSpacing(doc) {
  const none = { hits: 0, blocks: 0 };
  if (!doc || !Array.isArray(doc.chapters)) return none;
  try {
    const s = await getSettings();
    if (!String(s.targetLanguage || '').startsWith('zh')) return none;
    if (s.translateDoc?.epubAutoFixSpacing === false) return none;
  } catch (_) {
    return none;
  }
  const SK = window.__SK;
  let blocks = 0;
  let hits = 0;
  for (const ch of doc.chapters) {
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'done') continue;
      const sig = _cjkFixSignature(b);
      if (_cjkFixSigByBlock.get(b) === sig) continue;
      _cjkFixSigByBlock.set(b, sig);
      if (Array.isArray(b.tagSlots) && typeof b.translationRaw === 'string'
          && !(typeof b.editedHtml === 'string' && b.editedHtml.length > 0)) {
        const r = fixCjkSpacingAroundPlaceholders(b.translationRaw, addCjkLatinSpacing);
        if (r.count > 0) {
          b.translationRaw = r.text;
          b.translation = stripPlaceholderTokens(r.text);
          blocks++;
          hits += r.count;
          _cjkFixSigByBlock.set(b, _cjkFixSignature(b));
        }
        continue;
      }
      const rendered = renderBlockContent(b, SK);
      if (!rendered) continue;
      const el = rendered.el;
      const nodes = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) nodes.push(node);
      let blockHits = 0;
      for (let i = 0; i < nodes.length; i++) {
        if (!nodes[i].nodeValue) continue;
        let prevChar = '';
        for (let j = i - 1; j >= 0 && !prevChar; j--) prevChar = (nodes[j].nodeValue || '').slice(-1);
        const r = addCjkLatinSpacing(nodes[i].nodeValue, { prevChar });
        if (r.count > 0) {
          nodes[i].nodeValue = r.text;
          blockHits += r.count;
        }
      }
      if (blockHits > 0) {
        blocks++;
        hits += blockHits;
        commitEditedBlock(b, el);
        _cjkFixSigByBlock.set(b, _cjkFixSignature(b));
      }
    }
  }
  if (blocks > 0) scheduleEpubSessionSave();
  return { hits, blocks };
}

function renderEpubPreview() {
  const SK = window.__SK;
  const scope = epubPreviewScope;
  if (!scope || !currentDoc) return;
  const chapters = scope === 'all'
    ? currentDoc.chapters.filter((c) => c.blocks.length > 0)
    : [scope];
  $('epub-preview-title').textContent = scope === 'all'
    ? t(currentDoc.kind === 'epub' ? 'doc.epub.preview.allTitle' : 'doc.book.btn.previewAll')
    : `${scope.index + 1}. ${scope.title}`;
  setI18nText($('epub-preview-back-btn'), chapterKey('btn.previewBack'));
  setI18nText($('epub-preview-edit-help'), kindKey('preview.editHint'));
  $('epub-preview-compare').checked = epubPreviewCompare;
  $('epub-sr-status').textContent = '';
  const dedupe = computeAnnotationDedupe(currentDoc, currentArticleGlossary);
  const content = $('epub-preview-content');
  content.replaceChildren();
  for (const ch of chapters) {
    if (scope === 'all') {
      const h = document.createElement('h2');
      h.className = 'epub-preview-chapter-title';
      h.textContent = `${ch.index + 1}. ${ch.title}`;
      content.appendChild(h);
    }
    for (const b of ch.blocks) appendPreviewBlock(content, b, SK, dedupe);
  }
}

function onPreviewEditablePaste(e) {
  e.preventDefault();
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (!text) return;
  document.execCommand('insertText', false, text);
}

const previewLinkRepair = window.__SKEditLinkRepair.createEditLinkRepair({});

function findPreviewScrollAnchor() {
  const sticky = document.querySelector('#stage-epub-preview .epub-preview-sticky');
  const stickyBottom = sticky ? sticky.getBoundingClientRect().bottom : 0;
  for (const el of $('epub-preview-content').querySelectorAll('[data-sk-block-id]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > stickyBottom + 1) {
      return { blockId: el.dataset.skBlockId, offset: r.top };
    }
  }
  return null;
}

function restorePreviewScrollAnchor(anchor) {
  if (!anchor) return;
  let el = null;
  try {
    el = $('epub-preview-content').querySelector(`[data-sk-block-id="${CSS.escape(anchor.blockId)}"]`);
  } catch (_) {   }
  if (!el) return;
  window.scrollBy(0, el.getBoundingClientRect().top - anchor.offset);
}

function appendPreviewBlock(content, b, SK, dedupe) {
  const el = document.createElement(b.type === 'heading' ? 'h3' : 'p');
  el.className = 'epub-preview-block';
  el.dataset.state = b.translationStatus || 'pending';
  el.dataset.skBlockId = b.blockId;
  if (b.translationStatus === 'done') {
    const rendered = renderBlockContent(b, SK, dedupe.get(b.blockId) ?? null);
    if (rendered) {
      el.append(...rendered.el.childNodes);
      if (rendered.usedEdited) el.classList.add('is-edited');
    } else {
      el.textContent = '';
    }
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.__skBlock = b;
    el.addEventListener('paste', onPreviewEditablePaste);
    el.addEventListener('beforeinput', previewLinkRepair.onBeforeInput);
    el.addEventListener('input', previewLinkRepair.onInput);
    el.addEventListener('compositionend', previewLinkRepair.onCompositionEnd);
    el.addEventListener('pointerdown', previewLinkRepair.onPointerDown);
    el.addEventListener('keydown', previewLinkRepair.onKeyDown);
    const before = el.innerHTML;
    el.addEventListener('blur', () => {
      if (el.innerHTML === before) return;
      commitEditedBlock(b, el);
      el.classList.add('is-edited');
      scheduleEpubSessionSave();
    });
    content.appendChild(el);
    if (epubPreviewCompare) {
      const orig = document.createElement('div');
      orig.className = 'epub-preview-original';
      orig.textContent = b.plainText;
      content.appendChild(orig);
    }
    return;
  }
  el.textContent = b.plainText;
  content.appendChild(el);
}

function bindChaptersUI() {
  if (!stages.chapters) return;
  $('chapters-select-all-btn').addEventListener('click', () => {
    for (const c of currentDoc?.chapters || []) {
      if (!c.parseFailed && c.blocks.length > 0) c.selected = true;
    }
    renderChapterList();
  });
  $('chapters-select-none-btn').addEventListener('click', () => {
    for (const c of currentDoc?.chapters || []) c.selected = false;
    renderChapterList();
  });
  $('chapters-exclude-matter-btn').addEventListener('click', () => {
    for (const c of currentDoc?.chapters || []) {
      if (c.suggestSkip) c.selected = false;
    }
    renderChapterList();
  });
  $('chapters-translate-btn').addEventListener('click', () => startTranslate());
  $('chapters-glossary-btn').addEventListener('click', () => openGlossaryEditor('chapters'));
  $('chapters-preview-all-btn').addEventListener('click', () => openEpubPreview('all'));
  $('chapters-download-btn').addEventListener('click', downloadTranslatedEpub);
  $('chapters-settings-btn').addEventListener('click', () => openSettingsDialog());
  $('chapters-discard-btn').addEventListener('click', discardBookTranslation);
  $('chapters-export-session-btn').addEventListener('click', exportEpubSession);
  $('chapters-import-session-btn').addEventListener('click', () => {
    const fi = $('epub-session-import-file');
    fi.value = '';
    fi.click();
  });
  $('epub-session-import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importEpubSession(file);
  });
  $('chapters-reupload-btn').addEventListener('click', () => {
    clearError();
    releaseCurrentDoc();
    showStage('upload');
  });
}

function bindEpubPreviewUI() {
  if (!stages.epubPreview) return;
  $('epub-preview-back-btn').addEventListener('click', () => showStage('chapters'));
  $('epub-preview-compare').addEventListener('change', (e) => {
    epubPreviewCompare = e.target.checked;
    if (!epubPreviewScope) return;
    const anchor = findPreviewScrollAnchor();
    renderEpubPreview();
    restorePreviewScrollAnchor(anchor);
  });
  $('epub-sr-apply').addEventListener('click', () => {
    const find = $('epub-sr-find').value;
    const replace = $('epub-sr-replace').value;
    if (!find) return;
    let blocks = 0;
    let hits = 0;
    for (const el of $('epub-preview-content').querySelectorAll('.epub-preview-block[data-state="done"]')) {
      const b = el.__skBlock;
      if (!b) continue;
      let changed = false;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.includes(find)) continue;
        hits += node.nodeValue.split(find).length - 1;
        node.nodeValue = node.nodeValue.split(find).join(replace);
        changed = true;
      }
      if (changed) {
        blocks++;
        commitEditedBlock(b, el);
        el.classList.add('is-edited');
      }
    }
    if (blocks > 0) scheduleEpubSessionSave();
    $('epub-sr-status').textContent = t('doc.epub.sr.result', { hits, blocks });
  });
}

async function maybeRunConsistencyScan(doc) {
  if (!isBookDoc(doc) || currentDoc !== doc) return;
  try {
    const s = await getSettings();
    if (s.translateDoc?.consistencyScan === false) return;
  } catch (_) {   }
  if (!doc.chapters.some((c) => c.blocks.some((b) => b.translationStatus === 'done'))) return;
  runConsistencyScan(doc).catch((err) => {
    console.warn('[Transit] consistency scan failed', err && err.message);
    if (currentDoc === doc && epubScanState?.running) {
      epubScanState = null;
      renderScanBanner();
    }
  });
}

async function runConsistencyScan(doc) {
  const gen = ++epubScanGen;
  epubScanState = { running: true, tier1: [], cases: [], autoFixes: [] };
  renderScanBanner();

  const glossary = Array.isArray(currentArticleGlossary) ? currentArticleGlossary : [];
  const blockById = new Map();
  for (const ch of doc.chapters) for (const b of ch.blocks) blockById.set(b.blockId, b);

  let autoFixes = repairComplianceMangles(doc, glossary);

  let tier1 = filterIgnoredViolations(checkGlossaryCompliance(doc.chapters, glossary));
  const complianceFixes = applyComplianceFixes(doc, tier1, blockById);
  if (complianceFixes.length > 0) {
    autoFixes = mergeComplianceFixes(autoFixes, complianceFixes);
    tier1 = filterIgnoredViolations(checkGlossaryCompliance(doc.chapters, glossary));
  }

  const candidates = mineCandidates(doc.chapters, glossary)
    .filter((c) => !epubScanIgnoredDrift.has(c.term));
  const batches = buildScanBatches(candidates, blockById);

  const collected = [];
  for (const batch of batches) {
    if (gen !== epubScanGen || currentDoc !== doc) return;
    const inputHash = await sha1Hex(JSON.stringify(batch.items) + '#skscan-v1');
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'SCAN_TERM_RENDERINGS',
        payload: { items: batch.items, inputHash },
      });
    } catch (err) {
      console.warn('[Transit] scan batch failed', err && err.message);
      continue;
    }
    if (res?.ok && Array.isArray(res.renderings)) {
      collected.push({ items: batch.items, results: res.renderings });
      if (currentDoc === doc && Number.isFinite(res.usage?.billedCostUSD) && res.usage.billedCostUSD > 0) {
        epubCumulativeCostUSD += res.usage.billedCostUSD;
        scheduleEpubSessionSave();
      }
    } else if (res && !res.ok) {
      console.warn('[Transit] scan batch not ok', res.error);
    }
  }
  if (gen !== epubScanGen || currentDoc !== doc) return;

  const cases = aggregateRenderings(collected);
  epubScanState = { running: false, tier1, cases, autoFixes };
  console.log('[Transit] consistency scan done', {
    glossaryViolations: tier1.length, driftCases: cases.length,
    autoFixedEntries: autoFixes.length,
    candidates: candidates.length, batches: batches.length,
  });
  renderScanResults();
  renderScanBanner();
  await renderChapterList();
}

function triggerManualScan() {
  if (!isBookDoc(currentDoc) || epubScanState?.running) return;
  const doc = currentDoc;
  if (!doc.chapters.some((c) => c.blocks.some((b) => b.translationStatus === 'done'))) return;
  runConsistencyScan(doc).catch((err) => {
    console.warn('[Transit] manual consistency scan failed', err && err.message);
    if (currentDoc === doc && epubScanState?.running) {
      epubScanState = null;
      renderScanBanner();
    }
  });
}

function renderScanBanner() {
  const btn = $('chapters-scan-btn');
  if (!btn) return;
  const rescanBtn = $('scan-rescan-btn');
  if (rescanBtn) {
    rescanBtn.disabled = !!epubScanState?.running;
    rescanBtn.textContent = epubScanState?.running
      ? t('doc.epub.scan.running') : t('doc.epub.scan.rescan');
  }
  const hasDone = isBookDoc(currentDoc)
    && currentDoc.chapters.some((c) => c.blocks.some((b) => b.translationStatus === 'done'));
  if (!hasDone) {
    btn.hidden = true;
    return;
  }
  if (epubScanState?.running) {
    btn.hidden = false;
    btn.disabled = true;
    btn.dataset.skMode = 'running';
    btn.textContent = t('doc.epub.scan.running');
    return;
  }
  const findings = epubScanState
    ? epubScanState.tier1.length
      + epubScanState.cases.filter((c) => !c.applied).length
      + (epubScanState.autoFixes?.length || 0)
      + epubScanIgnored.size
      + epubScanIgnoredDrift.size
    : 0;
  btn.hidden = false;
  btn.disabled = false;
  if (findings > 0) {
    btn.dataset.skMode = 'results';
    btn.textContent = t('doc.epub.scan.banner', { n: findings });
  } else {
    btn.dataset.skMode = 'manual';
    btn.textContent = t('doc.epub.scan.manual');
  }
}

function renderScanResults() {
  const state = epubScanState || { tier1: [], cases: [] };
  setI18nText($('scan-back-btn'), (currentDoc?.chapters?.length || 0) > 1 ? 'doc.epub.scan.back' : 'doc.book.btn.previewBack');
  const driftWrap = $('scan-drift-wrap');
  const compWrap = $('scan-compliance-wrap');
  const driftList = $('scan-drift-list');
  const compList = $('scan-compliance-list');
  driftList.replaceChildren();
  compList.replaceChildren();

  const activeCases = state.cases || [];
  const visibleCases = activeCases.filter((c) => !c.dismissed && !epubScanIgnoredDrift.has(c.term));
  const blockCtxById = new Map();
  if ((activeCases.length > 0 || (state.tier1 || []).length > 0 || (state.autoFixes || []).length > 0) && isBookDoc(currentDoc)) {
    for (const ch of currentDoc.chapters) {
      for (const b of ch.blocks) blockCtxById.set(b.blockId, { block: b, chapterIndex: ch.index });
    }
  }
  activeCases.forEach((scCase, idx) => {
    if (scCase.dismissed) return;
    if (epubScanIgnoredDrift.has(scCase.term)) return;
    const card = document.createElement('div');
    card.className = 'scan-case';
    const termEl = document.createElement('div');
    termEl.className = 'scan-case-term';
    termEl.textContent = scCase.term;
    card.appendChild(termEl);
    if (scCase.applied) {
      const done = document.createElement('div');
      done.className = 'scan-case-status';
      done.textContent = t('doc.epub.scan.applied', {
        keep: scCase.applied.keep || '', n: scCase.applied.hits, blocks: scCase.applied.blocks,
      });
      card.appendChild(done);
      const resultWrap = document.createElement('div');
      resultWrap.className = 'scan-rendering-contexts scan-applied-contexts';
      const changed = scCase.applied.undo || [];
      const MAX_APPLIED_CTX = 6;
      for (const u of changed.slice(0, MAX_APPLIED_CTX)) {
        if (typeof u.block?.translation !== 'string' || !u.block.translation) continue;
        const line = document.createElement('div');
        line.className = 'scan-rendering-context';
        const chap = document.createElement('span');
        chap.className = 'scan-context-chapter';
        chap.textContent = t('doc.epub.scan.contextChapter', { n: u.chapterIndex + 1 });
        line.appendChild(chap);
        appendExcerptWithHighlight(line, u.block.translation, scCase.applied.keep);
        resultWrap.appendChild(line);
      }
      if (changed.length > MAX_APPLIED_CTX) {
        const more = document.createElement('div');
        more.className = 'scan-rendering-context';
        more.textContent = t('doc.epub.scan.moreItems', { n: changed.length - MAX_APPLIED_CTX });
        resultWrap.appendChild(more);
      }
      if (resultWrap.childNodes.length > 0) card.appendChild(resultWrap);
      const actions = buildAddGlossaryActions(scCase, () => scCase.applied.keep);
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'secondary-btn scan-case-dismiss-btn';
      skipBtn.textContent = t('doc.epub.scan.skip');
      skipBtn.addEventListener('click', () => dismissScanCase(scCase));
      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'secondary-btn scan-case-undo-btn';
      undoBtn.textContent = t('doc.epub.scan.undo');
      undoBtn.addEventListener('click', () => undoScanCase(scCase));
      actions.insertBefore(undoBtn, actions.firstChild);
      actions.insertBefore(skipBtn, actions.firstChild);
      card.appendChild(actions);
      driftList.appendChild(card);
      return;
    }
    for (const r of scCase.renderings) {
      const row = document.createElement('label');
      row.className = 'scan-rendering-row';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `scan-case-${idx}`;
      radio.value = r.text;
      if (r === scCase.renderings[0]) radio.checked = true;
      const text = document.createElement('span');
      text.textContent = r.text;
      const count = document.createElement('span');
      count.className = 'scan-rendering-count';
      count.textContent = t('doc.epub.scan.count', { n: r.count });
      row.append(radio, text, count);
      card.appendChild(row);
      const ctxWrap = document.createElement('div');
      ctxWrap.className = 'scan-rendering-contexts';
      for (const blockId of r.blockIds) {
        const info = blockCtxById.get(blockId);
        if (!info || typeof info.block.translation !== 'string' || !info.block.translation) continue;
        const line = document.createElement('div');
        line.className = 'scan-rendering-context';
        const chap = document.createElement('span');
        chap.className = 'scan-context-chapter';
        chap.textContent = t('doc.epub.scan.contextChapter', { n: info.chapterIndex + 1 });
        line.appendChild(chap);
        appendExcerptWithHighlight(line, info.block.translation, r.text);
        ctxWrap.appendChild(line);
      }
      if (ctxWrap.childNodes.length > 0) card.appendChild(ctxWrap);
    }
    const actions = document.createElement('div');
    actions.className = 'scan-case-actions';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'secondary-btn';
    applyBtn.textContent = t('doc.epub.scan.apply');
    applyBtn.addEventListener('click', () => {
      const chosen = card.querySelector(`input[name="scan-case-${idx}"]:checked`);
      if (chosen) applyScanCase(scCase, chosen.value);
    });
    actions.appendChild(applyBtn);
    const driftSkipBtn = document.createElement('button');
    driftSkipBtn.type = 'button';
    driftSkipBtn.className = 'secondary-btn scan-drift-skip-btn';
    driftSkipBtn.textContent = t('doc.epub.scan.skip');
    driftSkipBtn.addEventListener('click', () => skipDriftCase(scCase));
    actions.appendChild(driftSkipBtn);
    appendAddGlossaryControls(actions, scCase,
      () => card.querySelector(`input[name="scan-case-${idx}"]:checked`)?.value || '');
    card.appendChild(actions);
    driftList.appendChild(card);
  });

  for (const term of epubScanIgnoredDrift) {
    const row = document.createElement('div');
    row.className = 'scan-compliance-row scan-skipped-row scan-drift-skipped-row';
    const label = document.createElement('span');
    label.textContent = t('doc.epub.scan.skippedTerm', { term });
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'secondary-btn scan-drift-skip-undo-btn';
    undoBtn.textContent = t('doc.epub.scan.undo');
    undoBtn.addEventListener('click', () => undoSkipDrift(term));
    row.append(label, document.createTextNode(' '), undoBtn);
    driftList.appendChild(row);
  }
  driftWrap.hidden = visibleCases.length === 0 && epubScanIgnoredDrift.size === 0;

  const tier1 = state.tier1 || [];
  const autoFixes = state.autoFixes || [];
  const skippedEntries = [...epubScanIgnored.values()];
  compWrap.hidden = tier1.length === 0 && autoFixes.length === 0 && skippedEntries.length === 0;
  for (const f of autoFixes) {
    const row = document.createElement('div');
    row.className = 'scan-compliance-row scan-autofixed-row';
    const head = document.createElement('span');
    head.textContent = t(f.manual ? 'doc.epub.scan.userfixed' : 'doc.epub.scan.autofixed', {
      source: f.source, target: f.expected, n: f.hits, blocks: f.blocks,
      chapters: [...f.chapters].sort((a, b) => a - b).join(', '),
    });
    row.appendChild(head);
    const refs = Array.isArray(f.blockRefs) ? f.blockRefs : [];
    const ctxWrap = document.createElement('div');
    ctxWrap.className = 'scan-rendering-contexts scan-applied-contexts';
    const MAX_FIXED_CTX = 6;
    for (const r of refs.slice(0, MAX_FIXED_CTX)) {
      const info = blockCtxById.get(r.blockId);
      if (typeof info?.block?.translation !== 'string' || !info.block.translation) continue;
      const line = document.createElement('div');
      line.className = 'scan-rendering-context';
      const chap = document.createElement('span');
      chap.className = 'scan-context-chapter';
      chap.textContent = t('doc.epub.scan.contextChapter', { n: r.chapterIndex + 1 });
      line.appendChild(chap);
      appendExcerptWithHighlight(line, info.block.translation, f.expected);
      ctxWrap.appendChild(line);
    }
    if (refs.length > MAX_FIXED_CTX) {
      const more = document.createElement('div');
      more.className = 'scan-rendering-context';
      more.textContent = t('doc.epub.scan.moreItems', { n: refs.length - MAX_FIXED_CTX });
      ctxWrap.appendChild(more);
    }
    if (ctxWrap.childNodes.length > 0) row.appendChild(ctxWrap);
    compList.appendChild(row);
  }
  const grouped = new Map();
  for (const v of tier1) {
    const key = `${v.source}\u0000${v.expected}`;
    let g = grouped.get(key);
    if (!g) {
      g = { source: v.source, expected: v.expected, count: 0, chapters: new Set(), items: [] };
      grouped.set(key, g);
    }
    g.count++;
    g.chapters.add(v.chapterIndex + 1);
    g.items.push(v);
  }
  for (const g of grouped.values()) {
    const row = document.createElement('div');
    row.className = 'scan-compliance-row';
    const head = document.createElement('span');
    head.textContent = t('doc.epub.scan.compliance.row', {
      source: g.source, target: g.expected, n: g.count,
      chapters: [...g.chapters].sort((a, b) => a - b).join(', '),
    });
    const MAX_CTX_ITEMS = 6;
    const ctxList = document.createElement('div');
    ctxList.className = 'scan-compliance-contexts';
    for (const v of g.items.slice(0, MAX_CTX_ITEMS)) {
      const info = blockCtxById.get(v.blockId);
      const item = document.createElement('div');
      item.className = 'scan-compliance-item';
      const srcLine = document.createElement('div');
      srcLine.className = 'scan-rendering-context';
      const chap = document.createElement('span');
      chap.className = 'scan-context-chapter';
      chap.textContent = t('doc.epub.scan.contextChapter', { n: v.chapterIndex + 1 });
      const srcTag = document.createElement('span');
      srcTag.className = 'scan-excerpt-label';
      srcTag.textContent = t('doc.epub.scan.excerpt.src');
      srcLine.append(chap, srcTag);
      if (typeof info?.block?.plainText === 'string' && info.block.plainText) {
        appendExcerptWithHighlight(srcLine, info.block.plainText, v.source);
      } else {
        srcLine.appendChild(document.createTextNode(v.excerpt));
      }
      item.appendChild(srcLine);
      const dstText = info?.block?.translation;
      if (typeof dstText === 'string' && dstText) {
        const dstLine = document.createElement('div');
        dstLine.className = 'scan-rendering-context';
        const dstTag = document.createElement('span');
        dstTag.className = 'scan-excerpt-label';
        dstTag.textContent = t('doc.epub.scan.excerpt.dst');
        dstLine.appendChild(dstTag);
        dstLine.appendChild(document.createTextNode(
          translationExcerptNear(dstText, info.block.plainText, v.source)));
        item.appendChild(dstLine);
      }
      ctxList.appendChild(item);
    }
    if (g.items.length > MAX_CTX_ITEMS) {
      const more = document.createElement('div');
      more.className = 'scan-rendering-context';
      more.textContent = t('doc.epub.scan.moreItems', { n: g.items.length - MAX_CTX_ITEMS });
      ctxList.appendChild(more);
    }
    const actions = document.createElement('div');
    actions.className = 'scan-case-actions';
    const status = document.createElement('span');
    status.className = 'scan-case-status';
    const termInput = document.createElement('input');
    termInput.type = 'text';
    termInput.className = 'scan-term-input';
    termInput.placeholder = t('doc.epub.scan.termInput.placeholder');
    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'secondary-btn scan-custom-replace-btn';
    customBtn.textContent = t('doc.epub.scan.replaceCustom');
    customBtn.addEventListener('click', () => {
      const term = termInput.value.trim();
      if (!term) {
        termInput.focus();
        return;
      }
      customComplianceReplace(g, term, status);
    });
    termInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') customBtn.click();
    });
    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'secondary-btn scan-skip-btn';
    skipBtn.textContent = t('doc.epub.scan.skip');
    skipBtn.addEventListener('click', () => skipComplianceEntry(g));
    actions.append(termInput, customBtn, skipBtn, status);
    row.append(head, ctxList, actions);
    compList.appendChild(row);
  }
  for (const e of skippedEntries) {
    const row = document.createElement('div');
    row.className = 'scan-compliance-row scan-skipped-row';
    const label = document.createElement('span');
    label.textContent = t('doc.epub.scan.skipped', { source: e.source, target: e.expected });
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'secondary-btn scan-skip-undo-btn';
    undoBtn.textContent = t('doc.epub.scan.undo');
    undoBtn.addEventListener('click', () => undoSkipEntry(e));
    row.append(label, document.createTextNode(' '), undoBtn);
    compList.appendChild(row);
  }

  $('scan-empty').hidden = visibleCases.length > 0 || tier1.length > 0
    || autoFixes.length > 0 || skippedEntries.length > 0 || epubScanIgnoredDrift.size > 0;
}

function replaceInTextNodes(el, term, replacement, opts = null) {
  const nodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  let hits = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node.nodeValue) continue;
    let prevChar = '';
    for (let j = i - 1; j >= 0 && !prevChar; j--) prevChar = (nodes[j].nodeValue || '').slice(-1);
    let nextChar = '';
    for (let j = i + 1; j < nodes.length && !nextChar; j++) nextChar = (nodes[j].nodeValue || '').charAt(0);
    const r = replaceTermInText(node.nodeValue, term, replacement, { ...opts, prevChar, nextChar });
    if (r.count > 0) {
      node.nodeValue = r.text;
      hits += r.count;
    }
  }
  hits += replaceAcrossTextNodes(nodes, term, replacement, opts);
  return hits;
}

function replaceAcrossTextNodes(nodes, term, replacement, opts = null) {
  if (!term || typeof replacement !== 'string' || term === replacement) return 0;
  let hits = 0;
  let from = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const vals = nodes.map((nd) => nd.nodeValue || '');
    const joined = vals.join('');
    const idx = joined.indexOf(term, from);
    if (idx === -1) return hits;
    const prevChar = idx > 0 ? joined[idx - 1] : '';
    const nextChar = joined[idx + term.length] || '';
    const synth = prevChar + term + nextChar;
    const r = replaceTermInText(synth, term, replacement, { ...opts });
    if (r.count === 0) { from = idx + 1; continue; }
    const middle = r.count === 1
      ? r.text.slice(prevChar.length, r.text.length - nextChar.length)
      : replacement;
    let acc = 0;
    let sN = -1; let sOff = 0; let eN = -1; let eOff = 0;
    for (let i = 0; i < nodes.length; i++) {
      const len = vals[i].length;
      if (sN === -1 && idx < acc + len) { sN = i; sOff = idx - acc; }
      if (sN !== -1 && idx + term.length <= acc + len) { eN = i; eOff = idx + term.length - acc; break; }
      acc += len;
    }
    if (sN === -1 || eN === -1) return hits;
    if (sN === eN) { from = idx + 1; continue; }
    nodes[sN].nodeValue = vals[sN].slice(0, sOff) + middle;
    for (let i = sN + 1; i < eN; i++) nodes[i].nodeValue = '';
    nodes[eN].nodeValue = vals[eN].slice(eOff);
    hits++;
    from = idx + middle.length;
  }
  return hits;
}
window.__skReplaceInTextNodes = replaceInTextNodes;

function appendExcerptWithHighlight(el, text, term, radius = 40) {
  const idx = text.indexOf(term);
  if (idx === -1) {
    el.appendChild(document.createTextNode(text.slice(0, radius * 2)));
    return;
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  el.appendChild(document.createTextNode((start > 0 ? '…' : '') + text.slice(start, idx)));
  const strong = document.createElement('strong');
  strong.textContent = term;
  el.appendChild(strong);
  el.appendChild(document.createTextNode(text.slice(idx + term.length, end) + (end < text.length ? '…' : '')));
}

function translationExcerptNear(translation, plainText, term, radius = 40) {
  let center = 0;
  const idx = typeof plainText === 'string' ? plainText.indexOf(term) : -1;
  if (idx >= 0 && plainText.length > 0) {
    center = Math.round((idx / plainText.length) * translation.length);
  }
  const start = Math.max(0, center - radius);
  const end = Math.min(translation.length, center + radius * 2);
  return (start > 0 ? '…' : '') + translation.slice(start, end) + (end < translation.length ? '…' : '');
}

function applyComplianceFixes(doc, violations, blockByIdArg = null) {
  if (!Array.isArray(violations) || violations.length === 0) return [];
  const SK = window.__SK;
  let blockById = blockByIdArg;
  if (!blockById) {
    blockById = new Map();
    for (const ch of doc.chapters) for (const b of ch.blocks) blockById.set(b.blockId, b);
  }
  const groups = new Map();
  let changed = false;
  for (const v of violations) {
    if (v.noTranslate || v.source === v.expected) continue;
    const b = blockById.get(v.blockId);
    if (!b || b.translationStatus !== 'done') continue;
    const el = renderBlockForScanEdit(b, SK);
    if (!el) continue;
    let hits = 0;
    if (v.annotation && /^《.+》$/.test(v.expected)) {
      const bare = v.expected.slice(1, -1);
      for (const wrapped of [`${bare}（${v.annotation}）`, `${bare}(${v.annotation})`]) {
        hits += replaceInTextNodes(el, wrapped, `${v.expected}（${v.annotation}）`,
          { skipTitleAdjacent: true });
      }
    }
    hits += replaceInTextNodes(el, v.source, v.expected, { skipAnnotated: true });
    if (hits === 0) continue;
    commitEditedBlock(b, el);
    changed = true;
    const key = v.source + '\u0000' + v.expected;
    let g = groups.get(key);
    if (!g) {
      g = { source: v.source, expected: v.expected, hits: 0, blocks: 0, chapters: new Set(), blockRefs: [] };
      groups.set(key, g);
    }
    g.hits += hits;
    g.blocks++;
    g.chapters.add(v.chapterIndex + 1);
    g.blockRefs.push({ blockId: v.blockId, chapterIndex: v.chapterIndex });
  }
  if (changed) scheduleEpubSessionSave();
  return [...groups.values()];
}

function repairComplianceMangles(doc, glossary) {
  if (!Array.isArray(glossary) || glossary.length === 0) return [];
  const SK = window.__SK;
  const groups = new Map();
  let changed = false;
  for (const entry of glossary) {
    if (!entry || entry.noTranslate === true) continue;
    if (typeof entry.source !== 'string' || typeof entry.target !== 'string') continue;
    const m = entry.target.trim().match(/^(《.+》)（(.+)）\s*$/);
    if (!m) continue;
    const base = m[1];
    const annotation = m[2].trim();
    if (!annotation) continue;
    if (epubScanIgnored.has(scanIgnoreKey(entry.source.trim(), base))) continue;
    const bare = base.slice(1, -1);
    const sig = `${bare}（${base}）`;
    const replacement = `${base}（${annotation}）`;
    for (const ch of doc.chapters) {
      for (const b of ch.blocks) {
        if (b.translationStatus !== 'done') continue;
        if (typeof b.translation !== 'string' || !b.translation.includes(sig)) continue;
        const el = renderBlockForScanEdit(b, SK);
        if (!el) continue;
        const hits = replaceInTextNodes(el, sig, replacement);
        if (hits === 0) continue;
        commitEditedBlock(b, el);
        changed = true;
        const key = entry.source.trim() + '\u0000' + base;
        let g = groups.get(key);
        if (!g) {
          g = { source: entry.source.trim(), expected: base, hits: 0, blocks: 0, chapters: new Set(), blockRefs: [] };
          groups.set(key, g);
        }
        g.hits += hits;
        g.blocks++;
        g.chapters.add(ch.index + 1);
        g.blockRefs.push({ blockId: b.blockId, chapterIndex: ch.index });
      }
    }
  }
  if (changed) scheduleEpubSessionSave();
  return [...groups.values()];
}

function scanIgnoreKey(source, expected) {
  return source + '→' + expected;
}

function hydrateScanIgnored(arr) {
  const map = new Map();
  for (const e of arr) {
    if (!e || typeof e.source !== 'string' || typeof e.expected !== 'string') continue;
    map.set(scanIgnoreKey(e.source, e.expected), { source: e.source, expected: e.expected });
  }
  return map;
}

function filterIgnoredViolations(violations) {
  if (!Array.isArray(violations) || epubScanIgnored.size === 0) return violations || [];
  return violations.filter((v) => !epubScanIgnored.has(scanIgnoreKey(v.source, v.expected)));
}

function skipComplianceEntry(group) {
  if (!isBookDoc(currentDoc) || !epubScanState) return;
  epubScanIgnored.set(scanIgnoreKey(group.source, group.expected),
    { source: group.source, expected: group.expected });
  scheduleEpubSessionSave();
  epubScanState.tier1 = filterIgnoredViolations(epubScanState.tier1);
  renderScanResults();
  renderScanBanner();
}

function undoSkipEntry(entry) {
  if (!isBookDoc(currentDoc) || !epubScanState) return;
  epubScanIgnored.delete(scanIgnoreKey(entry.source, entry.expected));
  scheduleEpubSessionSave();
  const glossary = Array.isArray(currentArticleGlossary) ? currentArticleGlossary : [];
  epubScanState.tier1 = filterIgnoredViolations(checkGlossaryCompliance(currentDoc.chapters, glossary));
  renderScanResults();
  renderScanBanner();
}

function customComplianceReplace(group, term, statusEl) {
  if (!isBookDoc(currentDoc) || !epubScanState || epubScanState.running) return;
  if (!term || term === group.expected) return;
  const SK = window.__SK;
  let hits = 0;
  let blocks = 0;
  const chapters = new Set();
  const blockRefs = [];
  const hasSource = compileTermMatcher(group.source);
  for (const ch of currentDoc.chapters) {
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'done') continue;
      if (typeof b.plainText !== 'string' || !hasSource(b.plainText)) continue;
      const el = renderBlockForScanEdit(b, SK);
      if (!el) continue;
      const blockHits = replaceInTextNodes(el, term, group.expected);
      if (blockHits === 0) continue;
      commitEditedBlock(b, el);
      hits += blockHits;
      blocks++;
      chapters.add(ch.index + 1);
      blockRefs.push({ blockId: b.blockId, chapterIndex: ch.index });
    }
  }
  if (hits === 0) {
    if (statusEl) statusEl.textContent = t('doc.epub.scan.customNotFound', { term });
    return;
  }
  scheduleEpubSessionSave();
  epubScanState.autoFixes = mergeComplianceFixes(epubScanState.autoFixes || [],
    [{ source: group.source, expected: group.expected, hits, blocks, chapters, blockRefs, manual: true }]);
  epubScanState.tier1 = filterIgnoredViolations(checkGlossaryCompliance(currentDoc.chapters,
    Array.isArray(currentArticleGlossary) ? currentArticleGlossary : []));
  renderScanResults();
  renderScanBanner();
}

function mergeComplianceFixes(base, extra) {
  const keyOf = (f) => f.source + '\u0000' + f.expected + (f.manual ? ':m' : '');
  const map = new Map(base.map((f) => [keyOf(f), f]));
  for (const f of extra) {
    const key = keyOf(f);
    const g = map.get(key);
    if (!g) {
      map.set(key, f);
      continue;
    }
    g.hits += f.hits;
    g.blocks += f.blocks;
    for (const c of f.chapters) g.chapters.add(c);
    if (Array.isArray(f.blockRefs) && f.blockRefs.length > 0) {
      g.blockRefs = g.blockRefs || [];
      const seen = new Set(g.blockRefs.map((r) => r.blockId));
      for (const r of f.blockRefs) {
        if (seen.has(r.blockId)) continue;
        seen.add(r.blockId);
        g.blockRefs.push(r);
      }
    }
  }
  return [...map.values()];
}

function applyScanCase(scCase, keep) {
  if (!isBookDoc(currentDoc) || !keep) return;
  const SK = window.__SK;
  const others = scCase.renderings.map((r) => r.text).filter((x) => x && x !== keep);
  if (others.length === 0) return;
  let hits = 0;
  let blocks = 0;
  const undo = [];
  const hasTerm = compileTermMatcher(scCase.term);
  for (const ch of currentDoc.chapters) {
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'done') continue;
      if (typeof b.plainText !== 'string' || !hasTerm(b.plainText)) continue;
      const el = renderBlockForScanEdit(b, SK);
      if (!el) continue;
      const prevEditedHtml = (typeof b.editedHtml === 'string' && b.editedHtml.length > 0) ? b.editedHtml : null;
      const prevTranslation = typeof b.translation === 'string' ? b.translation : null;
      let changed = false;
      for (const other of others) {
        const n = replaceInTextNodes(el, other, keep);
        if (n === 0) continue;
        hits += n;
        changed = true;
      }
      if (changed) {
        blocks++;
        undo.push({ block: b, prevEditedHtml, prevTranslation, chapterIndex: ch.index });
        commitEditedBlock(b, el);
      }
    }
  }
  scheduleEpubSessionSave();
  scCase.applied = { hits, blocks, keep, undo };
  renderScanResults();
  renderScanBanner();
}

function undoScanCase(scCase) {
  if (!isBookDoc(currentDoc) || !scCase.applied) return;
  for (const u of scCase.applied.undo || []) {
    u.block.editedHtml = u.prevEditedHtml;
    u.block.translation = u.prevTranslation;
  }
  scCase.applied = null;
  scCase.dismissed = false;
  scheduleEpubSessionSave();
  renderScanResults();
  renderScanBanner();
}

function dismissScanCase(scCase) {
  scCase.dismissed = true;
  renderScanResults();
  renderScanBanner();
}

function skipDriftCase(scCase) {
  if (!isBookDoc(currentDoc) || !epubScanState) return;
  epubScanIgnoredDrift.add(scCase.term);
  scheduleEpubSessionSave();
  renderScanResults();
  renderScanBanner();
}

function undoSkipDrift(term) {
  if (!isBookDoc(currentDoc)) return;
  epubScanIgnoredDrift.delete(term);
  scheduleEpubSessionSave();
  renderScanResults();
  renderScanBanner();
}

function addScanCaseToGlossary(scCase, keep, statusEl) {
  if (!isBookDoc(currentDoc) || !keep) return;
  const list = Array.isArray(currentArticleGlossary) ? [...currentArticleGlossary] : [];
  const existing = list.find((e) => e && typeof e.source === 'string'
    && e.source.trim().toLowerCase() === scCase.term.toLowerCase());
  if (existing) existing.target = keep;
  else list.push({ source: scCase.term, target: keep });
  savePersistedBookGlossary(list);
  if (statusEl) statusEl.textContent = t('doc.epub.scan.addedGlossary');
}

function appendAddGlossaryControls(actions, scCase, getKeep) {
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'secondary-btn scan-add-glossary-btn';
  addBtn.textContent = t('doc.epub.scan.addGlossary');
  const status = document.createElement('span');
  status.className = 'scan-case-status';
  addBtn.addEventListener('click', () => {
    const keep = getKeep();
    if (keep) addScanCaseToGlossary(scCase, keep, status);
  });
  actions.append(addBtn, status);
}

function buildAddGlossaryActions(scCase, getKeep) {
  const actions = document.createElement('div');
  actions.className = 'scan-case-actions';
  appendAddGlossaryControls(actions, scCase, getKeep);
  return actions;
}

function commitEditedBlock(b, el) {
  b.editedHtml = el.innerHTML;
  b.translation = editedHtmlToPlain(el.innerHTML);
}

function renderBlockContent(b, SK, override = null) {
  const picked = resolveBlockFragment(SK, b, override, {
    renderPlain: (plainIn) => {
      let plain = plainIn;
      if (subtitleStripPeriodOn && Array.isArray(b.tagSlots)) plain = stripCueTrailingPeriod(plain);
      const frag = document.createDocumentFragment();
      plain.split('\n').forEach((line, k) => {
        if (k > 0) frag.appendChild(document.createElement('br'));
        frag.appendChild(document.createTextNode(line));
      });
      return frag;
    },
  });
  if (!picked) return null;
  const el = document.createElement('div');
  el.appendChild(picked.frag);
  return { el, usedEdited: picked.source === 'edited' };
}

function renderBlockForScanEdit(b, SK) {
  return renderBlockContent(b, SK)?.el ?? null;
}

function bindScanUI() {
  if (!stages.scan) return;
  $('chapters-scan-btn').addEventListener('click', () => {
    if ($('chapters-scan-btn').dataset.skMode === 'manual') {
      triggerManualScan();
      return;
    }
    renderScanResults();
    showStage('scan');
  });
  $('scan-rescan-btn').addEventListener('click', () => triggerManualScan());
  $('scan-back-btn').addEventListener('click', async () => {
    await renderChapterList();
    showStage('chapters');
  });
}

const BOOK_GLOSSARY_SUFFIX_ZH = `補充規則（書籍模式）：本次輸入是一本書籍的內容（可能為小說）。
1. 人物優先：主要角色與反覆出現的配角人名一律收錄。
2. 同一人物的暱稱、簡稱、敬稱或別名（例如 Elizabeth / Lizzy / Miss Bennet 是同一人）各建一條，譯名必須對映同一人物的一致中文名（例如伊莉莎白 / 莉茲 / 班奈特小姐），確保跨章節譯名一致。
3. 多詞人名除了全名條目外，「姓氏單獨出現」也要另建一條（例如 Richard Enfield 之外另建 Enfield→恩菲爾德），因為書中常只以姓氏稱呼。
4. 譯名中的姓名分隔一律用全形間隔號「・」（例如「拉夫・舒馬克」），絕對不可用半形「·」。
5. 反覆出現的地名、組織名與作品內世界觀專有名詞（魔法、科技、稱號等設定詞）也收錄。`;
const BOOK_GLOSSARY_SUFFIX_EN = `Additional rules (book mode): the input is part of a book (possibly a novel).
1. Prioritize people: include every main character and recurring supporting character.
2. Create separate entries for nicknames, short forms, honorifics and aliases of the same person (e.g. Elizabeth / Lizzy / Miss Bennet are one person), keeping the translated names consistent for that character across chapters.
3. For multi-word person names, also add a surname-only entry (e.g. besides Richard Enfield, add Enfield), because books often refer to characters by surname alone.
4. When a translated name needs a separator between name parts, always use the full-width middle dot 「・」(U+30FB), never the half-width 「·」.
5. Also include recurring place names, organizations, and in-world proper nouns (magic terms, technologies, titles).`;

function bookGlossaryRoundHash(text) {
  return sha1Hex(text + '\n#transit-book-glossary-v4');
}

async function clearBookGlossaryExtractionCache(doc) {
  try {
    const rounds = buildBookGlossaryRounds(doc);
    if (rounds.length === 0) return;
    const prefixes = await Promise.all(rounds.map(async (text) => 'gloss_' + await bookGlossaryRoundHash(text)));
    const all = await chrome.storage.local.get(null);
    const toRemove = Object.keys(all).filter((k) => prefixes.some((p) => k.startsWith(p)));
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
    console.log('[Transit] book glossary extraction cache cleared', { removed: toRemove.length });
  } catch (err) {
    console.warn('[Transit] clear book glossary cache failed', err && err.message);
  }
}

async function extractGlossaryForBook(doc, { forceRefresh = false } = {}) {
  const docAtStart = doc;
  const rounds = buildBookGlossaryRounds(doc);
  if (rounds.length === 0) return null;
  const settings = await getSettings();
  const promptSuffix = (settings.targetLanguage === 'zh-TW' || !settings.targetLanguage)
    ? BOOK_GLOSSARY_SUFFIX_ZH
    : BOOK_GLOSSARY_SUFFIX_EN;

  const presetModel = currentModelOverride || (await resolveDocEngine()).modelOverride || null;
  const lists = [];
  let failures = 0;
  for (let i = 0; i < rounds.length; i++) {
    if (currentDoc !== docAtStart) return null;
    setGlossaryState(t(kindKey('glossary.extracting'), { current: i + 1, total: rounds.length }), 'is-loading');
    const text = rounds[i];
    const inputHash = await bookGlossaryRoundHash(text);
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'EXTRACT_GLOSSARY',
        payload: {
          compressedText: text, inputHash, promptSuffix, forceRefresh,
          modelOverride: presetModel,
        },
      });
      if (res?.ok && Array.isArray(res.glossary)) {
        lists.push(res.glossary);
        if (currentDoc === docAtStart && Number.isFinite(res.usage?.billedCostUSD) && res.usage.billedCostUSD > 0) {
          epubCumulativeCostUSD += res.usage.billedCostUSD;
          scheduleEpubSessionSave();
        }
      } else {
        failures++;
        console.warn('[Transit] book glossary round not ok', i + 1, res?.error);
      }
    } catch (err) {
      failures++;
      console.warn('[Transit] book glossary round failed', i + 1, err && err.message);
    }
  }
  if (currentDoc !== docAtStart) return null;
  if (lists.length === 0) return null;
  const { entries, conflicts } = mergeBookGlossaries(lists);
  console.log('[Transit] book glossary merged', {
    rounds: rounds.length, failures, terms: entries.length, conflicts,
  });
  return entries;
}

let _sessionSavedSig = new Map();

async function persistEpubSession() {
  if (!isBookDoc(currentDoc) || !epubBookHash) return;
  const changedBlocks = {};
  const doneIds = new Set();
  for (const ch of currentDoc.chapters) {
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'done') {
        if (b._skPrevDone) doneIds.add(b.blockId);
        continue;
      }
      doneIds.add(b.blockId);
      const raw = b.translationRaw ?? null;
      const plain = b.translation ?? null;
      const edited = b.editedHtml ?? null;
      const sig = _sessionSavedSig.get(b.blockId);
      if (sig && sig.raw === raw && sig.plain === plain && sig.edited === edited) continue;
      changedBlocks[b.blockId] = { raw, plain, edited };
    }
  }
  const removedBlockIds = [..._sessionSavedSig.keys()].filter((id) => !doneIds.has(id));
  const ok = await saveEpubSession(epubBookHash, sessionMetaFields(), { changedBlocks, removedBlockIds });
  if (ok) {
    for (const [id, rec] of Object.entries(changedBlocks)) _sessionSavedSig.set(id, rec);
    for (const id of removedBlockIds) _sessionSavedSig.delete(id);
    await removeLegacyBookGloss();
  }
}

function sessionMetaFields() {
  return {
    title: currentDoc.meta.title || '',
    glossary: Array.isArray(currentArticleGlossary) ? currentArticleGlossary : null,
    forbidden: currentBookForbidden,
    extraPrompt: currentDocExtraPrompt || '',
    costUSD: epubCumulativeCostUSD,
    scanIgnored: [...epubScanIgnored.values()],
    scanIgnoredDrift: [...epubScanIgnoredDrift],
  };
}

async function removeLegacyBookGloss() {
  const legacyKey = bookGlossStorageKey();
  if (legacyKey) {
    try { await chrome.storage.local.remove(legacyKey); } catch (_) {   }
  }
}

let _sessionSaveTimer = null;
function scheduleEpubSessionSave() {
  if (_sessionSaveTimer) clearTimeout(_sessionSaveTimer);
  _sessionSaveTimer = setTimeout(() => {
    _sessionSaveTimer = null;
    persistEpubSession();
  }, 800);
}

function flushPendingSessionSave() {
  if (!_sessionSaveTimer) return;
  clearTimeout(_sessionSaveTimer);
  _sessionSaveTimer = null;
  persistEpubSession();
}
window.addEventListener('pagehide', flushPendingSessionSave);

async function savePersistedBookGlossary(entries) {
  if (Array.isArray(entries)) currentArticleGlossary = entries;
  await persistEpubSession();
}

async function discardBookTranslation() {
  if (!isBookDoc(currentDoc)) return;
  if (!confirm(t(kindKey('confirm.discard')))) return;
  if (_sessionSaveTimer) {
    clearTimeout(_sessionSaveTimer);
    _sessionSaveTimer = null;
  }
  await clearEpubBlocksCache(currentDoc.chapters, { all: true });
  await clearBookGlossaryExtractionCache(currentDoc);
  await deleteEpubSession(epubBookHash);
  await removeLegacyBookGloss();
  releaseCurrentDoc();
  showStage('upload');
}

const SESSION_EXPORT_TYPE = 'transit-epub-session';

function exportEpubSession() {
  if (!isBookDoc(currentDoc) || !epubBookHash) return;
  const data = {
    type: SESSION_EXPORT_TYPE,
    version: 1,
    bookHash: epubBookHash,
    ...sessionMetaFields(),
    exportedAt: new Date().toISOString(),
    blocks: collectSessionBlocks(currentDoc),
    failures: collectSessionFailures(currentDoc),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const baseName = (currentDoc.meta.filename || 'book').replace(/\.(epub|txt|md|markdown|html?)$/i, '');
  a.download = `${baseName}-session.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

async function importEpubSession(file) {
  if (!isBookDoc(currentDoc)) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.type !== SESSION_EXPORT_TYPE || !data.blocks) {
      throw new Error(t('doc.epub.alert.importSessionInvalid'));
    }
    if (data.bookHash !== epubBookHash) {
      alert(t(kindKey('alert.importSessionMismatch')));
      return;
    }
    for (const ch of currentDoc.chapters) {
      for (const b of ch.blocks) {
        b.translation = null;
        b.translationRaw = null;
        b.editedHtml = null;
        b.translationStatus = 'pending';
        b.translationError = null;
      }
    }
    const restored = hydrateSessionBlocks(currentDoc, data.blocks);
    if (Array.isArray(data.glossary)) currentArticleGlossary = data.glossary;
    if (Array.isArray(data.forbidden)) currentBookForbidden = data.forbidden;
    if (typeof data.extraPrompt === 'string') currentDocExtraPrompt = data.extraPrompt;
    if (Number.isFinite(data.costUSD)) epubCumulativeCostUSD = data.costUSD;
    epubScanIgnored = hydrateScanIgnored(Array.isArray(data.scanIgnored) ? data.scanIgnored : []);
    epubScanIgnoredDrift = new Set((Array.isArray(data.scanIgnoredDrift) ? data.scanIgnoredDrift : []).filter((x) => typeof x === 'string'));
    for (const ch of currentDoc.chapters) {
      if (chapterDoneState(ch) === 'done') ch.selected = false;
    }
    epubScanGen++;
    epubScanState = null;
    await persistEpubSession();
    await renderChapterList();
    console.log('[Transit] epub session imported:', { blocks: restored });
  } catch (err) {
    alert(t('doc.epub.alert.importSessionFail', { error: (err && err.message) || String(err) }));
  }
}

function bookGlossStorageKey() {
  return epubBookHash ? `bookgloss_${epubBookHash}` : null;
}

async function loadPersistedBookGlossary() {
  const key = bookGlossStorageKey();
  if (!key) return null;
  try {
    const got = await chrome.storage.local.get(key);
    const entry = got[key];
    return (entry && Array.isArray(entry.glossary)) ? entry.glossary : null;
  } catch (_) {
    return null;
  }
}

function buildBookForbiddenTable(entries) {
  const grid = $('book-forbidden-grid');
  for (const el of [...grid.children]) {
    if (!el.classList.contains('g-header')) el.remove();
  }
  for (const e of entries || []) appendBookForbiddenRow(e);
}

function appendBookForbiddenRow(entry = { forbidden: '', replacement: '' }) {
  const grid = $('book-forbidden-grid');
  const forbiddenInput = document.createElement('input');
  forbiddenInput.type = 'text';
  forbiddenInput.className = 'bf-forbidden';
  forbiddenInput.value = entry.forbidden || '';
  const replacementInput = document.createElement('input');
  replacementInput.type = 'text';
  replacementInput.className = 'bf-replacement';
  replacementInput.value = entry.replacement || '';
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'glossary-row-delete';
  delBtn.textContent = t('doc.glossary.btn.delete');
  delBtn.addEventListener('click', () => {
    forbiddenInput.remove();
    replacementInput.remove();
    delBtn.remove();
  });
  grid.append(forbiddenInput, replacementInput, delBtn);
}

function readBookForbiddenTable() {
  const out = [];
  for (const forbiddenInput of $('book-forbidden-grid').querySelectorAll('.bf-forbidden')) {
    const forbidden = forbiddenInput.value.trim();
    if (!forbidden) continue;
    const replacementInput = forbiddenInput.nextElementSibling;
    const replacement = (replacementInput && replacementInput.classList.contains('bf-replacement'))
      ? replacementInput.value.trim() : '';
    out.push({ forbidden, replacement });
  }
  return out;
}
