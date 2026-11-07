import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXT_PATH = path.join(REPO_ROOT, 'transit');
const OUT_DIR = path.join(REPO_ROOT, '.playwright-mcp');
const DUMP_PATH = path.join(OUT_DIR, 'pdf-layout-dump.json');
const SUMMARY_PATH = path.join(OUT_DIR, 'pdf-layout-summary.txt');

const PDF_PATH = process.env.PDF_PATH;
const HEADED = process.env.TRANSIT_HEADED === '1';
const KEEP = process.argv.includes('--keep');
const RUN_TRANSLATE = process.argv.includes('--translate');
const PAGE_RANGE = (process.env.PAGE_RANGE || '').trim();
const PARSE_TIMEOUT_MS = 60_000;
const TRANSLATE_TIMEOUT_MS = 10 * 60_000;

const KEY_PATH = path.join(os.homedir(), '.transit-test-key');
const HAS_TEST_KEY = fs.existsSync(KEY_PATH);
const TEST_KEY = HAS_TEST_KEY ? fs.readFileSync(KEY_PATH, 'utf8').trim() : '';

if (!PDF_PATH) {
  console.error('錯誤:請設定 PDF_PATH 環境變數,例:');
  console.error('  PDF_PATH=/Users/you/sample.pdf node tools/harness/pdf-layout-harness.js');
  process.exit(1);
}
if (!fs.existsSync(PDF_PATH)) {
  console.error(`錯誤:PDF 不存在:${PDF_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
  console.error(`錯誤:找不到 extension manifest:${EXT_PATH}/manifest.json`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-pdf-harness-'));
  console.log('[harness] launch chromium with extension');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      ...(HEADED ? [] : ['--headless=new']),
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  let [worker] = context.serviceWorkers();
  if (!worker) {
    console.log('[harness] 等 service worker…');
    worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  }
  const extensionId = worker.url().split('/')[2];
  console.log(`[harness] extensionId: ${extensionId}`);

  const page = await context.newPage();

  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning' || /Transit/.test(msg.text())) {
      console.log(`PAGE[${t}]>`, msg.text());
    }
  });
  page.on('pageerror', (err) => console.log('PAGE[error]>', err.message));

  if (RUN_TRANSLATE && TEST_KEY) {
    const optionsUrl = `chrome-extension://${extensionId}/options/options.html`;
    console.log(`[harness] 注入 apiKey 到 chrome.storage.local…`);
    await page.goto(optionsUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate((apiKey) => new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set({ apiKey }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve();
        });
      } catch (err) { reject(err); }
    }), TEST_KEY);
    console.log(`[harness] apiKey 已注入(${TEST_KEY.length} chars)`);
  }

  const url = `chrome-extension://${extensionId}/translate-doc/index.html`;
  console.log(`[harness] navigate ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#dropzone', { state: 'visible', timeout: 10_000 });

  console.log(`[harness] 餵 PDF: ${PDF_PATH}`);
  await page.setInputFiles('#file-input', PDF_PATH);

  console.log('[harness] 等版面分析完成…');
  try {
    await page.waitForFunction(
      () => {
        const stageResult = document.getElementById('stage-result');
        const stageUpload = document.getElementById('stage-upload');
        const errEl = document.getElementById('upload-error');
        if (stageResult && !stageResult.hidden) return 'result';
        if (errEl && !errEl.hidden && errEl.textContent.trim()) return 'error';
        if (stageUpload && !stageUpload.hidden && errEl && !errEl.hidden) return 'error';
        return false;
      },
      null,
      { timeout: PARSE_TIMEOUT_MS, polling: 250 }
    );
  } catch (err) {
    console.error('[harness] 解析超時或失敗:', err.message);
    await page.screenshot({ path: path.join(OUT_DIR, 'pdf-layout-timeout.png'), fullPage: true });
    if (!KEEP) await context.close();
    process.exit(2);
  }

  const errorState = await page.evaluate(() => {
    const errEl = document.getElementById('upload-error');
    if (!errEl || errEl.hidden) return null;
    const stageResult = document.getElementById('stage-result');
    if (stageResult && !stageResult.hidden) { console.log('[Transit harness] 解析警告：' + errEl.textContent.trim()); return null; }
    return errEl.textContent.trim();
  });
  if (errorState) {
    console.error('[harness] 解析錯誤:', errorState);
    await page.screenshot({ path: path.join(OUT_DIR, 'pdf-layout-error.png'), fullPage: true });
    if (!KEEP) await context.close();
    process.exit(3);
  }

  const dump = await page.evaluate(() => window.__skLayoutDoc || null);
  if (!dump) {
    console.error('[harness] window.__skLayoutDoc 沒有資料,index.js 可能沒寫 expose');
    await page.screenshot({ path: path.join(OUT_DIR, 'pdf-layout-no-dump.png'), fullPage: true });
    if (!KEEP) await context.close();
    process.exit(4);
  }

  fs.writeFileSync(DUMP_PATH, JSON.stringify(dump, null, 2), 'utf-8');
  console.log(`[harness] 完整 layout 寫到 ${path.relative(REPO_ROOT, DUMP_PATH)} (${(fs.statSync(DUMP_PATH).size / 1024).toFixed(1)} KB)`);

  if (RUN_TRANSLATE) {
    if (TEST_KEY) {
      console.log('[harness] --translate 啟動翻譯(用 ~/.transit-test-key)');
    } else {
      console.log('[harness] --translate 啟動翻譯(無 ~/.transit-test-key,需環境內已設 apiKey)');
    }
    if (PAGE_RANGE) {
      const m = PAGE_RANGE.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) {
        console.error(`[harness] PAGE_RANGE 格式錯誤（要 <from>-<to>，例 1-3）:${PAGE_RANGE}`);
        process.exit(5);
      }
      await page.fill('#page-range-from', m[1]);
      await page.dispatchEvent('#page-range-from', 'change');
      await page.fill('#page-range-to', m[2]);
      await page.dispatchEvent('#page-range-to', 'change');
      const applied = await page.evaluate(() => ({
        from: document.getElementById('page-range-from').value,
        to: document.getElementById('page-range-to').value,
      }));
      console.log(`[harness] 翻譯頁數範圍：${applied.from}-${applied.to}`);
    }
    await page.click('#translate-btn');
    try {
      await page.waitForSelector('#stage-reader:not([hidden])', { timeout: TRANSLATE_TIMEOUT_MS });
      const translatedDump = await page.evaluate(() => window.__skLayoutDoc || null);
      if (translatedDump) {
        fs.writeFileSync(DUMP_PATH, JSON.stringify(translatedDump, null, 2), 'utf-8');
        console.log(`[harness] 翻譯後 layout 已覆寫 dump (${(fs.statSync(DUMP_PATH).size / 1024).toFixed(1)} KB)`);
      }
      try {
        await page.waitForSelector('.reader-page-translated canvas', { timeout: 30_000 });
        await page.waitForFunction(() => typeof window.__skReaderRenderAll === 'function', { timeout: 30_000 });
        await page.evaluate(() => window.__skReaderRenderAll());
        await page.waitForFunction(() => {
          const ps = Array.from(document.querySelectorAll('.reader-page-translated'));
          if (ps.length === 0) return false;
          return ps.every((p) => {
            const c = p.querySelector('canvas');
            return c && c.width > 100 && c.height > 100 && p.dataset.baseHeight;
          });
        }, { timeout: 60_000 });
        const both = await page.evaluate(() => {
          const tr = Array.from(document.querySelectorAll('.reader-page-translated canvas')).map((c) => c.toDataURL('image/png'));
          const og = Array.from(document.querySelectorAll('.reader-page-original canvas')).map((c) => c.toDataURL('image/png'));
          return { tr, og };
        });
        for (let i = 0; i < both.tr.length; i++) {
          const b64 = both.tr[i].replace(/^data:image\/png;base64,/, '');
          const shotPath = path.join(OUT_DIR, `pdf-translated-page-${i}.png`);
          fs.writeFileSync(shotPath, Buffer.from(b64, 'base64'));
          console.log(`[harness] 譯文第 ${i + 1} 頁截圖 → ${path.relative(REPO_ROOT, shotPath)}`);
        }
        for (let i = 0; i < both.og.length; i++) {
          const b64 = both.og[i].replace(/^data:image\/png;base64,/, '');
          const shotPath = path.join(OUT_DIR, `pdf-original-page-${i}.png`);
          fs.writeFileSync(shotPath, Buffer.from(b64, 'base64'));
          console.log(`[harness] 原稿第 ${i + 1} 頁截圖 → ${path.relative(REPO_ROOT, shotPath)}`);
        }
      } catch (err) {
        console.warn('[harness] 譯文截圖失敗(reader canvas 還沒 ready?):', err.message);
      }
      try {
        const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
        await page.click('#reader-download-pdf-btn');
        const download = await downloadPromise;
        const pdfPath = path.join(OUT_DIR, 'pdf-translated.pdf');
        await download.saveAs(pdfPath);
        console.log(`[harness] 譯文 PDF 下載到 ${path.relative(REPO_ROOT, pdfPath)}`);
      } catch (err) {
        console.warn('[harness] 譯文 PDF 下載失敗:', err.message);
      }
    } catch (err) {
      console.error('[harness] 翻譯流程超時 / 失敗:', err.message);
      await page.screenshot({ path: path.join(OUT_DIR, 'pdf-translate-timeout.png'), fullPage: true });
    }
  }

  const summary = buildSummary(dump);
  fs.writeFileSync(SUMMARY_PATH, summary, 'utf-8');
  console.log(`[harness] 摘要寫到 ${path.relative(REPO_ROOT, SUMMARY_PATH)}`);

  console.log('\n========== high-level 摘要 ==========');
  const totalBlocks = dump.pages.reduce((s, p) => s + p.blocks.length, 0);
  console.log(`檔名: ${dump.meta.filename}`);
  console.log(`頁數: ${dump.meta.pageCount}, 總 block 數: ${totalBlocks}`);
  console.log(`pages columnCount: [${dump.pages.map((p) => p.columnCount).join(', ')}]`);
  console.log(`pages medianLineHeight: [${dump.pages.map((p) => p.medianLineHeight.toFixed(1)).join(', ')}]`);
  console.log(`warnings: ${dump.warnings.length} 條`);
  console.log('=====================================');

  if (!KEEP) {
    await context.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {   }
  } else {
    console.log('[harness] --keep 啟用,browser 留著(Ctrl-C 收掉)');
  }
}

function buildSummary(dump) {
  const lines = [];
  const totalBlocks = dump.pages.reduce((s, p) => s + p.blocks.length, 0);

  lines.push(`# PDF Layout Dump — ${dump.meta.filename}`);
  lines.push('');
  lines.push(`頁數: ${dump.meta.pageCount}, pageSize: ${dump.meta.pageSize.width.toFixed(0)} × ${dump.meta.pageSize.height.toFixed(0)}pt`);
  lines.push(`總 block: ${totalBlocks}, totalRuns: ${dump.stats.totalRuns}, totalChars: ${dump.stats.totalChars}`);
  if (dump.warnings.length > 0) {
    lines.push(`warnings: ${dump.warnings.map((w) => w.code + ' (' + w.message + ')').join(', ')}`);
  }
  lines.push('');

  for (const page of dump.pages) {
    const typeCounts = {};
    for (const b of page.blocks) typeCounts[b.type] = (typeCounts[b.type] || 0) + 1;
    const typeStr = Object.entries(typeCounts).map(([t, n]) => `${t} ${n}`).join(' / ');
    const emptyMark = page.blocks.length === 0 ? '  [空白頁/純圖]' : '';
    lines.push(`## p${page.pageIndex}  ${page.viewport.width.toFixed(0)} × ${page.viewport.height.toFixed(0)}pt  · column ${page.columnCount}  · medianLineHeight ${page.medianLineHeight.toFixed(1)}pt  · bodyFs ${(page.bodyFontSize || 0).toFixed(1)}pt  · blocks ${page.blocks.length}${typeStr ? '  (' + typeStr + ')' : ''}${emptyMark}`);
    lines.push('');

    const issues = [];
    const pageW = page.viewport.width;
    const pageH = page.viewport.height;
    for (const b of page.blocks) {
      const [x0, y0, x1, y1] = b.bbox;
      const w = x1 - x0;
      const h = y1 - y0;
      const reasons = [];

      if (page.columnCount >= 2 && w > pageW * 0.7) {
        reasons.push(`寬 ${w.toFixed(0)}pt(>${(pageW * 0.7).toFixed(0)}pt) 跨欄`);
      }
      if (b.lineCount > 18) {
        reasons.push(`${b.lineCount} 行未切`);
      }
      if (b.plainText.length < 3 && w < 50 && h < 30) {
        reasons.push('短 cell');
      }
      if (w > pageW * 0.5 && b.plainText.length < 30) {
        reasons.push('大 bbox 但少字');
      }

      if (reasons.length > 0) issues.push({ block: b, reasons });
    }

    if (issues.length > 0) {
      lines.push('### 潛在問題 block:');
      for (const { block, reasons } of issues.slice(0, 30)) {
        const [x0, y0, x1, y1] = block.bbox;
        lines.push(`  - #${block.readingOrder} ${block.blockId} col=${block.column} bbox=[${x0.toFixed(0)},${y0.toFixed(0)},${x1.toFixed(0)},${y1.toFixed(0)}] lines=${block.lineCount} runs=${block.runCount} fs=${block.fontSize.toFixed(1)}pt`);
        lines.push(`      原因: ${reasons.join(' / ')}`);
        lines.push(`      文字: ${truncate(block.plainText, 100)}`);
      }
      if (issues.length > 30) lines.push(`  ...還有 ${issues.length - 30} 條`);
      lines.push('');
    }

    lines.push('### 全部 block:');
    for (const b of page.blocks) {
      const [x0, y0, x1, y1] = b.bbox;
      lines.push(`  #${b.readingOrder} ${b.blockId} ${b.type} col=${b.column} bbox=[${x0.toFixed(0)},${y0.toFixed(0)},${x1.toFixed(0)},${y1.toFixed(0)}] lines=${b.lineCount} fs=${b.fontSize.toFixed(1)}pt | ${truncate(b.plainText, 80)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function truncate(s, n) {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n) + '…';
}

main().catch((err) => {
  console.error('[harness] fatal:', err);
  process.exit(1);
});
