// 產生 Chrome Web Store 用的通用截圖 (1280x800) 與 small promo tile (440x280)。
// 輸出 24-bit PNG (無 alpha),符合 Chrome Web Store 規定。
// 用法: pnpm store:screenshots   (TRANSIT_HEADED=1 可看到瀏覽器畫面)
// 網站用的 2x 版本: STORE_SCALE=2 STORE_OUT=docs/img pnpm store:screenshots
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const EXT_PATH = path.join(ROOT, 'transit');
const OUT_DIR = path.resolve(ROOT, process.env.STORE_OUT || 'store/screenshots');
// Chrome Web Store 只收 1x; 網站用 2x 才不會在高解析度螢幕上模糊。
const SCALE = Number(process.env.STORE_SCALE) || 1;
const TARGET_URL = process.env.TARGET_URL || 'https://en.wikipedia.org/wiki/Astronomical_transit';
// 雙語對照用單欄的手機版,避免桌面版側欄也被加上雙語標記。
const DUAL_URL = process.env.DUAL_URL || 'https://en.wikipedia.org/wiki/Astronomical_transit?useskin=minerva';
const HEADED = process.env.TRANSIT_HEADED === '1';

const SHOT = { width: 1280, height: 800 };
const TILE = { width: 440, height: 280 };
const POPUP_WIDTH = 296;

const BASE_SETTINGS = {
  targetLanguage: 'zh-TW',
  uiLanguage: 'zh-TW',
  displayMode: 'single',
  disableUpdateNotice: true,
  // 不用 API Key 的 Google Translate 當主要翻譯,避免完成通知出現「改用備援翻譯」。
  translateEngines: {
    primary: { engine: 'google', model: null, label: 'Google MT' },
    fallback: { engine: 'google', model: null, label: 'Google MT' },
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- extension 操作 ----------

async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'transit-store-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: SHOT,
    deviceScaleFactor: SCALE,
    locale: 'zh-TW',
    args: [
      ...(HEADED ? [] : ['--headless=new']),
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--hide-scrollbars',
    ],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  await sw.evaluate(() => new Promise((res) => chrome.storage.local.set({ updateCheckLastAt: Date.now() }, res)));
  return { ctx, sw, extId, profile };
}

async function setSettings(sw, settings) {
  await sw.evaluate((s) => new Promise((res) => chrome.storage.sync.set(s, res)), settings);
}

// 在 content script 的 isolated world 執行程式碼 (同 tools/harness/debug-harness.js)。
async function getIsolatedEvaluator(page) {
  const cdp = await page.context().newCDPSession(page);
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  await cdp.send('Runtime.enable');
  await sleep(500);
  const target = contexts.find((c) => c?.auxData?.type === 'isolated' && /Transit/i.test(c.name || ''));
  if (!target) throw new Error('找不到 Transit isolated world');
  return async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      contextId: target.id, expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(`evaluate 失敗: ${r.exceptionDetails.text}`);
    return r.result.value;
  };
}

function debugBridge(evaluate, action) {
  return evaluate(`
    new Promise((resolve) => {
      const onResp = (e) => { window.removeEventListener('transit-debug-response', onResp); resolve(e.detail); };
      window.addEventListener('transit-debug-response', onResp);
      window.dispatchEvent(new CustomEvent('transit-debug-request', { detail: { action: ${JSON.stringify(action)} } }));
      setTimeout(() => resolve({ ok: false, error: 'TIMEOUT' }), 60000);
    })
  `);
}

async function openArticle(ctx, viewport, url = TARGET_URL) {
  const page = await ctx.newPage();
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await sleep(2500);
  return page;
}

// 和 popup 的「翻譯本頁」按鈕一樣,送 TOGGLE_TRANSLATE 給文章分頁。
// release build 的 debug bridge 只開放 GET_STATE,所以只用它來輪詢狀態。
async function translate(sw, page) {
  const evaluate = await getIsolatedEvaluator(page);
  const initial = await debugBridge(evaluate, 'GET_STATE');
  await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === url);
    if (!tab) throw new Error(`找不到分頁 ${url}`);
    await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATE' });
  }, page.url());
  // 「簡繁自動互轉」可能在翻譯前就產生少量段落,所以要比開始時多才算完成。
  for (let i = 0; i < 240; i++) {
    const st = await debugBridge(evaluate, 'GET_STATE');
    if (!st.translating && st.segmentCount > initial.segmentCount) {
      console.log(`  翻譯完成, segments=${st.segmentCount}`);
      // 等完成通知自動消失,畫面只留下譯文。
      await sleep(Number(process.env.TOAST_WAIT_MS) || 8000);
      return;
    }
    await sleep(500);
  }
  throw new Error('翻譯 120 秒內沒有完成');
}

async function captureArticle(ctx, sw, { viewport, displayMode, translated, url, scrollToBody = false }) {
  await setSettings(sw, { ...BASE_SETTINGS, displayMode });
  const page = await openArticle(ctx, viewport, url);
  if (translated) await translate(sw, page);
  if (scrollToBody) {
    // 捲到第一段內文,讓畫面顯示多組「原文 + 譯文」段落。
    await page.evaluate(() => {
      const first = [...document.querySelectorAll('#mw-content-text p')]
        .find((p) => p.textContent.trim().length > 50);
      if (first) window.scrollTo(0, first.getBoundingClientRect().top + window.scrollY - 8);
    });
    await sleep(800);
  }
  const buf = await page.screenshot();
  await page.close();
  return buf;
}

// popup 以背景分頁開啟,讓 tabs.query({active:true}) 取得的仍是文章分頁。
async function capturePopup(ctx, sw, extId, articlePage) {
  const pagePromise = ctx.waitForEvent('page');
  await sw.evaluate((url) => chrome.tabs.create({ url, active: false }), `chrome-extension://${extId}/popup/popup.html`);
  const popup = await pagePromise;
  await popup.setViewportSize({ width: POPUP_WIDTH, height: SHOT.height });
  await popup.waitForLoadState('load');
  await sleep(1500);
  const height = await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  const buf = await popup.screenshot({ clip: { x: 0, y: 0, width: POPUP_WIDTH, height: Math.min(height, SHOT.height) } });
  await popup.close();
  await articlePage.bringToFront();
  return buf;
}

async function captureExtensionPage(ctx, extId, pagePath) {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${extId}/${pagePath}`, { waitUntil: 'load' });
  await sleep(1500);
  const buf = await page.screenshot();
  await page.close();
  return buf;
}

// ---------- 合成 ----------

const dataUrl = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;

async function render(ctx, html, size) {
  const page = await ctx.newPage();
  await page.setViewportSize(size);
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    body { width: ${size.width}px; height: ${size.height}px; overflow: hidden;
      font-family: "Segoe UI", "Microsoft JhengHei", "Noto Sans TC", sans-serif; }
  </style></head><body>${html}</body></html>`, { waitUntil: 'load' });
  const buf = await page.screenshot();
  await page.close();
  return buf;
}

function composeBeforeAfter(ctx, before, after) {
  const pane = (img, label, accent) => `
    <div style="width:640px;height:800px;display:flex;flex-direction:column;">
      <div style="height:48px;display:flex;align-items:center;justify-content:center;gap:10px;
        background:${accent};color:#fff;font-size:20px;font-weight:600;letter-spacing:.5px;">${label}</div>
      <img src="${dataUrl(img)}" style="width:640px;height:752px;display:block;">
    </div>`;
  return render(ctx, `<div style="display:flex;">
    ${pane(before, '原文 Original', '#475569')}
    <div style="width:0;border-left:2px solid #fff;"></div>
    ${pane(after, 'Transit 翻譯後', '#2563eb')}
  </div>`, SHOT);
}

function composePopup(ctx, page, popup) {
  return render(ctx, `<div style="position:relative;width:1280px;height:800px;">
    <img src="${dataUrl(page)}" style="position:absolute;inset:0;width:1280px;height:800px;display:block;">
    <div style="position:absolute;inset:0;background:rgba(15,23,42,.18);"></div>
    <img src="${dataUrl(popup)}" style="position:absolute;top:12px;right:24px;width:${POPUP_WIDTH}px;display:block;
      max-height:776px;border-radius:10px;box-shadow:0 12px 40px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.12);">
  </div>`, SHOT);
}

function composePromoTile(ctx, logo) {
  return render(ctx, `<div style="width:440px;height:280px;display:flex;align-items:center;gap:22px;padding:0 30px;
    background:radial-gradient(circle at 25% 50%,#3b1d8f 0%,#120a33 55%,#05040f 100%);color:#fff;">
    <img src="${dataUrl(logo)}" style="width:132px;height:132px;border-radius:28px;display:block;
      box-shadow:0 0 36px rgba(99,102,241,.55);">
    <div>
      <div style="font-size:44px;font-weight:700;letter-spacing:.5px;">Transit</div>
      <div style="margin-top:8px;font-size:17px;line-height:1.45;color:#c7d2fe;">網頁・字幕・文件翻譯<br>Web · Subtitles · Docs</div>
    </div>
  </div>`, TILE);
}

// ---------- 輸出與驗證 ----------

// Chrome Web Store 只接受無 alpha 的 PNG,所以轉成 colorType 2 (RGB)。
function writeRgbPng(file, buf) {
  const png = PNG.sync.read(buf);
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 2 }));
  console.log(`  → ${path.relative(ROOT, file)}`);
}

function verify(files) {
  let ok = true;
  for (const [file, size] of files) {
    const png = PNG.sync.read(fs.readFileSync(file));
    const header = fs.readFileSync(file).subarray(16, 26);
    const colorType = header[9];
    const pass = png.width === size.width * SCALE && png.height === size.height * SCALE && colorType === 2;
    if (!pass) ok = false;
    console.log(`${pass ? '✓' : '✗'} ${path.basename(file)} ${png.width}x${png.height} colorType=${colorType}`);
  }
  if (!ok) throw new Error('有圖片不符合 Chrome Web Store 規格');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { ctx, sw, extId, profile } = await launch();
  const out = (name) => path.join(OUT_DIR, name);
  const files = [];
  try {
    for (const p of ctx.pages()) await p.close().catch(() => {});

    console.log('[1/5] 網頁翻譯前後對照');
    const half = { width: 640, height: 752 };
    const before = await captureArticle(ctx, sw, { viewport: half, displayMode: 'single', translated: false });
    const after = await captureArticle(ctx, sw, { viewport: half, displayMode: 'single', translated: true });
    writeRgbPng(out('01-before-after.png'), await composeBeforeAfter(ctx, before, after));
    files.push([out('01-before-after.png'), SHOT]);

    console.log('[2/5] 雙語對照模式');
    writeRgbPng(out('02-dual.png'), await captureArticle(ctx, sw, { viewport: SHOT, displayMode: 'dual', translated: true, url: DUAL_URL, scrollToBody: true }));
    files.push([out('02-dual.png'), SHOT]);

    console.log('[3/5] 工具列 popup');
    await setSettings(sw, { ...BASE_SETTINGS, displayMode: 'single' });
    const article = await openArticle(ctx, SHOT);
    await translate(sw, article);
    const articleShot = await article.screenshot();
    const popupShot = await capturePopup(ctx, sw, extId, article);
    await article.close();
    writeRgbPng(out('03-popup.png'), await composePopup(ctx, articleShot, popupShot));
    files.push([out('03-popup.png'), SHOT]);

    console.log('[4/5] 設定頁');
    writeRgbPng(out('04-options.png'), await captureExtensionPage(ctx, extId, 'options/options.html'));
    files.push([out('04-options.png'), SHOT]);

    console.log('[5/5] 文件翻譯頁');
    writeRgbPng(out('05-translate-doc.png'), await captureExtensionPage(ctx, extId, 'translate-doc/index.html'));
    files.push([out('05-translate-doc.png'), SHOT]);

    console.log('[tile] small promo tile');
    const tile = await composePromoTile(ctx, fs.readFileSync(path.join(ROOT, 'res', 'logo.png')));
    writeRgbPng(out('promo-small-440x280.png'), tile);
    files.push([out('promo-small-440x280.png'), TILE]);
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  verify(files);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
