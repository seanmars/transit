import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, '..', '..', 'transit');
const TARGET_URL = process.env.TARGET_URL
  || 'https://www.newyorker.com/magazine/2026/07/06/the-tick-that-hunts-down-its-hosts-including-us';
const PROFILE = path.resolve(os.tmpdir(), 'transit-probe-glossary-cache-profile');
const KEY_PATH = path.join(os.homedir(), '.transit-test-key');
const OUT_DIR = process.env.PROBE_OUT_DIR || path.resolve(__dirname, '..', '..', '.playwright-mcp');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getIsolatedEvaluator(page) {
  const cdp = await page.context().newCDPSession(page);
  const contexts = [];
  cdp.on('Runtime.executionContextCreated', (e) => contexts.push(e.context));
  await cdp.send('Runtime.enable');
  await sleep(800);
  const isolated = contexts.filter((c) => c?.auxData?.type === 'isolated');
  const target = isolated.find((c) => /Transit/i.test(c.name || ''));
  if (!target) throw new Error('找不到 Transit isolated world: ' + JSON.stringify(isolated.map((c) => c.name)));
  return async function evaluate(expression) {
    const r = await cdp.send('Runtime.evaluate', {
      contextId: target.id, expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error('evaluate 失敗: ' + r.exceptionDetails.text);
    return r.result.value;
  };
}

async function bridge(evaluate, action, extra = {}, timeoutMs = 30000) {
  return await evaluate(`
    new Promise((resolve) => {
      const onResp = (e) => { window.removeEventListener('transit-debug-response', onResp); resolve(e.detail); };
      window.addEventListener('transit-debug-response', onResp);
      window.dispatchEvent(new CustomEvent('transit-debug-request',
        { detail: Object.assign({ action: ${JSON.stringify(action)} }, ${JSON.stringify(extra)}) }));
      setTimeout(() => { window.removeEventListener('transit-debug-response', onResp); resolve({ ok: false, error: 'TIMEOUT' }); }, ${timeoutMs});
    })
  `);
}

async function runTranslate(evaluate, label) {
  await bridge(evaluate, 'CLEAR_LOGS');
  const t0 = Date.now();
  const trig = await bridge(evaluate, 'TRANSLATE');
  console.log(`[${label}] trigger:`, JSON.stringify(trig));
  let done = false;
  for (let i = 0; i < 480; i++) {
    const st = await bridge(evaluate, 'GET_STATE');
    if (i % 20 === 0) console.log(`[${label}] poll${i} translating=${st.translating} translated=${st.translated} segments=${st.segmentCount}`);
    if (!st.translating && st.translated && st.segmentCount > 0) { done = true; break; }
    await sleep(500);
  }
  const t1 = Date.now();
  console.log(`[${label}] done=${done} 耗時 ${(t1 - t0) / 1000}s`);
  const logs = await bridge(evaluate, 'GET_LOGS', { afterSeq: 0 });
  const all = (logs && logs.logs) || [];
  fs.writeFileSync(path.join(OUT_DIR, `probe-gloss-${label}-logs.json`), JSON.stringify(all, null, 1));
  const gloss = all.filter((l) => l.category === 'glossary');
  for (const l of gloss) console.log(`[${label}] GLOSS ${l.level} ${l.message} ${JSON.stringify(l.data || {}).slice(0, 300)}`);
  const milestones = all.filter((l) => /milestone|cache/.test(l.message)).slice(0, 40);
  for (const l of milestones) console.log(`[${label}] MS ${l.message} ${JSON.stringify(l.data || {}).slice(0, 220)}`);
  const usage = await bridge(evaluate, 'GET_USAGE_STATS', { from: t0, to: t1 + 5000 });
  console.log(`[${label}] USAGE:`, JSON.stringify(usage?.stats || usage).slice(0, 600));
  return { t0, t1, gloss, usage };
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const apiKey = fs.readFileSync(KEY_PATH, 'utf8').trim();

  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--headless=new', `--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`,
      '--no-first-run', '--no-default-browser-check'],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  for (const p of ctx.pages()) { try { await p.close(); } catch {   } }

  const page = await ctx.newPage();
  console.log('[probe] navigate →', TARGET_URL);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3000);

  let evaluate = await getIsolatedEvaluator(page);

  await evaluate(`chrome.storage.local.set({ apiKey: ${JSON.stringify(apiKey)} })`);
  await evaluate(`chrome.storage.sync.set({ glossary: { enabled: true } })`);
  console.log('[probe] settings seeded (apiKey + glossary.enabled)');
  await sleep(500);

  const run1 = await runTranslate(evaluate, 'run1');

  console.log('[probe] page.reload → run2');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3000);
  evaluate = await getIsolatedEvaluator(page);
  const run2 = await runTranslate(evaluate, 'run2');

  const pick = (r) => {
    const pre = r.gloss.find((l) => l.message === 'glossary preprocessing');
    const ready = r.gloss.find((l) => /glossary ready|arrived/.test(l.message));
    return { hash: pre?.data?.hash, chars: pre?.data?.compressedChars, terms: ready?.data?.terms, fromCache: ready?.data?.fromCache };
  };
  const s1 = pick(run1); const s2 = pick(run2);
  console.log('\n===== 摘要 =====');
  console.log('run1:', JSON.stringify(s1), 'usage:', JSON.stringify(run1.usage?.stats || {}).slice(0, 300));
  console.log('run2:', JSON.stringify(s2), 'usage:', JSON.stringify(run2.usage?.stats || {}).slice(0, 300));
  console.log('inputHash 相同?', s1.hash === s2.hash);

  await ctx.close();
}

main().catch((e) => { console.error('[probe] FAILED:', e); process.exit(1); });
