import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const EXT = path.join(ROOT, 'transit');
const KEY_PATH = path.join(os.homedir(), '.transit-test-key');
const FILE = process.env.FILE;
const WITH_DUAL = process.argv.includes('--dual');

if (!FILE || !fs.existsSync(FILE)) {
  console.error('FILE 未設定或檔案不存在');
  process.exit(1);
}
if (!fs.existsSync(KEY_PATH)) {
  console.error(`找不到 ${KEY_PATH}`);
  process.exit(1);
}
const API_KEY = fs.readFileSync(KEY_PATH, 'utf-8').trim();
const today = new Date().toISOString().slice(0, 10);
const OUT_DIR = path.join(ROOT, `docs/excluded/test docx/${today} output`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-docx-harness-'));
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
const extId = new URL(sw.url()).host;
const page = await ctx.newPage();
await page.goto(`chrome-extension://${extId}/translate-doc/index.html`, { waitUntil: 'domcontentloaded' });

await page.evaluate(async ({ apiKey }) => {
  await chrome.storage.local.set({ apiKey, translateDocPresetSlot: 1 });
  await chrome.storage.sync.set({
    targetLanguage: 'zh-TW',
    translatePresets: [
      { label: 'lite', engine: 'gemini', model: 'gemini-3.1-flash-lite' },
      { label: 'lite2', engine: 'gemini', model: 'gemini-3.1-flash-lite' },
      { label: 'lite3', engine: 'gemini', model: 'gemini-3.1-flash-lite' },
    ],
  });
}, { apiKey: API_KEY });
console.log('[harness] apiKey + lite preset + zh-TW 已注入');
await page.reload({ waitUntil: 'domcontentloaded' });

await page.setInputFiles('#file-input', FILE);
await page.waitForSelector('#stage-chapters:not([hidden])', { timeout: 60_000 });
const dump = await page.evaluate(() => window.__skEpubDoc.chapters.map((c) => ({
  index: c.index, title: c.title, chars: c.charCount, blocks: c.blocks.length,
})));
console.log('[harness] 章節清單：');
for (const c of dump) console.log(`  #${c.index} ${c.title} — ${c.chars} chars / ${c.blocks} blocks`);

await page.evaluate(() => {
  for (const c of window.__skEpubDoc.chapters) c.selected = c.blocks.length > 0;
});
await page.click('#chapters-translate-btn');
await page.waitForSelector('#stage-chapters:not([hidden])', { timeout: 900_000 });
await page.waitForSelector('#chapters-download-btn:not([hidden])', { timeout: 30_000 });

const after = await page.evaluate(() => {
  const doc = window.__skEpubDoc;
  let done = 0, failed = 0, total = 0;
  for (const c of doc.chapters) for (const b of c.blocks) {
    total++;
    if (b.translationStatus === 'done') done++;
    else if (b.translationStatus === 'failed') failed++;
  }
  return { done, failed, total };
});
console.log(`[harness] 翻譯狀態：done=${after.done} failed=${after.failed} / ${after.total}`);
const cost = await page.textContent('#chapters-cumulative-cost').catch(() => null);
if (cost) console.log('[harness] 累計費用：', cost.trim());

async function download(mode) {
  if (mode === 'dual') await page.selectOption('#epub-dual-mode', 'dual');
  else await page.selectOption('#epub-dual-mode', 'single').catch(() => {});
  const dlPromise = page.waitForEvent('download');
  await page.click('#chapters-download-btn');
  const dl = await dlPromise;
  const out = path.join(OUT_DIR, dl.suggestedFilename());
  await dl.saveAs(out);
  console.log('[harness] 已存：', out);
  return out;
}

await download('single');
if (WITH_DUAL) await download('dual');

await ctx.close();
console.log('[harness] done');
