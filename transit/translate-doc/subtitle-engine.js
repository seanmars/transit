import {
  DocFileParseError, HAS_LETTER_RE, normalizeEol, stripBom, decodeTextFile,
  assembleTextDoc, blockOutputText, makeOffsets,
} from './doc-file-engine.js';
import SUBTITLE_PROMPT_HINT_ZH from '../prompts/subtitle-file-hint-zh.js';
import SUBTITLE_PROMPT_HINT_EN from '../prompts/subtitle-file-hint-universal.js';
import SUBTITLE_PROMPT_HINT_ZH_NO_PERIOD from '../prompts/subtitle-file-hint-zh-no-period.js';

export const SUBTITLE_FORMAT_LABELS = { srt: 'SRT', vtt: 'WebVTT', ass: 'ASS' };

export function detectSubtitleFormat(file) {
  const name = (file && file.name) || '';
  if (/\.srt$/i.test(name)) return 'srt';
  if (/\.vtt$/i.test(name)) return 'vtt';
  if (/\.(ass|ssa)$/i.test(name)) return 'ass';
  const type = (file && file.type) || '';
  if (type === 'application/x-subrip') return 'srt';
  if (type === 'text/vtt') return 'vtt';
  return null;
}

const TOKEN_RE_HTMLISH = /<[^<>\n]+>|\{[^{}\n]*\}/g;
const TOKEN_RE_ASS = /<[^<>\n]+>|\{[^{}\n]*\}|\\[Nnh]/g;
const OPEN_TAG_RE = /^<([A-Za-z][^\s>/.]*)(?:[^>]*)>$/;
const CLOSE_TAG_RE = /^<\/([A-Za-z][^\s>/.]*)\s*>$/;

function classifyToken(raw) {
  const close = raw.match(CLOSE_TAG_RE);
  if (close) return { kind: 'close', name: close[1].toLowerCase() };
  const open = raw.match(OPEN_TAG_RE);
  if (open && !/\/\s*>$/.test(raw)) return { kind: 'open', name: open[1].toLowerCase() };
  return { kind: 'atomic' };
}

export function serializeCueText(text, format) {
  const re = format === 'ass' ? TOKEN_RE_ASS : TOKEN_RE_HTMLISH;
  const tokens = [];
  for (const m of text.matchAll(re)) {
    tokens.push({ start: m.index, end: m.index + m[0].length, raw: m[0], ...classifyToken(m[0]) });
  }
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.kind === 'open') { stack.push(i); continue; }
    if (tk.kind !== 'close') continue;
    let found = -1;
    for (let s = stack.length - 1; s >= 0; s--) {
      if (tokens[stack[s]].name === tk.name) { found = s; break; }
    }
    if (found === -1) { tk.kind = 'atomic'; continue; }
    for (let s = stack.length - 1; s > found; s--) tokens[stack[s]].kind = 'atomic';
    const openIdx = stack[found];
    stack.length = found;
    tokens[openIdx].pairWith = i;
    tk.pairWith = openIdx;
    tk.kind = 'pairedClose';
  }
  for (const idx of stack) tokens[idx].kind = 'atomic';

  const slots = [];
  let serialized = '';
  let plain = '';
  let cursor = 0;
  for (const tk of tokens) {
    const between = text.slice(cursor, tk.start);
    serialized += between;
    plain += between;
    cursor = tk.end;
    if (tk.kind === 'open') {
      tk.slot = slots.length;
      slots.push({ open: tk.raw, close: tokens[tk.pairWith].raw });
      serialized += `⟦${tk.slot}⟧`;
    } else if (tk.kind === 'pairedClose') {
      serialized += `⟦/${tokens[tk.pairWith].slot}⟧`;
    } else {
      const n = slots.length;
      slots.push({ atomic: tk.raw });
      serialized += `⟦*${n}⟧`;
      if (format === 'ass') {
        if (tk.raw === '\\N' || tk.raw === '\\n') plain += '\n';
        else if (tk.raw === '\\h') plain += ' ';
      }
    }
  }
  const tail = text.slice(cursor);
  serialized += tail;
  plain += tail;
  return { serialized, plain, slots };
}

const MARKER_RE = /⟦([*＊]?)([/／]?)([0-9０-９]+)⟧/g;
const toAsciiDigits = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));

export function restoreCueText(translated, slots, format) {
  const opens = new Set();
  const closes = new Set();
  const seenAtomic = new Set();
  for (const m of translated.matchAll(MARKER_RE)) {
    const n = Number(toAsciiDigits(m[3]));
    if (m[1]) seenAtomic.add(n);
    else if (m[2]) closes.add(n);
    else opens.add(n);
  }
  let out = translated.replace(MARKER_RE, (_m, star, slash, digits) => {
    const n = Number(toAsciiDigits(digits));
    const slot = slots[n];
    if (!slot) return '';
    if (slot.atomic != null) return slot.atomic;
    if (!(opens.has(n) && closes.has(n))) return '';
    return slash ? slot.close : slot.open;
  });
  out = out.replace(/[⟦⟧]/g, '');
  let missing = '';
  slots.forEach((slot, i) => {
    if (slot.atomic != null && !seenAtomic.has(i) && /^\{/.test(slot.atomic)) missing += slot.atomic;
  });
  out = missing + out;
  if (format === 'ass') out = out.replace(/\n/g, '\\N');
  return out;
}

export function fixCjkSpacingAroundPlaceholders(raw, fixFn) {
  const parts = String(raw).split(/(⟦[*＊]?[/／]?[0-9０-９]+⟧)/);
  let count = 0;
  let prevChar = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue;
    if (!parts[i]) continue;
    const r = fixFn(parts[i], { prevChar });
    if (r.count > 0) { parts[i] = r.text; count += r.count; }
    prevChar = parts[i].slice(-1);
  }
  return { text: parts.join(''), count };
}

function pushCueSegment(segments, src, format) {
  const cue = serializeCueText(src, format);
  if (!HAS_LETTER_RE.test(cue.plain)) {
    segments.push({ verbatim: src });
    return;
  }
  segments.push({
    block: { text: cue.plain, type: 'paragraph' },
    cue: { serialized: cue.serialized, slots: cue.slots },
    src,
    prefix: '',
    linePrefix: '',
  });
}

function parseTimedStructure(text, format) {
  const segments = [];
  const lines = text.split('\n');
  const offsets = makeOffsets(lines);
  const clamp = (o) => Math.min(text.length, o);
  let verbCursor = 0;
  const flushVerbatimTo = (offset) => {
    const o = clamp(offset);
    if (o > verbCursor) segments.push({ verbatim: text.slice(verbCursor, o) });
    verbCursor = o;
  };
  const RE_TIMING = /-->/;
  const RE_BLANK = /^\s*$/;
  let i = 0;
  while (i < lines.length) {
    if (!RE_TIMING.test(lines[i])) { i++; continue; }
    let j = i + 1;
    while (j < lines.length && !RE_BLANK.test(lines[j])) j++;
    if (j > i + 1) {
      const src = text.slice(offsets[i + 1], clamp(offsets[j] - 1));
      flushVerbatimTo(offsets[i + 1]);
      pushCueSegment(segments, src, format);
      verbCursor = clamp(offsets[j] - 1);
    }
    i = j;
  }
  flushVerbatimTo(text.length);
  return { segments };
}

function parseAssStructure(text) {
  const segments = [];
  const lines = text.split('\n');
  const offsets = makeOffsets(lines);
  const clamp = (o) => Math.min(text.length, o);
  let verbCursor = 0;
  const flushVerbatimTo = (offset) => {
    const o = clamp(offset);
    if (o > verbCursor) segments.push({ verbatim: text.slice(verbCursor, o) });
    verbCursor = o;
  };
  let inEvents = false;
  let textIdx = 9;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sec = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec) { inEvents = /^events$/i.test(sec[1].trim()); continue; }
    if (!inEvents) continue;
    const fmt = line.match(/^Format\s*:\s*(.*)$/i);
    if (fmt) {
      const fields = fmt[1].split(',').map((s) => s.trim().toLowerCase());
      const k = fields.indexOf('text');
      textIdx = k >= 0 ? k : Math.max(0, fields.length - 1);
      continue;
    }
    const dlg = line.match(/^Dialogue\s*:/i);
    if (!dlg) continue;
    let pos = dlg[0].length;
    let ok = true;
    for (let c = 0; c < textIdx; c++) {
      const k = line.indexOf(',', pos);
      if (k === -1) { ok = false; break; }
      pos = k + 1;
    }
    if (!ok) continue;
    const src = line.slice(pos);
    if (!src) continue;
    flushVerbatimTo(offsets[i] + pos);
    pushCueSegment(segments, src, 'ass');
    verbCursor = clamp(offsets[i + 1] - 1);
  }
  flushVerbatimTo(text.length);
  return { segments };
}

export function parseSubtitleStructure(text, format) {
  return format === 'ass' ? parseAssStructure(text) : parseTimedStructure(text, format);
}

export async function parseSubtitleFile(file, format, opts = {}) {
  const rawText = await decodeTextFile(file, opts);
  const bom = stripBom(rawText);
  const eol = normalizeEol(bom.text);
  const structure = parseSubtitleStructure(eol.text, format);
  const doc = assembleTextDoc('subtitle', file.name, structure, { hadCrLf: eol.hadCrLf, hadBom: bom.hadBom });
  doc.subtitleFormat = format;
  for (const seg of structure.segments) {
    if (!seg.block || !seg.cue) continue;
    seg.block.epubSerializedText = seg.cue.serialized;
    seg.block.slots = null;
    seg.block.tagSlots = seg.cue.slots;
  }
  return doc;
}

export function buildTranslatedSubtitleText(doc, dedupe = null, { bilingual = false, stripPeriod = false } = {}) {
  const format = doc.subtitleFormat;
  const lineBreak = format === 'ass' ? '\\N' : '\n';
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
    const tr = restoreCueText(stripPeriod ? stripCueTrailingPeriod(out) : out, seg.block.tagSlots || [], format);
    parts.push(bilingual ? tr + lineBreak + seg.src : tr);
  }
  let text = parts.join('');
  if (doc.hadCrLf) text = text.replace(/\n/g, '\r\n');
  if (doc.hadBom) text = '﻿' + text;
  return text;
}

export function translatedSubtitleFilename(originalName, format, { bilingual = false, targetLanguage = 'zh-TW' } = {}) {
  const name = originalName || 'subtitle';
  const m = name.match(/\.(srt|vtt|ass|ssa)$/i);
  const ext = m ? m[0] : `.${format || 'srt'}`;
  const base = m ? name.slice(0, -m[0].length) : name;
  const lang = (String(targetLanguage || 'zh').split(/[-_]/)[0] || 'zh').toLowerCase();
  return `${base}${bilingual ? '.dual' : ''}.${lang}${ext}`;
}

export function subtitleMimeType(format) {
  return format === 'vtt' ? 'text/vtt' : 'text/plain';
}

export function subtitlePromptHint(targetLanguage, { stripPeriod = false } = {}) {
  if (!String(targetLanguage || '').startsWith('zh')) return SUBTITLE_PROMPT_HINT_EN;
  return stripPeriod ? `${SUBTITLE_PROMPT_HINT_ZH}\n\n${SUBTITLE_PROMPT_HINT_ZH_NO_PERIOD}` : SUBTITLE_PROMPT_HINT_ZH;
}

const CUE_TRAILING_PERIOD_RE = /。+(?=(?:[」』）】〕》〉\]\)"'”’]|⟦[*＊]?[/／]?[0-9０-９]+⟧|[ \t\u3000])*$)/gm;
export function stripCueTrailingPeriod(text) {
  if (typeof text !== 'string' || !text.includes('。')) return text;
  return text.replace(CUE_TRAILING_PERIOD_RE, '');
}
