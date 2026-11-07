import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXT_PATH = process.env.EXT_PATH || path.resolve(__dirname, '..', '..', 'transit');
const TARGET_URL = process.env.TARGET_URL || 'https://en.wikipedia.org/wiki/Taiwan';
const HEADED = process.env.TRANSIT_HEADED === '1';
const KEEP = process.argv.includes('--keep');
const NO_TRANSLATE = process.argv.includes('--no-translate');
const FRESH = process.argv.includes('--fresh');
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', '.playwright-mcp');
const PERSISTENT_PROFILE = path.resolve(os.tmpdir(), 'transit-debug-pw-profile');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeScreenshot(page, opts) {
  try {
    await page.screenshot({ ...opts, timeout: 90000 });
    return true;
  } catch (err) {
    console.log(`[harness] screenshot 失敗 (${opts.path}):`, err.message.slice(0, 120));
    return false;
  }
}

async function getIsolatedEvaluator(page) {
  const cdp = await page.context().newCDPSession(page);
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  cdp.on('Runtime.executionContextDestroyed', (e) => {
    const idx = contexts.findIndex((c) => c.id === e.executionContextId);
    if (idx >= 0) contexts.splice(idx, 1);
  });
  await cdp.send('Runtime.enable');
  await sleep(500);

  const isolated = contexts.filter((c) => c?.auxData?.type === 'isolated');
  let target = isolated.find((c) => c.name === 'Transit')
    || isolated.find((c) => /Transit/i.test(c.name || ''));
  if (!target) {
    const dump = isolated.map((c) => ({ id: c.id, name: c.name, origin: c.origin }));
    throw new Error(`找不到 Transit isolated world。候選: ${JSON.stringify(dump, null, 2)}`);
  }

  async function evaluate(expression) {
    const r = await cdp.send('Runtime.evaluate', {
      contextId: target.id, expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`evaluate 失敗: ${r.exceptionDetails.text}\nexpression: ${expression}`);
    }
    return r.result.value;
  }
  return { evaluate, contextId: target.id };
}

async function debugBridge(evaluate, action, opts = {}) {
  const { afterSeq = 0, timeoutMs = 60000 } = opts;
  return await evaluate(`
    new Promise((resolve) => {
      const onResp = (e) => {
        window.removeEventListener('transit-debug-response', onResp);
        resolve(e.detail);
      };
      window.addEventListener('transit-debug-response', onResp);
      window.dispatchEvent(new CustomEvent('transit-debug-request',
        { detail: { action: ${JSON.stringify(action)}, afterSeq: ${afterSeq} } }));
      setTimeout(() => {
        window.removeEventListener('transit-debug-response', onResp);
        resolve({ ok: false, error: 'TIMEOUT' });
      }, ${timeoutMs});
    })
  `);
}

async function main() {
  if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
    throw new Error(`找不到 extension manifest: ${EXT_PATH}/manifest.json`);
  }
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  if (FRESH) {
    fs.rmSync(PERSISTENT_PROFILE, { recursive: true, force: true });
  }
  fs.mkdirSync(PERSISTENT_PROFILE, { recursive: true });

  console.log('[harness] EXT_PATH:', EXT_PATH);
  console.log('[harness] TARGET_URL:', TARGET_URL);
  console.log('[harness] profile dir:', PERSISTENT_PROFILE);
  console.log('[harness] mode:', HEADED ? 'headed' : 'headless=new');

  const ctx = await chromium.launchPersistentContext(PERSISTENT_PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      ...(HEADED ? [] : ['--headless=new']),
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
    ],
  });

  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  console.log('[harness] SW URL:', sw.url());
  sw.on('console', (m) => console.log(`SW> ${m.type()}`, m.text().slice(0, 300)));

  if (process.env.SEED_SYNC) {
    const seed = JSON.parse(process.env.SEED_SYNC);
    await sw.evaluate((s) => new Promise((res) => chrome.storage.sync.set(s, res)), seed);
    console.log('[harness] SEED_SYNC 已種入:', Object.keys(seed).join(', '));
  }
  if (process.env.SEED_LOCAL) {
    const seed = JSON.parse(process.env.SEED_LOCAL);
    await sw.evaluate((s) => new Promise((res) => chrome.storage.local.set(s, res)), seed);
    console.log('[harness] SEED_LOCAL 已種入:', Object.keys(seed).join(', '));
  }

  for (const p of ctx.pages()) { try { await p.close(); } catch {   } }

  const page = await ctx.newPage();
  page.on('console', (m) => {
    const txt = m.text();
    if (m.type() === 'error' || !/^\[Transit/.test(txt)) {
      console.log(`PAGE> ${m.type()}`, txt.slice(0, 200));
    }
  });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  if (process.env.THROTTLE_CPU) {
    const rate = Number(process.env.THROTTLE_CPU) || 1;
    const throttleCdp = await page.context().newCDPSession(page);
    await throttleCdp.send('Emulation.setCPUThrottlingRate', { rate });
    console.log(`[harness] CPU throttle x${rate}`);
  }

  console.log(`[harness] navigate → ${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2500);

  const { evaluate } = await getIsolatedEvaluator(page);

  const beforeState = await debugBridge(evaluate, 'GET_STATE');
  console.log('[harness] before state:', beforeState);

  await page.evaluate(() => { document.body.style.zoom = '0.5'; });
  await sleep(300);
  await safeScreenshot(page, { path: path.join(SCREENSHOT_DIR, 'before-viewport.png') });
  await safeScreenshot(page, { path: path.join(SCREENSHOT_DIR, 'before-fullpage.png'), fullPage: true });
  await page.evaluate(() => { document.body.style.zoom = ''; });

  if (NO_TRANSLATE) {
    console.log('[harness] --no-translate,跳過翻譯,只截圖前態');
  } else {
    console.log('[harness] CLEAR_CACHE + CLEAR_LOGS...');
    await debugBridge(evaluate, 'CLEAR_CACHE');
    await debugBridge(evaluate, 'CLEAR_LOGS');

    const TRIGGER_ACTION = process.env.TRIGGER_ACTION || 'TRANSLATE';
    console.log(`[harness] ${TRIGGER_ACTION}...`);
    const trigger = await debugBridge(evaluate, TRIGGER_ACTION);
    console.log('[harness] trigger response:', trigger);
    if (TRIGGER_ACTION === 'YT_TRANSLATE') {
      const playMs = Number(process.env.YT_PLAY_MS) || 60000;
      await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(() => {}); } });
      const t0 = Date.now();
      while (Date.now() - t0 < playMs) {
        await sleep(5000);
        const st = await debugBridge(evaluate, 'GET_STATE');
        const ct = await page.evaluate(() => { const v = document.querySelector('video'); return v ? Math.round(v.currentTime) : -1; });
        console.log(`[harness] yt t=${Math.round((Date.now() - t0) / 1000)}s video=${ct}s`, JSON.stringify(st && st.yt));
      }
    }

    const POLL_MS = 500;
    const MAX_POLLS = TRIGGER_ACTION === 'YT_TRANSLATE' ? 0 : 240;
    let pollCount = 0;
    let lastSegmentCount = -1;
    while (pollCount < MAX_POLLS) {
      const state = await debugBridge(evaluate, 'GET_STATE');
      if (state.segmentCount !== lastSegmentCount) {
        console.log(`[harness] poll ${pollCount}: translating=${state.translating} translated=${state.translated} segments=${state.segmentCount}`);
        lastSegmentCount = state.segmentCount;
      }
      if (!state.translating && state.translated && state.segmentCount > 0) {
        console.log(`[harness] 翻譯完成,segments=${state.segmentCount}`);
        break;
      }
      await sleep(POLL_MS);
      pollCount++;
    }
    if (pollCount === MAX_POLLS) {
      console.log('[harness] 翻譯 120s 逾時,繼續往下做');
    }

    const afterState = await debugBridge(evaluate, 'GET_STATE');
    console.log('[harness] after state:', afterState);

    const logs = await debugBridge(evaluate, 'GET_LOGS', { afterSeq: 0 });
    if (logs && logs.ok && Array.isArray(logs.logs)) {
      const interesting = logs.logs.filter((l) => l.level === 'warn' || l.level === 'error');
      console.log(`[harness] log 共 ${logs.logs.length} 條,warn/error ${interesting.length} 條`);
      for (const l of interesting.slice(0, 30)) {
        console.log(`  [${l.level}] ${l.category}: ${l.message}`);
        if (l.data) console.log(`         data:`, JSON.stringify(l.data).slice(0, 200));
      }
    }
  }

  if (process.env.PROBE_WAIT_MS) {
    const extra = Number(process.env.PROBE_WAIT_MS) || 0;
    console.log(`[harness] PROBE_WAIT_MS:額外等待 ${extra}ms`);
    await sleep(extra);
  }

  const domSummary = await page.evaluate(() => {
    const translated = document.querySelectorAll('[data-transit-translated]');
    const dualSource = document.querySelectorAll('[data-transit-dual-source]');
    const dualWrappers = document.querySelectorAll('transit-translation');
    const sample = (nodes, n) => Array.from(nodes).slice(0, n).map((el) => ({
      tag: el.tagName,
      classes: (el.className && el.className.toString().slice(0, 80)) || '',
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
    }));
    return {
      translatedCount: translated.length,
      dualSourceCount: dualSource.length,
      dualWrapperCount: dualWrappers.length,
      sampleTranslated: sample(translated, 8),
      sampleDualWrapper: sample(dualWrappers, 4),
    };
  });
  console.log('[harness] DOM 翻譯狀態:');
  console.log(JSON.stringify(domSummary, null, 2));

  if (process.env.PROBE_EXPR) {
    try {
      const probeResult = await evaluate(`(async () => JSON.stringify(await (${process.env.PROBE_EXPR})))()`);
      console.log('[harness] PROBE_EXPR 結果:', probeResult);
    } catch (e) {
      console.log('[harness] PROBE_EXPR 失敗:', e.message);
    }
  }

  await page.evaluate(() => { document.body.style.zoom = '0.5'; });
  await sleep(300);
  await safeScreenshot(page, { path: path.join(SCREENSHOT_DIR, 'after-viewport.png') });
  await safeScreenshot(page, { path: path.join(SCREENSHOT_DIR, 'after-fullpage.png'), fullPage: true });
  console.log(`[harness] 截圖存到 ${SCREENSHOT_DIR}/`);
  console.log('[harness] 用 Read tool 看 after-fullpage.png 肉眼驗排版');

  if (KEEP) {
    console.log('[harness] --keep:browser 保持開啟,Ctrl+C 結束');
    await new Promise(() => {   });
  } else {
    await ctx.close();
  }
}

main().catch((e) => {
  console.error('[harness] 失敗:', e.message);
  console.error(e.stack);
  process.exit(1);
});
