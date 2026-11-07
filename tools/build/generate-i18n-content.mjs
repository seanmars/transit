#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
const EXT = path.join(ROOT, 'transit');
export const SOURCE_PATH = path.join(EXT, 'lib', 'i18n.js');
export const OUTPUT_PATH = path.join(EXT, 'lib', 'i18n-content.js');

const LANGS = ['ZH_TW', 'ZH_CN', 'EN', 'JA', 'KO', 'ES', 'FR', 'DE'];
export const DYNAMIC_PREFIXES = ['error.bg.'];

function dictBlock(src, lang) {
  const start = src.indexOf(`// === ${lang}_DICT_START ===`);
  const end = src.indexOf(`// === ${lang}_DICT_END ===`);
  if (start === -1 || end === -1) throw new Error(`i18n.js 缺 ${lang} dict marker`);
  return { start, end: end + `// === ${lang}_DICT_END ===`.length };
}

const ENTRY_RE = /^(\s*)'([^']+)':\s*(.+),\s*$/;

export function parseDictEntries(blockText) {
  const entries = new Map();
  for (const line of blockText.split('\n')) {
    const m = line.match(ENTRY_RE);
    if (m) entries.set(m[2], line);
  }
  return entries;
}

export function contentScriptFiles() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf-8'));
  const files = new Set();
  for (const cs of manifest.content_scripts || []) {
    for (const js of cs.js || []) {
      if (js === 'lib/i18n.js' || js === 'lib/i18n-content.js') continue;
      files.add(js);
    }
  }
  return [...files];
}

export function collectContentKeys(zhTWKeys) {
  const keys = new Set();
  for (const rel of contentScriptFiles()) {
    const src = fs.readFileSync(path.join(EXT, rel), 'utf-8');
    for (const m of src.matchAll(/'([A-Za-z][A-Za-z0-9_.-]*)'/g)) {
      if (zhTWKeys.has(m[1])) keys.add(m[1]);
    }
  }
  for (const k of zhTWKeys) {
    if (DYNAMIC_PREFIXES.some((p) => k.startsWith(p))) keys.add(k);
  }
  return keys;
}

export function buildContentI18n() {
  const src = fs.readFileSync(SOURCE_PATH, 'utf-8');
  const zh = dictBlock(src, 'ZH_TW');
  const zhTWKeys = new Set(parseDictEntries(src.slice(zh.start, zh.end)).keys());
  const keys = collectContentKeys(zhTWKeys);
  const sortedKeys = [...zhTWKeys].filter((k) => keys.has(k));

  let out = src;
  for (const lang of [...LANGS].reverse()) {
    const { start, end } = dictBlock(out, lang);
    const block = out.slice(start, end);
    const entries = parseDictEntries(block);
    const varName = block.match(/const (messages_\w+) = \{/)?.[1];
    if (!varName) throw new Error(`${lang} dict 找不到 const messages_* 宣告`);
    const lines = [
      `// === ${lang}_DICT_START ===`,
      `  const ${varName} = {`,
    ];
    for (const k of sortedKeys) {
      const line = entries.get(k);
      if (!line) throw new Error(`${lang} dict 缺 key ${k}（先跑 i18n-sync-check 對齊 8 語）`);
      lines.push(line);
    }
    lines.push('  };', `  // === ${lang}_DICT_END ===`);
    out = out.slice(0, start) + lines.join('\n') + out.slice(end);
  }
  const iife = out.indexOf('(function (global) {');
  out = out.slice(iife);
  return { text: out, keys: sortedKeys };
}

function main() {
  const check = process.argv.includes('--check');
  const { text, keys } = buildContentI18n();
  if (check) {
    const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf-8') : '';
    if (current !== text) {
      console.error(`✗ lib/i18n-content.js 已過期（${keys.length} 個 key），請跑：node tools/build/generate-i18n-content.mjs`);
      process.exit(1);
    }
    console.log(`✓ lib/i18n-content.js 與 lib/i18n.js 一致（${keys.length} 個 key）`);
    return;
  }
  fs.writeFileSync(OUTPUT_PATH, text);
  console.log(`✓ 已產出 ${path.relative(ROOT, OUTPUT_PATH)}：${keys.length} 個 key，${(text.length / 1024).toFixed(1)}KB（完整 dict ${(fs.statSync(SOURCE_PATH).size / 1024).toFixed(1)}KB）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
