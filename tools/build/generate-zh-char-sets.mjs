#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DICT_DIR = join(ROOT, 'transit', 'lib', 'vendor', 'opencc', 'dict');
const TARGET = join(ROOT, 'transit', 'content-detect.js');

const parse = (f) => readFileSync(join(DICT_DIR, `${f}.txt`), 'utf8').split('|').map((l) => l.split(' '));
const ST = parse('STCharacters');
const TS = parse('TSCharacters');
const STP = parse('STPhrases');
const TWP = parse('TWPhrases');
const TWV = parse('TWVariants');

const tradChars = new Set();
const simpChars = new Set();
for (const arr of [ST, STP, TWP, TWV]) for (const p of arr) for (const v of p.slice(1)) for (const ch of v) tradChars.add(ch);
for (const p of TS) for (const ch of p[0]) tradChars.add(ch);
for (const p of TS) for (const v of p.slice(1)) for (const ch of v) simpChars.add(ch);
for (const arr of [ST, STP]) for (const p of arr) for (const ch of p[0]) simpChars.add(ch);

const simpOnly = [...new Set(ST.map((p) => p[0]))].filter((c) => c.length === 1 && !tradChars.has(c)).sort().join('');
const tradOnly = [...new Set(TS.map((p) => p[0]))].filter((c) => c.length === 1 && !simpChars.has(c)).sort().join('');

const AMBIGUOUS_PROBES = '干后里台丑斗面谷划据范几叶松准征余向回';
for (const c of AMBIGUOUS_PROBES) {
  if (simpOnly.includes(c) || tradOnly.includes(c)) {
    throw new Error(`歧義字 ${c} 誤入特徵字集,判準退化,中止生成`);
  }
}
for (const c of '发们这对没说冲个国网赛绝击') {
  if (!simpOnly.includes(c)) throw new Error(`純簡體字 ${c} 未入集,覆蓋倒退,中止生成`);
}

const QUASI_MAX = 3;
const tradCharCount = new Map();
for (const arr of [ST, STP, TWP, TWV]) for (const p of arr) for (const v of p.slice(1)) for (const ch of v) tradCharCount.set(ch, (tradCharCount.get(ch) || 0) + 1);
for (const p of TS) for (const ch of p[0]) tradCharCount.set(ch, (tradCharCount.get(ch) || 0) + 1);
const simpCharCount = new Map();
for (const p of TS) for (const v of p.slice(1)) for (const ch of v) simpCharCount.set(ch, (simpCharCount.get(ch) || 0) + 1);
for (const arr of [ST, STP]) for (const p of arr) for (const ch of p[0]) simpCharCount.set(ch, (simpCharCount.get(ch) || 0) + 1);

const QUASI_SIMP_ALLOW = new Set(['么', '万', '广', '厂', '种', '别', '虫', '腊', '腌']);
const quasiSimpCandidates = [...new Set(ST.map((p) => p[0]))]
  .filter((c) => c.length === 1 && !simpOnly.includes(c) && tradChars.has(c) && (tradCharCount.get(c) || 0) <= QUASI_MAX);
const quasiSimp = quasiSimpCandidates.filter((c) => QUASI_SIMP_ALLOW.has(c));
const quasiTrad = [...new Set(TS.map((p) => p[0]))]
  .filter((c) => c.length === 1 && !tradOnly.includes(c) && simpChars.has(c) && (simpCharCount.get(c) || 0) <= QUASI_MAX);
const simpOnlyFull = [...simpOnly, ...quasiSimp].sort().join('');
const tradOnlyFull = [...tradOnly, ...quasiTrad].sort().join('');
console.log(`quasiSimp 候選 ${quasiSimpCandidates.length} 字,白名單放行 ${quasiSimp.length} 字: ${quasiSimp.join('')}`);
console.log(`quasiSimp 候選但未放行(人工檢視後可考慮增補): ${quasiSimpCandidates.filter((c) => !QUASI_SIMP_ALLOW.has(c)).join('')}`);
console.log(`quasiTrad(+${quasiTrad.length}): ${quasiTrad.join('')}`);

if (!simpOnlyFull.includes('么')) throw new Error('準特徵字 tier 漏 么,判準退化,中止生成');
for (const c of '台周后里干面斗谷吃秘峰床唇恒灶痴粽霉') {
  if (simpOnlyFull.includes(c)) throw new Error(`繁體日常/常用共用字 ${c} 誤入簡體特徵集,中止生成`);
}
for (const c of simpOnlyFull) {
  if (tradOnlyFull.includes(c)) throw new Error(`${c} 同時出現在簡繁兩側特徵集,矛盾,中止生成`);
}

const BEGIN = '// ── GENERATED:ZH-CHAR-SETS BEGIN(tools/build/generate-zh-char-sets.mjs,勿手改)──';
const END = '// ── GENERATED:ZH-CHAR-SETS END ──';
const block = `${BEGIN}
  const SIMPLIFIED_ONLY_CHARS = new Set(${JSON.stringify(simpOnlyFull)});
  const TRADITIONAL_ONLY_CHARS = new Set(${JSON.stringify(tradOnlyFull)});
  ${END}`;

const src = readFileSync(TARGET, 'utf8');
const re = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
if (!re.test(src)) {
  console.error('content-detect.js 找不到生成區塊 marker,請先手動放置 BEGIN/END 標記');
  process.exit(1);
}
writeFileSync(TARGET, src.replace(re, block), 'utf8');
console.log(`OK:simpOnly ${simpOnly.length} 字(${Buffer.byteLength(simpOnly)} bytes)/ tradOnly ${tradOnly.length} 字(${Buffer.byteLength(tradOnly)} bytes)`);
