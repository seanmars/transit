import { collectChapterBlocks, getSerializerSK, EPUB_LIMITS, HAS_LETTER_RE } from './epub-engine.js';
import { pickBlockOutput, editedHtmlToPlain } from './block-output.js';

export class DocFileParseError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'DocFileParseError';
    this.code = code;
  }
}

export function detectDocFileKind(file) {
  const name = (file && file.name) || '';
  if (/\.txt$/i.test(name)) return 'txt';
  if (/\.(md|markdown)$/i.test(name)) return 'md';
  if (/\.html?$/i.test(name)) return 'html';
  const type = (file && file.type) || '';
  if (type === 'text/plain') return 'txt';
  if (type === 'text/markdown') return 'md';
  if (type === 'text/html') return 'html';
  return null;
}

export function preflightDocFile(file) {
  if (file.size > EPUB_LIMITS.hardMaxBytes) {
    return { level: 'error', code: 'too-large' };
  }
  return { level: 'ok' };
}

export { HAS_LETTER_RE };

const BLOCK_MAX_CHARS = 2000;

export function normalizeEol(rawText) {
  const hadCrLf = /\r\n/.test(rawText);
  return { text: rawText.replace(/\r\n?/g, '\n'), hadCrLf };
}

export function stripBom(rawText) {
  const hadBom = rawText.charCodeAt(0) === 0xFEFF;
  return { text: hadBom ? rawText.slice(1) : rawText, hadBom };
}

const COMMON_HANZI = new Set(('的一是不了在人有我他這这個个們们中來来上大為为和國国地到以說说時时要就出會会可也你對对生能而子那得於于著着下自之年過过發发後后作裡里用道行所然家種种事成方多經经麼么去法學学如都同現现當当沒没動动面起看定天分還还進进好小部其些主樣样理心她本前開开但因只從从想實实日軍军者意無无力它與与長长把機机十民第公此已工使情明性知全三又關关點点正業业外將将兩两高間间由問问很最重並并物手應应戰战向頭头文體体政美相見见被利什二等產产或新己制身果加西斯月話话合回特代內内信表化老給给世位次度門门任常先海通教兒儿原東东聲声提立及比員员解水名真論论處处走義义各入幾几口認认條条平系氣气題题活爾尔更別别打女變变四神總总何電电數数安少報报才結结反受目太量再感建務务做接必場场件計计管期市直德資资命山金指克許许統统區区保至隊队形社便空決决治展馬马科司五基眼書书非則则聽听白卻却界達达光放強强即像難难且權权思王象完設设式色路記记南品住告類类求據据程北邊边死張张該该交規规萬万取拉格望覺觉術术領领共確确傳传師师觀观清今切院讓让識识候帶带導导爭争運运笑飛飞風风步改收根幹干造言聯联持組组每濟济車车親亲極极林服快辦办議议往元英士證证近失轉转夫令準准布始怎呢存未遠远叫台單单影具羅罗字愛爱擊击流備备兵連连調调深商算質质團团集百需價价花黨党華华城石級级整府離离況况亞亚請请技際际約约示復复病息究線线似官火斷断精滿满支視视消越器容照須须九增研寫写稱称企八功嗎吗包片史委乎查輕轻易早曾除農农找裝装廣广顯显吧阿李標标談谈吃圖图念六引歷历首醫医局突專专費费號号盡尽另周較较注語语僅仅考落青隨随選选奇嚴严江省板半友陽阳獎奖雲云輪轮啊哦喔嘿唉哪誰谁').split(''));
const COMMON_HANGUL = new Set('이다는을를에의가하고한지로도기서나것게니사아그수어있자으시리인대정보들주해요면상없않만우전소내적마라경생되와실학국제일부오무세처장신문'.split(''));
const LETTER_ANY_RE = /\p{L}/gu;
const count = (s, re) => (s.match(re) || []).length;
const ratioIn = (s, re, set) => {
  const chars = s.match(re) || [];
  if (chars.length === 0) return 0;
  let hit = 0;
  for (const c of chars) if (set.has(c)) hit++;
  return hit / chars.length;
};
const LEGACY_CANDIDATES = [
  { enc: 'big5', script: /[一-鿿]/g, plausible: (s) => ratioIn(s, /[一-鿿]/g, COMMON_HANZI) >= 0.2 },
  { enc: 'gbk', script: /[一-鿿]/g, plausible: (s) => ratioIn(s, /[一-鿿]/g, COMMON_HANZI) >= 0.2 },
  { enc: 'shift_jis', script: /[぀-ヿ一-鿿]/g, plausible: (s) => count(s, /[぀-ヿ]/g) / Math.max(1, count(s, /[぀-ヿ一-鿿]/g)) >= 0.2 },
  { enc: 'euc-kr', script: /[가-힯]/g, plausible: (s) => ratioIn(s, /[가-힯]/g, COMMON_HANGUL) >= 0.15 },
];

function orderLegacyCandidates(targetLanguage) {
  const l = String(targetLanguage || '').toLowerCase();
  const pref = (l === 'zh-cn' || l === 'zh-sg' || l === 'zh-hans') ? 'gbk'
    : l.startsWith('zh') ? 'big5'
      : l.startsWith('ja') ? 'shift_jis'
        : l.startsWith('ko') ? 'euc-kr' : null;
  if (!pref) return LEGACY_CANDIDATES;
  return [...LEGACY_CANDIDATES.filter((c) => c.enc === pref), ...LEGACY_CANDIDATES.filter((c) => c.enc !== pref)];
}

export function decodeTextBytes(buf, { targetLanguage } = {}) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return { text: new TextDecoder('utf-16le', { ignoreBOM: true }).decode(bytes), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return { text: new TextDecoder('utf-16be', { ignoreBOM: true }).decode(bytes), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), encoding: 'utf-8' };
  } catch (_) {   }
  for (const cand of orderLegacyCandidates(targetLanguage)) {
    let text;
    try {
      text = new TextDecoder(cand.enc, { fatal: true }).decode(bytes);
    } catch (_) {
      continue;
    }
    const letters = count(text, LETTER_ANY_RE);
    if (letters === 0) continue;
    if (count(text, cand.script) / letters < 0.3) continue;
    if (!cand.plausible(text)) continue;
    return { text, encoding: cand.enc };
  }
  return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
}

export async function decodeTextFile(file, opts = {}) {
  if (typeof file.arrayBuffer !== 'function') return file.text();
  return decodeTextBytes(await file.arrayBuffer(), opts).text;
}

export function parseTxtStructure(text) {
  const segments = [];
  let cursor = 0;
  const paraRe = /[^\n]*\S[^\n]*(?:\n[^\n]*\S[^\n]*)*/g;
  let m;
  while ((m = paraRe.exec(text)) !== null) {
    if (m.index > cursor) segments.push({ verbatim: text.slice(cursor, m.index) });
    pushParagraphSegments(segments, m[0], '', '');
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) segments.push({ verbatim: text.slice(cursor) });
  return { segments };
}

function pushParagraphSegments(segments, para, prefix, linePrefix) {
  if (!HAS_LETTER_RE.test(para)) {
    segments.push({ verbatim: para });
    return;
  }
  for (const piece of splitOversized(para)) {
    if (piece.gap) segments.push({ verbatim: piece.text });
    else {
      segments.push({
        block: { text: piece.text, type: 'paragraph' },
        src: piece.text,
        prefix,
        linePrefix,
      });
    }
  }
}

function splitOversized(para) {
  if (para.length <= BLOCK_MAX_CHARS) return [{ text: para }];
  const out = [];
  const lines = para.split('\n');
  let cur = [];
  let curLen = 0;
  const flush = () => {
    if (cur.length === 0) return;
    out.push({ text: cur.join('\n') });
    cur = [];
    curLen = 0;
  };
  const gapIfNeeded = () => {
    if (out.length > 0) out.push({ text: '\n', gap: true });
  };
  for (const line of lines) {
    if (line.length > BLOCK_MAX_CHARS) {
      flush();
      gapIfNeeded();
      pushSentenceChunks(out, line);
      continue;
    }
    if (curLen + line.length + 1 > BLOCK_MAX_CHARS) flush();
    if (cur.length === 0) gapIfNeeded();
    cur.push(line);
    curLen += line.length + 1;
  }
  flush();
  return out;
}

function pushSentenceChunks(out, line) {
  const sentRe = /[^]*?[.!?。！？…‥](?=\s|$)|[^]+$/g;
  let cur = '';
  let m;
  const flush = () => {
    if (!cur) return;
    out.push({ text: cur });
    cur = '';
  };
  while ((m = sentRe.exec(line)) !== null) {
    const piece = m[0];
    if (cur && cur.length + piece.length > BLOCK_MAX_CHARS) flush();
    cur += piece;
    if (cur.length >= BLOCK_MAX_CHARS) flush();
  }
  flush();
}

export function parseMdStructure(text) {
  const segments = [];
  const chapterBreaks = [];
  const lines = text.split('\n');
  const offsets = new Array(lines.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < lines.length; i++) offsets[i + 1] = offsets[i] + lines[i].length + 1;
  const clamp = (o) => Math.min(text.length, o);
  const lineSpan = (a, b) => text.slice(offsets[a], clamp(offsets[b] - 1));

  let verbCursor = 0;
  const flushVerbatimTo = (offset) => {
    const o = clamp(offset);
    if (o > verbCursor) segments.push({ verbatim: text.slice(verbCursor, o) });
    verbCursor = o;
  };
  const consumeLines = (a, b) => {
    verbCursor = clamp(offsets[b] - 1);
  };

  const RE_FENCE = /^\s{0,3}(`{3,}|~{3,})/;
  const RE_ATX = /^(#{1,6})([ \t]+)(.*)$/;
  const RE_QUOTE = /^\s{0,3}>/;
  const RE_LIST = /^(\s*(?:[-*+]|\d{1,9}[.)])[ \t]+)(\S.*)$/;
  const RE_BLANK = /^\s*$/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(RE_FENCE);
    if (fence) {
      const marker = fence[1][0];
      const minLen = fence[1].length;
      const closeRe = new RegExp(`^\\s{0,3}\\${marker}{${minLen},}\\s*$`);
      let j = i + 1;
      while (j < lines.length && !closeRe.test(lines[j])) j++;
      i = Math.min(lines.length, j + 1);
      continue;
    }
    const atx = line.match(RE_ATX);
    if (atx && HAS_LETTER_RE.test(atx[3])) {
      flushVerbatimTo(offsets[i]);
      if (atx[1].length <= 2) {
        chapterBreaks.push({ segIndex: segments.length, title: atx[3].trim().slice(0, 80) });
      }
      segments.push({
        block: { text: atx[3], type: 'heading' },
        src: lineSpan(i, i + 1),
        prefix: atx[1] + atx[2],
        linePrefix: '',
      });
      consumeLines(i, i + 1);
      i++;
      continue;
    }
    if (RE_QUOTE.test(line)) {
      let j = i;
      while (j < lines.length && RE_QUOTE.test(lines[j])) j++;
      const src = lineSpan(i, j);
      const inner = lines.slice(i, j).map((l) => l.replace(/^\s{0,3}> ?/, '')).join('\n');
      flushVerbatimTo(offsets[i]);
      if (HAS_LETTER_RE.test(inner)) {
        segments.push({
          block: { text: inner, type: 'paragraph' },
          src,
          prefix: '> ',
          linePrefix: '> ',
        });
      } else {
        segments.push({ verbatim: src });
      }
      consumeLines(i, j);
      i = j;
      continue;
    }
    const list = line.match(RE_LIST);
    if (list && HAS_LETTER_RE.test(list[2])) {
      flushVerbatimTo(offsets[i]);
      segments.push({
        block: { text: list[2], type: 'paragraph' },
        src: lineSpan(i, i + 1),
        prefix: list[1],
        linePrefix: ' '.repeat(list[1].length),
      });
      consumeLines(i, i + 1);
      i++;
      continue;
    }
    if (RE_BLANK.test(line)) {
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length
      && !RE_BLANK.test(lines[j]) && !RE_FENCE.test(lines[j])
      && !RE_ATX.test(lines[j]) && !RE_QUOTE.test(lines[j]) && !RE_LIST.test(lines[j])) j++;
    const para = lineSpan(i, j);
    flushVerbatimTo(offsets[i]);
    pushParagraphSegments(segments, para, '', '');
    consumeLines(i, j);
    i = j;
  }
  flushVerbatimTo(text.length);
  return { segments, chapterBreaks };
}

function baseName(filename, kind) {
  const re = kind === 'html' ? /\.html?$/i : kind === 'md' ? /\.(md|markdown)$/i : kind === 'txt' ? /\.txt$/i : /\.[^.]+$/;
  return (filename || '').replace(re, '') || (filename || 'document');
}

function makeBlock(meta, chapterIndex, n) {
  return {
    blockId: `c${chapterIndex}-b${n}`,
    type: meta.type,
    plainText: meta.text,
    epubSerializedText: meta.text,
    slots: [],
    translation: null,
    translationRaw: null,
    translationStatus: 'pending',
    translationError: null,
  };
}

export function assembleTextDoc(kind, filename, structure, { hadCrLf, hadBom }) {
  const { segments, chapterBreaks = [] } = structure;
  const breaks = new Map(chapterBreaks.map((b) => [b.segIndex, b.title]));
  const chapters = [];
  const newChapter = (title) => {
    const ch = {
      index: chapters.length,
      href: '',
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
  let cur = null;
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (breaks.has(si)) cur = newChapter(breaks.get(si));
    if (!seg.block) continue;
    if (!cur) cur = newChapter(baseName(filename, kind));
    const block = makeBlock(seg.block, cur.index, cur.blocks.length);
    seg.block = block;
    cur.blocks.push(block);
    cur.charCount += block.plainText.length;
  }
  if (chapters.length === 0 || chapters.every((c) => c.blocks.length === 0)) {
    throw new DocFileParseError('empty');
  }
  const totalChars = chapters.reduce((acc, c) => acc + c.charCount, 0);
  return {
    kind,
    meta: {
      filename,
      title: baseName(filename, kind),
      author: '',
      language: '',
      identifier: '',
      epubVersion: '',
      pageCount: chapters.length,
      chapterCount: chapters.length,
    },
    stats: { totalChars },
    chapters,
    pages: chapters.map((c) => ({ pageIndex: c.index, chapterIndex: c.index, blocks: c.blocks })),
    fileSegments: segments,
    hadCrLf,
    hadBom,
  };
}

function parseHtmlDoc(rawText, filename) {
  const SK = getSerializerSK();
  const htmlDoc = new DOMParser().parseFromString(rawText, 'text/html');
  const blocks = collectChapterBlocks(htmlDoc, 0, SK);
  if (blocks.length === 0) throw new DocFileParseError('empty');
  const title = (htmlDoc.title || '').trim() || baseName(filename, 'html');
  const chapters = [{
    index: 0,
    href: '',
    linear: 'yes',
    isNavDoc: false,
    title,
    parseFailed: false,
    blocks,
    charCount: blocks.reduce((acc, b) => acc + b.plainText.length, 0),
    selected: true,
    suggestSkip: false,
  }];
  return {
    kind: 'html',
    meta: {
      filename,
      title,
      author: '',
      language: htmlDoc.documentElement.getAttribute('lang') || '',
      identifier: '',
      epubVersion: '',
      pageCount: 1,
      chapterCount: 1,
    },
    stats: { totalChars: chapters[0].charCount },
    chapters,
    pages: [{ pageIndex: 0, chapterIndex: 0, blocks }],
    htmlDoc,
    hadDoctype: /^\s*<!doctype/i.test(rawText),
  };
}

export async function parseDocFile(file, kind, opts = {}) {
  const rawText = await decodeTextFile(file, opts);
  if (kind === 'html') return parseHtmlDoc(rawText, file.name);
  const bom = stripBom(rawText);
  const eol = normalizeEol(bom.text);
  const structure = kind === 'md' ? parseMdStructure(eol.text) : parseTxtStructure(eol.text);
  return assembleTextDoc(kind, file.name, structure, { hadCrLf: eol.hadCrLf, hadBom: bom.hadBom });
}

export { editedHtmlToPlain };

export function blockOutputText(b, override) {
  if (!b || b.translationStatus !== 'done') return null;
  const picked = pickBlockOutput(b, override);
  if (!picked) return null;
  return picked.source === 'edited' ? editedHtmlToPlain(picked.value) : picked.value;
}

export function buildTranslatedDocText(doc, dedupe = null) {
  const parts = [];
  for (const seg of doc.fileSegments) {
    if (seg.verbatim != null) {
      parts.push(seg.verbatim);
      continue;
    }
    const out = blockOutputText(seg.block, dedupe ? dedupe.get(seg.block.blockId) : null);
    if (out == null) {
      parts.push(seg.src);
      continue;
    }
    const lines = out.split('\n');
    parts.push(seg.prefix + lines
      .map((ln, i) => (i === 0 ? ln : seg.linePrefix + ln))
      .join('\n'));
  }
  let text = parts.join('');
  if (doc.hadCrLf) text = text.replace(/\n/g, '\r\n');
  if (doc.hadBom) text = '﻿' + text;
  return text;
}

export async function buildTranslatedHtmlDoc(doc, targetLanguage, dedupe = null) {
  const { applyBlockTranslation } = await import('./epub-writer.js');
  const SK = getSerializerSK();
  const htmlDoc = doc.htmlDoc;
  for (const ch of doc.chapters) {
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'done') continue;
      applyBlockTranslation(SK, htmlDoc, b, dedupe ? dedupe.get(b.blockId) : null, false);
    }
  }
  if (targetLanguage) htmlDoc.documentElement.setAttribute('lang', targetLanguage);
  if (!htmlDoc.querySelector('meta[charset], meta[http-equiv="Content-Type" i]')) {
    const head = htmlDoc.querySelector('head');
    if (head) {
      const meta = htmlDoc.createElement('meta');
      meta.setAttribute('charset', 'utf-8');
      head.insertBefore(meta, head.firstChild);
    }
  }
  return (doc.hadDoctype ? '<!DOCTYPE html>\n' : '') + htmlDoc.documentElement.outerHTML;
}

export function translatedDocFilename(originalName, kind) {
  const name = originalName || 'document';
  const m = name.match(/\.(txt|md|markdown|html?)$/i);
  const ext = m ? m[0] : (kind === 'html' ? '.html' : kind === 'md' ? '.md' : '.txt');
  const base = m ? name.slice(0, -m[0].length) : name;
  return `${base}-transit${ext}`;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sourceHasOwnAnnotation(plainText, source) {
  if (typeof plainText !== 'string' || !plainText) return false;
  const src = escapeRe(source);
  return new RegExp(`${src}\\s*[（(]|[（(]\\s*${src}\\s*[）)]`, 'i').test(plainText);
}

export function stripGlossaryAnnotations(text, glossary, plainText = '') {
  if (typeof text !== 'string' || !text || !Array.isArray(glossary) || glossary.length === 0) {
    return { text: text || '', count: 0 };
  }
  let out = text;
  let count = 0;
  for (const e of glossary) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') continue;
    const target = e.target.trim();
    const source = e.source.trim();
    if (!target || !source || /[（(]/.test(target)) continue;
    if (sourceHasOwnAnnotation(plainText, source)) continue;
    const re = new RegExp(`(${escapeRe(target)})((?:\u27E6\\/?\\d+\u27E7)*)[ \u3000]?[（(]\\s*${escapeRe(source)}\\s*[）)]`, 'gi');
    out = out.replace(re, (_m, t, tokens) => { count++; return t + tokens; });
  }
  return { text: out, count };
}

export function applyGlossaryAnnotationCleanup(doc, glossary) {
  if (!doc || !Array.isArray(doc.chapters) || !Array.isArray(glossary) || glossary.length === 0) return 0;
  let total = 0;
  for (const ch of doc.chapters) {
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'done') continue;
      if (typeof b.editedHtml === 'string' && b.editedHtml.length > 0) continue;
      const rawRes = typeof b.translationRaw === 'string'
        ? stripGlossaryAnnotations(b.translationRaw, glossary, b.plainText) : null;
      const plainRes = typeof b.translation === 'string'
        ? stripGlossaryAnnotations(b.translation, glossary, b.plainText) : null;
      if (rawRes && plainRes) {
        if (rawRes.count > 0) {
          b.translationRaw = rawRes.text;
          b.translation = plainRes.text;
          total += rawRes.count;
        }
      } else if (rawRes && rawRes.count > 0) {
        b.translationRaw = rawRes.text;
        total += rawRes.count;
      } else if (plainRes && plainRes.count > 0) {
        b.translation = plainRes.text;
        total += plainRes.count;
      }
    }
  }
  return total;
}

export function parseGlossaryCsv(text) {
  if (typeof text !== 'string' || !text) return null;
  const s = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const entries = [];
  for (const r of rows) {
    if (r.length < 2) continue;
    const source = (r[0] || '').trim();
    const target = (r[1] || '').trim();
    if (!source || !target) continue;
    entries.push({ source, target });
  }
  if (entries.length > 0) {
    const h = entries[0];
    if (/^(source|original|term|原文|词条|詞條|用語|原語)$/i.test(h.source)
      || /^(target|translation|translated|譯名|译名|譯文|译文|訳語)$/i.test(h.target)) {
      entries.shift();
    }
  }
  return entries.length > 0 ? entries : null;
}
