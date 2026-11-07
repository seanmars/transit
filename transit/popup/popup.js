import { browser } from '../lib/compat.js';
import { formatBytes, formatTokens, formatUSD, formatMoney } from '../lib/format.js';
import { getCachedRate, FALLBACK_USD_TWD_RATE } from '../lib/exchange-rate.js';
import { RELEASE_HIGHLIGHT_KEYS } from '../lib/release-highlights.js';
import { shouldShowWelcomeNotice } from '../lib/welcome-notice.js';
import { isWorthNotifying, buildUpdateDownloadUrl } from '../lib/update-check.js';
import { getSettings, resolveTranslateChain, translateChainUnavailable, TARGET_LANGUAGES, DEFAULT_SETTINGS } from '../lib/storage.js';

const IS_PANEL = (() => {
  try { return new URLSearchParams(location.search).get('panel') === '1'; }
  catch (_e) { return false; }
})();
function closePopup() {
  if (IS_PANEL) {
    try { window.parent.postMessage({ type: 'transit-close-panel' }, '*'); } catch (_e) {}
    return;
  }
  window.close();
}
if (IS_PANEL) {
  const postPanelSize = () => {
    try {
      const rect = document.body.getBoundingClientRect();
      const h = Math.ceil(rect.height);
      const w = Math.ceil(rect.width);
      window.parent.postMessage({ type: 'transit-panel-size', height: h, width: w }, '*');
    } catch (_e) {}
  };
  window.addEventListener('load', postPanelSize);
  if (window.ResizeObserver) {
    try { new ResizeObserver(postPanelSize).observe(document.body); } catch (_e) {}
  }
  setTimeout(postPanelSize, 0);
}

const I18N = (typeof window !== 'undefined' && window.__SK && window.__SK.i18n) || null;
const t = (key, params) => (I18N ? I18N.t(key, params, _currentTarget) : key);
let _currentTarget = 'zh-TW';

function highlightToHtml(s) {
  const esc = String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

const $ = (id) => document.getElementById(id);
const statusEl = $('status');

async function refreshUsageInfo() {
  try {
    const { usageResetAt } = await browser.storage.local.get('usageResetAt');
    const statsPayload = (typeof usageResetAt === 'number' && usageResetAt > 0)
      ? { from: usageResetAt } : {};
    const [resp, currencyState] = await Promise.all([
      browser.runtime.sendMessage({ type: 'QUERY_USAGE_STATS', payload: statsPayload }),
      readCurrencyState(),
    ]);
    const stats = resp?.ok ? resp.stats : null;
    if (stats) {
      const totalTok = (stats.totalInputTokens || 0) + (stats.totalOutputTokens || 0);
      $('usage-info').textContent = t('popup.usage.value', {
        cost: formatMoney(stats.totalBilledCostUSD || 0, currencyState),
        tokens: formatTokens(totalTok),
      });
    } else {
      $('usage-info').textContent = t('popup.usage.failed');
    }
  } catch {
    $('usage-info').textContent = t('popup.usage.unreadable');
  }
}

async function readCurrencyState() {
  try {
    const [{ displayCurrency = 'TWD' }, rateInfo] = await Promise.all([
      browser.storage.sync.get('displayCurrency'),
      getCachedRate(),
    ]);
    return { currency: displayCurrency, rate: rateInfo?.rate || FALLBACK_USD_TWD_RATE };
  } catch {
    return { currency: 'TWD', rate: FALLBACK_USD_TWD_RATE };
  }
}

async function refreshCacheInfo() {
  try {
    const resp = await browser.runtime.sendMessage({ type: 'CACHE_STATS' });
    if (resp?.ok) {
      $('cache-info').textContent = t('popup.cache.value', {
        count: resp.count,
        bytes: formatBytes(resp.bytes),
      });
    } else {
      $('cache-info').textContent = t('popup.cache.failed');
    }
  } catch {
    $('cache-info').textContent = t('popup.cache.unreadable');
  }
}

async function refreshTranslateButton() {
  const btn = $('translate-btn');
  const editBtn = $('edit-btn');
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const resp = await browser.tabs.sendMessage(tab.id, { type: 'GET_STATE' });
    if (resp?.translated) {
      btn.textContent = t('popup.action.restore');
      btn.dataset.mode = 'restore';
    } else {
      btn.textContent = t('popup.action.translate');
      btn.dataset.mode = 'translate';
    }
    if (resp?.translated || resp?.injected) {
      editBtn.hidden = false;
      editBtn.textContent = resp?.editing ? t('popup.action.editDone') : t('popup.action.editStart');
    } else {
      editBtn.hidden = true;
    }
  } catch {
    btn.textContent = t('popup.action.translate');
    btn.dataset.mode = 'translate';
    editBtn.hidden = true;
  }
}

async function refreshShortcutHint() {
  const el = $('shortcut-hint');
  if (!el) return;
  try {
    const cmds = await browser.commands.getAll();
    const cmd = cmds.find((c) => c.name === 'translate-preset-0');
    const shortcut = cmd?.shortcut?.trim();
    if (shortcut) {
      const isMac = /Mac/i.test((typeof navigator !== 'undefined' && navigator.platform) || '');
      const SC = (typeof window !== 'undefined' && window.__SKShortcuts) || null;
      const display = SC ? SC.macifyCommandShortcut(shortcut, isMac) : shortcut;
      el.textContent = t('popup.shortcut.value', { shortcut: display });
    } else {
      el.textContent = t('popup.shortcut.unset');
    }
  } catch {
    el.textContent = '';
  }
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('#welcome-banner-dismiss')) return;
  e.preventDefault();
  try {
    await browser.runtime.sendMessage({ type: 'WELCOME_NOTICE_DISMISSED' });
    $('welcome-banner').hidden = true;
    $('update-dot').hidden = true;
  } catch (err) {
    console.error('[transit] welcome-banner dismiss failed', err);
  }
});

document.addEventListener('click', async (e) => {
  if (!e.target.closest('#update-banner')) return;
  e.preventDefault();
  try {
    const { updateAvailable } = await browser.storage.local.get('updateAvailable');
    const url = buildUpdateDownloadUrl(updateAvailable);
    await browser.tabs.create({ url });
    closePopup();
  } catch (err) {
    console.error('[transit] update-banner click failed', err);
  }
});

async function init() {
  const manifest = browser.runtime.getManifest();
  $('version').textContent = 'v' + manifest.version;

  let welcomeShown = false;
  let welcomeVersion = null;
  try {
    const { welcomeNotice } = await browser.storage.local.get('welcomeNotice');
    const decision = shouldShowWelcomeNotice(welcomeNotice, manifest.version);
    if (decision.removeStale) {
      await browser.storage.local.remove('welcomeNotice');
    } else if (decision.show) {
      welcomeShown = true;
      welcomeVersion = welcomeNotice.version;
      $('update-dot').hidden = false;
      $('welcome-banner').hidden = false;
      $('welcome-banner-title').textContent = t('popup.banner.welcome', { version: welcomeNotice.version });
      $('welcome-bullets').innerHTML = RELEASE_HIGHLIGHT_KEYS
        .map(k => `<li>${highlightToHtml(t(k))}</li>`)
        .join('');
    }
  } catch {   }

  if (!welcomeShown) {
    try {
      const { disableUpdateNotice } = await browser.storage.sync.get('disableUpdateNotice');
      if (disableUpdateNotice !== true) {
        const { updateAvailable } = await browser.storage.local.get('updateAvailable');
        if (updateAvailable && updateAvailable.version && updateAvailable.releaseUrl
            && isWorthNotifying(updateAvailable.version, manifest.version)) {
          $('update-dot').hidden = false;
          const banner = $('update-banner');
          banner.hidden = false;
          $('update-banner-version').textContent = t('popup.banner.updateNoticeVersion', {
            newVersion: updateAvailable.version,
            currentVersion: manifest.version,
          });
        }
      }
    } catch {   }
  }

  const { autoTranslate = false, displayMode = 'single', uiLanguage, targetLanguage, autoConvertZh = true } = await browser.storage.sync.get(['autoTranslate', 'displayMode', 'uiLanguage', 'targetLanguage', 'autoConvertZh']);
  $('auto').checked = autoTranslate;

  if ($('targetLanguage')) {
    const tl = (typeof targetLanguage === 'string' && TARGET_LANGUAGES.includes(targetLanguage))
      ? targetLanguage : DEFAULT_SETTINGS.targetLanguage;
    $('targetLanguage').value = tl;
    _updateAutoConvertZhRow(tl);
  }
  $('auto-convert-zh-toggle').checked = autoConvertZh === true;

  _currentTarget = I18N ? I18N.getUiLanguage(uiLanguage || 'auto') : 'zh-TW';
  const rerenderWelcomeBullets = () => {
    if (!welcomeShown) return;
    $('welcome-banner-title').textContent = t('popup.banner.welcome', { version: welcomeVersion });
    $('welcome-bullets').innerHTML = RELEASE_HIGHLIGHT_KEYS
      .map(k => `<li>${highlightToHtml(t(k))}</li>`)
      .join('');
  };
  if (I18N) {
    I18N.applyI18n(document, _currentTarget);
    rerenderWelcomeBullets();
    I18N.subscribeUiLanguageChange((newUi  ) => {
      _currentTarget = newUi || 'zh-TW';
      I18N.applyI18n(document, _currentTarget);
      rerenderWelcomeBullets();
      refreshCacheInfo();
      refreshUsageInfo();
      refreshTranslateButton();
      refreshShortcutHint();
    });
  }
  refreshShortcutHint();

  setDisplayModeButtons(displayMode === 'dual' ? 'dual' : 'single');

  try {
    const { glossary: gc } = await browser.storage.sync.get('glossary');
    $('glossary-toggle').checked = gc?.enabled ?? false;
  } catch {   }

  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';
    const isYtWatch = /youtube\.com\/(watch|live\/)/.test(url);
    const isDriveFile = /^https:\/\/drive\.google\.com\/file\//.test(url);
    const isXStatus = /^https:\/\/(?:[\w-]+\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/.test(url);
    if (isYtWatch || isDriveFile || isXStatus) {
      const { ytSubtitle = {} } = await browser.storage.sync.get('ytSubtitle');
      if (isYtWatch) {
        $('yt-subtitle-row').hidden = false;
        $('yt-subtitle-toggle').checked = ytSubtitle.autoTranslate !== false;
        $('yt-caption-size-row').hidden = false;
        $('yt-caption-size').value = String(ytSubtitle.captionScale ?? 100);
      }
      if (isDriveFile) {
        $('drive-subtitle-row').hidden = false;
        $('drive-subtitle-toggle').checked = ytSubtitle.autoTranslate !== false;
      }
      if (isXStatus) {
        $('x-subtitle-row').hidden = false;
        $('x-subtitle-toggle').checked = ytSubtitle.autoTranslate !== false;
      }
    }
  } catch {   }

  statusEl.classList.remove('status-cta');
  statusEl.onclick = null;
  // 主要和 failback 都不能用時才提示; 只要 failback (例如 Google) 可用就能翻譯
  let chainUnavailable = false;
  try { chainUnavailable = translateChainUnavailable(resolveTranslateChain(await getSettings())); } catch {   }
  if (chainUnavailable) {
    statusEl.textContent = t('popup.status.noApiKey');
    statusEl.dataset.tone = 'error';
    statusEl.classList.add('status-cta');
    statusEl.onclick = () => $('options-btn').click();
  }

  refreshCacheInfo();
  refreshUsageInfo();
  refreshTranslateButton();
}

$('translate-btn').addEventListener('click', async () => {
  const btn = $('translate-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { btn.disabled = false; return; }
    const mode = btn.dataset.mode;
    statusEl.textContent = mode === 'restore' ? t('popup.status.restoring') : t('popup.status.translating');
    await browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_TRANSLATE' });
    closePopup();
  } catch (err) {
    statusEl.textContent = t('popup.status.cannotRun');
    statusEl.dataset.tone = 'error';
    btn.disabled = false;
  }
});

$('auto').addEventListener('change', async (e) => {
  await browser.storage.sync.set({ autoTranslate: e.target.checked });
});

function _updateAutoConvertZhRow(tl) {
  const row = $('auto-convert-zh-row');
  if (row) row.hidden = !(tl === 'zh-TW' || tl === 'zh-CN');
}

$('auto-convert-zh-toggle').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  try {
    await browser.storage.sync.set({ autoConvertZh: enabled });
  } catch (err) {
    console.error('[transit] autoConvertZh set failed', err);
  }
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, { type: 'SET_AUTO_CONVERT_ZH', payload: { enabled } }).catch(() => {});
    }
  } catch {   }
});

$('targetLanguage').addEventListener('change', async (e) => {
  const v = e.target.value;
  const tl = TARGET_LANGUAGES.includes(v) ? v : DEFAULT_SETTINGS.targetLanguage;
  _updateAutoConvertZhRow(tl);
  try {
    await browser.storage.sync.set({ targetLanguage: tl });
  } catch (err) {
    console.error('[transit] targetLanguage set failed', err);
  }
});

function setDisplayModeButtons(mode) {
  $('mode-single').setAttribute('aria-checked', mode === 'single' ? 'true' : 'false');
  $('mode-dual').setAttribute('aria-checked', mode === 'dual' ? 'true' : 'false');
}

async function changeDisplayMode(mode) {
  setDisplayModeButtons(mode);
  await browser.storage.sync.set({ displayMode: mode });
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, { type: 'MODE_CHANGED', mode }).catch(() => {});
    }
  } catch {   }
}

$('mode-single').addEventListener('click', () => changeDisplayMode('single'));
$('mode-dual').addEventListener('click',   () => changeDisplayMode('dual'));

$('glossary-toggle').addEventListener('change', async (e) => {
  try {
    const { glossary: gc = {} } = await browser.storage.sync.get('glossary');
    gc.enabled = e.target.checked;
    await browser.storage.sync.set({ glossary: gc });
  } catch (err) {
    console.error('[Transit] popup: failed to save glossary toggle', err);
  }
});

$('yt-subtitle-toggle').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, {
        type: 'SET_SUBTITLE',
        payload: { enabled },
      }).catch(() => {});
    }
  } catch (err) {
    statusEl.textContent = t('popup.status.subtitleToggleFailed');
    statusEl.dataset.tone = 'error';
  }
});

async function _setSubtitleAutoTranslateFromToggle(e) {
  const enabled = e.target.checked;
  try {
    const { ytSubtitle = {} } = await browser.storage.sync.get('ytSubtitle');
    await browser.storage.sync.set({
      ytSubtitle: { ...ytSubtitle, autoTranslate: enabled },
    });
  } catch (err) {
    statusEl.textContent = t('popup.status.subtitleToggleFailed');
    statusEl.dataset.tone = 'error';
  }
}
$('drive-subtitle-toggle').addEventListener('change', _setSubtitleAutoTranslateFromToggle);
$('x-subtitle-toggle').addEventListener('change', _setSubtitleAutoTranslateFromToggle);

$('yt-caption-size').addEventListener('change', async (e) => {
  const scale = parseInt(e.target.value, 10);
  if (!Number.isFinite(scale)) return;
  try {
    const { ytSubtitle = {} } = await browser.storage.sync.get('ytSubtitle');
    await browser.storage.sync.set({
      ytSubtitle: { ...ytSubtitle, captionScale: scale },
    });
  } catch (err) {
    statusEl.textContent = t('popup.status.captionSizeFailed');
    statusEl.dataset.tone = 'error';
  }
});

$('options-btn').addEventListener('click', async() => {
  try{
    await browser.runtime.openOptionsPage();
  } catch (e) {
    const url = browser.runtime.getURL('options/options.html');
    await browser.tabs.create({ url });
  }
});

$('translate-doc-btn').addEventListener('click', async () => {
  const url = browser.runtime.getURL('translate-doc/index.html');
  await browser.tabs.create({ url });
  closePopup();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.ytSubtitle) return;
  const newVal = changes.ytSubtitle.newValue || {};
  const enabled = newVal.autoTranslate !== false;
  $('yt-subtitle-toggle').checked = enabled;
  $('drive-subtitle-toggle').checked = enabled;
  $('x-subtitle-toggle').checked = enabled;
  if (newVal.captionScale != null) $('yt-caption-size').value = String(newVal.captionScale);
});

$('edit-btn').addEventListener('click', async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const resp = await browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_EDIT_MODE' });
    if (resp?.ok) {
      $('edit-btn').textContent = resp.editing ? t('popup.action.editDone') : t('popup.action.editStart');
      statusEl.textContent = resp.editing
        ? t('popup.status.editMode', { count: resp.elements })
        : t('popup.status.editEnded');
      statusEl.dataset.tone = resp.editing ? 'accent' : 'muted';
    }
  } catch {
    statusEl.textContent = t('popup.status.editFailed');
    statusEl.dataset.tone = 'error';
  }
});

$('clear-cache-btn').addEventListener('click', () => {
  $('clear-cache-btn').hidden = true;
  $('clear-cache-confirm').hidden = false;
});

$('clear-cache-no').addEventListener('click', () => {
  $('clear-cache-confirm').hidden = true;
  $('clear-cache-btn').hidden = false;
});

$('clear-cache-yes').addEventListener('click', async () => {
  $('clear-cache-confirm').hidden = true;
  $('clear-cache-btn').hidden = false;
  const resp = await browser.runtime.sendMessage({ type: 'CLEAR_CACHE' });
  if (resp?.ok) {
    statusEl.textContent = t('popup.status.cacheCleared', { count: resp.removed });
    statusEl.dataset.tone = 'ok';
    refreshCacheInfo();
  } else {
    statusEl.textContent = t('popup.status.cacheClearFailed', { error: resp?.error || t('common.errorUnknown') });
    statusEl.dataset.tone = 'error';
  }
});

$('clear-usage-btn').addEventListener('click', () => {
  $('clear-usage-btn').hidden = true;
  $('clear-usage-confirm').hidden = false;
});

$('clear-usage-no').addEventListener('click', () => {
  $('clear-usage-confirm').hidden = true;
  $('clear-usage-btn').hidden = false;
});

$('clear-usage-yes').addEventListener('click', async () => {
  $('clear-usage-confirm').hidden = true;
  $('clear-usage-btn').hidden = false;
  try {
    await browser.storage.local.set({ usageResetAt: Date.now() });
    refreshUsageInfo();
  } catch {
    $('usage-info').textContent = t('popup.usage.unreadable');
  }
});

init();
