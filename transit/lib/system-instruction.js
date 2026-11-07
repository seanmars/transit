import { DEFAULT_UNITS_PER_BATCH, DEFAULT_CHARS_PER_BATCH } from './constants.js';

export const DELIMITER = '\n<<<TRZX_SEP>>>\n';
export const SEP_RE = /\s*<<<TRZX_SEP>>>\s*/i;

export const MARKER_COMPACT = {
  fmt: (n) => `«${n}» `,
  re: /^«\d+»\s*/,
  stripGlobalRe: /«\d+»\s*/g,
  scanRe: /«\s*(\d+)\s*»/,
  display: '«N»',
};
export const MARKER_STRONG = {
  fmt: (n) => `<<<TRZX_SEG-${n}>>> `,
  re: /^<<<TRZX_SEG-\d+>>>\s*/i,
  stripGlobalRe: /<<<TRZX_SEG-\d+>>>\s*/gi,
  scanRe: /<<<TRZX_SEG-(\d+)>>>/i,
  display: '<<<TRZX_SEG-N>>>',
};

export function realignByMarkers(text, expectedCount, marker = MARKER_COMPACT) {
  if (!text || expectedCount < 2) return null;
  const re = new RegExp(marker.scanRe.source, 'gi');
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    hits.push({ n: parseInt(m[1], 10), start: m.index, end: m.index + m[0].length });
    if (hits.length > expectedCount) return null;
  }
  if (hits.length !== expectedCount) return null;
  for (let i = 0; i < hits.length; i++) {
    if (hits[i].n !== i + 1) return null;
  }
  if (text.slice(0, hits[0].start).trim() !== '') return null;
  const sepGlobal = new RegExp(SEP_RE.source, 'gi');
  const parts = [];
  for (let i = 0; i < hits.length; i++) {
    const from = hits[i].end;
    const to = i + 1 < hits.length ? hits[i + 1].start : text.length;
    parts.push(text.slice(from, to).replace(sepGlobal, ' ').trim());
  }
  return parts;
}

const MAX_UNITS_PER_CHUNK = DEFAULT_UNITS_PER_BATCH;
const MAX_CHARS_PER_CHUNK = DEFAULT_CHARS_PER_BATCH;

function sanitizeTermText(s) {
  return String(s ?? '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/⟦\/?\*?\d+⟧/g, '')
    .replace(/<<<TRZX_SEP>>>/gi, '')
    .replace(/<<<TRZX_SEG-\d+>>>/gi, '')
    .replace(/«\d+»/g, '')
    .replace(/<\/?forbidden_terms_blacklist>/gi, '')
    .trim()
    .slice(0, 200);
}

const GLOSSARY_TYPE_TOKENS = new Set(['person', 'place', 'tech', 'work']);
export function isValidGlossaryEntry(e) {
  if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') return false;
  if (!e.source || !e.target) return false;
  if (GLOSSARY_TYPE_TOKENS.has(e.target.trim().toLowerCase())) return false;
  return true;
}

export function isSuspectEchoTranslation(source, translation, targetLanguage) {
  if (typeof source !== 'string' || typeof translation !== 'string') return false;
  const s = source.trim();
  const t = translation.trim();
  if (!s || !t) return false;
  const tl = String(targetLanguage || 'zh-TW');
  const isCjkTarget = tl.startsWith('zh') || tl.startsWith('ja') || tl.startsWith('ko');
  if (isCjkTarget) {
    const tLatin = (t.match(/[A-Za-z]/g) || []).length;
    const tWords = t.split(/\s+/).filter(Boolean).length;
    const tCjk = (t.match(/[぀-ゟ゠-ヿ㐀-䶿一-鿿가-힣]/g) || []).length;
    if (tLatin >= 40 && tWords >= 8 && tCjk <= 2) return true;
  }
  if (s !== t) return false;
  const kana = (s.match(/[ぁ-ゖァ-ヺ]/g) || []).length;
  const hangul = (s.match(/[가-힣]/g) || []).length;
  if (tl.startsWith('zh')) return kana >= 2 || hangul >= 2;
  if (tl.startsWith('ja')) return hangul >= 2;
  if (tl.startsWith('ko')) return kana >= 2;
  const han = (s.match(/[一-鿿]/g) || []).length;
  return kana + hangul + han >= 2;
}

export function detectOutputLangMismatch(results, targetLanguage) {
  const tl = String(targetLanguage || 'zh-TW');
  if (tl.startsWith('ja')) return false;
  const joined = (Array.isArray(results) ? results : [])
    .filter((t) => typeof t === 'string').join('\n');
  if (joined.length < 40) return false;
  const kana = (joined.match(/[ぁ-ゖァ-ヺー]/g) || []).length;
  const han = (joined.match(/[一-鿿]/g) || []).length;
  const hangul = (joined.match(/[가-힣]/g) || []).length;
  const latin = (joined.match(/[A-Za-z]/g) || []).length;
  if (tl.startsWith('ko')) {
    return (kana >= 30 && kana > hangul) || (han >= 30 && han > hangul * 2);
  }
  if (tl.startsWith('zh')) {
    if (kana >= 30 && kana / (kana + han) > 0.15) return true;
    if (hangul >= 30 && hangul / (hangul + han) > 0.5) return true;
    return false;
  }
  const cjkish = kana + han + hangul;
  return cjkish >= 30 && cjkish > latin;
}

export function filterEchoPairsForCache(texts, translations, targetLanguage) {
  const outTexts = [];
  const outTranslations = [];
  let skipped = 0;
  const n = Math.min(texts?.length || 0, translations?.length || 0);
  for (let i = 0; i < n; i++) {
    if (!translations[i]) continue;
    if (isSuspectEchoTranslation(texts[i], translations[i], targetLanguage)) { skipped++; continue; }
    outTexts.push(texts[i]);
    outTranslations.push(translations[i]);
  }
  return { texts: outTexts, translations: outTranslations, skipped };
}

export function packChunks(texts, opts = {}) {
  const maxUnits = (Number.isFinite(opts.maxUnits) && opts.maxUnits >= 1)
    ? Math.floor(opts.maxUnits) : MAX_UNITS_PER_CHUNK;
  const maxChars = (Number.isFinite(opts.maxChars) && opts.maxChars >= 1)
    ? Math.floor(opts.maxChars) : MAX_CHARS_PER_CHUNK;
  const batches = [];
  let cur = null;
  const flush = () => { if (cur && cur.end > cur.start) batches.push(cur); cur = null; };
  for (let i = 0; i < texts.length; i++) {
    const len = (texts[i] || '').length;
    if (len > maxChars) {
      flush();
      batches.push({ start: i, end: i + 1 });
      continue;
    }
    if (cur && (cur.chars + len > maxChars || (cur.end - cur.start) >= maxUnits)) {
      flush();
    }
    if (!cur) cur = { start: i, end: i, chars: 0 };
    cur.end = i + 1;
    cur.chars += len;
  }
  flush();
  return batches;
}

export function buildEffectiveSystemInstruction(baseSystem, texts, joined, glossary, fixedGlossary, forbiddenTerms, marker = MARKER_COMPACT) {
  const parts = [baseSystem];

  if (texts.some(t => t && t.indexOf('\n') !== -1)) {
    parts.push(
      '額外規則（段落分隔）:\n輸入中可能含有段內換行符 \\n（例如 "第一段\\n\\n第二段"）,代表原文有對應的段落或行分隔（通常是 <br> 或 <br><br>）。翻譯時必須在對應位置原樣保留 \\n 字元——譯文段落數與輸入段落數一致,連續兩個 \\n 也要保留兩個。不可把段落合併成一行,也不可把空白行多塞或少塞。'
    );
  }

  if (joined.indexOf('⟦') !== -1) {
    parts.push(
      '額外規則（極重要，處理佔位符標記）:\n輸入中可能含有兩種佔位符標記，都是用來保留原文結構，必須原樣保留、不可翻譯、不可省略、不可改寫、不可新增、不可重排。佔位符裡的數字、斜線、星號 **必須是半形 ASCII 字元**（0-9、/、*），絕對不可改成全形（０-９、／、＊），否則程式無法配對會整段崩壞。\n\n（A）配對型 ⟦數字⟧…⟦/數字⟧（例如 ⟦0⟧Tokugawa Ieyasu⟦/0⟧)：\n- 把標記視為透明外殼。外殼「內部」的文字跟外殼「外部」的文字一樣，都要翻譯（翻成前面指定的翻譯目標語言，與殼外文字相同的語言，不是固定繁體中文）。\n- ⟦數字⟧ 與 ⟦/數字⟧ 兩個標記本身原樣保留，數字不變。\n- **配對型可以巢狀嵌套**（例如 ⟦0⟧may incorporate text from a ⟦1⟧large language model⟦/1⟧, which is ...⟦/0⟧）。巢狀代表原文是 `<b>text <a>link</a> more text</b>` 這類嵌套結構。翻譯時必須**同時**保留外層與內層兩組標記、不可扁平化成單層、不可交換順序、不可遺漏任何一層。外層與內層的內部文字都要翻譯（翻成前面指定的目標語言，與殼外文字相同）。\n\n（B）自閉合 ⟦*數字⟧（例如 ⟦*5⟧)：\n- 這是「原子保留」位置記號，代表原文裡有一段不可翻譯的小區塊（例如維基百科腳註參照 [2])。\n- 整個 ⟦*數字⟧ token 原樣保留，不可拆開、不可翻譯、不可省略，數字不變。\n- 它的位置代表那段內容應該插在譯文的哪裡。\n\n具體範例 1（單層）：\n輸入： ⟦0⟧Tokugawa Ieyasu⟦/0⟧ won the ⟦1⟧Battle of Sekigahara⟦/1⟧ in 1600.⟦*2⟧\n正確輸出： ⟦0⟧德川家康⟦/0⟧於 1600 年贏得⟦1⟧關原之戰⟦/1⟧。⟦*2⟧\n錯誤輸出 1： ⟦0⟧Tokugawa Ieyasu⟦/0⟧於 1600 年贏得⟦1⟧Battle of Sekigahara⟦/1⟧。⟦*2⟧（配對型內部英文沒翻）\n錯誤輸出 2： ⟦0⟧德川家康⟦/0⟧於 1600 年贏得⟦1⟧關原之戰⟦/1⟧。[2]（自閉合 ⟦*2⟧ 被擅自還原成 [2])\n\n具體範例 2（巢狀）：\n輸入： This article ⟦0⟧may incorporate text from a ⟦1⟧large language model⟦/1⟧, which is ⟦2⟧prohibited in Wikipedia articles⟦/2⟧⟦/0⟧.\n正確輸出： 本條目⟦0⟧可能包含來自⟦1⟧大型語言模型⟦/1⟧的文字，這在⟦2⟧維基百科條目中是被禁止的⟦/2⟧⟦/0⟧。\n錯誤輸出 3： 本條目可能包含來自⟦1⟧大型語言模型⟦/1⟧的文字，這在⟦2⟧維基百科條目中是被禁止的⟦/2⟧。（外層 ⟦0⟧…⟦/0⟧ 被扁平化丟掉）'
    );
  }

  if (fixedGlossary && fixedGlossary.length > 0) {
    const lines = fixedGlossary
      .map(e => `${sanitizeTermText(e.source)} → ${sanitizeTermText(e.target)}`)
      .filter(l => !/^\s*→\s*$/.test(l))
      .join('\n');
    if (lines) {
      parts.push(
        '以下是使用者指定的固定術語表，優先級高於下方所有術語對照。遇到這些原文一律使用指定譯名，不可自行改寫，也不需加註英文原文：\n' + lines
      );
    }
  }

  if (forbiddenTerms && forbiddenTerms.length > 0) {
    const mappedLines = [];
    const bannedOnly = [];
    for (const t of forbiddenTerms) {
      if (!t) continue;
      const forbidden = sanitizeTermText(t.forbidden);
      if (!forbidden || !forbidden.trim()) continue;
      const replacement = sanitizeTermText(t.replacement);
      if (replacement && replacement.trim()) {
        mappedLines.push(`${forbidden} → ${replacement}`);
      } else {
        bannedOnly.push(forbidden);
      }
    }
    if (mappedLines.length > 0 || bannedOnly.length > 0) {
      let block = '<forbidden_terms_blacklist>\n極重要：以下是嚴格禁用的詞彙，譯文中絕對不可使用，違反此規則即為錯誤翻譯。\n';
      if (mappedLines.length > 0) {
        block += '\n【禁用 → 必須改用】以下左欄詞彙一律改用右欄的台灣慣用語。即使原文是英文（例如 video / software / data），譯文也只能使用右欄。\n' + mappedLines.join('\n') + '\n';
      }
      if (bannedOnly.length > 0) {
        block += '\n【禁用（未指定替換詞）】以下詞彙同樣不可出現在譯文中，但未指定替換詞，請自行改用合適、自然的台灣慣用說法表達相同語意。\n' + bannedOnly.join('\n') + '\n';
      }
      block += '\n說明：本黑名單為硬性規定，優先級高於任何 stylistic 考量。若該詞為文章本身討論的主題（例如一篇分析「中國科技用語演變」的文章），請使用引號標示後保留原詞，例如「視頻」。\n</forbidden_terms_blacklist>';
      parts.push(block);
    }
  }

  if (glossary && glossary.length > 0) {
    const lines = glossary
      .map(e => `${sanitizeTermText(e.source)} → ${sanitizeTermText(e.target)}`)
      .filter(l => !/^\s*→\s*$/.test(l))
      .join('\n');
    if (lines) {
      parts.push(
        '以下是本篇文章的術語對照表，遇到左欄原文時一律逐字使用右欄指定譯名。右欄字串的所有部分——包括其中的書名號與括號內的原文對照——都是指定譯名的一部分，每次出現都要完整輸出，不可自行增刪、改寫或省略括號對照；右欄已含書名號時不要在外面再包一層書名號或引號；右欄沒有括號對照時，也不要自行加註原文：\n' + lines
      );
    }
  }

  if (texts.length > 1) {
    const m = marker.display;
    parts.push(
      `額外規則（多段翻譯分隔符與序號，極重要）:\n本批次包含 ${texts.length} 段文字。每段開頭有序號標記 ${m}（N 為 1 到 ${texts.length}），段與段之間以分隔符 <<<TRZX_SEP>>> 隔開。\n你的輸出必須：\n- 每段譯文開頭也加上對應的序號標記 ${m}（N 與輸入的序號一一對應）\n- 段與段之間用完全相同的分隔符 <<<TRZX_SEP>>> 隔開\n- 恰好輸出 ${texts.length} 段譯文和 ${texts.length - 1} 個分隔符\n- 不可合併段落、不可省略分隔符、不可增減段數`
    );
  }

  return parts.join('\n\n');
}
