import { browser } from '../lib/compat.js';
import { getSettings, DEFAULT_SETTINGS, DEFAULT_DOC_SYSTEM_PROMPT } from '../lib/storage.js';
import * as cache from '../lib/cache.js';

const $ = (id) => document.getElementById(id);

const t = (key, params, fallback) => {
  const i18n = window.__SK?.i18n;
  if (i18n && typeof i18n.t === 'function') return i18n.t(key, params);
  return fallback != null ? fallback : key;
};

async function load() {
  await initI18n();
  const s = await getSettings();
  const td = s.translateDoc || DEFAULT_SETTINGS.translateDoc;
  $('td-systemPrompt').value = td.systemPrompt || DEFAULT_DOC_SYSTEM_PROMPT;
  $('td-applyFixedGlossary').checked = td.applyFixedGlossary !== false;
  $('td-temperature').value = (typeof td.temperature === 'number' && Number.isFinite(td.temperature))
    ? td.temperature : DEFAULT_SETTINGS.translateDoc.temperature;
  initialLoaded = true;
  hideSaveBar();
}

async function initI18n() {
  const I18N = window.__SK?.i18n;
  if (!I18N) return;
  let uiLang = 'auto';
  try {
    const stored = await chrome.storage.sync.get(['uiLanguage']);
    if (typeof stored.uiLanguage === 'string') uiLang = stored.uiLanguage;
  } catch (_) {   }
  const dictLang = I18N.getUiLanguage(uiLang);
  window.__SK = window.__SK || {};
  window.__SK.STATE = window.__SK.STATE || {};
  window.__SK.STATE.uiLanguage = dictLang;
  I18N.applyI18n(document, dictLang);
  I18N.subscribeUiLanguageChange((newUi) => {
    window.__SK.STATE.uiLanguage = newUi;
    I18N.applyI18n(document, newUi);
  });
}

let _saveInFlight = false;
let _savePending = false;
async function save() {
  if (_saveInFlight) { _savePending = true; return; }
  _saveInFlight = true;
  try {
    await _saveImpl();
    while (_savePending) {
      _savePending = false;
      await _saveImpl();
    }
  } finally {
    _saveInFlight = false;
  }
}

async function _saveImpl() {
  const existing = (await browser.storage.sync.get(null)) || {};
  const td = existing.translateDoc || {};
  const tempRaw = parseFloat($('td-temperature').value);
  const tempClean = (Number.isFinite(tempRaw) && tempRaw >= 0 && tempRaw <= 2)
    ? tempRaw : DEFAULT_SETTINGS.translateDoc.temperature;
  const merged = {
    ...td,
    systemPrompt: $('td-systemPrompt').value || DEFAULT_DOC_SYSTEM_PROMPT,
    applyFixedGlossary: $('td-applyFixedGlossary').checked,
    temperature: tempClean,
  };
  await browser.storage.sync.set({ translateDoc: merged });
  showSaveBar('saved', t('doc.settingsPage.saveBar.saved'));
}

let initialLoaded = false;
let saveBarHideTimer = null;
function showSaveBar(state, text) {
  const bar = $('save-bar');
  bar.textContent = text;
  bar.className = 'save-bar ' + state;
  bar.hidden = false;
  if (saveBarHideTimer) clearTimeout(saveBarHideTimer);
  if (state === 'saved') {
    saveBarHideTimer = setTimeout(() => { bar.hidden = true; }, 3000);
  }
}
function hideSaveBar() {
  const bar = $('save-bar');
  bar.hidden = true;
  if (saveBarHideTimer) { clearTimeout(saveBarHideTimer); saveBarHideTimer = null; }
}
let _autoSaveTimer = null;
function scheduleAutoSave() {
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => { _autoSaveTimer = null; save(); }, 600);
}
function markDirty() {
  if (!initialLoaded) return;
  scheduleAutoSave();
  const bar = $('save-bar');
  if (bar.classList.contains('saved') && !bar.hidden) return;
  showSaveBar('dirty', t('doc.settingsPage.saveBar.dirty'));
}
document.querySelector('.container').addEventListener('input', markDirty);
document.querySelector('.container').addEventListener('change', markDirty);

$('td-reset-prompt').addEventListener('click', () => {
  $('td-systemPrompt').value = DEFAULT_DOC_SYSTEM_PROMPT;
  markDirty();
});

$('td-clear-all-cache-btn').addEventListener('click', async () => {
  if (!confirm(t('doc.settingsPage.confirm.clearAllCache'))) return;
  const status = $('td-clear-cache-status');
  try {
    const cleared = await cache.clearDocTranslationCache();
    status.textContent = t('doc.settingsPage.cache.cleared', { n: cleared });
    status.style.color = '#34c759';
    setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 3000);
  } catch (err) {
    status.textContent = t('doc.settingsPage.cache.failed', { error: (err && err.message) || '' });
    status.style.color = '#ef4444';
  }
});

load();
