#!/usr/bin/env node
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import fontkit from '@pdf-lib/fontkit';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const EXT_PATH = path.join(ROOT, 'transit');
const PDF_DIR = path.join(ROOT, 'docs/excluded/test pdf');
const CORPUS_DIR = path.join(PDF_DIR, 'corpus');
const RUN_DATE = new Date().toISOString().slice(0, 10);
const OUT_ROOT = path.join(PDF_DIR, `${RUN_DATE} test pdf output`);
const OUT_DIR = path.join(OUT_ROOT, 'corpus');

const argv = process.argv.slice(2);
const onlyIdx = argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1].toLowerCase() : null;
const limitIdx = argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : Infinity;
const MODE = argv.includes('--plain') ? 'plain' : 'pseudo-cjk';
const targetIdx = argv.indexOf('--target');
const TARGET_LANGUAGE = targetIdx >= 0 ? argv[targetIdx + 1] : null;
const ratioIdx = argv.indexOf('--ratio');
const PSEUDO_RATIO = ratioIdx >= 0 ? Number(argv[ratioIdx + 1]) : 0.45;
const HEADED = process.env.TRANSIT_HEADED === '1';
const PARSE_TIMEOUT_MS = 120_000;
const VERIFY_TIMEOUT_MS = 300_000;

const TC_FONT = fontkit.create(fs.readFileSync(path.join(EXT_PATH, 'lib/vendor/fonts/NotoSansTC-Regular.ttf')));
const fontHasGlyph = (cp) => { try { return TC_FONT.hasGlyphForCodePoint(cp); } catch { return false; } };
const PROBE_CHARS = new Set(['①', 'が', '简', '—', '𠮷', '😀']);
const NEG_BUCKETS = new Set(['encryption-broken', 'scanned', 'failed pdf']);
const NEG_CODES = new Set(['encrypted', 'invalid', 'open-failed', 'scanned', 'too-many-pages', 'too-large', 'rotated-content']);

function listFiles() {
  const out = [];
  const push = (bucket, dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!/\.pdf$/i.test(f)) continue;
      out.push({ bucket, file: path.join(dir, f), name: f });
    }
  };
  push('business', PDF_DIR);
  push('failed pdf', path.join(PDF_DIR, 'failed pdf'));
  if (fs.existsSync(CORPUS_DIR)) {
    for (const b of fs.readdirSync(CORPUS_DIR).sort()) {
      const d = path.join(CORPUS_DIR, b);
      if (fs.statSync(d).isDirectory()) push(b, d);
    }
  }
  return out;
}
let files = listFiles();
if (ONLY) files = files.filter((f) => f.bucket.toLowerCase() === ONLY || f.name.toLowerCase().includes(ONLY));
files = files.slice(0, LIMIT);
if (files.length === 0) { console.error('沒有符合的 PDF'); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

function stem(name) {
  return name.replace(/\.pdf$/i, '').replace(/[^\w一-鿿぀-ヿ가-힣؀-ۿ֐-׿\-.]+/g, '_').replace(/_+/g, '_').slice(0, 80);
}
function pdfinfo(file) {
  try {
    const txt = execFileSync('pdfinfo', [file], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 });
    const get = (k) => (txt.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || null;
    return { pages: Number(get('Pages')) || null, pageSize: get('Page size'), rot: get('Page rot'), encrypted: get('Encrypted'), producer: get('Producer'), tagged: get('Tagged') };
  } catch { return null; }
}
function pdftotextRaw(file) {
  try {
    return execFileSync('pdftotext', ['-raw', '-enc', 'UTF-8', file, '-'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
  } catch { return null; }
}
const stripWs = (s) => s.replace(/\s+/g, '');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-pdf-corpus-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [...(HEADED ? [] : ['--headless=new']), `--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-first-run', '--no-default-browser-check', '--mute-audio'],
});
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
const extensionId = worker.url().split('/')[2];
const DOC_URL = `chrome-extension://${extensionId}/translate-doc/index.html`;

let page = null;
let consoleLog = [];
async function freshPage() {
  if (page) await page.close().catch(() => {});
  page = await context.newPage();
  page.on('console', (msg) => { consoleLog.push({ t: msg.type(), text: msg.text() }); });
  page.on('pageerror', (err) => { consoleLog.push({ t: 'pageerror', text: err.message }); });
  await page.goto(DOC_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dropzone', { state: 'visible', timeout: 15_000 });
}
async function resetToUploadStage() {
  const inUpload = await page.$eval('#stage-upload', (el) => !el.hidden).catch(() => false);
  if (inUpload) return;
  for (const sel of ['#reupload-btn', '#reader-reupload-btn', '#cancel-btn', '#debug-back-btn']) {
    const btn = await page.$(sel);
    if (!btn) continue;
    const visible = await btn.evaluate((el) => { for (let n = el; n; n = n.parentElement) if (n.hasAttribute && n.hasAttribute('hidden')) return false; return true; }).catch(() => false);
    if (visible) {
      await btn.click().catch(() => {});
      await page.waitForSelector('#stage-upload:not([hidden])', { timeout: 5000 }).catch(() => {});
      return;
    }
  }
  await freshPage();
}
await freshPage();
if (TARGET_LANGUAGE) {
  await page.evaluate((lang) => new Promise((r) => chrome.storage.sync.set({ targetLanguage: lang }, r)), TARGET_LANGUAGE);
  const FONT_DIR = path.join(ROOT, 'docs/fonts');
  await context.route('https://seanmars.github.io/transit/fonts/**', (route) => {
    const file = path.join(FONT_DIR, path.basename(new URL(route.request().url()).pathname));
    if (!fs.existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: 'font/ttf', body: fs.readFileSync(file) });
  });
  const effective = await page.evaluate(async () => (await (await import('/lib/storage.js')).getSettings()).targetLanguage);
  console.log(`[target] ${TARGET_LANGUAGE}（遠端字型攔到本機 docs/fonts/；getSettings().targetLanguage = ${effective}）`);
}

const results = [];
const t0all = Date.now();
for (let i = 0; i < files.length; i++) {
  const { bucket, file, name } = files[i];
  const outDir = path.join(OUT_DIR, bucket.replace(/\s+/g, '-'), stem(name));
  fs.mkdirSync(outDir, { recursive: true });
  const r = { bucket, name, file: path.relative(ROOT, file), outDir: path.relative(ROOT, outDir), status: 'pending', flags: [], ms: 0 };
  consoleLog = [];
  const t0 = Date.now();
  process.stdout.write(`[${i + 1}/${files.length}] ${bucket}/${name} `);
  try {
    r.bytes = fs.statSync(file).size;
    r.infoOrig = pdfinfo(file);
    await resetToUploadStage();
    await page.evaluate(() => { window.__skLastParseError = null; });
    await page.setInputFiles('#file-input', file);
    const reached = await page.waitForFunction(() => {
      const res = document.getElementById('stage-result');
      const errEl = document.getElementById('upload-error');
      if (res && !res.hidden) return 'result';
      if (window.__skLastParseError) return 'error';
      if (errEl && !errEl.hidden && errEl.textContent.trim() && document.getElementById('stage-upload') && !document.getElementById('stage-upload').hidden) return 'error';
      return false;
    }, null, { timeout: PARSE_TIMEOUT_MS, polling: 250 }).catch(() => null);
    if (!reached) { r.status = 'FAIL'; r.error = 'parse-timeout'; throw new Error('parse-timeout'); }
    const stage = await reached.jsonValue();
    if (stage === 'error') {
      const perr = await page.evaluate(() => window.__skLastParseError);
      const msg = await page.$eval('#upload-error', (e) => e.textContent.trim()).catch(() => '');
      const code = (perr && perr.code) || (/MB/.test(msg) ? 'too-large' : 'unknown');
      r.parseError = { code, message: (perr && perr.message) || msg };
      if (code === 'scanned') {
        const popplerChars = (pdftotextRaw(file) || '').replace(/\s+/g, '').length;
        r.parseError.popplerChars = popplerChars;
        if (popplerChars < 200) r.status = 'NEG(scanned)';
        else { r.status = 'FAIL'; r.error = `parse:scanned-but-poppler-has-${popplerChars}-chars`; }
      } else if (code === 'rotated-content') {
        r.status = 'NEG(rotated-content)';
      } else if (code === 'encrypted') {
        if (!r.infoOrig) r.status = 'NEG(encrypted)';
        else { r.status = 'FAIL'; r.error = 'parse:encrypted-but-poppler-opens'; }
      } else if ((NEG_BUCKETS.has(bucket) || bucket === 'engine-fixtures') && NEG_CODES.has(code)) r.status = `NEG(${code})`;
      else { r.status = 'FAIL'; r.error = `parse:${code}`; }
      throw new Error('__done__');
    }

    const dyn = await page.evaluate(() => {
      const d = window.__skLayoutDoc;
      if (!d) return null;
      const typeCounts = {};
      let cjk = 0; let rtl = 0; let total = 0; let tiny = 0; let huge = 0; let bold = 0; let italic = 0; let links = 0;
      let minFs = Infinity; let maxFs = 0; let emptyPages = 0; let maxCol = 0; let translatable = 0;
      for (const p of d.pages) {
        if (p.blocks.length === 0) emptyPages++;
        if (p.columnCount > maxCol) maxCol = p.columnCount;
        for (const b of p.blocks) {
          typeCounts[b.type] = (typeCounts[b.type] || 0) + 1;
          const t = b.plainText || '';
          total += t.length;
          for (const ch of t) {
            const cp = ch.codePointAt(0);
            if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff)) cjk++;
            else if ((cp >= 0x0590 && cp <= 0x08ff)) rtl++;
          }
          if (b.fontSize < 4) tiny++;
          if (b.fontSize > 30) huge++;
          if (b.fontSize < minFs) minFs = b.fontSize;
          if (b.fontSize > maxFs) maxFs = b.fontSize;
          for (const s of (b.styleSegments || [])) { if (s.isBold) bold++; if (s.isItalic) italic++; }
          if (b.linkUrls && b.linkUrls.length) links += b.linkUrls.length;
        }
      }
      return {
        pageCount: d.pages.length,
        totalBlocks: d.pages.reduce((s, p) => s + p.blocks.length, 0),
        totalRuns: d.stats?.totalRuns || 0,
        totalChars: d.stats?.totalChars || 0,
        warnings: (d.warnings || []).map((w) => w.code),
        typeCounts, maxColumnCount: maxCol, emptyPages,
        cjkRatio: total ? Math.round(cjk / total * 100) / 100 : 0,
        rtlRatio: total ? Math.round(rtl / total * 100) / 100 : 0,
        tinyFontBlocks: tiny, hugeFontBlocks: huge,
        minFontSize: Math.round(minFs * 10) / 10, maxFontSize: Math.round(maxFs * 10) / 10,
        boldSegments: bold, italicSegments: italic, linkUrls: links,
        pageSizes: [...new Set(d.pages.map((p) => `${Math.round(p.viewport.width)}x${Math.round(p.viewport.height)}`))],
      };
    });
    r.doc = dyn;
    process.stdout.write(`p=${dyn.pageCount} b=${dyn.totalBlocks} `);

    await page.evaluate(() => window.__skInstallVerify());
    const struct = await page.evaluate(() => window.__skVerify.computeStructureDiagnostics());
    r.structure = { issueCount: struct.issueCount, byCode: {} , samples: struct.issues.slice(0, 6) };
    for (const it of struct.issues) r.structure.byCode[it.code] = (r.structure.byCode[it.code] || 0) + 1;
    if (struct.issueCount > 0) r.flags.push(`ir-issues:${struct.issueCount}`);

    const enhanced = await page.evaluate(
      ({ mode, timeout, ratio }) => Promise.race([
        window.__skVerify.runEnhancedVerify({ mode, keepBytes: true, pseudoRatio: ratio }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('enhanced-verify-timeout')), timeout)),
      ]),
      { mode: MODE, timeout: VERIFY_TIMEOUT_MS - 10_000, ratio: PSEUDO_RATIO },
    ).catch((err) => ({ ok: false, error: (err && err.message) || String(err) }));
    if (process.env.SK_DEBUG_FONT) console.log('\n  [debug] enhanced keys:', Object.keys(enhanced).join(','), '| buildTranslatedPdfMeta:', await page.evaluate(() => typeof window.__skVerify.buildTranslatedPdfMeta), '| fontSource:', enhanced.fontSource, '| fontFallback:', enhanced.fontFallback);
    if (!enhanced.ok) { r.status = 'FAIL'; r.error = `generate:${enhanced.error}`; throw new Error('__done__'); }
    const bytes = Buffer.from(enhanced.bytesBase64, 'base64');
    const translatedPath = path.join(outDir, 'translated.pdf');
    fs.writeFileSync(translatedPath, bytes);
    r.translated = { bytes: bytes.length, sizeRatio: Math.round(bytes.length / r.bytes * 100) / 100, translatableCount: enhanced.translatableCount };
    r.translated.fontSource = enhanced.fontSource || null;
    if (enhanced.fontFallback) r.flags.push('font-fallback');
    r.bold = { total: enhanced.bold.totalBoldBlocks, lost: enhanced.bold.lostCount, samples: enhanced.bold.lostBlocks.slice(0, 5) };
    r.links = { total: enhanced.links.totalLinks, lost: enhanced.links.lostCount, samples: enhanced.links.lostLinks.slice(0, 5) };
    r.overflow = { checked: enhanced.overflow.totalChecked, risk: enhanced.overflow.riskCount, actual: enhanced.overflow.actualOverflowCount, samples: enhanced.overflow.actualOverflowSamples.slice(0, 5) };
    if (r.bold.lost > 0) r.flags.push(`bold-lost:${r.bold.lost}/${r.bold.total}`);
    if (r.links.lost > 0) r.flags.push(`links-lost:${r.links.lost}/${r.links.total}`);
    if (r.overflow.actual > 0) r.flags.push(`overflow-actual:${r.overflow.actual}`);
    if (r.translated.sizeRatio > 3 && bytes.length > 2_000_000) r.flags.push(`size-ratio:${r.translated.sizeRatio}`);

    const layout = await page.evaluate(() => {
      const d = window.__skLayoutDoc;
      return {
        pages: d.pages.map((p) => ({
          pageIndex: p.pageIndex,
          viewport: { width: p.viewport.width, height: p.viewport.height },
          blocks: p.blocks.map((b) => ({
            blockId: b.blockId, type: b.type, bbox: b.bbox, fontSize: b.fontSize,
            translated: !!(b.translation && b.translationStatus === 'done'),
            translation: b.translation || null,
          })),
        })),
      };
    });
    fs.writeFileSync(path.join(outDir, 'layout.json'), JSON.stringify(layout));

    const tl = enhanced.textLayer || { checked: 0, missingBlocks: 0, missingChars: 0, blocks: [] };
    const classify = (ch) => {
      const cp = ch.codePointAt(0);
      if (PROBE_CHARS.has(ch)) return 'probe';
      if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0xe000 && cp <= 0xf8ff)) return 'control';
      const known = (cp < 0x0530) || (cp >= 0x2000 && cp <= 0x2bff) || (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xffef);
      if (!known) return 'foreign';
      return fontHasGlyph(cp) ? 'lost' : 'tofu';
    };
    const agg = { probe: {}, control: {}, foreign: {}, tofu: {}, lost: {} };
    let truncatedBlocks = 0; let lostBlocks = 0; const lostSamples = [];
    for (const b of tl.blocks || []) {
      let lost = '';
      for (const ch of b.missing) { const k = classify(ch); agg[k][ch] = (agg[k][ch] || 0) + 1; if (k === 'lost') lost += ch; }
      if (!lost) continue;
      lostBlocks++;
      const tailNeed = new Map();
      for (const ch of b.tail) tailNeed.set(ch, (tailNeed.get(ch) || 0) + 1);
      let hit = 0;
      for (const ch of lost) { const n = tailNeed.get(ch); if (n) { hit++; tailNeed.set(ch, n - 1); } }
      const truncated = lost.length >= 4 && hit / lost.length > 0.8;
      if (truncated) truncatedBlocks++;
      if (lostSamples.length < 6) lostSamples.push({ pageIndex: b.pageIndex, blockId: b.blockId, type: b.type, expectedLen: b.expectedLen, lost: lost.slice(0, 30), truncated });
    }
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, n]) => `${c}×${n}`);
    r.textLayer = { checked: tl.checked, missingBlocks: tl.missingBlocks, lostBlocks, truncatedBlocks,
      tofuChars: sum(agg.tofu), tofuTop: top(agg.tofu), lostChars: sum(agg.lost), lostTop: top(agg.lost),
      foreignChars: sum(agg.foreign), controlChars: sum(agg.control), probeTofu: agg.probe, samples: lostSamples };
    if (r.textLayer.foreignChars > 0) r.flags.push(`foreign-tofu:${r.textLayer.foreignChars}`);
    if (r.textLayer.controlChars > 0) r.flags.push(`control-chars:${r.textLayer.controlChars}`);
    if (r.textLayer.truncatedBlocks > 0) r.flags.push(`truncated:${r.textLayer.truncatedBlocks}`);
    r.textLayer.rightOverflowItems = tl.rightOverflowItems || 0;
    r.textLayer.rightOverflowSamples = tl.rightOverflowSamples || [];
    if (r.textLayer.rightOverflowItems > 0) r.flags.push(`right-overflow:${r.textLayer.rightOverflowItems}`);
    r.textLayer.ellipsisBlocks = tl.ellipsisBlocks || 0;
    if (r.textLayer.ellipsisBlocks > 0) r.flags.push(`clipped-ellipsis:${r.textLayer.ellipsisBlocks}`);
    if (r.textLayer.tofuChars > 0) r.flags.push(`tofu:${r.textLayer.tofuChars}`);
    if (r.textLayer.lostChars > 0) r.flags.push(`text-lost:${r.textLayer.lostChars}`);

    r.infoTrans = pdfinfo(translatedPath);
    if (r.infoOrig && r.infoTrans) {
      if (r.infoOrig.pages !== r.infoTrans.pages) r.flags.push(`pages-changed:${r.infoOrig.pages}->${r.infoTrans.pages}`);
      if (r.infoOrig.pageSize !== r.infoTrans.pageSize) r.flags.push(`page-size-changed`);
      if ((r.infoOrig.rot || '0') !== (r.infoTrans.rot || '0')) r.flags.push(`rotate-changed:${r.infoOrig.rot}->${r.infoTrans.rot}`);
    }

    const skips = consoleLog.filter((c) => /drawText 跳過/.test(c.text));
    r.drawSkips = { count: skips.length, samples: skips.slice(0, 3).map((c) => c.text.slice(0, 120)) };
    if (skips.length > 0) r.flags.push(`draw-skip:${skips.length}`);
    const errs = consoleLog.filter((c) => c.t === 'pageerror' || (c.t === 'error' && !/favicon/.test(c.text)));
    if (errs.length) { r.consoleErrors = errs.slice(0, 5).map((c) => c.text.slice(0, 200)); r.flags.push(`console-errors:${errs.length}`); }

    const hardFail = r.flags.some((f) => /^(text-lost|truncated|pages-changed|page-size-changed|rotate-changed|console-errors|draw-skip)/.test(f));
    r.status = hardFail ? 'FAIL' : (r.flags.length ? 'WARN' : 'OK');
  } catch (err) {
    if (err.message !== '__done__') {
      if (r.status === 'pending') { r.status = 'FAIL'; r.error = err.message.slice(0, 200); }
      await freshPage().catch(() => {});
    }
  }
  r.ms = Date.now() - t0;
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(r, null, 1));
  results.push(r);
  console.log(`→ ${r.status}${r.error ? ' ' + r.error : ''}${r.flags.length ? ' [' + r.flags.join(' ') + ']' : ''} (${(r.ms / 1000).toFixed(1)}s)`);
}

await context.close();
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {   }

const counts = { OK: 0, WARN: 0, NEG: 0, FAIL: 0 };
for (const r of results) counts[r.status.startsWith('NEG') ? 'NEG' : r.status]++;
const lines = [];
lines.push(`# PDF corpus verify（${MODE}）`, '', `執行：${new Date().toISOString()}，${results.length} 檔，${Math.round((Date.now() - t0all) / 1000)}s`, '',
  `結果：OK=${counts.OK} WARN=${counts.WARN} NEG=${counts.NEG} FAIL=${counts.FAIL}`, '');
lines.push('| bucket | 檔案 | 狀態 | 頁 | blocks | 譯 | flags |', '|---|---|---|---|---|---|---|');
for (const r of results) {
  lines.push(`| ${r.bucket} | ${r.name.slice(0, 48)} | ${r.status} | ${r.doc?.pageCount ?? '-'} | ${r.doc?.totalBlocks ?? '-'} | ${r.translated?.translatableCount ?? '-'} | ${r.error ? r.error : r.flags.join(' ')} |`);
}
lines.push('', '## FAIL 明細', '');
for (const r of results.filter((x) => x.status === 'FAIL')) {
  lines.push(`### ${r.bucket}/${r.name}`, `- error: ${r.error || '-'}；flags: ${r.flags.join(' ') || '-'}`);
  if (r.structure?.samples?.length) for (const s of r.structure.samples.slice(0, 4)) lines.push(`  - IR p${s.pageIndex} ${s.blockId} \`${s.code}\` ${s.detail}`);
  if (r.textLayer) lines.push(`- textLayer: checked=${r.textLayer.checked} lostBlocks=${r.textLayer.lostBlocks} truncated=${r.textLayer.truncatedBlocks} tofu=[${r.textLayer.tofuTop.join(' ')}] lost=[${r.textLayer.lostTop.join(' ')}] foreign=${r.textLayer.foreignChars} control=${r.textLayer.controlChars}`);
  if (r.textLayer?.samples?.length) for (const s of r.textLayer.samples.slice(0, 4)) lines.push(`  - p${s.pageIndex} ${s.blockId} ${s.type} len=${s.expectedLen} lost=「${s.lost}」${s.truncated ? ' TRUNCATED' : ''}`);
  if (r.consoleErrors) for (const e of r.consoleErrors) lines.push(`  - console: ${e}`);
  lines.push('');
}
lines.push('## flag 統計', '');
const flagCounts = {};
for (const r of results) for (const f of r.flags) { const k = f.split(':')[0]; flagCounts[k] = (flagCounts[k] || 0) + 1; }
for (const [k, n] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1])) lines.push(`- ${k}: ${n} 檔`);
fs.writeFileSync(path.join(OUT_ROOT, 'pdf-corpus-report.md'), lines.join('\n'), 'utf-8');
fs.writeFileSync(path.join(OUT_ROOT, 'pdf-corpus-report.json'), JSON.stringify(results, null, 1), 'utf-8');
console.log(`\n=== pdf-corpus-verify: OK=${counts.OK} WARN=${counts.WARN} NEG=${counts.NEG} FAIL=${counts.FAIL} / ${results.length}（${Math.round((Date.now() - t0all) / 1000)}s） ===`);
console.log('report:', path.relative(ROOT, path.join(OUT_ROOT, 'pdf-corpus-report.md')));
process.exit(counts.FAIL > 0 ? 1 : 0);
