import { TRANSLATABLE_TYPES } from './block-types.js';
import { downloadBilingualPdf, buildBilingualPdf } from './pdf-renderer.js';

function computeStructureDiagnostics(doc) {
  const issues = [];
  const PCT_EPSILON = 0.5;
  const BBOX_OUTSIDE_TOL = 1.5;
  for (const page of doc.pages) {
    const pageW = page.viewport.width;
    const pageH = page.viewport.height;
    if (!(pageW > 0 && pageH > 0)) {
      issues.push({ pageIndex: page.pageIndex, blockId: '-', code: 'invalid-page-size', detail: `${pageW}x${pageH}` });
      continue;
    }
    const seenOrders = new Set();
    for (const block of page.blocks) {
      if (!Array.isArray(block.bbox) || block.bbox.length !== 4) {
        issues.push({ pageIndex: page.pageIndex, blockId: block.blockId || '-', code: 'no-bbox', detail: '' });
        continue;
      }
      const [x0, y0, x1, y1] = block.bbox;
      if (!(x0 < x1 && y0 < y1)) {
        issues.push({ pageIndex: page.pageIndex, blockId: block.blockId, code: 'invalid-bbox', detail: `[${x0.toFixed(1)},${y0.toFixed(1)},${x1.toFixed(1)},${y1.toFixed(1)}]` });
        continue;
      }
      if (x0 < -BBOX_OUTSIDE_TOL || y0 < -BBOX_OUTSIDE_TOL || x1 > pageW + BBOX_OUTSIDE_TOL || y1 > pageH + BBOX_OUTSIDE_TOL) {
        issues.push({ pageIndex: page.pageIndex, blockId: block.blockId, code: 'bbox-outside-page', detail: `[${x0.toFixed(1)},${y0.toFixed(1)},${x1.toFixed(1)},${y1.toFixed(1)}] page=${pageW.toFixed(0)}x${pageH.toFixed(0)}` });
      }
      if (TRANSLATABLE_TYPES.has(block.type)) {
        if (!block.plainText || !block.plainText.trim()) {
          issues.push({ pageIndex: page.pageIndex, blockId: block.blockId, code: 'empty-plain-text', detail: block.type });
        }
      }
      if (typeof block.fontSize === 'number' && (block.fontSize < 0 || block.fontSize > 200)) {
        issues.push({ pageIndex: page.pageIndex, blockId: block.blockId, code: 'extreme-font-size', detail: `${block.fontSize.toFixed(1)}pt` });
      }
      const leftPct = (x0 / pageW) * 100;
      const topPct = (y0 / pageH) * 100;
      const widthPct = ((x1 - x0) / pageW) * 100;
      const heightPct = ((y1 - y0) / pageH) * 100;
      if (leftPct < -PCT_EPSILON || topPct < -PCT_EPSILON
          || leftPct + widthPct > 100 + PCT_EPSILON
          || topPct + heightPct > 100 + PCT_EPSILON) {
        issues.push({ pageIndex: page.pageIndex, blockId: block.blockId, code: 'overlay-pct-overflow', detail: `L=${leftPct.toFixed(1)} T=${topPct.toFixed(1)} W=${widthPct.toFixed(1)} H=${heightPct.toFixed(1)}` });
      }
      if (typeof block.readingOrder === 'number') {
        if (seenOrders.has(block.readingOrder)) {
          issues.push({ pageIndex: page.pageIndex, blockId: block.blockId, code: 'duplicate-reading-order', detail: String(block.readingOrder) });
        }
        seenOrders.add(block.readingOrder);
      }
    }
  }
  return { issueCount: issues.length, issues };
}

const PSEUDO_POOL = '的一是不了人我在有他這中大來上國個到說們為子和你地出道也時年得就那要下以生會自著去之過家學對可她裡後小麼心多天而能好都然沒日於起還發成事只作當想看文無開手十用主行方又如前所本見經頭面公同三已老從動兩長知民樣現分將外但身些與高意進把法此實回二理美點月明其種聲全工己話兒者向情性入定四東量真氣機重應水果體';
const PSEUDO_PUNCT = { '.': '。', ',': '，', ':': '：', ';': '；', '!': '！', '?': '？', '(': '（', ')': '）', '[': '［', ']': '］' };
const PSEUDO_PROBE_RARE = '①が简—𠮷';
const PSEUDO_PROBE_EMOJI = '😀';
function pseudoHash(str, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function pseudoWord(word, salt, ratio = 0.45) {
  const len = Math.max(1, Math.round(word.length * ratio));
  let h = pseudoHash(word.toLowerCase(), salt);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += PSEUDO_POOL[h % PSEUDO_POOL.length];
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
  }
  return out;
}
export function pseudoCjkTranslate(text, blockIndex = 0, ratio = 0.45) {
  const re = /(⟦[^⟧]*⟧)|(https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\.{2,})|([A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’\-]*)|(\d[\d.,:%\/\-]*)|(\s+)|(.)/gsu;
  const probeForbidden = blockIndex % 7 === 3;
  const tokens = [];
  let latinIdx = 0;
  let quoteOpen = true;
  for (const m of text.matchAll(re)) {
    if (m[1]) tokens.push({ k: 'keep', v: m[1] });
    else if (m[2]) tokens.push({ k: 'keep', v: m[2] });
    else if (m[3]) {
      latinIdx++;
      if (latinIdx % 5 === 0) tokens.push({ k: 'keep', v: m[3] });
      else tokens.push({ k: 'cjk', v: pseudoWord(m[3], blockIndex, ratio) + (probeForbidden ? '，' : '') });
    } else if (m[4]) tokens.push({ k: 'keep', v: m[4] });
    else if (m[5]) tokens.push({ k: 'ws' });
    else {
      const ch = m[6];
      const prevNonWs = [...tokens].reverse().find((t) => t.k !== 'ws');
      if (ch === '.' && prevNonWs && (prevNonWs.v === '。' || prevNonWs.v === '.')) tokens.push({ k: 'keep', v: '.' });
      else if (ch === '"') { tokens.push({ k: 'cjk', v: quoteOpen ? '「' : '」' }); quoteOpen = !quoteOpen; }
      else if (PSEUDO_PUNCT[ch]) tokens.push({ k: 'cjk', v: PSEUDO_PUNCT[ch] });
      else tokens.push({ k: ch.charCodeAt(0) < 128 ? 'keep' : 'cjk', v: ch });
    }
  }
  let out = '偽';
  let prevKeep = false;
  let pendingWs = false;
  for (const tk of tokens) {
    if (tk.k === 'ws') { pendingWs = true; continue; }
    if (pendingWs && prevKeep && tk.k === 'keep') out += ' ';
    pendingWs = false;
    out += tk.v;
    prevKeep = tk.k === 'keep';
  }
  if (blockIndex % 11 === 5) out += PSEUDO_PROBE_RARE;
  if (blockIndex % 13 === 7) out += PSEUDO_PROBE_EMOJI;
  return out;
}
function injectTranslations(doc, mode, ratio = 0.45) {
  let count = 0;
  let idx = 0;
  for (const page of doc.pages) {
    for (const block of page.blocks) {
      if (TRANSLATABLE_TYPES.has(block.type) && block.plainText && block.plainText.trim()) {
        block.translation = mode === 'pseudo-cjk' ? pseudoCjkTranslate(block.plainText, idx, ratio) : block.plainText;
        block.translationStatus = 'done';
        count++;
        idx++;
      }
    }
  }
  return count;
}
function bytesToBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function createVerify(deps) {
  return {
      hasDoc: () => !!deps.getCurrentDoc(),
      injectPlainTextAsTranslation: () => {
        if (!deps.getCurrentDoc()) return null;
        let count = 0;
        for (const page of deps.getCurrentDoc().pages) {
          for (const block of page.blocks) {
            if (TRANSLATABLE_TYPES.has(block.type) && block.plainText && block.plainText.trim()) {
              block.translation = block.plainText;
              block.translationStatus = 'done';
              count++;
            }
          }
        }
        return { translatableCount: count };
      },
      injectPseudoCjkTranslation: () => {
        if (!deps.getCurrentDoc()) return null;
        return { translatableCount: injectTranslations(deps.getCurrentDoc(), 'pseudo-cjk') };
      },
      buildTranslatedPdfMeta: async () => {
        if (!deps.getCurrentDoc() || !deps.getCurrentOriginalArrayBuffer()) return null;
        const r = await buildBilingualPdf(deps.getCurrentOriginalArrayBuffer(), deps.getCurrentDoc(), {});
        return { fontSource: r.fontSource, fontFallback: r.fontFallback, bytes: r.byteLength };
      },
      buildTranslatedPdfBytes: async () => {
        if (!deps.getCurrentDoc() || !deps.getCurrentOriginalArrayBuffer()) return null;
        const { bytes } = await buildBilingualPdf(deps.getCurrentOriginalArrayBuffer(), deps.getCurrentDoc(), {});
        return Array.from(bytes);
      },
      generateAndVerifyPdf: async () => {
        if (!deps.getCurrentDoc() || !deps.getCurrentOriginalArrayBuffer()) return null;
        let capturedBytes = null;
        const origCreateObjectURL = URL.createObjectURL;
        const origAppendChild = document.body.appendChild.bind(document.body);
        URL.createObjectURL = function (blob) {
          if (blob && typeof blob.arrayBuffer === 'function') {
            blob.arrayBuffer().then((buf) => { capturedBytes = new Uint8Array(buf); });
          }
          return 'blob:verify-stub';
        };
        document.body.appendChild = function (el) {
          if (el && el.tagName === 'A' && el.download) el.click = () => {};
          return origAppendChild(el);
        };
        let result = null;
        let error = null;
        const t0 = performance.now();
        try {
          result = await downloadBilingualPdf(deps.getCurrentOriginalArrayBuffer(), deps.getCurrentDoc(), {});
          for (let i = 0; i < 200 && !capturedBytes; i++) {
            await new Promise((r) => setTimeout(r, 20));
          }
        } catch (err) {
          error = (err && err.message) || String(err);
        } finally {
          URL.createObjectURL = origCreateObjectURL;
          document.body.appendChild = origAppendChild;
        }
        const elapsedMs = Math.round(performance.now() - t0);
        if (!result || !capturedBytes) {
          return { ok: false, error: error || 'no-bytes-captured', elapsedMs };
        }
        const pdfjsLib = await import('../lib/vendor/pdfjs/pdf.min.mjs');
        let reparsed = null;
        let reparseError = null;
        try {
          const loadingTask = pdfjsLib.getDocument({ data: capturedBytes.slice(0).buffer, disableFontFace: false });
          const pdfDoc = await loadingTask.promise;
          const pageDiagnostics = [];
          for (let i = 0; i < pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i + 1);
            const tc = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1 });
            pageDiagnostics.push({
              pageIndex: i,
              width: Math.round(viewport.width),
              height: Math.round(viewport.height),
              runCount: tc.items.length,
            });
          }
          reparsed = { numPages: pdfDoc.numPages, pages: pageDiagnostics };
          await pdfDoc.destroy();
        } catch (err) {
          reparseError = (err && err.message) || String(err);
        }
        return {
          ok: true,
          error: null,
          byteLength: result.byteLength,
          captured: capturedBytes.byteLength,
          elapsedMs,
          reparsed,
          reparseError,
        };
      },
      computeStructureDiagnostics: () => {
        if (!deps.getCurrentDoc()) return null;
        return computeStructureDiagnostics(deps.getCurrentDoc());
      },
      runEnhancedVerify: async (opts = {}) => {
        if (!deps.getCurrentDoc() || !deps.getCurrentOriginalArrayBuffer()) return null;
        const mode = opts.mode === 'pseudo-cjk' ? 'pseudo-cjk' : 'plain';
        const pdfjs = await import('../lib/vendor/pdfjs/pdf.min.mjs');

        async function analyzePdfBytes(ab) {
          const task = pdfjs.getDocument({ data: ab.slice(0), disableFontFace: false });
          const pdfDoc = await task.promise;
          const pages = [];
          for (let i = 0; i < pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i + 1);
            const viewport = page.getViewport({ scale: 1 });
            const annotations = await page.getAnnotations();
            const links = annotations
              .filter((a) => a.subtype === 'Link')
              .map((a) => ({ rect: a.rect, url: a.url || a.unsafeUrl || null, dest: a.dest || null }));
            await page.getOperatorList();
            const tc = await page.getTextContent();
            const styles = tc.styles || {};
            const fontsByName = {};
            for (const fn of Object.keys(styles)) {
              try {
                const font = await new Promise((resolve) => {
                  page.commonObjs.get(fn, (obj) => resolve(obj));
                });
                if (font) {
                  const name = font.name || '';
                  const isBold = font.bold === true || /Bold|Black|Heavy|Demi|Semi/i.test(name);
                  fontsByName[fn] = { name, isBold };
                }
              } catch {   }
            }
            const items = tc.items.filter((it) => typeof it.str === 'string' && it.str.trim().length > 0).map((it) => {
              const m = pdfjs.Util.transform(viewport.transform, it.transform);
              const fontSize = Math.hypot(m[2], m[3]);
              const left = m[4];
              const baselineY = m[5];
              const top = baselineY - fontSize;
              const right = left + (it.width || 0);
              const bottom = baselineY;
              const fmeta = fontsByName[it.fontName];
              return {
                str: it.str,
                fontName: it.fontName,
                bbox: [left, top, right, bottom],
                fontSize,
                isBold: !!(fmeta && fmeta.isBold),
                fontRealName: fmeta ? fmeta.name : '',
              };
            });
            pages.push({
              pageIndex: i,
              viewport: { width: viewport.width, height: viewport.height },
              links,
              fontsByName,
              items,
            });
          }
          await pdfDoc.destroy();
          return { numPages: pdfDoc.numPages, pages };
        }

        function blockBoldRatio(block, gtPage, fontFilter) {
          const [bx0, by0, bx1, by1] = block.bbox;
          let boldChars = 0;
          let totalChars = 0;
          for (const it of gtPage.items) {
            if (fontFilter && !fontFilter(it)) continue;
            const [ix0, iy0, ix1, iy1] = it.bbox;
            const cx = (ix0 + ix1) / 2;
            const cy = (iy0 + iy1) / 2;
            if (cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1) {
              const n = it.str.length;
              totalChars += n;
              if (it.isBold) boldChars += n;
            }
          }
          return { boldChars, totalChars, ratio: totalChars > 0 ? boldChars / totalChars : 0 };
        }
        const isOverlayFont = (it) => /Noto|NotoSansTC/i.test(it.fontRealName || '');

        function computeOverflowFor(block) {
          if (!TRANSLATABLE_TYPES.has(block.type)) return null;
          const txt = block.plainText || '';
          if (!txt.trim()) return null;
          const [x0, y0, x1, y1] = block.bbox;
          const blockW = x1 - x0;
          const blockH = y1 - y0;
          if (blockW <= 0 || blockH <= 0) return null;
          const fontSize = Math.max(7, block.fontSize * 0.9);
          const lineHeight = fontSize * 1.3;

          const englishCharWidth = (ch) => {
            const cp = ch.codePointAt(0);
            const isCJK = (cp >= 0x3000 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0xFF00 && cp <= 0xFFEF);
            const isWS = /\s/.test(ch);
            if (isCJK) return fontSize * 1.0;
            if (isWS) return fontSize * 0.3;
            return fontSize * 0.5;
          };
          let englishLines = 1;
          let lineW = 0;
          for (const ch of txt) {
            const w = englishCharWidth(ch);
            if (lineW + w > blockW && lineW > 0) { englishLines++; lineW = w; }
            else lineW += w;
          }
          const englishHeight = fontSize + (englishLines - 1) * lineHeight;

          const cjkChars = Math.max(2, Math.ceil(txt.replace(/\s+/g, '').length / 2));
          const cjkCharsPerLine = Math.max(1, Math.floor(blockW / fontSize));
          const cjkLines = Math.ceil(cjkChars / cjkCharsPerLine);
          const cjkHeight = fontSize + (cjkLines - 1) * lineHeight;

          const minSafeHeight = fontSize * 1.15;
          const isTightHeight = blockH < minSafeHeight;

          const englishOverflow = englishHeight - blockH;
          const cjkOverflow = cjkHeight - blockH;
          const TOLERANCE = 1;

          const isOverflow = englishOverflow > TOLERANCE || cjkOverflow > TOLERANCE || isTightHeight;
          return {
            blockId: block.blockId,
            type: block.type,
            blockW: Math.round(blockW),
            blockH: Math.round(blockH * 10) / 10,
            fontSize: Math.round(fontSize * 10) / 10,
            englishLines,
            englishHeight: Math.round(englishHeight * 10) / 10,
            cjkLines,
            cjkHeight: Math.round(cjkHeight * 10) / 10,
            englishOverflow: Math.round(englishOverflow * 10) / 10,
            cjkOverflow: Math.round(cjkOverflow * 10) / 10,
            isTightHeight,
            isOverflow,
            worstDelta: Math.round(Math.max(englishOverflow, cjkOverflow, isTightHeight ? minSafeHeight - blockH : 0) * 10) / 10,
          };
        }

        const gt = await analyzePdfBytes(deps.getCurrentOriginalArrayBuffer());

        const blockAnalysis = [];
        for (const page of deps.getCurrentDoc().pages) {
          const gtPage = gt.pages[page.pageIndex];
          if (!gtPage) continue;
          for (const block of page.blocks) {
            const boldR = blockBoldRatio(block, gtPage);
            const overflowR = computeOverflowFor(block);
            blockAnalysis.push({
              pageIndex: page.pageIndex,
              blockId: block.blockId,
              type: block.type,
              fontSize: Math.round(block.fontSize * 10) / 10,
              originalBoldRatio: Math.round(boldR.ratio * 100) / 100,
              isOriginalBold: boldR.ratio >= 0.5,
              boldChars: boldR.boldChars,
              totalCharsInBlock: boldR.totalChars,
              overflow: overflowR,
            });
          }
        }

        const translatableCount = injectTranslations(deps.getCurrentDoc(), mode, typeof opts.pseudoRatio === 'number' ? opts.pseudoRatio : 0.45);

        let capturedBytes = null;
        const origCreateObjectURL = URL.createObjectURL;
        const origAppendChild = document.body.appendChild.bind(document.body);
        URL.createObjectURL = function (blob) {
          if (blob && typeof blob.arrayBuffer === 'function') {
            blob.arrayBuffer().then((buf) => { capturedBytes = new Uint8Array(buf); });
          }
          return 'blob:enhanced-verify-stub';
        };
        document.body.appendChild = function (el) {
          if (el && el.tagName === 'A' && el.download) el.click = () => {};
          return origAppendChild(el);
        };
        let generatedByteLength = 0;
        let generateError = null;
        let fontFallback = false;
        let fontSource = null;
        try {
          const r = await downloadBilingualPdf(deps.getCurrentOriginalArrayBuffer(), deps.getCurrentDoc(), {});
          generatedByteLength = r.byteLength;
          fontFallback = !!r.fontFallback;
          fontSource = r.fontSource || null;
          for (let i = 0; i < 200 && !capturedBytes; i++) await new Promise((resolve) => setTimeout(resolve, 20));
        } catch (err) {
          generateError = (err && err.message) || String(err);
        } finally {
          URL.createObjectURL = origCreateObjectURL;
          document.body.appendChild = origAppendChild;
        }
        if (!capturedBytes) {
          return {
            ok: false,
            error: generateError || 'no-bytes-captured',
            translatableCount,
            blockAnalysis,
            originalLinks: gt.pages.map((p) => p.links).flat(),
          };
        }

        const gen = await analyzePdfBytes(capturedBytes.buffer);

        const boldOrig = blockAnalysis.filter((b) => b.isOriginalBold);
        const boldLost = [];
        for (const ba of boldOrig) {
          const layoutBlock = deps.getCurrentDoc().pages[ba.pageIndex].blocks.find((b) => b.blockId === ba.blockId);
          if (!layoutBlock) continue;
          const genPage = gen.pages[ba.pageIndex];
          if (!genPage) continue;
          const overlayRatio = blockBoldRatio(layoutBlock, genPage, isOverlayFont);
          if (overlayRatio.totalChars > 0 && overlayRatio.ratio < 0.5) {
            boldLost.push({
              pageIndex: ba.pageIndex,
              blockId: ba.blockId,
              type: ba.type,
              fontSize: ba.fontSize,
              originalBoldRatio: ba.originalBoldRatio,
              overlayBoldRatio: Math.round(overlayRatio.ratio * 100) / 100,
              overlayChars: overlayRatio.totalChars,
              plainTextPreview: (layoutBlock.plainText || '').slice(0, 60),
            });
          }
        }

        const RECT_TOL = 5;
        const linkOrig = [];
        const linkLost = [];
        for (let i = 0; i < gt.pages.length; i++) {
          const gtLinks = gt.pages[i].links || [];
          const genLinks = (gen.pages[i] && gen.pages[i].links) || [];
          for (const L of gtLinks) {
            linkOrig.push({ pageIndex: i, ...L });
            const found = genLinks.find((G) => {
              if (G.url !== L.url) return false;
              const r1 = L.rect, r2 = G.rect;
              return Math.abs(r1[0] - r2[0]) <= RECT_TOL && Math.abs(r1[1] - r2[1]) <= RECT_TOL
                && Math.abs(r1[2] - r2[2]) <= RECT_TOL && Math.abs(r1[3] - r2[3]) <= RECT_TOL;
            });
            if (!found) linkLost.push({ pageIndex: i, ...L });
          }
        }

        const overflowList = blockAnalysis.filter((b) => b.overflow && b.overflow.isOverflow);

        function maxAllowedBottomY(block, page) {
          const [cx0, , cx1, cy1] = block.bbox;
          const pageH = page.viewport.height;
          let minBlockerY0 = pageH;
          for (const b of page.blocks) {
            if (b === block) continue;
            if (!Array.isArray(b.bbox) || b.bbox.length !== 4) continue;
            const [bx0, by0, bx1] = b.bbox;
            if (by0 <= cy1) continue;
            if (bx0 >= cx1 || bx1 <= cx0) continue;
            if (by0 < minBlockerY0) minBlockerY0 = by0;
          }
          return Math.max(cy1, minBlockerY0 - 2);
        }
        const actualOverflowList = [];
        for (const ba of blockAnalysis) {
          if (!TRANSLATABLE_TYPES.has(ba.type)) continue;
          const layoutBlock = deps.getCurrentDoc().pages[ba.pageIndex].blocks.find((b) => b.blockId === ba.blockId);
          if (!layoutBlock) continue;
          const layoutPage = deps.getCurrentDoc().pages[ba.pageIndex];
          const genPage = gen.pages[ba.pageIndex];
          if (!genPage) continue;
          const [bx0, by0, bx1, by1] = layoutBlock.bbox;
          const allowedBottom = maxAllowedBottomY(layoutBlock, layoutPage);
          let maxBottom = -Infinity;
          let overlayCharsInBlock = 0;
          for (const it of genPage.items) {
            if (!isOverlayFont(it)) continue;
            const [ix0, iy0, ix1, iy1] = it.bbox;
            const cx = (ix0 + ix1) / 2;
            const cy = (iy0 + iy1) / 2;
            if (cx >= bx0 && cx <= bx1 && cy >= by0 - 1 && cy <= allowedBottom + 1) {
              overlayCharsInBlock += it.str.length;
              if (iy1 > maxBottom) maxBottom = iy1;
            }
          }
          if (overlayCharsInBlock === 0) continue;
          const actualOverflow = maxBottom - allowedBottom;
          if (actualOverflow > 1) {
            actualOverflowList.push({
              pageIndex: ba.pageIndex,
              blockId: ba.blockId,
              type: ba.type,
              fontSize: ba.fontSize,
              blockH: Math.round((by1 - by0) * 10) / 10,
              allowedBottom: Math.round(allowedBottom * 10) / 10,
              maxBottom: Math.round(maxBottom * 10) / 10,
              actualOverflow: Math.round(actualOverflow * 10) / 10,
              overlayChars: overlayCharsInBlock,
            });
          }
        }

        const textLayer = { checked: 0, missingBlocks: 0, missingChars: 0, truncatedBlocks: 0, ellipsisBlocks: 0, missingCharCounts: {}, samples: [], blocks: [] };
        let rightOverflowItems = 0;
        const rightOverflowSamples = [];
        for (const page of deps.getCurrentDoc().pages) {
          const genPage = gen.pages[page.pageIndex];
          if (!genPage || page.blocks.length === 0) continue;
          const contentRight = Math.max(...page.blocks.filter((b) => Array.isArray(b.bbox)).map((b) => b.bbox[2]));
          for (const it of genPage.items) {
            if (isOverlayFont(it) && it.bbox[2] > contentRight + 20) {
              rightOverflowItems++;
              if (rightOverflowSamples.length < 5) rightOverflowSamples.push({ pageIndex: page.pageIndex, str: it.str.slice(0, 40), right: Math.round(it.bbox[2]), contentRight: Math.round(contentRight), left: Math.round(it.bbox[0]) });
            }
          }
        }
        textLayer.rightOverflowItems = rightOverflowItems;
        textLayer.rightOverflowSamples = rightOverflowSamples;
        for (const page of deps.getCurrentDoc().pages) {
          const genPage = gen.pages[page.pageIndex];
          if (!genPage) continue;
          const pageW = page.viewport.width;
          for (const block of page.blocks) {
            if (!TRANSLATABLE_TYPES.has(block.type) || !block.translation || block.translationStatus !== 'done') continue;
            const normText = (str) => str.replace(/\s+/g, '').replace(/…/g, '\uE000').normalize('NFKC');
            const expected = normText(block.translation);
            if (!expected) continue;
            textLayer.checked++;
            const [bx0, by0] = block.bbox;
            const allowedBottom = maxAllowedBottomY(block, page);
            const need = new Map();
            for (const ch of expected) need.set(ch, (need.get(ch) || 0) + 1);
            let extraEllipsis = 0;
            for (const it of genPage.items) {
              if (!isOverlayFont(it)) continue;
              const [ix0, iy0] = it.bbox;
              if (ix0 < bx0 - 3 || ix0 > pageW || iy0 < by0 - 3 || iy0 > allowedBottom + 3) continue;
              for (const ch of normText(it.str)) {
                const n = need.get(ch);
                if (n) need.set(ch, n - 1);
                else if (ch === '\uE000') extraEllipsis++;
              }
            }
            if (extraEllipsis > 0) textLayer.ellipsisBlocks++;
            let missing = 0;
            let missingStr = '';
            for (const [ch, n] of need) {
              if (n > 0) { missing += n; missingStr += ch.repeat(n); textLayer.missingCharCounts[ch] = (textLayer.missingCharCounts[ch] || 0) + n; }
            }
            if (missing > 0) {
              textLayer.blocks.push({ pageIndex: page.pageIndex, blockId: block.blockId, type: block.type, expectedLen: expected.length, missing: missingStr, tail: expected.slice(-60) });
              textLayer.missingBlocks++;
              textLayer.missingChars += missing;
              const tail = expected.slice(-Math.min(missing, expected.length));
              let tailHit = 0;
              const rest = new Map(need);
              for (const ch of tail) { const n = rest.get(ch); if (n > 0) { tailHit++; rest.set(ch, n - 1); } }
              const truncated = missing >= 4 && tailHit / tail.length > 0.8;
              if (truncated) textLayer.truncatedBlocks++;
              if (textLayer.samples.length < 8) {
                textLayer.samples.push({ pageIndex: page.pageIndex, blockId: block.blockId, type: block.type, expectedLen: expected.length, missing, truncated, preview: expected.slice(0, 40) });
              }
            }
          }
        }

        return {
          ok: true,
          mode,
          bytesBase64: opts.keepBytes ? bytesToBase64(capturedBytes) : null,
          fontFallback,
          fontSource,
          textLayer,
          generatedByteLength,
          translatableCount,
          totalBlocks: blockAnalysis.length,
          bold: {
            totalBoldBlocks: boldOrig.length,
            preservedCount: boldOrig.length - boldLost.length,
            lostCount: boldLost.length,
            lostBlocks: boldLost.slice(0, 30),
          },
          links: {
            totalLinks: linkOrig.length,
            preservedCount: linkOrig.length - linkLost.length,
            lostCount: linkLost.length,
            lostLinks: linkLost.slice(0, 30),
          },
          overflow: {
            totalChecked: blockAnalysis.filter((b) => b.overflow).length,
            riskCount: overflowList.length,
            englishOverflowCount: overflowList.filter((b) => b.overflow.englishOverflow > 1).length,
            cjkOverflowCount: overflowList.filter((b) => b.overflow.cjkOverflow > 1).length,
            tightHeightCount: overflowList.filter((b) => b.overflow.isTightHeight).length,
            worstRisk: overflowList.slice().sort((a, b) => b.overflow.worstDelta - a.overflow.worstDelta).slice(0, 15)
              .map((b) => ({ pageIndex: b.pageIndex, blockId: b.blockId, type: b.type, ...b.overflow })),
            actualOverflowCount: actualOverflowList.length,
            actualOverflowSamples: actualOverflowList.slice().sort((a, b) => b.actualOverflow - a.actualOverflow).slice(0, 15),
          },
        };
      },
    };
}
