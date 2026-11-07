import { browser } from './compat.js';
import { debugLog } from './logger.js';

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/seanmars/transit/releases/latest';
const STORAGE_KEY = 'updateAvailable';
const LAST_CHECK_KEY = 'updateCheckLastAt';
export const UPDATE_CHECK_MIN_INTERVAL_MS = 23 * 60 * 60 * 1000;

export function localTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseVersion(v) {
  const cleaned = String(v || '').replace(/^v/, '').split('-')[0];
  const parts = cleaned.split('.').map(s => parseInt(s, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

function isWorthNotifying(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (a[0] > b[0]) return true;
  if (a[0] < b[0]) return false;
  if (a[1] > b[1]) return true;
  return false;
}

function isManualInstall() {
  try {
    const updateUrl = browser.runtime.getManifest().update_url;
    return !updateUrl;
  } catch (err) {
    debugLog('warn', 'update-check', 'getManifest failed', { error: err.message });
    return true;
  }
}

export async function checkForUpdate() {
  if (!isManualInstall()) {
    return { checked: false, hasUpdate: false, error: 'CWS install — skipped' };
  }
  const { [LAST_CHECK_KEY]: lastAt } = await browser.storage.local.get(LAST_CHECK_KEY);
  const sinceLast = typeof lastAt === 'number' ? Date.now() - lastAt : Infinity;
  if (sinceLast >= 0 && sinceLast < UPDATE_CHECK_MIN_INTERVAL_MS) {
    return { checked: false, hasUpdate: false, error: 'throttled' };
  }
  const currentVersion = browser.runtime.getManifest().version;
  let resp;
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 15_000);
  try {
    resp = await fetch(GITHUB_RELEASES_URL, {
      headers: { 'Accept': 'application/vnd.github+json' },
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err?.name === 'AbortError';
    debugLog('warn', 'update-check', isAbort ? 'fetch timeout' : 'fetch failed', { error: err.message });
    return { checked: false, hasUpdate: false, error: isAbort ? 'timeout' : err.message };
  }
  clearTimeout(timeoutId);
  await browser.storage.local.set({ [LAST_CHECK_KEY]: Date.now() });
  if (!resp.ok) {
    debugLog('warn', 'update-check', `GitHub API ${resp.status}`, { status: resp.status });
    return { checked: false, hasUpdate: false, error: `HTTP ${resp.status}` };
  }
  let json;
  try {
    json = await resp.json();
  } catch (err) {
    debugLog('warn', 'update-check', 'response not JSON', { error: err.message });
    return { checked: false, hasUpdate: false, error: 'invalid JSON' };
  }
  const latestTag = json?.tag_name || '';
  const latestVersion = String(latestTag).replace(/^v/, '');
  if (!latestVersion) {
    debugLog('warn', 'update-check', 'response missing tag_name', {});
    return { checked: false, hasUpdate: false, error: 'missing tag_name' };
  }
  const releaseUrl = json?.html_url || `https://github.com/seanmars/transit/releases/tag/${latestTag}`;

  if (isWorthNotifying(latestVersion, currentVersion)) {
    const payload = {
      version: latestVersion,
      releaseUrl,
      checkedAt: Date.now(),
    };
    const existing = await browser.storage.local.get(STORAGE_KEY);
    const merged = {
      ...payload,
      lastNoticeShownDate: existing[STORAGE_KEY]?.lastNoticeShownDate || null,
    };
    await browser.storage.local.set({ [STORAGE_KEY]: merged });
    debugLog('info', 'update-check', 'new version detected', {
      current: currentVersion, latest: latestVersion,
    });
    return { checked: true, hasUpdate: true, version: latestVersion, releaseUrl };
  }

  await browser.storage.local.remove(STORAGE_KEY);
  debugLog('info', 'update-check', 'up-to-date', {
    current: currentVersion, latest: latestVersion,
  });
  return { checked: true, hasUpdate: false, version: latestVersion };
}

export async function markUpdateNoticeShown() {
  const existing = await browser.storage.local.get(STORAGE_KEY);
  const cur = existing[STORAGE_KEY];
  if (!cur) return;
  await browser.storage.local.set({
    [STORAGE_KEY]: { ...cur, lastNoticeShownDate: localTodayKey() },
  });
}

export function buildUpdateDownloadUrl(updateAvailable) {
  const version = updateAvailable?.version;
  return updateAvailable?.releaseUrl
    || (version
      ? `https://github.com/seanmars/transit/releases/tag/v${version}`
      : 'https://github.com/seanmars/transit/releases');
}

export { parseVersion, isWorthNotifying };
