import { getPricingForModel } from '../lib/model-pricing.js';

export const HAS_LETTER_RE = /\p{L}/u;

export const EPUB_LIMITS = {
  hardMaxBytes: 100 * 1024 * 1024,
  softWarnChars: 500_000,
};

export class EpubParseError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'EpubParseError';
    this.code = code;
  }
}

export function preflightEpubFile(file) {
  const isEpubExt = /\.epub$/i.test(file.name || '');
  const isEpubMime = (file.type || '') === 'application/epub+zip';
  if (!isEpubExt && !isEpubMime) {
    return { level: 'error', code: 'not-epub' };
  }
  if (file.size > EPUB_LIMITS.hardMaxBytes) {
    return { level: 'error', code: 'too-large' };
  }
  return { level: 'ok' };
}

let _policyApplied = false;
function applyEpubSerializerPolicy(SK) {
  if (_policyApplied) return;
  _policyApplied = true;
  const origAtomic = SK.isAtomicPreserve;
  SK.isAtomicPreserve = function epubIsAtomicPreserve(el) {
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'SVG' || tag === 'MATH') return true;
    if (!SK.hasSubstantiveContent(el)
        && (el.id || el.getAttribute('epub:type'))) return true;
    return origAtomic(el);
  };
}

export function getSerializerSK() {
  const SK = window.__SK;
  if (!SK || typeof SK.serializeWithPlaceholders !== 'function') {
    throw new EpubParseError('bad-zip',
      'serializer not loaded（index.html 需先載入 content-ns.js + content-serialize.js）');
  }
  applyEpubSerializerPolicy(SK);
  return SK;
}

function parseXml(text, mime) {
  const doc = new DOMParser().parseFromString(text, mime);
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  return doc;
}

function decodeEntryText(u8) {
  let text = window.fflate.strFromU8(u8);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return text;
}

export function resolvePath(baseDir, href) {
  const _rawHref = (href || '').split('#')[0];
  let raw;
  try {
    raw = decodeURIComponent(_rawHref);
  } catch (_) {
    raw = _rawHref;
  }
  if (!raw) return '';
  const parts = (baseDir ? baseDir.split('/') : []).filter(Boolean);
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

const FONT_OBFUSCATION_ALGOS = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
]);

function checkDrm(entries) {
  const encU8 = entries['META-INF/encryption.xml'];
  if (!encU8) return;
  const doc = parseXml(decodeEntryText(encU8), 'application/xml');
  if (!doc) throw new EpubParseError('drm');
  const methods = doc.getElementsByTagNameNS('*', 'EncryptionMethod');
  for (const m of methods) {
    const algo = m.getAttribute('Algorithm') || '';
    if (!FONT_OBFUSCATION_ALGOS.has(algo)) throw new EpubParseError('drm');
  }
}

const BLOCK_CANDIDATE_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'figcaption', 'caption', 'td', 'th', 'dd', 'dt', 'div'];
const BLOCK_CANDIDATE_SELECTOR = BLOCK_CANDIDATE_TAGS.join(',');
const SKIP_SUBTREE_TAGS = new Set(['pre', 'script', 'style', 'template', 'svg', 'math', 'nav']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function isInsideSkippedSubtree(el, stopAt) {
  let cur = el.parentElement;
  while (cur && cur !== stopAt) {
    if (SKIP_SUBTREE_TAGS.has(cur.localName)) return true;
    cur = cur.parentElement;
  }
  return false;
}

function hasCandidateDescendant(el) {
  return !!el.querySelector(BLOCK_CANDIDATE_SELECTOR);
}

function normalizeText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function htmlCloneFromXhtml(el) {
  return document.importNode(el, true);
}

export function collectChapterBlocks(xhtmlDoc, chapterIndex, SK) {
  const body = xhtmlDoc.getElementsByTagNameNS('*', 'body')[0];
  if (!body) return [];
  const blocks = [];
  const candidates = body.querySelectorAll(BLOCK_CANDIDATE_SELECTOR);
  let n = 0;
  const leafSet = new Set();
  for (const el of candidates) {
    if (hasCandidateDescendant(el)) continue;
    if (isInsideSkippedSubtree(el, body)) continue;
    leafSet.add(el);
    const htmlClone = htmlCloneFromXhtml(el);
    if (!htmlClone) continue;
    stripRubyAnnotations(htmlClone);
    const plainText = normalizeText(htmlClone.textContent);
    if (!plainText) continue;
    if (!HAS_LETTER_RE.test(plainText)) continue;

    const { text: serializedText, slots } = SK.serializeWithPlaceholders(htmlClone);
    if (!serializedText || !serializedText.trim()) continue;

    blocks.push({
      blockId: `c${chapterIndex}-b${n++}`,
      type: HEADING_TAGS.has(el.localName) ? 'heading' : 'paragraph',
      el,
      plainText,
      epubSerializedText: serializedText,
      slots,
      translation: null,
      translationRaw: null,
      translationStatus: 'pending',
      translationError: null,
    });
  }

  let m = 0;
  const containers = [body, ...body.getElementsByTagName('*')];
  for (const container of containers) {
    if (container !== body) {
      if (SKIP_SUBTREE_TAGS.has(container.localName)) continue;
      if (leafSet.has(container)) continue;
      if (!RUN_BREAK_TAGS.has(container.localName) && !hasCandidateDescendant(container)) continue;
      if (isInsideSkippedSubtree(container, body)) continue;
    }
    for (const run of inlineRunsOf(container)) {
      const wrapper = document.createElement('span');
      for (const node of run) wrapper.appendChild(document.importNode(node, true));
      stripRubyAnnotations(wrapper);
      const plainText = normalizeText(wrapper.textContent);
      if (!plainText || !HAS_LETTER_RE.test(plainText)) continue;
      const { text: serializedText, slots } = SK.serializeWithPlaceholders(wrapper);
      if (!serializedText || !serializedText.trim()) continue;
      m++;
      blocks.push({
        blockId: null,
        type: 'paragraph',
        el: null,
        fragStart: run[0],
        fragEnd: run[run.length - 1],
        plainText,
        epubSerializedText: serializedText,
        slots,
        translation: null,
        translationRaw: null,
        translationStatus: 'pending',
        translationError: null,
      });
    }
  }
  if (m > 0) {
    sortBlocksByDocumentOrder(blocks);
    let f = 0;
    for (const b of blocks) if (b.blockId == null) b.blockId = `c${chapterIndex}-f${f++}`;
  }
  return blocks;
}

const RUN_BREAK_TAGS = new Set([
  ...BLOCK_CANDIDATE_TAGS,
  'ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'section', 'article', 'aside', 'header', 'footer', 'figure', 'hr', 'main',
  'address', 'details', 'summary', 'form', 'fieldset', 'body',
]);

function inlineRunsOf(container) {
  const runs = [];
  let cur = [];
  const flush = () => { if (cur.length > 0) runs.push(cur); cur = []; };
  for (const node of container.childNodes) {
    if (node.nodeType === 3) { cur.push(node); continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.localName;
    if (SKIP_SUBTREE_TAGS.has(tag) || RUN_BREAK_TAGS.has(tag) || hasCandidateDescendant(node)) {
      flush();
      continue;
    }
    cur.push(node);
  }
  flush();
  return runs;
}

function blockAnchorNode(b) {
  return b.el || b.fragStart;
}

function sortBlocksByDocumentOrder(blocks) {
  blocks.sort((a, b) => {
    const na = blockAnchorNode(a);
    const nb = blockAnchorNode(b);
    if (na === nb) return 0;
    const pos = na.compareDocumentPosition(nb);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

function stripRubyAnnotations(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  for (const n of root.querySelectorAll('rt, rp')) n.remove();
}

function parseTocTitles(entries, opfDir, manifest, spineTocId) {
  const titleByPath = new Map();
  const navItem = manifest.find((m) => (m.properties || '').split(/\s+/).includes('nav'));
  if (navItem) {
    const navPath = resolvePath(opfDir, navItem.href);
    const u8 = entries[navPath];
    if (u8) {
      const doc = parseXml(decodeEntryText(u8), 'application/xhtml+xml');
      if (doc) {
        const navs = doc.getElementsByTagNameNS('*', 'nav');
        let tocNav = null;
        for (const nav of navs) {
          const t = nav.getAttributeNS('http://www.idpf.org/2007/ops', 'type')
            || nav.getAttribute('epub:type') || '';
          if (t.split(/\s+/).includes('toc')) { tocNav = nav; break; }
        }
        if (!tocNav && navs.length > 0) tocNav = navs[0];
        if (tocNav) {
          const navDir = dirOf(navPath);
          for (const a of tocNav.getElementsByTagNameNS('*', 'a')) {
            const href = a.getAttribute('href');
            const label = normalizeText(a.textContent);
            if (!href || !label) continue;
            const p = resolvePath(navDir, href);
            if (p && !titleByPath.has(p)) titleByPath.set(p, label);
          }
        }
      }
    }
  }
  if (titleByPath.size === 0 && spineTocId) {
    const ncxItem = manifest.find((m) => m.id === spineTocId);
    if (ncxItem) {
      const ncxPath = resolvePath(opfDir, ncxItem.href);
      const u8 = entries[ncxPath];
      if (u8) {
        const doc = parseXml(decodeEntryText(u8), 'application/xml');
        if (doc) {
          const ncxDir = dirOf(ncxPath);
          for (const np of doc.getElementsByTagNameNS('*', 'navPoint')) {
            const label = normalizeText(
              np.getElementsByTagNameNS('*', 'text')[0]?.textContent);
            const src = np.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src');
            if (!label || !src) continue;
            const p = resolvePath(ncxDir, src);
            if (p && !titleByPath.has(p)) titleByPath.set(p, label);
          }
        }
      }
    }
  }
  return titleByPath;
}

const MATTER_FILENAME_RE = /(?<![a-z])((?:front|back|book)?cover|titlepage|title-page|copyright|colophon|imprint|toc|nav|contents|tableofcontents|table-of-contents|dedication|halftitle|half-title)(?![a-z])/i;

function suggestSkipChapter(ch) {
  if (ch.linear === 'no') return true;
  if (ch.isNavDoc) return true;
  if (MATTER_FILENAME_RE.test(ch.href.split('/').pop() || '')) return true;
  if (ch.charCount < 200) return true;
  return false;
}

export async function parseEpub(file, onProgress = () => {}, opts = {}) {
  const SK = getSerializerSK();
  const { signal } = opts;
  const throwIfAborted = () => {
    if (signal?.aborted) throw new EpubParseError('aborted');
  };

  onProgress({ stage: 'unzip' });
  const buf = await file.arrayBuffer();
  throwIfAborted();
  let entries;
  try {
    entries = window.fflate.unzipSync(new Uint8Array(buf));
  } catch (err) {
    throw new EpubParseError('bad-zip', err && err.message);
  }

  checkDrm(entries);

  onProgress({ stage: 'opf' });
  const containerU8 = entries['META-INF/container.xml'];
  if (!containerU8) throw new EpubParseError('no-opf');
  const containerDoc = parseXml(decodeEntryText(containerU8), 'application/xml');
  const rootfile = containerDoc
    && containerDoc.getElementsByTagNameNS('*', 'rootfile')[0];
  const opfPath = rootfile && rootfile.getAttribute('full-path');
  if (!opfPath || !entries[opfPath]) throw new EpubParseError('no-opf');
  const opfText = decodeEntryText(entries[opfPath]);
  const opfDoc = parseXml(opfText, 'application/xml');
  if (!opfDoc) throw new EpubParseError('no-opf');
  const opfDir = dirOf(opfPath);

  const dc = (tag) => normalizeText(
    opfDoc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', tag)[0]?.textContent);
  const packageEl = opfDoc.documentElement;
  const meta = {
    filename: file.name,
    title: dc('title') || file.name.replace(/\.epub$/i, ''),
    author: dc('creator') || '',
    language: dc('language') || '',
    identifier: dc('identifier') || '',
    epubVersion: (packageEl && packageEl.getAttribute('version')) || '',
  };

  const manifest = [];
  for (const item of opfDoc.getElementsByTagNameNS('*', 'item')) {
    manifest.push({
      id: item.getAttribute('id'),
      href: item.getAttribute('href'),
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || '',
    });
  }
  const manifestById = new Map(manifest.map((m) => [m.id, m]));
  const spineEl = opfDoc.getElementsByTagNameNS('*', 'spine')[0];
  const spineTocId = spineEl ? spineEl.getAttribute('toc') : null;
  const spine = [];
  if (spineEl) {
    for (const ref of spineEl.getElementsByTagNameNS('*', 'itemref')) {
      spine.push({
        idref: ref.getAttribute('idref'),
        linear: (ref.getAttribute('linear') || 'yes').toLowerCase(),
      });
    }
  }

  const titleByPath = parseTocTitles(entries, opfDir, manifest, spineTocId);

  const chapters = [];
  let chapterIndex = 0;
  const xhtmlSpine = spine.filter((s) => {
    const m = manifestById.get(s.idref);
    return m && /xhtml|html/i.test(m.mediaType);
  });
  for (const s of xhtmlSpine) {
    throwIfAborted();
    const m = manifestById.get(s.idref);
    const path = resolvePath(opfDir, m.href);
    const u8 = entries[path];
    if (!u8) continue;
    onProgress({ stage: 'chapters', current: chapterIndex + 1, total: xhtmlSpine.length });

    const rawText = decodeEntryText(u8);
    const xhtmlDoc = parseXml(rawText, 'application/xhtml+xml');
    const isNavDoc = (m.properties || '').split(/\s+/).includes('nav');
    let blocks = [];
    let parseFailed = false;
    if (xhtmlDoc) {
      blocks = collectChapterBlocks(xhtmlDoc, chapterIndex, SK);
    } else {
      parseFailed = true;
    }
    const charCount = blocks.reduce((acc, b) => acc + b.plainText.length, 0);
    const ch = {
      index: chapterIndex,
      href: path,
      manifestId: m.id,
      linear: s.linear,
      isNavDoc,
      title: titleByPath.get(path) || '',
      xhtmlDoc,
      hadXmlDeclaration: /^\s*<\?xml/i.test(rawText),
      parseFailed,
      blocks,
      charCount,
      cjkRatio: cjkRatioOfBlocks(blocks),
      selected: true,
      suggestSkip: false,
    };
    ch.suggestSkip = suggestSkipChapter(ch);
    ch.selected = !ch.suggestSkip;
    if (!ch.title && xhtmlDoc) {
      const h = blocks.find((b) => b.type === 'heading');
      ch.title = (h && h.plainText.slice(0, 80)) || path.split('/').pop();
    } else if (!ch.title) {
      ch.title = path.split('/').pop();
    }
    chapters.push(ch);
    chapterIndex++;
    await new Promise((r) => setTimeout(r, 0));
  }

  if (chapters.length === 0) throw new EpubParseError('no-chapters');

  const totalChars = chapters.reduce((acc, c) => acc + c.charCount, 0);

  return {
    kind: 'epub',
    meta: { ...meta, pageCount: chapters.length, chapterCount: chapters.length },
    stats: { totalChars },
    zip: { entries },
    opf: { path: opfPath, dir: opfDir, text: opfText },
    chapters,
    pages: chapters.map((c) => ({ pageIndex: c.index, chapterIndex: c.index, blocks: c.blocks })),
  };
}

export const BOOK_GLOSSARY_ROUND_CHARS = 60_000;
export const BOOK_GLOSSARY_MAX_ROUNDS = 40;
export const BOOK_GLOSSARY_MAX_TERMS = 500;

export function buildBookGlossaryRounds(doc, roundChars = BOOK_GLOSSARY_ROUND_CHARS, maxRounds = BOOK_GLOSSARY_MAX_ROUNDS) {
  const rounds = [];
  let cur = [];
  let acc = 0;
  const flush = () => {
    if (cur.length > 0) rounds.push(cur.join('\n'));
    cur = [];
    acc = 0;
  };
  for (const ch of doc.chapters) {
    for (const b of ch.blocks) {
      const txt = (b.plainText || '').trim();
      if (!txt) continue;
      const piece = txt.length > roundChars ? txt.slice(0, roundChars) : txt;
      if (acc + piece.length > roundChars && cur.length > 0) {
        flush();
        if (rounds.length >= maxRounds) return rounds;
      }
      cur.push(piece);
      acc += piece.length + 1;
    }
  }
  flush();
  return rounds.slice(0, maxRounds);
}

export function mergeBookGlossaries(lists, cap = BOOK_GLOSSARY_MAX_TERMS) {
  const bySource = new Map();
  let conflicts = 0;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') continue;
      const source = e.source.trim();
      const target = e.target.trim();
      if (!source || !target) continue;
      const key = source.toLowerCase();
      const prev = bySource.get(key);
      if (!prev) {
        const entry = { source, target: normalizeNameSeparators(target) };
        if (typeof e.type === 'string' && e.type) entry.type = e.type;
        if (e.noTranslate === true) entry.noTranslate = true;
        if (e.dedupeAnnotation === true) {
          entry.dedupeAnnotation = true;
          entry.dedupeKeep = e.dedupeKeep === 'target' ? 'target' : 'source';
        }
        bySource.set(key, entry);
      } else if (prev.target !== target) {
        conflicts++;
      }
    }
  }
  const all = [...bySource.values()];
  return { entries: all.slice(0, cap), conflicts, dropped: Math.max(0, all.length - cap) };
}

const NAME_SEP_RE = /(?<=[\u3400-\u9fff\uf900-\ufaff])[\u00B7\u2027\uFF65](?=[\u3400-\u9fff\uf900-\ufaff])/g;
export function normalizeNameSeparators(s) {
  if (typeof s !== 'string' || s.length === 0) return s;
  return s.replace(NAME_SEP_RE, '\u30FB');
}

export function glossaryGroupOf(entry) {
  if (entry && entry.type === 'person') return 'person';
  if (entry && entry.type === 'place') return 'place';
  return 'other';
}

export function estimateChapterCostUSD(charCount, model, settings, cjkRatio = 0) {
  const pricing = getPricingForModel(model, settings);
  if (!pricing || !charCount) return null;
  const ratio = Number.isFinite(cjkRatio) ? Math.min(1, Math.max(0, cjkRatio)) : 0;
  const cjkChars = charCount * ratio;
  const latinChars = charCount - cjkChars;
  const batches = Math.max(1, Math.ceil(charCount / 4000));
  const inTok = latinChars / 4 + cjkChars / 1.5 + batches * 600;
  const outTok = latinChars * 0.5 + cjkChars * 1.2;
  return (inTok * pricing.inputPerMTok + outTok * pricing.outputPerMTok) / 1e6;
}

const CJK_CHAR_RE = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;
export function cjkRatioOfBlocks(blocks) {
  let total = 0;
  let cjk = 0;
  for (const b of blocks) {
    const t = (b && b.plainText) || '';
    total += t.length;
    cjk += (t.match(CJK_CHAR_RE) || []).length;
  }
  return total > 0 ? cjk / total : 0;
}
