import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const EXT = path.resolve(import.meta.dirname, '../../transit');
const KEY_PATH = path.join(os.homedir(), '.transit-test-key');
const API_KEY = fs.readFileSync(KEY_PATH, 'utf-8').trim();

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-probe-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
    '--no-first-run', '--no-default-browser-check'],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;

const page = await ctx.newPage();
await page.goto(`chrome-extension://${extId}/translate-doc/index.html`, { waitUntil: 'domcontentloaded' });
await page.evaluate(async (key) => {
  await chrome.storage.local.set({ apiKey: key });
  await chrome.storage.sync.set({ targetLanguage: 'zh-TW' });
}, API_KEY);

const res = await page.evaluate(async (nonce) => {
  const text = 'Richard Enfield walked with Mr. Utterson through the streets of London. '
    + 'Enfield told the lawyer a strange story about a door and a man named Edward Hyde. '
    + 'Utterson listened carefully, thinking of his old friend Henry Jekyll.';
  const buf = new TextEncoder().encode(text + nonce);
  const hash = await crypto.subtle.digest('SHA-1', buf);
  const inputHash = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return chrome.runtime.sendMessage({
    type: 'EXTRACT_GLOSSARY',
    payload: { compressedText: text, inputHash },
  });
}, String(Date.now()));

console.log('[probe] ok:', res?.ok, 'fromCache:', res?.fromCache, '_diag:', res?._diag || null, 'error:', res?.error || null);
console.log('[probe] usage:', JSON.stringify(res?.usage));
console.log('[probe] glossary terms:', Array.isArray(res?.glossary) ? res.glossary.length : null);
const billed = res?.usage?.billedCostUSD;
console.log(Number.isFinite(billed) && billed > 0
  ? `[probe] PASS billedCostUSD=${billed}`
  : `[probe] FAIL billedCostUSD=${billed}`);
await ctx.close();
