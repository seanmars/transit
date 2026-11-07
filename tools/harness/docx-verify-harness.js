import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const EXT = path.join(ROOT, 'transit');
const CORPUS_DIR = process.env.CORPUS_DIR
  || path.join(ROOT, 'docs/excluded/test docx/corpus');
const SINGLE = process.env.FILE || null;
const SAVE = process.argv.includes('--save');

const today = new Date().toISOString().slice(0, 10);
const OUT_DIR = path.join(ROOT, `docs/excluded/test docx/${today} output`);
fs.mkdirSync(OUT_DIR, { recursive: true });
const PSEUDO_DIR = path.join(OUT_DIR, 'pseudo');
if (SAVE) fs.mkdirSync(PSEUDO_DIR, { recursive: true });

const files = SINGLE
  ? [SINGLE]
  : ['lo-fixtures', 'real-world'].flatMap((sub) => {
    const dir = path.join(CORPUS_DIR, sub);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.docx')).sort()
      .map((f) => path.join(dir, f));
  });
if (files.length === 0) {
  console.error('找不到語料檔（CORPUS_DIR=' + CORPUS_DIR + '）');
  process.exit(1);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-docx-verify-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    '--headless=new',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
  ],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extensionId = new URL(sw.url()).host;
const page = await ctx.newPage();
await page.goto(`chrome-extension://${extensionId}/translate-doc/index.html`, { waitUntil: 'domcontentloaded' });

const report = [];
let okCount = 0;
let negOk = 0;
let failCount = 0;

for (const file of files) {
  const name = path.basename(file);
  const b64 = fs.readFileSync(file).toString('base64');
  const t0 = Date.now();
  let res;
  try {
    res = await page.evaluate(async ({ b64Str, save }) => {
      const eng = await import('/translate-doc/docx-engine.js');
      const bytes = Uint8Array.from(atob(b64Str), (c) => c.charCodeAt(0));
      const toB64 = (u8) => {
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) {
          s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        }
        return btoa(s);
      };
      const file = new File([bytes], 'probe.docx');
      let doc;
      try {
        doc = await eng.parseDocxFile(file, () => {}, {});
      } catch (err) {
        if (err && err.name === 'DocxParseError') {
          return { negative: err.code };
        }
        return { error: 'parse-throw: ' + (err && err.message) };
      }
      const blocks = doc.chapters.flatMap((c) => c.blocks);
      const islands = doc.docxParas.reduce((a, p) => a + p.islands.length, 0);
      for (const b of blocks) {
        b.translationRaw = '偽' + b.epubSerializedText;
        b.translation = b.translationRaw;
        b.translationStatus = 'done';
      }
      const checkParts = (bytesOut) => {
        const entries = window.fflate.unzipSync(bytesOut);
        const bad = [];
        for (const [p, u8] of Object.entries(entries)) {
          if (!/\.xml$/.test(p)) continue;
          const xml = window.fflate.strFromU8(u8);
          const parsed = new DOMParser().parseFromString(xml, 'application/xml');
          if (parsed.getElementsByTagName('parsererror').length > 0) bad.push(p);
        }
        return { entries, bad };
      };
      let mono;
      let dual;
      try {
        mono = eng.buildTranslatedDocx(doc, 'zh-TW', { bilingual: false });
        dual = eng.buildTranslatedDocx(doc, 'zh-TW', { bilingual: true });
      } catch (err) {
        return { error: 'build-throw: ' + (err && err.message) };
      }
      const monoCheck = checkParts(mono.bytes);
      const dualCheck = checkParts(dual.bytes);
      const srcEntries = window.fflate.unzipSync(bytes);
      const ctName = '[Content_Types].xml';
      const ctSame = srcEntries[ctName] && monoCheck.entries[ctName]
        && srcEntries[ctName].length === monoCheck.entries[ctName].length
        && srcEntries[ctName].every((v, i) => v === monoCheck.entries[ctName][i]);
      let reparse;
      try {
        reparse = await eng.parseDocxFile(new File([mono.bytes], 'probe2.docx'), () => {}, {});
      } catch (err) {
        return { error: 'reparse-throw: ' + (err && err.message) + (monoCheck.bad.length ? ' badXml=' + monoCheck.bad.join(',') : '') };
      }
      const reBlocks = reparse.chapters.flatMap((c) => c.blocks);
      const missing = reBlocks.filter((b) => !b.plainText.startsWith('偽')).length;
      return {
        blocks: blocks.length,
        islands,
        chapters: doc.chapters.length,
        reBlocks: reBlocks.length,
        missingPseudo: missing,
        badXmlMono: monoCheck.bad,
        badXmlDual: dualCheck.bad,
        ctSame: !!ctSame,
        monoB64: save ? toB64(mono.bytes) : null,
        dualB64: save ? toB64(dual.bytes) : null,
      };
    }, { b64Str: b64, save: SAVE });
  } catch (err) {
    res = { error: 'evaluate-throw: ' + err.message };
  }
  const ms = Date.now() - t0;

  if (SAVE && res.monoB64) {
    const stem = name.replace(/\.docx$/i, '');
    fs.writeFileSync(path.join(PSEUDO_DIR, `${stem}-mono.docx`), Buffer.from(res.monoB64, 'base64'));
    fs.writeFileSync(path.join(PSEUDO_DIR, `${stem}-dual.docx`), Buffer.from(res.dualB64, 'base64'));
  }
  delete res.monoB64;
  delete res.dualB64;

  let status;
  if (res.negative) {
    status = `NEG(${res.negative})`;
    negOk++;
  } else if (res.error) {
    status = 'FAIL';
    failCount++;
  } else if (res.badXmlMono.length || res.badXmlDual.length
    || res.missingPseudo > 0 || res.blocks !== res.reBlocks || !res.ctSame) {
    status = 'FAIL';
    failCount++;
  } else {
    status = 'OK';
    okCount++;
  }
  report.push({ file: name, status, ms, ...res });
  const detail = res.error ? res.error
    : res.negative ? ''
      : `blocks=${res.blocks} islands=${res.islands} ch=${res.chapters}`
        + (res.missingPseudo ? ` MISSING=${res.missingPseudo}` : '')
        + (res.blocks !== res.reBlocks ? ` REBLOCKS=${res.reBlocks}` : '')
        + (res.badXmlMono?.length ? ` BADXML=${res.badXmlMono.join(',')}` : '')
        + (res.badXmlDual?.length ? ` BADXML-DUAL=${res.badXmlDual.join(',')}` : '')
        + (!res.ctSame ? ' CT-DRIFT' : '');
  console.log(`${status.padEnd(18)} ${String(ms).padStart(5)}ms  ${name}  ${detail}`);
}

const reportPath = path.join(OUT_DIR, 'docx-verify-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n=== docx-verify: OK=${okCount} NEG=${negOk} FAIL=${failCount} / ${files.length} ===`);
console.log('report:', reportPath);
await ctx.close();
process.exit(failCount > 0 ? 1 : 0);
