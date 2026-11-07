import { collectChapterBlocks, getSerializerSK, EPUB_LIMITS, HAS_LETTER_RE, decodeEntryText } from './epub-engine.js';
import { resolveBlockFragment } from './block-output.js';
import { isPrecompressedMediaPath } from './epub-writer.js';

export class DocxParseError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'DocxParseError';
    this.code = code;
  }
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function detectDocxFile(file) {
  const name = (file && file.name) || '';
  if (/\.docx$/i.test(name)) return true;
  return ((file && file.type) || '') === DOCX_MIME;
}

export function preflightDocxFile(file) {
  if (file.size > EPUB_LIMITS.hardMaxBytes) {
    return { level: 'error', code: 'too-large' };
  }
  return { level: 'ok' };
}

export function isOleContainer(bytes) {
  return bytes.length >= 4
    && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
}

export function hasTrackedChanges(xml) {
  return /<w:(?:ins|del|moveFrom|moveTo)(?=[\s>])/.test(xml);
}

export function decodeXmlEntities(s) {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#x?[0-9A-Fa-f]+);/g, (m) => {
    switch (m) {
      case '&amp;': return '&';
      case '&lt;': return '<';
      case '&gt;': return '>';
      case '&quot;': return '"';
      case '&apos;': return "'";
      default: {
        const hex = /^&#x/i.test(m);
        const code = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
    }
  });
}

export function escapeXmlText(s) {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

export function escapeXmlAttr(s) {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'));
}

export function scanLeafParagraphSpans(xml) {
  const spans = [];
  const re = /<w:p(?=[\s>/])|<\/w:p>/g;
  const stack = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[0] === '</w:p>') {
      const top = stack.pop();
      if (!top) continue;
      if (!top.hasChildP) {
        spans.push({ start: top.start, end: m.index + 6   });
      }
      continue;
    }
    const gt = xml.indexOf('>', m.index);
    if (gt === -1) break;
    if (xml.charCodeAt(gt - 1) === 47  ) continue;
    for (const s of stack) s.hasChildP = true;
    stack.push({ start: m.index, hasChildP: false });
    re.lastIndex = gt + 1;
  }
  return spans;
}

export function findElementEnd(xml, openIdx, tagName) {
  const gt = xml.indexOf('>', openIdx);
  if (gt === -1) return { end: xml.length, selfClosing: true };
  if (xml.charCodeAt(gt - 1) === 47) return { end: gt + 1, selfClosing: true };
  const re = new RegExp('<' + tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s>/])|</' + tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '>', 'g');
  re.lastIndex = gt + 1;
  let depth = 1;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[0].charCodeAt(1) === 47  ) {
      depth--;
      if (depth === 0) return { end: m.index + m[0].length, selfClosing: false };
    } else {
      const g = xml.indexOf('>', m.index);
      if (g === -1) break;
      if (xml.charCodeAt(g - 1) !== 47) depth++;
      re.lastIndex = g + 1;
    }
  }
  return { end: xml.length, selfClosing: false };
}

function tagNameAt(xml, idx) {
  const m = /^<([A-Za-z0-9_:.-]+)/.exec(xml.slice(idx, idx + 64));
  return m ? m[1] : null;
}

const MARKER_TAGS = new Set([
  'w:bookmarkStart', 'w:bookmarkEnd',
  'w:commentRangeStart', 'w:commentRangeEnd',
  'w:permStart', 'w:permEnd',
]);
const DROP_TAGS = new Set(['w:proofErr']);

export function tokenizeParagraph(spanXml) {
  const openGt = spanXml.indexOf('>');
  const openTag = spanXml.slice(0, openGt + 1);
  const bodyEnd = spanXml.length - 6;
  const items = [];
  const leadMarkers = [];
  const tailMarkers = [];
  let pPrXml = '';
  let sawText = false;
  let fieldDepth = 0;
  let fieldBuf = '';

  let i = openGt + 1;
  while (i < bodyEnd) {
    const lt = spanXml.indexOf('<', i);
    if (lt === -1 || lt >= bodyEnd) break;
    if (spanXml.charCodeAt(lt + 1) === 47  ) {
      if (spanXml.startsWith('</w:hyperlink>', lt)) {
        items.push({ k: 'linkEnd' });
        i = lt + '</w:hyperlink>'.length;
      } else {
        i = spanXml.indexOf('>', lt) + 1;
      }
      continue;
    }
    const tag = tagNameAt(spanXml, lt);
    if (!tag) { i = lt + 1; continue; }

    if (tag === 'w:pPr') {
      const { end } = findElementEnd(spanXml, lt, tag);
      pPrXml = spanXml.slice(lt, end);
      i = end;
      continue;
    }
    if (DROP_TAGS.has(tag)) {
      const { end } = findElementEnd(spanXml, lt, tag);
      i = end;
      continue;
    }
    if (MARKER_TAGS.has(tag)) {
      const { end } = findElementEnd(spanXml, lt, tag);
      (sawText ? tailMarkers : leadMarkers).push(spanXml.slice(lt, end));
      i = end;
      continue;
    }
    if (tag === 'w:hyperlink') {
      if (fieldDepth > 0) {
        const { end } = findElementEnd(spanXml, lt, tag);
        fieldBuf += spanXml.slice(lt, end);
        i = end;
        continue;
      }
      const gt = spanXml.indexOf('>', lt);
      const attrs = spanXml.slice(lt, gt + 1);
      const rid = /r:id="([^"]*)"/.exec(attrs)?.[1] || '';
      const anchor = /w:anchor="([^"]*)"/.exec(attrs)?.[1] || '';
      if (spanXml.charCodeAt(gt - 1) === 47) { i = gt + 1; continue; }
      const attrsXml = attrs.slice('<w:hyperlink'.length, -1).trim();
      items.push({ k: 'linkStart', rid, anchor, attrsXml });
      i = gt + 1;
      continue;
    }
    if (tag === 'w:r') {
      const { end } = findElementEnd(spanXml, lt, tag);
      const runXml = spanXml.slice(lt, end);
      const parsed = parseRun(runXml);
      if (fieldDepth > 0 || parsed.fldBegin > 0) {
        fieldDepth += parsed.fldBegin - parsed.fldEnd;
        fieldBuf += runXml;
        if (fieldDepth <= 0) {
          items.push({ k: 'island', xml: fieldBuf });
          fieldBuf = '';
          fieldDepth = 0;
        }
        i = end;
        continue;
      }
      for (const it of parsed.items) {
        if (it.k === 'text') sawText = true;
        items.push(it);
      }
      i = end;
      continue;
    }
    {
      const { end } = findElementEnd(spanXml, lt, tag);
      const xml = spanXml.slice(lt, end);
      if (fieldDepth > 0) fieldBuf += xml;
      else items.push({ k: 'island', xml });
      i = end;
    }
  }
  if (fieldBuf) items.push({ k: 'island', xml: fieldBuf });
  return { openTag, pPrXml, items, leadMarkers, tailMarkers };
}

function parseRun(runXml) {
  const items = [];
  let fldBegin = 0;
  let fldEnd = 0;
  const openGt = runXml.indexOf('>');
  let rpr = '';
  let i = openGt + 1;
  const bodyEnd = runXml.length - 6;
  while (i < bodyEnd) {
    const lt = runXml.indexOf('<', i);
    if (lt === -1 || lt >= bodyEnd) break;
    const tag = tagNameAt(runXml, lt);
    if (!tag) { i = lt + 1; continue; }
    if (runXml.charCodeAt(lt + 1) === 47) { i = runXml.indexOf('>', lt) + 1; continue; }
    const { end, selfClosing } = findElementEnd(runXml, lt, tag);
    const frag = runXml.slice(lt, end);
    if (tag === 'w:rPr') {
      rpr = frag;
    } else if (tag === 'w:t') {
      const inner = selfClosing ? '' : frag.slice(frag.indexOf('>') + 1, frag.lastIndexOf('<'));
      items.push({ k: 'text', text: decodeXmlEntities(inner), rpr: '' });
    } else if (tag === 'w:br' || tag === 'w:cr') {
      const hasAttrs = /<w:(?:br|cr)\s+[^>]*[^\s>]/.test(frag);
      if (tag === 'w:br' && hasAttrs) items.push({ k: 'island', xml: null, item: frag, rpr: '' });
      else items.push({ k: 'br', rpr: '' });
    } else if (tag === 'w:fldChar') {
      const type = /w:fldCharType="([^"]*)"/.exec(frag)?.[1];
      if (type === 'begin') fldBegin++;
      else if (type === 'end') fldEnd++;
    } else if (tag === 'w:instrText' || tag === 'w:delText' || tag === 'w:delInstrText') {
    } else if (tag === 'w:lastRenderedPageBreak') {
    } else {
      items.push({ k: 'island', xml: null, item: frag, rpr: '' });
    }
    i = end;
  }
  for (const it of items) {
    if (it.k === 'island' && it.item != null) {
      it.xml = '<w:r>' + rpr + it.item + '</w:r>';
      delete it.item;
    } else if (it.k === 'text' || it.k === 'br') {
      it.rpr = rpr;
    }
  }
  return { items, fldBegin, fldEnd };
}

export function mergeRunItems(items) {
  const out = [];
  for (const it of items) {
    if (it.k === 'text' || it.k === 'br') {
      const last = out[out.length - 1];
      if (last && last.k === 'group' && last.rpr === it.rpr) {
        last.parts.push(it.k === 'text' ? { t: 'text', text: it.text } : { t: 'br' });
      } else {
        out.push({ k: 'group', rpr: it.rpr, parts: [it.k === 'text' ? { t: 'text', text: it.text } : { t: 'br' }] });
      }
    } else {
      out.push(it);
    }
  }
  return out;
}

const offRe = (tag) => new RegExp('<w:' + tag + '\\s[^>]*w:val="(?:false|0|none)"');
function rprFlag(rpr, tag) {
  const re = new RegExp('<w:' + tag + '(?=[\\s/>])');
  if (!re.test(rpr)) return false;
  return !offRe(tag).test(rpr);
}
export function rprSemantics(rpr) {
  const vert = /<w:vertAlign\s[^>]*w:val="(superscript|subscript)"/.exec(rpr)?.[1];
  return {
    b: rprFlag(rpr, 'b'),
    i: rprFlag(rpr, 'i'),
    u: rprFlag(rpr, 'u'),
    s: rprFlag(rpr, 'strike'),
    sup: vert === 'superscript',
    sub: vert === 'subscript',
  };
}

export function dominantRpr(groups) {
  const weight = new Map();
  for (const g of groups) {
    if (g.k !== 'group') continue;
    let len = 0;
    for (const p of g.parts) if (p.t === 'text') len += p.text.length;
    weight.set(g.rpr, (weight.get(g.rpr) || 0) + len);
  }
  let best = '';
  let bestW = -1;
  for (const [rpr, w] of weight) {
    if (w > bestW) { best = rpr; bestW = w; }
  }
  return best;
}

export function headingLevel(pPrXml) {
  const style = /<w:pStyle\s[^>]*w:val="([^"]*)"/.exec(pPrXml)?.[1] || '';
  const m = /heading\s*([1-6])/i.exec(style) || /^berschrift([1-6])$/i.exec(style);
  if (m) return parseInt(m[1], 10);
  const lvl = /<w:outlineLvl\s[^>]*w:val="([0-5])"/.exec(pPrXml)?.[1];
  if (lvl != null) return parseInt(lvl, 10) + 1;
  return 0;
}

export function composeTranslatedParagraph(para, runsXml) {
  return para.openTag + para.pPrXml + para.leadMarkers.join('')
    + runsXml + para.tailMarkers.join('') + '</w:p>';
}

export function stripNumPr(pPrXml) {
  return stripPPrChildren(pPrXml, ['w:numPr']);
}

const DUAL_PPR_STRIP_TAGS = ['w:numPr', 'w:sectPr', 'w:framePr'];

export function stripPPrChildren(pPrXml, tags) {
  if (!pPrXml) return pPrXml;
  let out = pPrXml;
  for (const tag of tags) {
    let idx = out.indexOf('<' + tag);
    while (idx !== -1) {
      const after = out.charCodeAt(idx + tag.length + 1);
      if (after === 62   || after === 32   || after === 47  ) {
        const { end } = findElementEnd(out, idx, tag);
        out = out.slice(0, idx) + out.slice(end);
        idx = out.indexOf('<' + tag, idx);
      } else {
        idx = out.indexOf('<' + tag, idx + 1);
      }
    }
  }
  return out;
}

export function composeDualParagraph(para, runsXml) {
  return '<w:p>' + stripPPrChildren(para.pPrXml, DUAL_PPR_STRIP_TAGS) + runsXml + '</w:p>';
}

export function buildTextRun(text, rpr) {
  return '<w:r>' + (rpr || '') + '<w:t xml:space="preserve">' + escapeXmlText(text) + '</w:t></w:r>';
}

export function buildBrRun(rpr) {
  return '<w:r>' + (rpr || '') + '<w:br/></w:r>';
}

export function spliceEdits(xml, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const e of sorted) {
    parts.push(xml.slice(cursor, e.start), e.replacement);
    cursor = e.end;
  }
  parts.push(xml.slice(cursor));
  return parts.join('');
}

export function parseRels(relsXml) {
  const map = new Map();
  if (!relsXml) return map;
  const re = /<Relationship\s+[^>]*\/?>/g;
  let m;
  while ((m = re.exec(relsXml)) !== null) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1];
    if (id && target) map.set(id, decodeXmlEntities(target));
  }
  return map;
}

let _docxPolicyApplied = false;
function applyDocxSerializerPolicy(SK) {
  if (_docxPolicyApplied) return;
  _docxPolicyApplied = true;
  const origAtomic = SK.isAtomicPreserve;
  SK.isAtomicPreserve = function docxIsAtomicPreserve(el) {
    if (el.getAttribute && el.getAttribute('data-sk-docx-island') != null) return true;
    return origAtomic(el);
  };
  const origPreservable = SK.isPreservableInline;
  SK.isPreservableInline = function docxIsPreservableInline(el) {
    if (el && el.getAttribute && el.getAttribute('data-sk-rpr') != null) {
      return /\S/.test(el.textContent || '');
    }
    return origPreservable(el);
  };
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}

export async function parseDocxFile(file, onProgress = () => {}, opts = {}) {
  const SK = getSerializerSK();
  applyDocxSerializerPolicy(SK);
  const { signal } = opts;
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DocxParseError('aborted');
  };

  onProgress({ stage: 'unzip' });
  const buf = await file.arrayBuffer();
  throwIfAborted();
  const bytes = new Uint8Array(buf);
  if (isOleContainer(bytes)) throw new DocxParseError('encrypted');
  let entries;
  try {
    entries = window.fflate.unzipSync(bytes);
  } catch (err) {
    throw new DocxParseError('bad-zip', err && err.message);
  }
  if (!entries['word/document.xml']) throw new DocxParseError('no-document');

  const readPart = (path) => (entries[path] ? decodeEntryText(entries[path]) : null);

  const partPaths = ['word/document.xml'];
  const names = Object.keys(entries);
  const headersFooters = names
    .filter((n) => /^word\/(?:header|footer)\d*\.xml$/.test(n))
    .sort(naturalSort);
  const notes = ['word/footnotes.xml', 'word/endnotes.xml'].filter((n) => entries[n]);
  const comments = entries['word/comments.xml'] ? ['word/comments.xml'] : [];

  const partsXml = new Map();
  for (const p of [...partPaths, ...headersFooters, ...notes, ...comments]) {
    const xml = readPart(p);
    if (xml != null) partsXml.set(p, xml);
  }

  for (const xml of partsXml.values()) {
    if (hasTrackedChanges(xml)) throw new DocxParseError('track-changes');
  }

  const relsFor = (path) => {
    const dir = path.slice(0, path.lastIndexOf('/'));
    const base = path.slice(path.lastIndexOf('/') + 1);
    return parseRels(readPart(`${dir}/_rels/${base}.rels`) || '');
  };

  const core = readPart('docProps/core.xml') || '';
  const coreTag = (tag) => {
    const m = new RegExp('<' + tag + '(?:\\s[^>]*)?>([^<]*)</' + tag + '>').exec(core);
    return m ? decodeXmlEntities(m[1]).trim() : '';
  };

  onProgress({ stage: 'paragraphs' });

  const paras = [];
  const htmlDocFor = () => document.implementation.createHTMLDocument('docx');

  const partKindOf = (path) => (
    path === 'word/document.xml' ? 'body'
      : /^word\/(?:header|footer)/.test(path) ? 'headers'
        : /^word\/(?:footnotes|endnotes)\.xml$/.test(path) ? 'notes' : 'comments');

  const separatorRanges = (xml) => {
    const ranges = [];
    const re = /<w:(?:footnote|endnote)\s[^>]*w:type="(?:separator|continuationSeparator|continuationNotice)"[^>]*>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const tag = m[0].startsWith('<w:footnote') ? 'w:footnote' : 'w:endnote';
      const { end } = findElementEnd(xml, m.index, tag);
      ranges.push([m.index, end]);
    }
    return ranges;
  };

  const crossParaFieldRanges = (xml) => {
    const re = /<w:fldChar\s[^>]*w:fldCharType="(begin|end)"/g;
    const ranges = [];
    const stack = [];
    let m;
    while ((m = re.exec(xml)) !== null) {
      if (m[1] === 'begin') stack.push(m.index);
      else if (stack.length) {
        const start = stack.pop();
        if (stack.length === 0) ranges.push([start, m.index]);
      }
    }
    return ranges;
  };

  const htmlPerPart = new Map();

  for (const [path, xml] of partsXml) {
    throwIfAborted();
    const rels = relsFor(path);
    const skipRanges = partKindOf(path) === 'notes' ? separatorRanges(xml) : [];
    const fieldRanges = crossParaFieldRanges(xml);
    const spans = scanLeafParagraphSpans(xml);
    const htmlDoc = htmlDocFor();
    const paraEls = [];
    for (const span of spans) {
      if (skipRanges.some(([a, b]) => span.start >= a && span.end <= b)) continue;
      if (fieldRanges.some(([a, b]) => span.start > a && span.start < b)) continue;
      const spanXml = xml.slice(span.start, span.end);
      const tok = tokenizeParagraph(spanXml);
      const groups = mergeRunItems(tok.items);
      const para = {
        part: path,
        start: span.start,
        end: span.end,
        openTag: tok.openTag,
        pPrXml: tok.pPrXml,
        leadMarkers: tok.leadMarkers,
        tailMarkers: tok.tailMarkers,
        defaultRpr: dominantRpr(groups),
        rprs: [],
        islands: [],
        block: null,
      };
      const el = buildParagraphHtml(htmlDoc, para, groups, rels, paraEls.length);
      if (el) {
        paraEls.push({ para, el });
        htmlDoc.body.appendChild(el);
      }
      paras.push(para);
    }
    htmlPerPart.set(path, { htmlDoc, paraEls });
  }

  onProgress({ stage: 'blocks' });

  const chapters = [];
  const newChapter = (title, partKind) => {
    const ch = {
      index: chapters.length,
      href: partKind,
      linear: 'yes',
      isNavDoc: false,
      title,
      parseFailed: false,
      blocks: [],
      charCount: 0,
      selected: true,
      suggestSkip: false,
    };
    chapters.push(ch);
    return ch;
  };

  const filenameBase = (file.name || 'document').replace(/\.docx$/i, '');
  const partKindOrder = ['body', 'headers', 'notes', 'comments'];
  const extraChapterTitle = {
    headers: opts.chapterTitles?.headers || 'Headers & footers',
    notes: opts.chapterTitles?.notes || 'Footnotes & endnotes',
    comments: opts.chapterTitles?.comments || 'Comments',
  };

  for (const kindKey of partKindOrder) {
    let cur = null;
    for (const [path, { htmlDoc, paraEls }] of htmlPerPart) {
      if (partKindOf(path) !== kindKey) continue;
      const blocks = collectChapterBlocks(htmlDoc, chapters.length, SK);
      const byIdx = new Map(paraEls.map((pe, n) => [String(n), pe]));
      for (const b of blocks) {
        if (!b.el) continue;
        const pe = byIdx.get(b.el.getAttribute('data-sk-docx-para'));
        if (!pe) continue;
        pe.para.block = b;
        b.docxPara = pe.para;
        if (kindKey === 'body') {
          const lvl = headingLevel(pe.para.pPrXml);
          if (lvl >= 1 && lvl <= 2) {
            cur = newChapter(b.plainText.slice(0, 80), 'body');
          }
        }
        if (!cur) {
          cur = newChapter(
            kindKey === 'body' ? filenameBase : extraChapterTitle[kindKey], kindKey);
        }
        b.blockId = `c${cur.index}-b${cur.blocks.length}`;
        cur.blocks.push(b);
        cur.charCount += b.plainText.length;
      }
    }
  }

  const nonEmpty = chapters.filter((c) => c.blocks.length > 0);
  nonEmpty.forEach((c, i) => {
    c.index = i;
    c.blocks.forEach((b, n) => { b.blockId = `c${i}-b${n}`; });
  });
  if (nonEmpty.length === 0) throw new DocxParseError('empty');

  const totalChars = nonEmpty.reduce((acc, c) => acc + c.charCount, 0);
  return {
    kind: 'docx',
    meta: {
      filename: file.name,
      title: coreTag('dc:title') || filenameBase,
      author: coreTag('dc:creator') || '',
      language: coreTag('dc:language') || '',
      identifier: '',
      epubVersion: '',
      pageCount: nonEmpty.length,
      chapterCount: nonEmpty.length,
    },
    stats: { totalChars },
    chapters: nonEmpty,
    pages: nonEmpty.map((c) => ({ pageIndex: c.index, chapterIndex: c.index, blocks: c.blocks })),
    docxEntries: entries,
    docxPartsXml: partsXml,
    docxParas: paras,
  };
}

function buildParagraphHtml(htmlDoc, para, groups, rels, paraIdx) {
  let hasLetter = false;
  for (const g of groups) {
    if (g.k !== 'group') continue;
    for (const p of g.parts) {
      if (p.t === 'text' && HAS_LETTER_RE.test(p.text)) { hasLetter = true; break; }
    }
    if (hasLetter) break;
  }
  if (!hasLetter) return null;

  const lvl = headingLevel(para.pPrXml);
  const el = htmlDoc.createElement(lvl >= 1 && lvl <= 6 ? `h${lvl}` : 'p');

  const rprIdx = (rpr) => {
    let idx = para.rprs.indexOf(rpr);
    if (idx === -1) { para.rprs.push(rpr); idx = para.rprs.length - 1; }
    return idx;
  };

  let container = el;
  for (const g of groups) {
    if (g.k === 'linkStart') {
      const a = htmlDoc.createElement('a');
      if (g.rid) a.setAttribute('data-sk-rid', g.rid);
      if (g.anchor) a.setAttribute('data-sk-anchor', g.anchor);
      if (g.attrsXml) a.setAttribute('data-sk-link-attrs', g.attrsXml);
      const url = g.rid && rels.get(g.rid);
      a.setAttribute('href', url || (g.anchor ? '#' + g.anchor : '#'));
      el.appendChild(a);
      container = a;
      continue;
    }
    if (g.k === 'linkEnd') {
      container = el;
      continue;
    }
    if (g.k === 'island') {
      const span = htmlDoc.createElement('span');
      span.className = 'sk-docx-island';
      para.islands.push(g.xml);
      span.setAttribute('data-sk-docx-island', String(para.islands.length - 1));
      container.appendChild(span);
      continue;
    }
    let target = container;
    if (g.rpr !== para.defaultRpr) {
      const sem = rprSemantics(g.rpr);
      const chain = [];
      if (sem.b) chain.push('b');
      if (sem.i) chain.push('i');
      if (sem.u) chain.push('u');
      if (sem.s) chain.push('s');
      if (sem.sup) chain.push('sup');
      else if (sem.sub) chain.push('sub');
      if (chain.length === 0) chain.push('span');
      let outer = null;
      let inner = null;
      for (const tag of chain) {
        const e = htmlDoc.createElement(tag);
        if (tag === 'span') e.className = 'sk-docx-run';
        if (!outer) outer = e;
        else inner.appendChild(e);
        inner = e;
      }
      outer.setAttribute('data-sk-rpr', String(rprIdx(g.rpr)));
      container.appendChild(outer);
      target = inner;
    }
    for (const p of g.parts) {
      if (p.t === 'text') target.appendChild(htmlDoc.createTextNode(p.text));
      else target.appendChild(htmlDoc.createElement('br'));
    }
  }
  el.setAttribute('data-sk-docx-para', String(typeof paraIdx === 'number' ? paraIdx : countParaEls(htmlDoc)));
  return el;
}

function countParaEls(htmlDoc) {
  return htmlDoc.body.querySelectorAll('[data-sk-docx-para]').length;
}

export function buildTranslatedDocx(doc, targetLanguage, { bilingual = false, dedupe = null } = {}) {
  const SK = getSerializerSK();
  const editsByPart = new Map();
  for (const para of doc.docxParas) {
    const b = para.block;
    if (!b || b.translationStatus !== 'done') continue;
    const frag = fragmentForBlock(SK, b, dedupe ? dedupe.get(b.blockId) : null);
    if (!frag) continue;
    const isBody = para.part === 'word/document.xml';
    const isDual = bilingual && isBody;
    const runsXml = buildRunsFromFragment(frag, para, { stripNoteAnchors: isDual });
    if (runsXml == null) continue;
    const replacement = isDual
      ? doc.docxPartsXml.get(para.part).slice(para.start, para.end) + composeDualParagraph(para, runsXml)
      : composeTranslatedParagraph(para, runsXml);
    if (!editsByPart.has(para.part)) editsByPart.set(para.part, []);
    editsByPart.get(para.part).push({ start: para.start, end: para.end, replacement });
  }

  const outEntries = {};
  for (const [path, u8] of Object.entries(doc.docxEntries)) outEntries[path] = isPrecompressedMediaPath(path) ? [u8, { level: 0 }] : u8;
  for (const [path, edits] of editsByPart) {
    const xml = doc.docxPartsXml.get(path);
    outEntries[path] = window.fflate.strToU8(spliceEdits(xml, edits));
  }
  const bytes = window.fflate.zipSync(outEntries, { level: 6 });
  return { bytes };
}

function fragmentForBlock(SK, b, override) {
  return resolveBlockFragment(SK, b, override)?.frag ?? null;
}

const NOTE_ANCHOR_RE = /<w:(?:footnoteReference|endnoteReference|commentReference)(?=[\s/>])/;

export function buildRunsFromFragment(frag, para, opts = {}) {
  const out = [];
  const walk = (node, rpr, linkDepth) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3  ) {
        const pieces = String(child.nodeValue).split('\n');
        pieces.forEach((piece, i) => {
          if (i > 0) out.push(buildBrRun(rpr));
          if (piece) out.push(buildTextRun(piece, rpr));
        });
        continue;
      }
      if (child.nodeType !== 1  ) continue;
      const tag = child.tagName;
      if (tag === 'BR') {
        out.push(buildBrRun(rpr));
        continue;
      }
      const islandIdx = child.getAttribute && child.getAttribute('data-sk-docx-island');
      if (islandIdx != null) {
        const xml = para.islands[parseInt(islandIdx, 10)];
        if (xml && !(opts.stripNoteAnchors && NOTE_ANCHOR_RE.test(xml))) out.push(xml);
        continue;
      }
      const rid = child.getAttribute && child.getAttribute('data-sk-rid');
      const anchor = child.getAttribute && child.getAttribute('data-sk-anchor');
      if (tag === 'A' && (rid || anchor) && linkDepth === 0) {
        const attrsXml = child.getAttribute('data-sk-link-attrs');
        const fallbackAttrs = (rid ? ' r:id="' + escapeXmlAttr(rid) + '"' : '')
          + (anchor ? ' w:anchor="' + escapeXmlAttr(anchor) + '"' : '');
        out.push('<w:hyperlink' + (attrsXml ? ' ' + attrsXml : fallbackAttrs) + '>');
        walk(child, childRpr(child, rpr, para), 1);
        out.push('</w:hyperlink>');
        continue;
      }
      walk(child, childRpr(child, rpr, para), linkDepth);
    }
  };
  walk(frag, para.defaultRpr, 0);
  return out.join('');
}

function childRpr(el, inherited, para) {
  const idx = el.getAttribute && el.getAttribute('data-sk-rpr');
  if (idx == null) return inherited;
  const rpr = para.rprs[parseInt(idx, 10)];
  return rpr != null ? rpr : inherited;
}

export function translatedDocxFilename(originalName, { bilingual = false } = {}) {
  const base = (originalName || 'document').replace(/\.docx$/i, '');
  return `${base}-transit${bilingual ? '-dual' : ''}.docx`;
}

export { DOCX_MIME };
