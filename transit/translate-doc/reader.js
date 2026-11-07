import { renderPageToCanvas } from './pdf-engine.js';
import { translateSingleBlock } from './translate.js';
import { buildBilingualPdf } from './pdf-renderer.js';
import { TRANSLATABLE_TYPES } from './block-types.js';
import * as pdfjsLib from '../lib/vendor/pdfjs/pdf.min.mjs';

const READER_RENDER_SCALE = 1.5;
const SCROLL_SYNC_RESET_MS = 250;
const READER_LAZY_MARGIN = '200%';

let _renderReaderGen = 0;

export async function renderReader(doc, originalPdfDoc, originalArrayBuffer, originalCol, translatedCol, opts = {}) {
  const _myRenderGen = ++_renderReaderGen;
  const { modelOverride, engine, glossary, extraPrompt = null, onFailedCountChange = () => {}, onFontFallback = null } = opts;
  let currentZoom = opts.initialZoom || 1.0;
  let syncEnabled = opts.initialSyncEnabled !== false;

  originalCol.innerHTML = '';
  translatedCol.innerHTML = '';

  if (!doc || !originalPdfDoc || !originalArrayBuffer) {
    const _t = (k) => window.__SK?.i18n?.t?.(k) ?? k;
    originalCol.innerHTML = `<div class="reader-empty">${_t('doc.reader.empty.notUploaded')}</div>`;
    translatedCol.innerHTML = `<div class="reader-empty">${_t('doc.reader.empty.notTranslated')}</div>`;
    return null;
  }

  let translatedBytes = null;
  let translatedFilename = null;
  let translatedPdfDoc = null;
  let destroyed = false;

  async function regenerateTranslatedPdf() {
    if (destroyed) return;
    if (translatedPdfDoc) {
      try { await translatedPdfDoc.destroy(); } catch (_) {   }
      translatedPdfDoc = null;
    }
    const built = await buildBilingualPdf(originalArrayBuffer, doc, { pdfDoc: originalPdfDoc });
    if (built.fontFallback && typeof onFontFallback === 'function') onFontFallback(built.fontSource);
    translatedBytes = built.bytes;
    translatedFilename = built.filename;
    const task = pdfjsLib.getDocument({
      data: translatedBytes.slice(0),
      disableFontFace: true,
      password: '',
    });
    translatedPdfDoc = await task.promise;
  }

  await regenerateTranslatedPdf();

  const pageMeta = new Map();
  let renderChain = Promise.resolve();

  function releaseCanvas(pageEl) {
    const canvas = pageEl.querySelector('canvas');
    if (canvas && canvas.width > 0) { canvas.width = 0; canvas.height = 0; }
  }

  async function renderPage(pageEl) {
    const meta = pageMeta.get(pageEl);
    if (!meta || destroyed || _myRenderGen !== _renderReaderGen) return;
    const pdf = meta.side === 'left' ? originalPdfDoc : translatedPdfDoc;
    const canvas = pageEl.querySelector('canvas');
    if (!pdf || !canvas) return;
    try {
      await renderPageToCanvas(pdf, meta.idx, canvas, READER_RENDER_SCALE);
      meta.rendered = true;
    } catch (err) {
      console.error('[Transit] reader render page failed', meta.idx, err);
    }
  }

  function queueRender(pageEl) {
    renderChain = renderChain.then(() => {
      const m = pageMeta.get(pageEl);
      if (!m || m.rendered || !m.inZone) return undefined;
      return renderPage(pageEl);
    });
  }

  const onZoneChange = (entries) => {
    for (const e of entries) {
      const meta = pageMeta.get(e.target);
      if (!meta) continue;
      meta.inZone = e.isIntersecting;
      if (e.isIntersecting) {
        if (!meta.rendered) queueRender(e.target);
      } else if (meta.rendered) {
        meta.rendered = false;
        releaseCanvas(e.target);
      }
    }
  };
  const leftIO = new IntersectionObserver(onZoneChange, {
    root: originalCol, rootMargin: `${READER_LAZY_MARGIN} 0px`,
  });
  const rightIO = new IntersectionObserver(onZoneChange, {
    root: translatedCol, rootMargin: `${READER_LAZY_MARGIN} 0px`,
  });

  const pageCount = Math.min(doc.pages.length, originalPdfDoc.numPages, translatedPdfDoc.numPages);
  for (let i = 0; i < pageCount; i++) {
    if (_myRenderGen !== _renderReaderGen) {
      destroyed = true;
      leftIO.disconnect();
      rightIO.disconnect();
      if (translatedPdfDoc) {
        try { await translatedPdfDoc.destroy(); } catch (_) {   }
        translatedPdfDoc = null;
      }
      return null;
    }
    const leftPage = document.createElement('div');
    leftPage.className = 'reader-page reader-page-original';
    leftPage.dataset.pageIndex = String(i);
    const leftCanvas = document.createElement('canvas');
    leftCanvas.width = 0;
    leftCanvas.height = 0;
    leftPage.appendChild(leftCanvas);
    originalCol.appendChild(leftPage);

    const rightPage = document.createElement('div');
    rightPage.className = 'reader-page reader-page-translated';
    rightPage.dataset.pageIndex = String(i);
    const rightCanvas = document.createElement('canvas');
    rightCanvas.width = 0;
    rightCanvas.height = 0;
    rightPage.appendChild(rightCanvas);
    translatedCol.appendChild(rightPage);

    try {
      const leftViewport = (await originalPdfDoc.getPage(i + 1)).getViewport({ scale: READER_RENDER_SCALE });
      const rightViewport = (await translatedPdfDoc.getPage(i + 1)).getViewport({ scale: READER_RENDER_SCALE });
      leftPage.dataset.baseWidth = String(leftViewport.width);
      leftPage.dataset.baseHeight = String(leftViewport.height);
      rightPage.dataset.baseWidth = String(rightViewport.width);
      rightPage.dataset.baseHeight = String(rightViewport.height);
      applyZoomToPage(leftPage, currentZoom);
      applyZoomToPage(rightPage, currentZoom);
      pageMeta.set(leftPage, { idx: i, side: 'left', rendered: false, inZone: false });
      pageMeta.set(rightPage, { idx: i, side: 'right', rendered: false, inZone: false });
      leftIO.observe(leftPage);
      rightIO.observe(rightPage);
    } catch (err) {
      console.error('[Transit] reader page setup failed', i, err);
      const _t = (k, p) => window.__SK?.i18n?.t?.(k, p) ?? k;
      leftPage.innerHTML = `<div class="reader-empty">${_t('doc.reader.empty.renderFail', { n: i + 1 })}</div>`;
    }
  }

  async function renderAllPages() {
    for (const [pageEl, meta] of pageMeta) {
      if (destroyed || _myRenderGen !== _renderReaderGen) return;
      if (!meta.rendered) await renderPage(pageEl);
    }
  }
  window.__skReaderRenderAll = renderAllPages;

  let sync = setupScrollSync(originalCol, translatedCol);
  sync.setEnabled(syncEnabled);
  emitFailedCount();

  function emitFailedCount() {
    let n = 0;
    for (const p of doc.pages) {
      for (const b of p.blocks) {
        if (TRANSLATABLE_TYPES.has(b.type) && b.translationStatus === 'failed') n++;
      }
    }
    onFailedCountChange(n);
  }

  async function rerenderRightColumn(pageIndexes = null) {
    if (destroyed || !translatedPdfDoc) return;
    const rightPages = translatedCol.querySelectorAll('.reader-page-translated');
    const n = Math.min(rightPages.length, translatedPdfDoc.numPages);
    for (let i = 0; i < n; i++) {
      if (pageIndexes && !pageIndexes.has(i)) continue;
      const pageEl = rightPages[i];
      const meta = pageMeta.get(pageEl);
      if (!meta) continue;
      if (meta.inZone) {
        await renderPage(pageEl);
      } else if (meta.rendered) {
        meta.rendered = false;
        releaseCanvas(pageEl);
      }
    }
  }

  return {
    setSyncEnabled(enabled) {
      syncEnabled = !!enabled;
      sync.setEnabled(syncEnabled);
    },
    setZoom(zoom) {
      const z = Math.max(0.5, Math.min(2.0, zoom));
      currentZoom = z;
      for (const el of originalCol.querySelectorAll('.reader-page-original')) {
        applyZoomToPage(el, z);
      }
      for (const el of translatedCol.querySelectorAll('.reader-page-translated')) {
        applyZoomToPage(el, z);
      }
      sync.destroy();
      sync = setupScrollSync(originalCol, translatedCol);
      sync.setEnabled(syncEnabled);
      return z;
    },
    getZoom() { return currentZoom; },
    getTranslatedPdfBytes() { return translatedBytes; },
    getTranslatedPdfFilename() { return translatedFilename; },
    async retryAllFailed() {
      const failed = [];
      for (let pi = 0; pi < doc.pages.length; pi++) {
        for (const b of doc.pages[pi].blocks) {
          if (TRANSLATABLE_TYPES.has(b.type) && b.translationStatus === 'failed') {
            failed.push({ block: b, pageIdx: pi });
          }
        }
      }
      let success = 0;
      const successPages = new Set();
      for (const { block, pageIdx } of failed) {
        if (destroyed) return { total: failed.length, success };
        const r = await translateSingleBlock(block, { modelOverride, engine, glossary, extraPrompt });
        if (r.ok) { success++; successPages.add(pageIdx); }
      }
      if (success > 0 && !destroyed) {
        await regenerateTranslatedPdf();
        if (!destroyed) await rerenderRightColumn(successPages);
      }
      if (!destroyed) emitFailedCount();
      return { total: failed.length, success };
    },
    renderAllPages,
    destroy() {
      destroyed = true;
      sync.destroy();
      leftIO.disconnect();
      rightIO.disconnect();
      for (const [pageEl, meta] of pageMeta) {
        meta.rendered = false;
        releaseCanvas(pageEl);
      }
      pageMeta.clear();
      if (window.__skReaderRenderAll === renderAllPages) delete window.__skReaderRenderAll;
      if (translatedPdfDoc) {
        translatedPdfDoc.destroy().catch(() => {});
        translatedPdfDoc = null;
      }
      translatedBytes = null;
    },
  };
}

function applyZoomToPage(pageEl, zoom) {
  const baseW = parseFloat(pageEl.dataset.baseWidth) || 0;
  const baseH = parseFloat(pageEl.dataset.baseHeight) || 0;
  if (baseW === 0 || baseH === 0) return;
  pageEl.style.width = `${baseW * zoom}px`;
  pageEl.style.height = `${baseH * zoom}px`;
}

function setupScrollSync(leftCol, rightCol) {
  let enabled = true;
  let source = null;
  let resetTimer = null;
  let leftRaf = null;
  let rightRaf = null;

  function findColumnPageAndRatio(col, pageSelector) {
    const center = col.scrollTop + col.clientHeight / 2;
    const pages = col.querySelectorAll(pageSelector);
    if (pages.length === 0) return null;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const top = p.offsetTop;
      const bottom = top + p.clientHeight;
      if (center >= top && center <= bottom) {
        const ratio = p.clientHeight > 0 ? (center - top) / p.clientHeight : 0;
        return { pageIdx: i, ratio };
      }
    }
    const firstTop = pages[0].offsetTop;
    const lastBottom = pages[pages.length - 1].offsetTop + pages[pages.length - 1].clientHeight;
    if (center < firstTop) return { pageIdx: 0, ratio: 0 };
    if (center > lastBottom) return { pageIdx: pages.length - 1, ratio: 1 };
    return null;
  }

  function applyToColumn(col, pageSelector, info) {
    const pages = col.querySelectorAll(pageSelector);
    const target = pages[info.pageIdx];
    if (!target) return;
    const targetCenter = target.offsetTop + target.clientHeight * info.ratio;
    const targetScrollTop = targetCenter - col.clientHeight / 2;
    col.scrollTo({ top: targetScrollTop, behavior: 'auto' });
  }

  function resetSourceAfter() {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { source = null; }, SCROLL_SYNC_RESET_MS);
  }

  function onLeftScroll() {
    if (!enabled) return;
    if (source && source !== 'left') return;
    if (leftRaf) return;
    leftRaf = requestAnimationFrame(() => {
      leftRaf = null;
      const info = findColumnPageAndRatio(leftCol, '.reader-page-original');
      if (!info) return;
      source = 'left';
      applyToColumn(rightCol, '.reader-page-translated', info);
      resetSourceAfter();
    });
  }

  function onRightScroll() {
    if (!enabled) return;
    if (source && source !== 'right') return;
    if (rightRaf) return;
    rightRaf = requestAnimationFrame(() => {
      rightRaf = null;
      const info = findColumnPageAndRatio(rightCol, '.reader-page-translated');
      if (!info) return;
      source = 'right';
      applyToColumn(leftCol, '.reader-page-original', info);
      resetSourceAfter();
    });
  }

  leftCol.addEventListener('scroll', onLeftScroll, { passive: true });
  rightCol.addEventListener('scroll', onRightScroll, { passive: true });

  return {
    setEnabled(v) { enabled = !!v; },
    destroy() {
      leftCol.removeEventListener('scroll', onLeftScroll);
      rightCol.removeEventListener('scroll', onRightScroll);
      clearTimeout(resetTimer);
      if (leftRaf) cancelAnimationFrame(leftRaf);
      if (rightRaf) cancelAnimationFrame(rightRaf);
    },
  };
}

export function buildPlainTextDump(doc) {
  if (!doc) return '';
  const lines = [];
  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    const _t = (k, p) => window.__SK?.i18n?.t?.(k, p) ?? k;
    lines.push(_t('doc.reader.dump.pageHeader', { n: i + 1 }));
    for (const block of page.blocks) {
      const t = block.translation || block.plainText;
      if (!t) continue;
      lines.push(t);
      lines.push('');
    }
  }
  return lines.join('\n');
}
