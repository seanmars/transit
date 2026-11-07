import { browser } from './compat.js';
import { debugLog } from './logger.js';

export const FALLBACK_USD_TWD_RATE = 31.6;
const RATE_API_URL = 'https://open.er-api.com/v6/latest/USD';
const STORAGE_KEY = 'exchangeRate';
const FRESHNESS_MS = 24 * 60 * 60 * 1000;

export async function fetchUsdTwdRate() {
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 15_000);
  let resp;
  try {
    resp = await fetch(RATE_API_URL, {
      headers: { 'Accept': 'application/json' },
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err?.name === 'AbortError';
    debugLog('warn', 'exchange-rate', isAbort ? 'fetch timeout' : 'fetch failed', { error: err.message });
    return null;
  }
  clearTimeout(timeoutId);
  if (!resp.ok) {
    debugLog('warn', 'exchange-rate', `open.er-api HTTP ${resp.status}`, { status: resp.status });
    return null;
  }
  let json;
  try {
    json = await resp.json();
  } catch (err) {
    debugLog('warn', 'exchange-rate', 'response not JSON', { error: err.message });
    return null;
  }
  if (json?.result !== 'success') {
    debugLog('warn', 'exchange-rate', 'API result not success', { result: json?.result });
    return null;
  }
  const rate = Number(json?.rates?.TWD);
  if (!Number.isFinite(rate) || rate <= 0) {
    debugLog('warn', 'exchange-rate', 'invalid TWD rate in response', { rate });
    return null;
  }
  return rate;
}

export async function refreshExchangeRate() {
  const rate = await fetchUsdTwdRate();
  if (rate === null) return null;
  const payload = {
    rate,
    fetchedAt: Date.now(),
    source: 'open.er-api',
  };
  await browser.storage.local.set({ [STORAGE_KEY]: payload });
  debugLog('info', 'exchange-rate', 'rate updated', { rate });
  return payload;
}

export async function getCachedRate() {
  try {
    const { [STORAGE_KEY]: cached } = await browser.storage.local.get(STORAGE_KEY);
    if (cached && Number.isFinite(cached.rate) && cached.rate > 0) {
      return cached;
    }
  } catch {
  }
  return {
    rate: FALLBACK_USD_TWD_RATE,
    fetchedAt: 0,
    source: 'fallback',
  };
}

export async function isCacheFresh() {
  try {
    const { [STORAGE_KEY]: cached } = await browser.storage.local.get(STORAGE_KEY);
    if (!cached || !cached.fetchedAt) return false;
    return Date.now() - cached.fetchedAt < FRESHNESS_MS;
  } catch {
    return false;
  }
}
