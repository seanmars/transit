import { browser } from '../lib/compat.js';
import { DEFAULT_SETTINGS, normalizeTranslateEngines, normalizeTranslateDoc, docEngineFields, sanitizeEngineSpec, DEFAULT_SYSTEM_PROMPT, DEFAULT_GLOSSARY_PROMPT, DEFAULT_SUBTITLE_SYSTEM_PROMPT, DEFAULT_FORBIDDEN_TERMS, TARGET_LANGUAGES, UI_LANGUAGES, getEffectiveSystemPrompt, getEffectiveSubtitleSystemPrompt, getEffectiveGlossaryPrompt, isPromptUnchangedFromDefault, isPromptUnchangedFromAnyTargetDefault, LOCAL_SETTINGS_KEYS, migrateLargeKeysToLocalIfNeeded, overlayLocalSettings, splitSettingsPatch } from '../lib/storage.js';
import { formatTokens, formatUSD, formatMoney, parseUserNum, buildUsageCsvFilename, formatYmdHms } from '../lib/format.js';
import { sanitizeImport as sanitizeImportImpl, importChangesCustomProviderOrigin } from './import-sanitize.js';
import { isWorthNotifying, buildUpdateDownloadUrl } from '../lib/update-check.js';

const DEFAULTS = DEFAULT_SETTINGS;

import { MODEL_PRICING as LIB_MODEL_PRICING, DEFAULT_GEMINI_CACHED_DISCOUNT } from '../lib/model-pricing.js';
const MODEL_PRICING = Object.fromEntries(
  Object.entries(LIB_MODEL_PRICING).map(([model, p]) => [model, { input: p.inputPerMTok, output: p.outputPerMTok }])
);

function getSelectedModel() {
  const engineSel = $('engine-engine-primary');
  const modelSel = $('engine-model-primary');
  if (engineSel?.value === 'gemini' && modelSel?.value) {
    return modelSel.value;
  }
  return DEFAULTS.geminiConfig.model;
}

const $ = (id) => document.getElementById(id);

const MODEL_OVERRIDE_FIELDS = [
  { model: 'gemini-3.1-flash-lite', input: 'override-lite-input',   output: 'override-lite-output',   discount: 'override-lite-discount' },
  { model: 'gemini-3.5-flash-lite', input: 'override-lite35-input', output: 'override-lite35-output', discount: 'override-lite35-discount' },
  { model: 'gemini-3-flash-preview', input: 'override-flash-input', output: 'override-flash-output',  discount: 'override-flash-discount' },
  { model: 'gemini-3.8-flash',      input: 'override-flash38-input', output: 'override-flash38-output', discount: 'override-flash38-discount' },
];

let _currentTargetLang = DEFAULT_SETTINGS.targetLanguage;
let _uiLangChangeSubscribed = false;

async function load() {
  const saved = await browser.storage.sync.get(null);
  await migrateLargeKeysToLocalIfNeeded(saved);
  await overlayLocalSettings(saved);
  const { apiKey: localApiKey = '' } = await browser.storage.local.get('apiKey');
  const s = {
    ...DEFAULTS,
    ...saved,
    geminiConfig: { ...DEFAULTS.geminiConfig, ...(saved.geminiConfig || {}) },
    pricing: { ...DEFAULTS.pricing, ...(saved.pricing || {}) },
    apiKey: localApiKey,
  };
  $('apiKey').value = s.apiKey;
  _currentTargetLang = (typeof s.targetLanguage === 'string' && TARGET_LANGUAGES.includes(s.targetLanguage))
    ? s.targetLanguage : DEFAULTS.targetLanguage;
  $('serviceTier').value = s.geminiConfig.serviceTier;
  $('temperature').value = s.geminiConfig.temperature;
  $('maxOutputTokens').value = s.geminiConfig.maxOutputTokens;
  $('systemInstruction').value = s.geminiConfig.systemInstruction;
  const overrides = s.modelPricingOverrides || {};
  const fillOverride = (id, model, key) => {
    const el = $(id);
    if (!el) return;
    const v = overrides[model]?.[key];
    el.value = (Number.isFinite(Number(v)) ? Number(v) : '');
  };
  const fillOverrideDiscount = (id, model) => {
    const el = $(id);
    if (!el) return;
    const v = overrides[model]?.cachedDiscount;
    el.value = (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : '');
  };
  for (const f of MODEL_OVERRIDE_FIELDS) {
    fillOverride(f.input,  f.model, 'inputPerMTok');
    fillOverride(f.output, f.model, 'outputPerMTok');
    fillOverrideDiscount(f.discount, f.model);
  }
  $('whitelist').value = (s.domainRules.whitelist || []).join('\n');
  $('debugLog').checked = s.debugLog;

  $('maxConcurrentBatches').value = s.maxConcurrentBatches ?? 10;
  $('maxUnitsPerBatch').value = s.maxUnitsPerBatch ?? DEFAULTS.maxUnitsPerBatch;
  $('maxCharsPerBatch').value = s.maxCharsPerBatch ?? DEFAULTS.maxCharsPerBatch;
  $('maxTranslateUnits').value = s.maxTranslateUnits ?? 1000;
  const pm = { ...DEFAULTS.partialMode, ...(s.partialMode || {}) };
  $('partialModeEnabled').checked = pm.enabled === true;
  $('partialModeMaxUnits').value = pm.maxUnits;
  $('maxRetries').value = s.maxRetries ?? 3;

  const gl = { ...DEFAULTS.glossary, ...(s.glossary || {}) };
  $('glossaryEnabled').checked = gl.enabled !== false;
  $('glossaryModel').value = gl.model ?? DEFAULTS.glossary.model;
  $('glossaryBlockingThreshold').value = gl.blockingThreshold ?? DEFAULTS.glossary.blockingThreshold;
  $('glossaryTemperature').value = gl.temperature;
  $('glossaryTimeout').value = Math.round((gl.timeoutMs ?? 60000) / 1000);
  $('glossaryPrompt').value = gl.prompt;

  const opacityPct = Math.round((s.toastOpacity ?? 0.7) * 100);
  $('toastOpacity').value = opacityPct;
  _renderToastOpacityLabel(opacityPct);
  $('toastPosition').value = s.toastPosition || 'bottom-right';
  $('toastAutoHide').checked = s.toastAutoHide !== false;
  $('showProgressToast').checked = s.showProgressToast !== false;
  $('hideZhConvertToast').checked = s.hideZhConvertToast !== false;

  $('floatingIcon').checked = typeof s.floatingIcon === 'boolean' ? s.floatingIcon : true;
  const floatingSize = [16, 24, 32].includes(s.floatingIconSize) ? s.floatingIconSize : 24;
  for (const r of document.querySelectorAll('input[name="floatingIconSize"]')) {
    r.checked = (r.value === String(floatingSize));
  }
  const floatingOpacityPct = Math.round((s.floatingIconOpacity ?? 0.7) * 100);
  $('floatingIconOpacity').value = floatingOpacityPct;
  _renderFloatingOpacityLabel(floatingOpacityPct);
  _renderFloatingSizeDemo();

  $('hoverTranslateModifier').value = ['off', 'shift', 'alt', 'ctrl'].includes(s.hoverTranslateModifier) ? s.hoverTranslateModifier : 'off';
  $('hoverTranslateMode').value = s.hoverTranslateMode === 'single' ? 'single' : 'dual';

  const validMarks = ['tint', 'bar', 'dashed', 'none'];
  const savedMark = validMarks.includes(s.translationMarkStyle) ? s.translationMarkStyle : 'tint';
  for (const r of document.querySelectorAll('input[name="markStyle"]')) {
    r.checked = (r.value === savedMark);
  }
  updateDualDemoMark(savedMark);

  currentDualAccent = sanitizeDualAccent(s.dualAccentColor);
  refreshDualAccentUI();

  const validCurrencies = ['USD', 'TWD'];
  const savedCurrency = validCurrencies.includes(s.displayCurrency) ? s.displayCurrency : 'TWD';
  for (const r of document.querySelectorAll('input[name="displayCurrency"]')) {
    r.checked = (r.value === savedCurrency);
  }
  refreshExchangeRateDisplay();

  fixedGlossary = {
    global: Array.isArray(s.fixedGlossary?.global) ? s.fixedGlossary.global : [],
    byDomain: (s.fixedGlossary?.byDomain && typeof s.fixedGlossary.byDomain === 'object') ? s.fixedGlossary.byDomain : {},
  };
  currentDomain = '';
  renderGlobalTable();
  updateDomainSelect();
  showDomainPanel('');

  forbiddenTerms = Array.isArray(saved.forbiddenTerms)
    ? saved.forbiddenTerms
    : (s.targetLanguage === 'zh-TW' ? DEFAULT_FORBIDDEN_TERMS.map(t => ({ ...t })) : []);
  renderForbiddenTermsTable();

  const cp = { ...DEFAULTS.customProvider, ...(s.customProvider || {}) };
  $('cp-baseUrl').value = cp.baseUrl || '';
  $('cp-model').value = cp.model || '';
  $('cp-systemPrompt').value = cp.systemPrompt || '';
  $('cp-temperature').value = (typeof cp.temperature === 'number')
    ? cp.temperature
    : (cp.temperature === null ? '' : 0.7);
  $('cp-fetchTimeout').value = (typeof cp.fetchTimeoutSec === 'number') ? cp.fetchTimeoutSec : 90;
  $('cp-inputPerMTok').value = cp.inputPerMTok != null ? cp.inputPerMTok : '';
  $('cp-outputPerMTok').value = cp.outputPerMTok != null ? cp.outputPerMTok : '';
  $('cp-cachedDiscount').value = (Number.isFinite(Number(cp.cachedDiscount))
    ? Math.round(Number(cp.cachedDiscount) * 100)
    : '');
  const validLevels = ['auto', 'off', 'low', 'medium', 'high'];
  const tl = validLevels.includes(cp.thinkingLevel) ? cp.thinkingLevel : 'auto';
  if ($('cp-thinking-level')) $('cp-thinking-level').value = tl;
  if ($('cp-extra-body-json')) $('cp-extra-body-json').value = (typeof cp.extraBodyJson === 'string') ? cp.extraBodyJson : '';
  if ($('cp-strong-seg-marker')) $('cp-strong-seg-marker').checked = cp.useStrongSegMarker !== false;
  const { customProviderApiKey = '' } = await browser.storage.local.get('customProviderApiKey');
  $('cp-apiKey').value = customProviderApiKey;

  const yt = { ...DEFAULTS.ytSubtitle, ...(s.ytSubtitle || {}) };
  const ytEngineEl = $('ytEngine');
  if (ytEngineEl) ytEngineEl.value = yt.engine || 'gemini';
  $('ytAutoTranslate').checked       = yt.autoTranslate       === true;
  $('ytAsrProgressive').checked = yt.asrMode !== 'heuristic';
  $('ytApplyFixedGlossary').checked  = yt.applyFixedGlossary  === true;
  $('ytApplyForbiddenTerms').checked = yt.applyForbiddenTerms === true;
  $('ytDebugToast').checked          = yt.debugToast          === true;
  $('ytOnTheFly').checked            = yt.onTheFly            === true;
  $('ytWindowSizeS').value           = yt.windowSizeS ?? 30;
  $('ytLookaheadS').value            = yt.lookaheadS  ?? 10;
  $('ytTemperature').value           = yt.temperature  ?? 1;
  $('ytSystemPrompt').value          = yt.systemPrompt || DEFAULT_SUBTITLE_SYSTEM_PROMPT;
  const ytModelSel = $('ytModel');
  const savedYtModel = yt.model || '';
  if ([...ytModelSel.options].some(o => o.value === savedYtModel)) {
    ytModelSel.value = savedYtModel;
  } else {
    ytModelSel.value = '';
  }
  const ytPricing = yt.pricing;
  $('ytInputPerMTok').value  = ytPricing?.inputPerMTok  != null ? ytPricing.inputPerMTok  : '';
  $('ytOutputPerMTok').value = ytPricing?.outputPerMTok != null ? ytPricing.outputPerMTok : '';

  const engines = normalizeTranslateEngines(saved);
  for (const slot of ENGINE_SLOTS) {
    const p = engines[slot];
    $(`engine-label-${slot}`).value = p.label || '';
    $(`engine-engine-${slot}`).value = p.engine;
    setGeminiModelSelect($(`engine-model-${slot}`), p.engine === 'gemini' ? p.model : null, _t(`options.engine.${slot}`));
    updateEngineModelVisibility(slot);
  }
  const docCfg = normalizeTranslateDoc(saved.translateDoc);
  $('doc-engine').value = docCfg.engine;
  setGeminiModelSelect($('doc-model'), docCfg.engine === 'gemini' ? docCfg.model : null, _t('options.engine.doc'));
  updateDocModelVisibility();
  shortcutTable = SC ? SC.sanitizeTable(s.customShortcuts) : shortcutTable;
  renderShortcutRecorders();

  _presetsCache = [engines.primary, engines.fallback];
  _customProviderCache = cp || { model: '' };

  updateYtSectionVisibility();
  updateYtPromptCostHint();

  try {
    const disableUpdateNotice = s.disableUpdateNotice === true;
    if (!disableUpdateNotice) {
      const { updateAvailable } = await browser.storage.local.get('updateAvailable');
      const manifest = browser.runtime.getManifest();
      if (updateAvailable && updateAvailable.version && updateAvailable.releaseUrl
          && isWorthNotifying(updateAvailable.version, manifest.version)) {
        $('update-banner-row').hidden = false;
        $('update-banner-version').textContent = _t('options.updateBanner.version', {
          newVersion: updateAvailable.version,
          currentVersion: manifest.version,
        });
      }
    }
  } catch {   }

  updateAllPromptTargetHints();

  const I18N = window.__SK?.i18n;
  if ($('uiLanguage')) {
    const ul = (typeof s.uiLanguage === 'string' && UI_LANGUAGES.includes(s.uiLanguage))
      ? s.uiLanguage : 'auto';
    $('uiLanguage').value = ul;
  }
  if (I18N) {
    const dictLang = I18N.getUiLanguage($('uiLanguage')?.value || s.uiLanguage || 'auto');
    I18N.applyI18n(document, dictLang);
    { const _vEl = $('options-version');
      if (_vEl) _vEl.textContent = 'v' + browser.runtime.getManifest().version; }
    _updateCurrencySectionVisibility();
    _renderToastOpacityLabel($('toastOpacity')?.value || 70);
    _renderFloatingOpacityLabel($('floatingIconOpacity')?.value || 70);
    updateYtPromptCostHint();
    refreshDomainKeyLabels();
    if (!_uiLangChangeSubscribed) {
    _uiLangChangeSubscribed = true;
    I18N.subscribeUiLanguageChange((newUi  ) => {
      applyUiLanguageRefresh(newUi);
    });
    }
  }
}

const _t = (key, params) => {
  const I18N = window.__SK?.i18n;
  if (!I18N) return key;
  const dictLang = I18N.getUiLanguage($('uiLanguage')?.value || 'auto');
  return I18N.t(key, params, dictLang);
};

const SC = window.__SKShortcuts;
let shortcutTable = SC ? SC.sanitizeTable(null) : { 2: null };
let recordingSlot = null;

function shortcutReasonText(v) {
  if (v.reason === 'shortcut.invalid.isDefault') return _t('shortcut.invalid.isDefault', { key: v.detail });
  return _t(v.reason);
}

function shortcutHint(text) {
  const el = $('shortcut-hint');
  if (el) el.textContent = text ? '⚠ ' + text : '';
}

function flashRecorderInvalid(slot) {
  const btn = $(`sc-${slot}`);
  if (!btn) return;
  btn.classList.add('invalid');
  setTimeout(() => btn.classList.remove('invalid'), 1200);
}

function renderShortcutRecorders() {
  if (!SC) return;
  for (const slot of SC.SLOTS) {
    const btn = $(`sc-${slot}`);
    const clearBtn = $(`sc-clear-${slot}`);
    if (!btn) continue;
    const custom = shortcutTable[slot];
    const def = SC.MANIFEST_DEFAULTS[slot];
    if (recordingSlot === slot) {
      btn.textContent = _t('shortcut.recording');
    } else if (custom) {
      btn.textContent = SC.format(custom);
    } else {
      btn.textContent = def ? _t('shortcut.defaultSuffix', { key: SC.format(def) }) : _t('common.unset');
    }
    btn.classList.toggle('recording', recordingSlot === slot);
    btn.classList.toggle('is-default', !custom && recordingSlot !== slot);
    if (clearBtn) clearBtn.disabled = !custom;
  }
}

function saveShortcutTable() {
  browser.storage.sync.set({ customShortcuts: shortcutTable }).then(() => {
    showSaveBar('saved', _t('options.action.savedBar'));
  }).catch(() => {});
}

if (SC) {
  for (const slot of SC.SLOTS) {
    $(`sc-${slot}`)?.addEventListener('click', () => {
      recordingSlot = recordingSlot === slot ? null : slot;
      shortcutHint('');
      renderShortcutRecorders();
    });
    $(`sc-clear-${slot}`)?.addEventListener('click', () => {
      shortcutTable[slot] = null;
      recordingSlot = null;
      shortcutHint('');
      saveShortcutTable();
      renderShortcutRecorders();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (recordingSlot == null) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      recordingSlot = null;
      renderShortcutRecorders();
      return;
    }
    const s = SC.eventToShortcut(e);
    if (!s) return;
    const v = SC.validate(s);
    if (!v.ok) {
      const failedSlot = recordingSlot;
      shortcutHint(shortcutReasonText(v));
      recordingSlot = null;
      renderShortcutRecorders();
      flashRecorderInvalid(failedSlot);
      return;
    }
    for (const other of SC.SLOTS) {
      if (other === recordingSlot) continue;
      const effective = shortcutTable[other] || SC.MANIFEST_DEFAULTS[other];
      if (effective && SC.shortcutEquals(s, effective)) {
        const failedSlot = recordingSlot;
        shortcutHint(_t('shortcut.invalid.assigned', { key: SC.format(s) }));
        recordingSlot = null;
        renderShortcutRecorders();
        flashRecorderInvalid(failedSlot);
        return;
      }
    }
    shortcutTable[recordingSlot] = s;
    recordingSlot = null;
    shortcutHint('');
    saveShortcutTable();
    renderShortcutRecorders();
  }, true);
}

$('update-banner-dismiss')?.addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  await browser.storage.sync.set({ disableUpdateNotice: true });
  $('update-banner-row').hidden = true;
});

document.addEventListener('click', async (e) => {
  const banner = e.target.closest('#update-banner');
  if (!banner) return;
  e.preventDefault();
  try {
    const { updateAvailable } = await browser.storage.local.get('updateAvailable');
    const url = buildUpdateDownloadUrl(updateAvailable);
    await browser.tabs.create({ url });
  } catch (err) {
    console.error('[transit] update-banner click failed', err);
  }
});

function updateDualDemoMark(mark) {
  ['dual-demo-wrapper-light', 'dual-demo-wrapper-dark'].forEach(id => {
    const wrapper = document.getElementById(id);
    if (wrapper) wrapper.setAttribute('data-sk-mark', mark);
  });
}

function getSelectedMarkStyle() {
  const checked = document.querySelector('input[name="markStyle"]:checked');
  const v = checked?.value;
  return ['tint', 'bar', 'dashed', 'none'].includes(v) ? v : 'tint';
}

const DUAL_ACCENT_TOKENS = ['auto', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink'];
const DUAL_ACCENT_HEX_MAP = {
  blue: '#3B82F6', green: '#10B981', yellow: '#F59E0B', orange: '#F97316',
  red: '#EF4444', purple: '#A855F7', pink: '#EC4899',
};
const DUAL_ACCENT_HEX_RE = /^#[0-9a-fA-F]{6}$/;

function sanitizeDualAccent(value) {
  if (typeof value !== 'string') return 'auto';
  const v = value.trim();
  if (DUAL_ACCENT_TOKENS.includes(v)) return v;
  if (DUAL_ACCENT_HEX_RE.test(v)) return v.toUpperCase();
  return 'auto';
}

function dualAccentToHex(value) {
  const norm = sanitizeDualAccent(value);
  if (norm === 'auto') return null;
  return DUAL_ACCENT_HEX_MAP[norm] || norm;
}

function dualAccentToRgbString(value) {
  const hex = dualAccentToHex(value);
  if (!hex) return null;
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 0xff} ${(n >> 8) & 0xff} ${n & 0xff}`;
}

let currentDualAccent = 'auto';

function applyDualAccentToDemo(value) {
  const norm = sanitizeDualAccent(value);
  const rgbStr = dualAccentToRgbString(norm);
  ['dual-demo-wrapper-light', 'dual-demo-wrapper-dark'].forEach(id => {
    const w = document.getElementById(id);
    if (!w) return;
    if (rgbStr) {
      w.setAttribute('data-sk-accent', 'custom');
      w.style.setProperty('--sk-accent-rgb', rgbStr);
    } else {
      w.removeAttribute('data-sk-accent');
      w.style.removeProperty('--sk-accent-rgb');
    }
  });
}

function refreshDualAccentUI() {
  const norm = currentDualAccent;
  for (const btn of document.querySelectorAll('.dual-accent-swatch')) {
    btn.classList.toggle('is-active', btn.dataset.token === norm);
  }
  const hexInput = document.getElementById('dualAccentHexInput');
  const picker = document.getElementById('dualAccentColorPicker');
  const hex = dualAccentToHex(norm);
  if (hexInput) {
    if (norm === 'auto') {
      hexInput.value = '';
      hexInput.removeAttribute('aria-invalid');
    } else {
      hexInput.value = hex || '';
      hexInput.removeAttribute('aria-invalid');
    }
  }
  if (picker && hex) picker.value = hex;
  applyDualAccentToDemo(norm);
}

function setDualAccent(value) {
  currentDualAccent = sanitizeDualAccent(value);
  refreshDualAccentUI();
  if (typeof markDirty === 'function') markDirty();
}

function getSelectedCurrency() {
  const checked = document.querySelector('input[name="displayCurrency"]:checked');
  const v = checked?.value;
  return ['USD', 'TWD'].includes(v) ? v : 'TWD';
}

let currentCurrencyState = { currency: 'TWD', rate: 31.6, fetchedAt: 0, source: 'fallback' };

function fmtMoneyOpts() {
  return { currency: currentCurrencyState.currency, rate: currentCurrencyState.rate };
}

function _renderToastOpacityLabel(value) {
  const wrap = document.getElementById('toastOpacityLabelWrap');
  if (wrap) wrap.textContent = _t('options.toast.opacity', { value });
  const demo = document.getElementById('toastOpacityDemo');
  if (demo) demo.style.opacity = String(Math.max(0, Math.min(1, Number(value) / 100)));
}

function _renderFloatingOpacityLabel(value) {
  const wrap = document.getElementById('floatingOpacityLabelWrap');
  if (wrap) wrap.textContent = _t('options.floating.opacity', { value });
  const demo = document.getElementById('floatingOpacityDemo');
  if (demo) demo.style.opacity = String(Math.max(0, Math.min(1, Number(value) / 100)));
}

function _renderFloatingSizeDemo() {
  const v = document.querySelector('input[name="floatingIconSize"]:checked')?.value;
  const size = ['16', '24', '32'].includes(v) ? Number(v) : 24;
  const img = document.querySelector('#floatingOpacityDemo img');
  if (img) { img.width = size; img.height = size; }
}

function _updateCurrencySectionVisibility() {
  const sec = document.getElementById('currency-section');
  if (!sec) return;
  const I18N = window.__SK?.i18n;
  const uiPref = $('uiLanguage')?.value || 'auto';
  const dictLang = I18N ? I18N.getUiLanguage(uiPref) : 'zh-TW';
  sec.hidden = (dictLang !== 'zh-TW');
}

async function refreshExchangeRateDisplay() {
  const el = document.getElementById('currency-rate-display');
  if (!el) return;
  el.textContent = _t('options.currency.rateLoading');
  try {
    const resp = await browser.runtime.sendMessage({ type: 'EXCHANGE_RATE_GET' });
    if (resp?.ok) {
      currentCurrencyState = {
        currency: getSelectedCurrency(),
        rate: resp.rate,
        fetchedAt: resp.fetchedAt,
        source: resp.source,
      };
      el.textContent = formatRateLine(resp);
    } else {
      el.textContent = _t('options.currency.rateFailed');
    }
  } catch {
    el.textContent = _t('options.currency.rateFailed');
  }
}

function formatRateLine(rate) {
  const rateStr = Number(rate.rate).toFixed(2);
  if (rate.source === 'fallback' || !rate.fetchedAt) {
    return _t('options.currency.rateFallback', { rate: rateStr });
  }
  const d = new Date(rate.fetchedAt);
  const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const hm  = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  return _t('options.currency.rateOk', { rate: rateStr, ymd, hm });
}

const ENGINE_SLOTS = ['primary', 'fallback'];

// 選單沒有這個模型時改用預設模型, 並提示使用者
function setGeminiModelSelect(sel, model, title) {
  if (model && [...sel.options].some(o => o.value === model)) {
    sel.value = model;
    return;
  }
  const fallbackModel = DEFAULTS.geminiConfig.model;
  sel.value = fallbackModel;
  if (model) showSaveBar('dirty', _t('options.engine.modelFallback', { name: title, model, fallback: fallbackModel }));
}

function updateEngineModelVisibility(slot) {
  const engine = $(`engine-engine-${slot}`).value;
  const row = $(`engine-model-row-${slot}`);
  if (row) row.hidden = (engine !== 'gemini');
}

function updateDocModelVisibility() {
  const row = $('doc-model-row');
  if (row) row.hidden = ($('doc-engine').value !== 'gemini');
}

function readEngineSpec(slot) {
  const engine = $(`engine-engine-${slot}`).value;
  return sanitizeEngineSpec({
    engine,
    model: engine === 'gemini' ? ($(`engine-model-${slot}`).value || null) : null,
    label: $(`engine-label-${slot}`).value || '',
  }, DEFAULTS.translateEngines[slot]);
}

function updateYtSectionVisibility() {
  const engine = $('ytEngine')?.value || 'gemini';
  const geminiOnly = document.getElementById('yt-gemini-only-sections');
  const promptSection = document.getElementById('yt-prompt-section');
  if (geminiOnly) geminiOnly.hidden = (engine !== 'gemini');
  if (promptSection) promptSection.hidden = (engine === 'google');
  const asrToggle = $('ytAsrProgressive');
  const asrGoogleNote = document.getElementById('yt-asr-google-note');
  if (asrToggle) asrToggle.disabled = (engine === 'google');
  if (asrGoogleNote) asrGoogleNote.hidden = (engine !== 'google');
}

function updateYtPromptCostHint() {
  const hintEl = $('yt-prompt-cost-hint');
  if (!hintEl) return;

  let inputPrice = 0;
  let modelDisplay = '';
  const engine = $('ytEngine')?.value || 'gemini';
  const cpInput = parseFloat($('cp-inputPerMTok').value);
  const cpModel = ($('cp-model').value || '').trim();
  const ytModel = $('ytModel').value;
  const ytInput = parseFloat($('ytInputPerMTok').value);
  const mainModel = getSelectedModel();
  const mainInput = MODEL_PRICING[mainModel]?.input ?? 0;

  if (engine === 'openai-compat') {
    inputPrice = isNaN(cpInput) ? 0 : cpInput;
    modelDisplay = cpModel || _t('options.cp.modelDisplayUnset');
  } else if (engine === 'gemini') {
    if (!isNaN(ytInput) && ytInput > 0) {
      inputPrice = ytInput;
      modelDisplay = ytModel || mainModel;
    } else if (ytModel && MODEL_PRICING[ytModel]) {
      inputPrice = MODEL_PRICING[ytModel].input;
      modelDisplay = ytModel;
    } else if (!isNaN(mainInput)) {
      inputPrice = mainInput;
      modelDisplay = mainModel;
    }
  }

  const fbCount = Array.isArray(forbiddenTerms) ? forbiddenTerms.filter(t => t && t.forbidden).length : 0;
  const fgCount = (fixedGlossary?.global || []).filter(e => e.source && e.target).length;
  const fbTok = fbCount > 0 ? 450 + 3 * fbCount : 0;
  const fgTok = fgCount > 0 ? 67  + 5 * fgCount : 0;

  const BATCHES_PER_30MIN = 60;
  function fmtUSD(tok, cacheRatio = 1) {
    if (!inputPrice || !tok) return '$0';
    const usd = tok * BATCHES_PER_30MIN / 1_000_000 * inputPrice * cacheRatio;
    if (usd < 0.0001) return '<$0.0001';
    if (usd < 0.01)   return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(3)}`;
  }

  if (engine === 'google') {
    hintEl.innerHTML = _t('options.gemini.cost.googleHint.html');
    return;
  }
  if (!inputPrice) {
    hintEl.innerHTML = _t('options.gemini.cost.noPrice.html');
    return;
  }

  const cachedRate = 1 - DEFAULT_GEMINI_CACHED_DISCOUNT;
  const cachedPct = Math.round(cachedRate * 100);
  hintEl.innerHTML =
    _t('options.gemini.cost.estimateHeader.html', {
      model: escapeHtml(modelDisplay),
      inputPrice,
    }) + '<br>' +
    `<span class="cost-hint-item">${_t('options.gemini.cost.estimateGlossary.html', {
      count: fgCount, tok: fgTok, usd: fmtUSD(fgTok), usdCache: fmtUSD(fgTok, cachedRate),
    })}</span><br>` +
    `<span class="cost-hint-item">${_t('options.gemini.cost.estimateForbidden.html', {
      count: fbCount, tok: fbTok, usd: fmtUSD(fbTok), usdCache: fmtUSD(fbTok, cachedRate),
    })}</span><br>` +
    `<span class="cost-hint-foot">${_t('options.gemini.cost.estimateFooter.html', { pct: cachedPct })}</span>`;
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
  } catch (err) {
    const msg = err?.message || String(err);
    console.warn('[Transit options] save failed', err);
    showSaveBar('dirty', _t('options.action.saveFailed', { error: msg }));
  } finally {
    _saveInFlight = false;
  }
}

async function _saveImpl() {
  const apiKeyValue = $('apiKey').value.trim();
  await browser.storage.local.set({ apiKey: apiKeyValue });
  const existing = await browser.storage.sync.get(['geminiConfig', 'pricing', 'ytSubtitle', 'translateDoc']);
  const existingModel = existing.geminiConfig?.model || DEFAULTS.geminiConfig.model;
  const settings = {
    geminiConfig: {
      model: existingModel,
      serviceTier: $('serviceTier').value,
      temperature: parseUserNum($('temperature').value, DEFAULTS.geminiConfig.temperature),
      topP: existing.geminiConfig?.topP ?? DEFAULTS.geminiConfig.topP,
      topK: existing.geminiConfig?.topK ?? DEFAULTS.geminiConfig.topK,
      maxOutputTokens: parseUserNum($('maxOutputTokens').value, DEFAULTS.geminiConfig.maxOutputTokens),
      systemInstruction: $('systemInstruction').value,
    },
    pricing: existing.pricing || DEFAULTS.pricing,
    domainRules: {
      whitelist: $('whitelist').value.split('\n').map(s => s.trim()).filter(Boolean),
    },
    debugLog: $('debugLog').checked,
    maxRetries: parseUserNum($('maxRetries').value, DEFAULTS.maxRetries),
    maxConcurrentBatches: parseUserNum($('maxConcurrentBatches').value, DEFAULTS.maxConcurrentBatches),
    maxUnitsPerBatch: parseUserNum($('maxUnitsPerBatch').value, DEFAULTS.maxUnitsPerBatch),
    maxCharsPerBatch: parseUserNum($('maxCharsPerBatch').value, DEFAULTS.maxCharsPerBatch),
    maxTranslateUnits: parseUserNum($('maxTranslateUnits').value, DEFAULTS.maxTranslateUnits),
    partialMode: {
      enabled: $('partialModeEnabled').checked,
      maxUnits: parseUserNum($('partialModeMaxUnits').value, DEFAULTS.partialMode.maxUnits),
    },
    glossary: {
      enabled: $('glossaryEnabled').checked,
      model: $('glossaryModel').value,
      prompt: $('glossaryPrompt').value,
      temperature: parseUserNum($('glossaryTemperature').value, DEFAULTS.glossary.temperature ?? 0.1),
      skipThreshold: DEFAULTS.glossary.skipThreshold,
      blockingThreshold: parseUserNum($('glossaryBlockingThreshold').value, DEFAULTS.glossary.blockingThreshold),
      timeoutMs: parseUserNum($('glossaryTimeout').value, (DEFAULTS.glossary.timeoutMs ?? 60000) / 1000) * 1000,
      maxTerms: DEFAULTS.glossary.maxTerms,
    },
    toastOpacity: parseUserNum($('toastOpacity').value, (DEFAULTS.toastOpacity ?? 0.95) * 100) / 100,
    toastPosition: $('toastPosition').value,
    toastAutoHide: $('toastAutoHide').checked,
    showProgressToast: $('showProgressToast').checked,
    hideZhConvertToast: $('hideZhConvertToast').checked,
    floatingIcon: $('floatingIcon').checked,
    floatingIconSize: (() => { const v = document.querySelector('input[name="floatingIconSize"]:checked')?.value; return ['16', '24', '32'].includes(v) ? Number(v) : 24; })(),
    floatingIconOpacity: parseUserNum($('floatingIconOpacity').value, (DEFAULTS.floatingIconOpacity ?? 0.7) * 100) / 100,
    hoverTranslateModifier: $('hoverTranslateModifier').value,
    hoverTranslateMode: $('hoverTranslateMode').value,
    translationMarkStyle: getSelectedMarkStyle(),
    dualAccentColor: currentDualAccent,
    displayCurrency: getSelectedCurrency(),
    ytSubtitle: {
      ...(existing.ytSubtitle || {}),
      engine: ($('ytEngine')?.value || 'gemini'),
      autoTranslate:      $('ytAutoTranslate').checked,
      asrMode: $('ytAsrProgressive').checked ? 'progressive' : 'heuristic',
      applyFixedGlossary:  $('ytApplyFixedGlossary').checked,
      applyForbiddenTerms: $('ytApplyForbiddenTerms').checked,
      debugToast:         $('ytDebugToast').checked,
      onTheFly:           $('ytOnTheFly').checked,
      windowSizeS:  parseUserNum($('ytWindowSizeS').value, DEFAULTS.ytSubtitle.windowSizeS ?? 30),
      lookaheadS:   parseUserNum($('ytLookaheadS').value, DEFAULTS.ytSubtitle.lookaheadS ?? 10),
      temperature:  parseUserNum($('ytTemperature').value, DEFAULTS.ytSubtitle.temperature ?? 1),
      systemPrompt: $('ytSystemPrompt').value || DEFAULT_SUBTITLE_SYSTEM_PROMPT,
      model: $('ytModel').value || '',
      pricing: (() => {
        const inp = parseFloat($('ytInputPerMTok').value);
        const out = parseFloat($('ytOutputPerMTok').value);
        if (isNaN(inp) && isNaN(out)) return null;
        return {
          inputPerMTok:  isNaN(inp) ? null : inp,
          outputPerMTok: isNaN(out) ? null : out,
        };
      })(),
    },
    translateEngines: {
      primary: readEngineSpec('primary'),
      fallback: readEngineSpec('fallback'),
    },
    translateDoc: {
      ...(existing.translateDoc || {}),
      ...docEngineFields($('doc-engine').value, $('doc-model').value),
    },
    modelPricingOverrides: (() => {
      const collect = (model, inputId, outputId, discountId) => {
        const i = $(inputId)?.value?.trim() ?? '';
        const o = $(outputId)?.value?.trim() ?? '';
        const d = $(discountId)?.value?.trim() ?? '';
        const entry = { model };
        if (i !== '' && o !== '') {
          const ni = Number(i), no = Number(o);
          if (Number.isFinite(ni) && Number.isFinite(no) && ni >= 0 && no >= 0) {
            entry.inputPerMTok = ni;
            entry.outputPerMTok = no;
          }
        }
        if (d !== '') {
          const nd = Number(d);
          if (Number.isFinite(nd) && nd >= 0 && nd <= 100) {
            entry.cachedDiscount = nd / 100;
          }
        }
        return Object.keys(entry).length > 1 ? entry : null;
      };
      const rows = MODEL_OVERRIDE_FIELDS
        .map((f) => collect(f.model, f.input, f.output, f.discount))
        .filter(Boolean);
      const out = {};
      for (const r of rows) {
        const { model, ...rest } = r;
        out[model] = rest;
      }
      return out;
    })(),
    fixedGlossary: (() => {
      fixedGlossary.global = readGlossaryTableEntries($('fixed-global-tbody'));
      if (currentDomain && fixedGlossary.byDomain[currentDomain]) {
        fixedGlossary.byDomain[currentDomain] = readGlossaryTableEntries($('fixed-domain-tbody'));
      }
      const cleanGlobal = fixedGlossary.global.filter(e => e.source || e.target);
      const cleanByDomain = {};
      for (const [domain, entries] of Object.entries(fixedGlossary.byDomain)) {
        const clean = entries.filter(e => e.source || e.target);
        if (clean.length > 0) cleanByDomain[domain] = clean;
      }
      return { global: cleanGlobal, byDomain: cleanByDomain };
    })(),
    forbiddenTerms: (() => {
      forbiddenTerms = readForbiddenTableEntries();
      return forbiddenTerms.filter(t => t.forbidden || t.replacement);
    })(),
    customProvider: {
      baseUrl: ($('cp-baseUrl').value || '').trim(),
      model: ($('cp-model').value || '').trim(),
      systemPrompt: $('cp-systemPrompt').value || '',
      temperature: (() => {
        const raw = String($('cp-temperature').value ?? '').trim();
        if (raw === '') return null;
        return parseUserNum(raw, DEFAULTS.customProvider?.temperature ?? 0.7);
      })(),
      fetchTimeoutSec: parseUserNum($('cp-fetchTimeout').value, DEFAULTS.customProvider?.fetchTimeoutSec ?? 90),
      inputPerMTok: parseUserNum($('cp-inputPerMTok').value, 0),
      outputPerMTok: parseUserNum($('cp-outputPerMTok').value, 0),
      cachedDiscount: (() => {
        const raw = $('cp-cachedDiscount')?.value?.trim();
        if (!raw) return null;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 100) return null;
        return n / 100;
      })(),
      thinkingLevel: (() => {
        const v = $('cp-thinking-level')?.value;
        return ['auto', 'off', 'low', 'medium', 'high'].includes(v) ? v : 'auto';
      })(),
      extraBodyJson: ($('cp-extra-body-json')?.value || '').trim(),
      useStrongSegMarker: $('cp-strong-seg-marker')?.checked !== false,
    },
  };
  if (isForbiddenTermsDefaultFor(settings.forbiddenTerms, _currentTargetLang, DEFAULT_FORBIDDEN_TERMS)) {
    delete settings.forbiddenTerms;
    await browser.storage.local.remove('forbiddenTerms');
    await browser.storage.sync.remove('forbiddenTerms');
  }
  const cpApiKeyValue = ($('cp-apiKey').value || '').trim();
  await browser.storage.local.set({ customProviderApiKey: cpApiKeyValue });
  const { syncPart, localPart } = splitSettingsPatch(settings);
  if (Object.keys(localPart).length > 0) await browser.storage.local.set(localPart);
  await browser.storage.sync.set(syncPart);
  showSaveBar('saved', _t('options.action.savedBar'));
}

$('cp-toggle-apiKey').addEventListener('click', () => {
  const input = $('cp-apiKey');
  const btn = $('cp-toggle-apiKey');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = _t('options.action.hide');
  } else {
    input.type = 'password';
    btn.textContent = _t('options.action.show');
  }
});

$('cp-test-apiKey').addEventListener('click', async () => {
  await runApiTest({
    btn: $('cp-test-apiKey'),
    resultEl: $('cp-test-apiKey-result'),
    sendMessage: () => browser.runtime.sendMessage({
      type: 'TEST_CUSTOM_PROVIDER',
      payload: {
        baseUrl: ($('cp-baseUrl').value || '').trim(),
        model: ($('cp-model').value || '').trim(),
        apiKey: ($('cp-apiKey').value || '').trim(),
      },
    }),
  });
});
function _syncPromptTextareaToTarget(textareaId, hintId, getEffectiveFn) {
  const textarea = $(textareaId);
  const hint = $(hintId);
  if (!textarea) return;
  const tl = _currentTargetLang;
  const cur = textarea.value || '';
  const treatedAsUnchanged = isPromptUnchangedFromAnyTargetDefault(cur, getEffectiveFn);
  if (treatedAsUnchanged) {
    textarea.value = getEffectiveFn(tl, '');
    if (hint) hint.hidden = true;
  } else {
    if (hint) hint.hidden = false;
  }
}

function updateAllPromptTargetHints() {
  _syncPromptTextareaToTarget('systemInstruction', 'systemInstruction-target-hint', getEffectiveSystemPrompt);
  _syncPromptTextareaToTarget('glossaryPrompt', 'glossaryPrompt-target-hint', getEffectiveGlossaryPrompt);
  _syncPromptTextareaToTarget('ytSystemPrompt', 'ytSystemPrompt-target-hint', getEffectiveSubtitleSystemPrompt);
  _syncPromptTextareaToTarget('cp-systemPrompt', 'cp-systemPrompt-target-hint', getEffectiveSystemPrompt);
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.targetLanguage) return;
  const nv = changes.targetLanguage.newValue;
  if (typeof nv !== 'string' || !TARGET_LANGUAGES.includes(nv)) return;
  if (nv === _currentTargetLang) return;
  const prevTl = _currentTargetLang;
  _currentTargetLang = nv;
  updateAllPromptTargetHints();
  _syncForbiddenTermsToTarget(nv, prevTl);
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const gEnabled = changes.glossary?.newValue?.enabled;
  if (typeof gEnabled === 'boolean' && $('glossaryEnabled')) {
    $('glossaryEnabled').checked = gEnabled;
  }
  const ytAuto = changes.ytSubtitle?.newValue?.autoTranslate;
  if (typeof ytAuto === 'boolean' && $('ytAutoTranslate')) {
    $('ytAutoTranslate').checked = ytAuto;
  }
});

let _lastAppliedUiDictLang = null;
function applyUiLanguageRefresh(dictLang) {
  if (dictLang === _lastAppliedUiDictLang) return;
  _lastAppliedUiDictLang = dictLang;
  const I18N = window.__SK?.i18n;
  if (!I18N) return;
  I18N.applyI18n(document, dictLang);
  { const _vEl = $('options-version');
    if (_vEl) _vEl.textContent = 'v' + browser.runtime.getManifest().version; }
  renderShortcutRecorders();
  refreshExchangeRateDisplay();
  _updateCurrencySectionVisibility();
  _renderToastOpacityLabel($('toastOpacity')?.value || 70);
  _renderFloatingOpacityLabel($('floatingIconOpacity')?.value || 70);
  updateYtPromptCostHint();
  refreshDomainKeyLabels();
}

$('uiLanguage')?.addEventListener('change', async () => {
  const v = $('uiLanguage').value;
  const ul = UI_LANGUAGES.includes(v) ? v : 'auto';
  try {
    await browser.storage.sync.set({ uiLanguage: ul });
  } catch (err) {
    console.error('[transit] uiLanguage set failed', err);
  }
  if (window.__SK?.i18n) {
    applyUiLanguageRefresh(window.__SK.i18n.getUiLanguage(ul));
  }
});

function isForbiddenTermsDefaultFor(terms, tl, defaults) {
  if (!Array.isArray(terms)) return false;
  if (terms.length === 0) return tl !== 'zh-TW';
  if (terms.length !== defaults.length) return false;
  for (let i = 0; i < terms.length; i++) {
    const a = terms[i];
    const b = defaults[i];
    if ((a?.forbidden || '') !== b.forbidden || (a?.replacement || '') !== b.replacement) {
      return false;
    }
  }
  return true;
}

function _syncForbiddenTermsToTarget(newTl, oldTl) {
  if (!isForbiddenTermsDefaultFor(forbiddenTerms, oldTl, DEFAULT_FORBIDDEN_TERMS)) return;
  forbiddenTerms = newTl === 'zh-TW' ? DEFAULT_FORBIDDEN_TERMS.map(t => ({ ...t })) : [];
  renderForbiddenTermsTable();
  browser.storage.local.remove('forbiddenTerms');
  browser.storage.sync.remove('forbiddenTerms');
}

$('yt-reset-prompt').addEventListener('click', () => {
  const tl = _currentTargetLang;
  $('ytSystemPrompt').value = getEffectiveSubtitleSystemPrompt(tl, '');
  markDirty();
  updateAllPromptTargetHints();
});
$('cp-reset-prompt')?.addEventListener('click', () => {
  const tl = _currentTargetLang;
  $('cp-systemPrompt').value = getEffectiveSystemPrompt(tl, '');
  markDirty();
  updateAllPromptTargetHints();
});

$('gemini-reset-all')?.addEventListener('click', () => {
  if (!confirm(_t('options.gemini.resetAllConfirm'))) return;
  const D = DEFAULTS;
  $('serviceTier').value = D.geminiConfig.serviceTier;
  $('temperature').value     = D.geminiConfig.temperature;
  $('maxOutputTokens').value = D.geminiConfig.maxOutputTokens;
  {
    const tl = _currentTargetLang;
    $('systemInstruction').value = getEffectiveSystemPrompt(tl, '');
  }
  for (const f of MODEL_OVERRIDE_FIELDS) {
    for (const id of [f.input, f.output, f.discount]) {
      const el = $(id);
      if (el) el.value = '';
    }
  }
  $('maxRetries').value = D.maxRetries;
  $('maxConcurrentBatches').value = D.maxConcurrentBatches;
  $('maxUnitsPerBatch').value     = D.maxUnitsPerBatch;
  $('maxCharsPerBatch').value     = D.maxCharsPerBatch;
  $('maxTranslateUnits').value    = D.maxTranslateUnits;
  $('partialModeEnabled').checked = D.partialMode.enabled;
  $('partialModeMaxUnits').value  = D.partialMode.maxUnits;
  markDirty();
  updateAllPromptTargetHints();
  $('save-gemini-status').textContent = _t('options.gemini.resetAllDone');
  setTimeout(() => { $('save-gemini-status').textContent = ''; }, 4000);
});

for (const slot of ENGINE_SLOTS) {
  $(`engine-engine-${slot}`).addEventListener('change', () => updateEngineModelVisibility(slot));
}
$('doc-engine').addEventListener('change', updateDocModelVisibility);

$('ytEngine')?.addEventListener('change', () => {
  updateYtSectionVisibility();
  updateYtPromptCostHint();
});
for (const id of ['ytModel', 'ytInputPerMTok', 'cp-model', 'cp-inputPerMTok']) {
  $(id)?.addEventListener('change', updateYtPromptCostHint);
  $(id)?.addEventListener('input', updateYtPromptCostHint);
}

$('ytModel').addEventListener('change', () => {
  const model = $('ytModel').value;
  if (!model) {
    $('ytInputPerMTok').value  = '';
    $('ytOutputPerMTok').value = '';
    return;
  }
  const p = MODEL_PRICING[model];
  if (p) {
    $('ytInputPerMTok').value  = p.input;
    $('ytOutputPerMTok').value = p.output;
  }
});

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
let _autoSaveTimer = null;
function scheduleAutoSave() {
  if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => { _autoSaveTimer = null; save(); }, 600);
}
window.addEventListener('pagehide', () => {
  if (!_autoSaveTimer) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = null;
  save();
});
function markDirty() {
  scheduleAutoSave();
  const bar = $('save-bar');
  if (bar.classList.contains('saved') && !bar.hidden) return;
  showSaveBar('dirty', _t('options.action.dirtyBar'));
}
document.getElementById('tab-settings').addEventListener('input', markDirty);
document.getElementById('tab-settings').addEventListener('change', markDirty);
document.getElementById('tab-gemini').addEventListener('input', markDirty);
document.getElementById('tab-gemini').addEventListener('change', markDirty);
document.getElementById('tab-glossary').addEventListener('input', markDirty);
document.getElementById('tab-glossary').addEventListener('change', markDirty);
document.getElementById('tab-forbidden').addEventListener('input', markDirty);
document.getElementById('tab-forbidden').addEventListener('change', markDirty);
document.getElementById('tab-custom-provider').addEventListener('input', markDirty);
document.getElementById('tab-custom-provider').addEventListener('change', markDirty);
document.getElementById('tab-youtube').addEventListener('input', markDirty);
document.getElementById('tab-youtube').addEventListener('change', markDirty);
$('debugLog').addEventListener('change', markDirty);
$('ytDebugToast').addEventListener('change', markDirty);
$('ytOnTheFly').addEventListener('change', markDirty);

function rerenderUsageWithCurrency() {
  if (allUsageRecords.length) applyUsageSearch();
  if (lastChartData) renderChart(lastChartData);
}

for (const r of document.querySelectorAll('input[name="displayCurrency"]')) {
  r.addEventListener('change', () => {
    currentCurrencyState.currency = getSelectedCurrency();
    rerenderUsageWithCurrency();
  });
}

$('refresh-rate-btn')?.addEventListener('click', async () => {
  const btn = $('refresh-rate-btn');
  const el = document.getElementById('currency-rate-display');
  btn.disabled = true;
  btn.dataset.state = 'loading';
  btn.textContent = _t('options.currency.refreshing');
  try {
    const resp = await browser.runtime.sendMessage({ type: 'EXCHANGE_RATE_REFRESH' });
    if (resp?.ok) {
      currentCurrencyState = {
        currency: getSelectedCurrency(),
        rate: resp.rate,
        fetchedAt: resp.fetchedAt,
        source: resp.source,
      };
      el.textContent = formatRateLine(resp);
      rerenderUsageWithCurrency();
    } else {
      el.textContent = _t('options.currency.refreshFailed', {
        error: resp?.error || _t('common.errorUnknown'),
        rate: Number(resp?.rate || 31.6).toFixed(2),
      });
    }
  } catch (err) {
    el.textContent = _t('options.currency.refreshFailedShort', { error: err?.message || err });
  } finally {
    btn.disabled = false;
    btn.dataset.state = '';
    btn.textContent = _t('options.currency.refresh');
  }
});

$('toggle-api-key').addEventListener('click', () => {
  const input = $('apiKey');
  const btn = $('toggle-api-key');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = _t('options.action.hide');
    btn.setAttribute('aria-label', _t('options.apiKey.hideAria'));
  } else {
    input.type = 'password';
    btn.textContent = _t('options.action.show');
    btn.setAttribute('aria-label', _t('options.apiKey.showAria'));
  }
});

async function runApiTest({ btn, resultEl, sendMessage }) {
  btn.disabled = true;
  btn.dataset.state = 'loading';
  btn.textContent = _t('options.action.testing');
  resultEl.hidden = false;
  resultEl.dataset.state = 'loading';
  resultEl.textContent = _t('options.action.testingConnect');
  try {
    const resp = await sendMessage();
    if (resp?.ok) {
      resultEl.dataset.state = 'ok';
      const OK_KEYS = { okModel: 'options.action.connectOkModel', okUsage: 'options.action.connectOkUsage' };
      const okKey = OK_KEYS[resp.code];
      resultEl.textContent = '✓ ' + (okKey ? _t(okKey, resp.params) : (resp.message || _t('options.action.connectOk')));
    } else {
      resultEl.dataset.state = 'fail';
      const I18N = window.__SK?.i18n;
      const coded = (resp?.errorCode && I18N?.bgErrorMessage) ? I18N.bgErrorMessage(resp, $('uiLanguage')?.value || 'auto') : '';
      resultEl.textContent = '✗ ' + (coded || resp?.message || resp?.error || _t('common.errorUnknown'));
    }
  } catch (err) {
    resultEl.dataset.state = 'fail';
    resultEl.textContent = '✗ ' + (err?.message || String(err));
  } finally {
    btn.disabled = false;
    btn.dataset.state = '';
    btn.textContent = _t('options.action.test');
  }
}

let _lastAutoTestedKey = '';
$('apiKey').addEventListener('input', () => {
  const v = $('apiKey').value.trim();
  if (/^AIza[0-9A-Za-z_-]{30,}$/.test(v) && v !== _lastAutoTestedKey) {
    _lastAutoTestedKey = v;
    setTimeout(() => $('test-api-key').click(), 400);
  }
});

$('test-api-key').addEventListener('click', async () => {
  await runApiTest({
    btn: $('test-api-key'),
    resultEl: $('test-api-key-result'),
    sendMessage: () => browser.runtime.sendMessage({
      type: 'TEST_GEMINI_KEY',
      payload: {
        apiKey: $('apiKey').value,
        model: getSelectedModel(),
      },
    }),
  });
});

$('toastOpacity').addEventListener('input', () => {
  _renderToastOpacityLabel($('toastOpacity').value);
});
$('floatingIconOpacity').addEventListener('input', () => {
  _renderFloatingOpacityLabel($('floatingIconOpacity').value);
});
for (const r of document.querySelectorAll('input[name="floatingIconSize"]')) {
  r.addEventListener('change', _renderFloatingSizeDemo);
}
$('toastPosition').addEventListener('change', markDirty);

for (const r of document.querySelectorAll('input[name="markStyle"]')) {
  r.addEventListener('change', () => updateDualDemoMark(getSelectedMarkStyle()));
}

for (const btn of document.querySelectorAll('.dual-accent-swatch')) {
  btn.addEventListener('click', () => setDualAccent(btn.dataset.token));
}
{
  const picker = document.getElementById('dualAccentColorPicker');
  const hexInput = document.getElementById('dualAccentHexInput');
  if (picker) {
    picker.addEventListener('input', () => setDualAccent(picker.value));
  }
  if (hexInput) {
    hexInput.addEventListener('input', () => {
      const v = hexInput.value.trim();
      if (DUAL_ACCENT_HEX_RE.test(v)) {
        setDualAccent(v);
      } else if (v === '') {
        setDualAccent('auto');
      } else {
        hexInput.setAttribute('aria-invalid', 'true');
      }
    });
    hexInput.addEventListener('blur', () => refreshDualAccentUI());
  }
}

$('reset-defaults').addEventListener('click', async () => {
  if (!confirm(_t('options.reset.confirm'))) return;
  await browser.storage.sync.clear();
  await browser.storage.local.remove(LOCAL_SETTINGS_KEYS);
  await load();
  showSaveBar('saved', _t('options.reset.done'));
});

$('export-settings').addEventListener('click', async () => {
  const all = await browser.storage.sync.get(null);
  await overlayLocalSettings(all);
  delete all.apiKey;
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = formatYmdHms(Date.now());
  a.href = url;
  a.download = `transit-settings-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

function sanitizeImport(raw) {
  return sanitizeImportImpl(raw, _t, SC);
}

$('import-file').addEventListener('click', () => $('import-input').click());
$('import-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (Object.prototype.hasOwnProperty.call(data, 'apiKey')) {
      delete data.apiKey;
    }
    const { clean, warnings } = sanitizeImport(data);
    if (Object.keys(clean).length === 0) {
      alert(_t('options.io.importNoFields'));
      return;
    }
    let cpKeyClearedNote = '';
    const { customProvider: curCp } = await browser.storage.sync.get('customProvider');
    const curBaseUrl = (curCp && typeof curCp.baseUrl === 'string')
      ? curCp.baseUrl : DEFAULT_SETTINGS.customProvider.baseUrl;
    if (importChangesCustomProviderOrigin(curBaseUrl, clean)) {
      const { customProviderApiKey } = await browser.storage.local.get('customProviderApiKey');
      if (customProviderApiKey) {
        await browser.storage.local.remove('customProviderApiKey');
        cpKeyClearedNote = _t('options.io.importCpKeyCleared', { url: clean.customProvider.baseUrl });
      }
    }
    const { syncPart, localPart } = splitSettingsPatch(clean);
    if (Object.keys(localPart).length > 0) await browser.storage.local.set(localPart);
    if (Object.keys(syncPart).length > 0) await browser.storage.sync.set(syncPart);
    await load();
    const msg = warnings.length > 0
      ? _t('options.io.importPartial', { warnings: warnings.join('\n') })
      : _t('options.io.importOk');
    alert(msg + cpKeyClearedNote + _t('options.io.importFooter'));
  } catch (err) {
    alert(_t('options.io.importFailed', { error: err.message }));
  } finally {
    e.target.value = '';
  }
});

document.addEventListener('click', (e) => {
  const link = e.target.closest('.open-shortcuts-link');
  if (!link) return;
  e.preventDefault();
  browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

let fixedGlossary = { global: [], byDomain: {} };
let currentDomain = '';

function renderGlossaryTable(tbody, entries) {
  const phSrc = escapeAttr(_t('options.glossary.fixed.placeholderSource'));
  const phTgt = escapeAttr(_t('options.glossary.fixed.placeholderTarget'));
  const delTitle = escapeAttr(_t('options.glossary.fixed.deleteRow'));
  tbody.innerHTML = entries.map((e, i) =>
    `<tr data-idx="${i}">` +
    `<td><input type="text" class="fg-source" value="${escapeAttr(e.source)}" placeholder="${phSrc}"></td>` +
    `<td><input type="text" class="fg-target" value="${escapeAttr(e.target)}" placeholder="${phTgt}"></td>` +
    `<td class="glossary-col-action"><button class="glossary-delete-row" data-idx="${i}" title="${delTitle}">×</button></td>` +
    `</tr>`
  ).join('');
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readGlossaryTableEntries(tbody) {
  const rows = tbody.querySelectorAll('tr');
  const entries = [];
  for (const row of rows) {
    const source = (row.querySelector('.fg-source')?.value || '').trim();
    const target = (row.querySelector('.fg-target')?.value || '').trim();
    if (source || target) entries.push({ source, target });
  }
  return entries;
}

function renderGlobalTable() {
  renderGlossaryTable($('fixed-global-tbody'), fixedGlossary.global);
}

$('fixed-global-add').addEventListener('click', () => {
  fixedGlossary.global.push({ source: '', target: '' });
  renderGlobalTable();
  const rows = $('fixed-global-tbody').querySelectorAll('tr');
  if (rows.length) rows[rows.length - 1].querySelector('.fg-source')?.focus();
  markDirty();
});

$('fixed-global-tbody').addEventListener('click', (e) => {
  const btn = e.target.closest('.glossary-delete-row');
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  fixedGlossary.global = readGlossaryTableEntries($('fixed-global-tbody'));
  fixedGlossary.global.splice(idx, 1);
  renderGlobalTable();
  markDirty();
});

$('fixed-global-tbody').addEventListener('focusout', () => {
  fixedGlossary.global = readGlossaryTableEntries($('fixed-global-tbody'));
});

function domainKeyLabel(key) {
  const scope = window.__SKDomain.splitScopeKey(key);
  return scope.path ? key + _t('options.glossary.fixed.domainPathScope') : key;
}

function refreshDomainKeyLabels() {
  if (!$('fixed-domain-select')) return;
  updateDomainSelect();
  if (currentDomain && fixedGlossary.byDomain[currentDomain]) {
    $('fixed-domain-label').textContent = domainKeyLabel(currentDomain);
  }
}

function updateDomainSelect() {
  const sel = $('fixed-domain-select');
  const domains = Object.keys(fixedGlossary.byDomain).sort();
  sel.innerHTML = `<option value="" data-i18n="options.glossary.fixed.domainSelectPlaceholder">${escapeHtml(_t('options.glossary.fixed.domainSelectPlaceholder'))}</option>` +
    domains.map(d => `<option value="${escapeAttr(d)}">${escapeHtml(domainKeyLabel(d))}</option>`).join('');
  if (currentDomain && fixedGlossary.byDomain[currentDomain]) {
    sel.value = currentDomain;
  }
}

function showDomainPanel(domain) {
  currentDomain = domain;
  if (!domain || !fixedGlossary.byDomain[domain]) {
    $('fixed-domain-panel').hidden = true;
    return;
  }
  $('fixed-domain-panel').hidden = false;
  $('fixed-domain-label').textContent = domainKeyLabel(domain);
  renderGlossaryTable($('fixed-domain-tbody'), fixedGlossary.byDomain[domain]);
}

$('fixed-domain-select').addEventListener('change', () => {
  if (currentDomain && fixedGlossary.byDomain[currentDomain]) {
    fixedGlossary.byDomain[currentDomain] = readGlossaryTableEntries($('fixed-domain-tbody'));
  }
  showDomainPanel($('fixed-domain-select').value);
});

$('fixed-domain-add-btn').addEventListener('click', () => {
  const input = $('fixed-domain-input');
  const domain = window.__SKDomain.normalizeScopeEntry(input.value || '');
  if (!domain) return;
  if (!fixedGlossary.byDomain[domain]) {
    fixedGlossary.byDomain[domain] = [];
  }
  input.value = '';
  updateDomainSelect();
  $('fixed-domain-select').value = domain;
  showDomainPanel(domain);
  markDirty();
});

$('fixed-domain-delete').addEventListener('click', () => {
  if (!currentDomain) return;
  if (!confirm(_t('options.glossary.fixed.domainDeleteConfirm', { domain: currentDomain }))) return;
  delete fixedGlossary.byDomain[currentDomain];
  currentDomain = '';
  updateDomainSelect();
  showDomainPanel('');
  markDirty();
});

$('fixed-domain-add-row').addEventListener('click', () => {
  if (!currentDomain) return;
  fixedGlossary.byDomain[currentDomain] = readGlossaryTableEntries($('fixed-domain-tbody'));
  fixedGlossary.byDomain[currentDomain].push({ source: '', target: '' });
  renderGlossaryTable($('fixed-domain-tbody'), fixedGlossary.byDomain[currentDomain]);
  const rows = $('fixed-domain-tbody').querySelectorAll('tr');
  if (rows.length) rows[rows.length - 1].querySelector('.fg-source')?.focus();
  markDirty();
});

$('fixed-domain-tbody').addEventListener('click', (e) => {
  const btn = e.target.closest('.glossary-delete-row');
  if (!btn || !currentDomain) return;
  const idx = Number(btn.dataset.idx);
  fixedGlossary.byDomain[currentDomain] = readGlossaryTableEntries($('fixed-domain-tbody'));
  fixedGlossary.byDomain[currentDomain].splice(idx, 1);
  renderGlossaryTable($('fixed-domain-tbody'), fixedGlossary.byDomain[currentDomain]);
  markDirty();
});

$('fixed-domain-tbody').addEventListener('focusout', () => {
  if (currentDomain && fixedGlossary.byDomain[currentDomain]) {
    fixedGlossary.byDomain[currentDomain] = readGlossaryTableEntries($('fixed-domain-tbody'));
  }
});

let forbiddenTerms = [];

function renderForbiddenTermsTable() {
  const tbody = $('forbidden-terms-tbody');
  const phF = escapeAttr(_t('options.forbidden.placeholderForbidden'));
  const phR = escapeAttr(_t('options.forbidden.placeholderReplacement'));
  const phN = escapeAttr(_t('options.forbidden.placeholderNote'));
  const delTitle = escapeAttr(_t('options.glossary.fixed.deleteRow'));
  tbody.innerHTML = forbiddenTerms.map((t, i) => {
    const noteVal = escapeAttr(t.note || '');
    return `<tr data-idx="${i}">` +
      `<td><input type="text" class="ft-forbidden" value="${escapeAttr(t.forbidden)}" placeholder="${phF}"></td>` +
      `<td><input type="text" class="ft-replacement" value="${escapeAttr(t.replacement)}" placeholder="${phR}"></td>` +
      `<td class="ft-note-cell"><input type="text" class="ft-note" value="${noteVal}" title="${noteVal}" placeholder="${phN}"></td>` +
      `<td class="glossary-col-action"><button class="glossary-delete-row" data-idx="${i}" title="${delTitle}">×</button></td>` +
      `</tr>`;
  }).join('');
}

function readForbiddenTableEntries() {
  const rows = $('forbidden-terms-tbody').querySelectorAll('tr');
  const entries = [];
  for (const row of rows) {
    const forbidden = (row.querySelector('.ft-forbidden')?.value || '').trim();
    const replacement = (row.querySelector('.ft-replacement')?.value || '').trim();
    const note = (row.querySelector('.ft-note')?.value || '').trim();
    entries.push({ forbidden, replacement, note });
  }
  return entries;
}

$('forbidden-terms-add').addEventListener('click', () => {
  forbiddenTerms = readForbiddenTableEntries();
  forbiddenTerms.push({ forbidden: '', replacement: '', note: '' });
  renderForbiddenTermsTable();
  const rows = $('forbidden-terms-tbody').querySelectorAll('tr');
  if (rows.length) rows[rows.length - 1].querySelector('.ft-forbidden')?.focus();
  markDirty();
});

$('forbidden-terms-reset').addEventListener('click', () => {
  if (!confirm(_t('options.forbidden.resetConfirm'))) return;
  forbiddenTerms = DEFAULT_FORBIDDEN_TERMS.map(t => ({ ...t }));
  renderForbiddenTermsTable();
  markDirty();
});

$('forbidden-terms-tbody').addEventListener('click', (e) => {
  const btn = e.target.closest('.glossary-delete-row');
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  forbiddenTerms = readForbiddenTableEntries();
  forbiddenTerms.splice(idx, 1);
  renderForbiddenTermsTable();
  markDirty();
});

$('forbidden-terms-tbody').addEventListener('focusout', () => {
  forbiddenTerms = readForbiddenTableEntries();
});

$('forbidden-terms-tbody').addEventListener('input', (e) => {
  const t = e.target;
  if (t && t.classList.contains('ft-note')) t.title = t.value;
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = $('tab-' + btn.dataset.tab);
    if (panel) panel.classList.add('active');
    if (btn.dataset.tab === 'usage') {
      setDateTimeFields('usage-to', new Date());
      loadUsageData();
    }
    if (btn.dataset.tab === 'log') startLogPolling();
    else stopLogPolling();
  });
});

let usageChart = null;
let currentGranularity = 'day';

const USAGE_PAGE_SIZE = 100;
let usageCurrentPage = 1;
let usageFilteredCache = [];
let allUsageRecords = [];
let lastChartData = null;

let _presetsCache = [];
let _customProviderCache = { model: '' };

function modelToLabel(modelId, engine) {
  if (!modelId) return '—';
  if (modelId === 'google-translate') {
    const p = _presetsCache.find(x => x.engine === 'google');
    return p?.label || 'Google MT';
  }
  const looksLikeGemini = modelId.startsWith('gemini-');
  const isCustom = engine === 'openai-compat' || (!engine && !looksLikeGemini);
  if (isCustom) {
    const last = modelId.split('/').pop();
    return last || modelId;
  }
  const p = _presetsCache.find(x => x.engine === 'gemini' && x.model === modelId);
  if (p) return p.label;
  return modelId.replace('gemini-', '').replace('-preview', '');
}

const _pad2 = n => String(n).padStart(2, '0');

let _timeSelectsBuilt = false;
function buildTimeSelectOptions() {
  if (_timeSelectsBuilt) return;
  _timeSelectsBuilt = true;
  const hourOptions = Array.from({ length: 24 }, (_, h) => `<option value="${_pad2(h)}">${_pad2(h)}</option>`).join('');
  const minOptions  = Array.from({ length: 60 }, (_, m) => `<option value="${_pad2(m)}">${_pad2(m)}</option>`).join('');
  for (const id of ['usage-from-hour', 'usage-to-hour']) $(id).innerHTML = hourOptions;
  for (const id of ['usage-from-min',  'usage-to-min'])  $(id).innerHTML = minOptions;
}

function setDateTimeFields(prefix, d) {
  $(`${prefix}-date`).value = `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
  $(`${prefix}-hour`).value = _pad2(d.getHours());
  $(`${prefix}-min`).value  = _pad2(d.getMinutes());
}

function readDateTimeFields(prefix, fallbackHHMM = '00:00') {
  const date = $(`${prefix}-date`).value;
  if (!date) return null;
  const hh = $(`${prefix}-hour`).value || fallbackHHMM.slice(0, 2);
  const mm = $(`${prefix}-min`).value  || fallbackHHMM.slice(3, 5);
  return new Date(`${date}T${hh}:${mm}`).getTime();
}

function initUsageDateRange() {
  buildTimeSelectOptions();
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  from.setHours(0, 0, 0, 0);
  setDateTimeFields('usage-from', from);
  setDateTimeFields('usage-to', to);
}

function getUsageDateRange() {
  const from = readDateTimeFields('usage-from', '00:00') ?? (Date.now() - 7 * 86400000);
  const toRaw = readDateTimeFields('usage-to', '23:59');
  const to   = toRaw != null ? toRaw + 59_999 : Date.now();
  return { from, to };
}

function fmtTime(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

let _loadUsageDataReqId = 0;

async function loadUsageData() {
  const { from, to } = getUsageDateRange();
  const reqId = ++_loadUsageDataReqId;

  let statsRes, chartRes, recordsRes;
  try {
    const pageRes = await browser.runtime.sendMessage({ type: 'QUERY_USAGE_PAGE', payload: { from, to, groupBy: currentGranularity } });
    const ok = !!(pageRes && pageRes.ok);
    statsRes = { ok, stats: pageRes?.stats };
    chartRes = { ok, data: pageRes?.data };
    recordsRes = { ok, records: pageRes?.records };
    if (!ok) throw new Error(pageRes?.error || 'QUERY_USAGE_PAGE failed');
  } catch (err) {
    if (reqId === _loadUsageDataReqId) {
      $('usage-total-cost').textContent = '—';
      $('usage-total-tokens').textContent = '—';
      $('usage-total-count').textContent = '—';
      $('usage-top-model').textContent = _t('options.usage.loadFailed', { error: err?.message || String(err) });
    }
    return;
  }

  if (reqId !== _loadUsageDataReqId) return;

  if (statsRes?.ok) {
    const s = statsRes.stats;
    $('usage-total-cost').textContent = formatMoney(s.totalBilledCostUSD, fmtMoneyOpts());
    $('usage-total-cost-label').textContent = _t('options.usage.totalCostLabelCurrency', { currency: currentCurrencyState.currency });
    $('usage-total-tokens').textContent = formatTokens(s.totalBilledInputTokens + s.totalOutputTokens);
    $('usage-total-count').textContent = String(s.count);
    let topModel = '—';
    let topCount = 0;
    for (const [m, info] of Object.entries(s.byModel || {})) {
      if (info.count > topCount) { topCount = info.count; topModel = m; }
    }
    $('usage-top-model').textContent = modelToLabel(topModel);
  }

  if (chartRes?.ok) {
    lastChartData = chartRes.data;
    renderChart(chartRes.data);
  }

  if (recordsRes?.ok) {
    allUsageRecords = recordsRes.records || [];
    populateModelFilter();
    applyUsageSearch();
  }
}

function renderChart(data) {
  const ctx = $('usage-chart').getContext('2d');

  if (usageChart) {
    usageChart.destroy();
    usageChart = null;
  }

  const labels = data.map(d => d.period);
  const tokenData = data.map(d => d.totalTokens);
  const isTwd = currentCurrencyState.currency === 'TWD';
  const costData = isTwd
    ? data.map(d => (d.billedCostUSD || 0) * currentCurrencyState.rate)
    : data.map(d => d.billedCostUSD || 0);
  const costLabel = isTwd ? _t('options.usage.costTwd') : _t('options.usage.costUsd');
  const yAxisTitle = isTwd ? 'TWD' : 'USD';

  const totalTokens = tokenData.reduce((s, v) => s + v, 0);
  const totalCostUSD = data.reduce((s, d) => s + (d.billedCostUSD || 0), 0);

  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  const cTokens = token('--chart-1');
  const cCost = token('--chart-2');
  const cMuted = token('--muted');
  const cGrid = token('--line');
  Chart.defaults.font.family = token('--font-ui');
  Chart.defaults.color = cMuted;

  usageChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Tokens',
          data: tokenData,
          borderColor: cTokens,
          backgroundColor: token('--chart-1-fill'),
          fill: true,
          tension: 0.3,
          yAxisID: 'y',
          pointRadius: data.length > 60 ? 0 : 3,
          pointHoverRadius: 5,
        },
        {
          label: costLabel,
          data: costData,
          borderColor: cCost,
          backgroundColor: token('--chart-2-fill'),
          fill: true,
          tension: 0.3,
          yAxisID: 'y1',
          pointRadius: data.length > 60 ? 0 : 3,
          pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'start',
          labels: { font: { size: 11 }, boxWidth: 12, padding: 12 },
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              if (ctx.datasetIndex === 0) return `Tokens: ${formatTokens(ctx.parsed.y)}`;
              if (isTwd) {
                const v = ctx.parsed.y;
                const value = v < 0.1 ? v.toFixed(3) : v.toFixed(1);
                return _t('options.usage.costTwdRow', { value });
              }
              return _t('options.usage.costUsdRow', { value: formatUSD(ctx.parsed.y) });
            },
          },
        },
        subtitle: {
          display: true,
          text: _t('options.usage.periodTotal', {
            tokens: formatTokens(totalTokens),
            cost: formatMoney(totalCostUSD, fmtMoneyOpts()),
          }),
          align: 'end',
          font: { size: 11, weight: 'normal' },
          color: cMuted,
          padding: { bottom: 8 },
        },
      },
      scales: {
        x: {
          ticks: {
            font: { size: 10 },
            maxTicksLimit: 12,
            maxRotation: 0,
            callback: function(value) {
              const label = this.getLabelForValue(value);
              if (currentGranularity === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(label)) {
                return label.slice(-2);
              }
              return label;
            },
          },
          grid: { display: false },
        },
        y: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          grid: { color: cGrid },
          border: { display: false },
          ticks: {
            font: { size: 11 },
            callback: (v) => formatTokens(v),
          },
          title: { display: true, text: 'Tokens', font: { size: 11 }, color: cTokens },
        },
        y1: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: {
            font: { size: 11 },
            callback: (v) => isTwd ? 'NT$' + Math.round(v) : '$' + v.toFixed(2),
          },
          border: { display: false },
          title: { display: true, text: yAxisTitle, font: { size: 11 }, color: cCost },
        },
      },
    },
  });
}

function renderTable(records) {
  const tbody = $('usage-tbody');
  const emptyMsg = $('usage-empty');

  if (!records || records.length === 0) {
    tbody.innerHTML = '';
    emptyMsg.hidden = false;
    renderUsagePagination(0);
    return;
  }
  emptyMsg.hidden = true;

  const totalPages = Math.max(1, Math.ceil(records.length / USAGE_PAGE_SIZE));
  if (usageCurrentPage > totalPages) usageCurrentPage = totalPages;
  if (usageCurrentPage < 1) usageCurrentPage = 1;
  const startIdx = (usageCurrentPage - 1) * USAGE_PAGE_SIZE;
  const pageRecords = records.slice(startIdx, startIdx + USAGE_PAGE_SIZE);

  tbody.innerHTML = pageRecords.map(r => {
    const isGoogle = r.engine === 'google';
    const billedTokens = (r.billedInputTokens || 0) + (r.outputTokens || 0);
    const shortModel = modelToLabel(r.model, r.engine);
    const shortModelEsc = escapeHtml(shortModel);
    const sourceTagHtml = r.source === 'glossary'
      ? `<span class="usage-source-tag">[${escapeHtml(_t('options.usage.sourceGlossary'))}] </span>`
      : '';
    const title = sourceTagHtml + escapeHtml(r.title || _t('common.untitled'));
    const urlDisplay = escapeHtml(shortenUrl(r.url || ''));
    const urlFull = escapeHtml(r.url || '');
    const inputTk = r.inputTokens || 0;
    const cachedTk = r.cachedTokens || 0;
    const hitRate = (!isGoogle && inputTk > 0) ? Math.round(cachedTk / inputTk * 100) : 0;
    const hitHtml = hitRate > 0
      ? `<span class="usage-cache-hit">(${hitRate}% hit)</span>`
      : '';
    const urlHtml = urlFull
      ? `<a class="site-url" href="${urlFull}" target="_blank" rel="noopener">${urlDisplay}</a>`
      : `<span class="site-url">${urlDisplay}</span>`;
    const tokenCell = isGoogle
      ? String(r.chars || 0)
      : `${formatTokens(billedTokens)}${hitHtml}`;
    const costCell = isGoogle ? formatMoney(0, fmtMoneyOpts()) : formatMoney(r.billedCostUSD || 0, fmtMoneyOpts());
    return `<tr>
      <td>${fmtTime(r.timestamp)}</td>
      <td>${title}${urlHtml}</td>
      <td class="col-model" title="${shortModelEsc}">${shortModelEsc}</td>
      <td class="num">${tokenCell}</td>
      <td class="num">${costCell}</td>
    </tr>`;
  }).join('');

  renderUsagePagination(records.length);
}

function renderUsagePagination(totalCount) {
  const nav = $('usage-pagination');
  const info = $('usage-page-info');
  const prevBtn = $('usage-page-prev');
  const nextBtn = $('usage-page-next');
  if (!nav || !info || !prevBtn || !nextBtn) return;

  if (totalCount <= USAGE_PAGE_SIZE) {
    nav.hidden = true;
    return;
  }
  nav.hidden = false;
  const totalPages = Math.ceil(totalCount / USAGE_PAGE_SIZE);
  info.textContent = _t('options.usage.pageInfo', {
    page: usageCurrentPage,
    total: totalPages,
    count: totalCount,
  });
  prevBtn.disabled = usageCurrentPage <= 1;
  nextBtn.disabled = usageCurrentPage >= totalPages;
}

function changeUsagePage(delta) {
  const totalPages = Math.max(1, Math.ceil(usageFilteredCache.length / USAGE_PAGE_SIZE));
  const next = usageCurrentPage + delta;
  if (next < 1 || next > totalPages) return;
  usageCurrentPage = next;
  renderTable(usageFilteredCache);
  $('usage-tbody')?.parentElement?.scrollTo({ top: 0 });
}

function updateSummaryFromRecords(records) {
  let totalCost = 0, totalTokens = 0;
  const modelCount = {};
  for (const r of records) {
    totalCost += r.billedCostUSD || 0;
    totalTokens += (r.billedInputTokens || 0) + (r.outputTokens || 0);
    const m = r.model || '';
    modelCount[m] = (modelCount[m] || 0) + 1;
  }
  let topModel = '—', topCount = 0;
  for (const [m, c] of Object.entries(modelCount)) {
    if (c > topCount) { topCount = c; topModel = m; }
  }
  $('usage-total-cost').textContent   = formatMoney(totalCost, fmtMoneyOpts());
  $('usage-total-cost-label').textContent = _t('options.usage.totalCostLabelCurrency', { currency: currentCurrencyState.currency });
  $('usage-total-tokens').textContent = formatTokens(totalTokens);
  $('usage-total-count').textContent  = String(records.length);
  $('usage-top-model').textContent    = modelToLabel(topModel);
}

function populateModelFilter() {
  const sel = $('usage-model-filter');
  if (!sel) return;
  const currentVal = sel.value;
  const models = [...new Set(allUsageRecords.map(r => r.model || '').filter(Boolean))].sort();
  sel.innerHTML = `<option value="" data-i18n="options.usage.modelAll">${escapeHtml(_t('options.usage.modelAll'))}</option>` +
    models.map(m => {
      const label = escapeHtml(modelToLabel(m));
      return `<option value="${escapeAttr(m)}"${m === currentVal ? ' selected' : ''}>${label}</option>`;
    }).join('');
}

function applyUsageSearch() {
  const q = ($('usage-search')?.value || '').trim().toLowerCase();
  const modelFilter = ($('usage-model-filter')?.value || '');
  let filtered = allUsageRecords;
  if (q) {
    filtered = filtered.filter(r =>
      (r.title || '').toLowerCase().includes(q) ||
      (r.url || '').toLowerCase().includes(q));
  }
  if (modelFilter) {
    filtered = filtered.filter(r => (r.model || '') === modelFilter);
  }
  usageFilteredCache = filtered;
  usageCurrentPage = 1;
  renderTable(filtered);
  updateSummaryFromRecords(filtered);
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') &&
        u.pathname === '/watch' && u.searchParams.get('v')) {
      return u.hostname + '/watch?v=' + u.searchParams.get('v');
    }
    const path = u.pathname.length > 40 ? u.pathname.slice(0, 40) + '…' : u.pathname;
    return u.hostname + path;
  } catch { return url; }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

for (const id of ['usage-from-date', 'usage-from-hour', 'usage-from-min',
                  'usage-to-date',   'usage-to-hour',   'usage-to-min']) {
  $(id)?.addEventListener('change', loadUsageData);
}
$('usage-to-now')?.addEventListener('click', () => {
  setDateTimeFields('usage-to', new Date());
  loadUsageData();
});
let _usageSearchTimer = null;
$('usage-search')?.addEventListener('input', () => {
  clearTimeout(_usageSearchTimer);
  _usageSearchTimer = setTimeout(applyUsageSearch, 150);
});
$('usage-model-filter')?.addEventListener('change', applyUsageSearch);

$('usage-page-prev')?.addEventListener('click', () => changeUsagePage(-1));
$('usage-page-next')?.addEventListener('click', () => changeUsagePage(+1));

document.querySelectorAll('.gran-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.gran-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGranularity = btn.dataset.gran;
    loadUsageData();
  });
});

$('usage-reload')?.addEventListener('click', () => {
  setDateTimeFields('usage-to', new Date());
  loadUsageData();
});

$('usage-export-csv').addEventListener('click', async () => {
  const { from, to } = getUsageDateRange();
  const res = await browser.runtime.sendMessage({ type: 'EXPORT_USAGE_CSV', payload: { from, to } });
  if (!res?.ok) { alert(_t('options.usage.exportFailed', { error: res?.error || _t('common.errorUnknown') })); return; }
  const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = buildUsageCsvFilename(from, to);
  a.click();
  URL.revokeObjectURL(url);
});

$('usage-clear').addEventListener('click', async () => {
  if (!confirm(_t('options.usage.clearConfirm'))) return;
  const res = await browser.runtime.sendMessage({ type: 'CLEAR_USAGE' });
  if (res?.ok) {
    loadUsageData();
  } else {
    alert(_t('options.usage.clearFailed', { error: res?.error || _t('common.errorUnknown') }));
  }
});

let logPollingTimer = null;
let logLatestSeq = 0;
let allLogs = [];
const _seenLogKeys = new Set();
let _persistedLoaded = false;

function logKey(entry) { return `${entry.t}|${entry.category}|${entry.message}`; }

function appendLogs(entries) {
  let added = 0;
  for (const e of entries) {
    const k = logKey(e);
    if (_seenLogKeys.has(k)) continue;
    _seenLogKeys.add(k);
    allLogs.push(e);
    added++;
  }
  if (allLogs.length > 2000) {
    const dropped = allLogs.splice(0, allLogs.length - 2000);
    for (const e of dropped) _seenLogKeys.delete(logKey(e));
  }
  return added;
}

function startLogPolling() {
  if (logPollingTimer) return;
  fetchLogs();
  logPollingTimer = setInterval(fetchLogs, 2000);
}

function stopLogPolling() {
  if (logPollingTimer) {
    clearInterval(logPollingTimer);
    logPollingTimer = null;
  }
}

let _fetchLogsInFlight = false;
async function fetchLogs() {
  if (_fetchLogsInFlight) return;
  _fetchLogsInFlight = true;
  try {
    if (!_persistedLoaded) {
      _persistedLoaded = true;
      try {
        const persisted = await browser.runtime.sendMessage({ type: 'GET_PERSISTED_LOGS' });
        if (persisted?.ok && Array.isArray(persisted.logs) && persisted.logs.length > 0) {
          appendLogs(persisted.logs);
          renderLogTable();
        }
      } catch {   }
    }
    const res = await browser.runtime.sendMessage({
      type: 'GET_LOGS',
      payload: { afterSeq: logLatestSeq },
    });
    if (!res?.ok) return;
    if (!res.logs || res.logs.length === 0) {
      if (res.latestSeq) logLatestSeq = res.latestSeq;
      return;
    }
    const added = appendLogs(res.logs);
    if (res.latestSeq) logLatestSeq = res.latestSeq;
    if (added > 0) renderLogTable();
  } catch {
  } finally {
    _fetchLogsInFlight = false;
  }
}

const _searchHitInDataSet = new WeakSet();

function getFilteredLogs() {
  const catFilter = $('log-category-filter').value;
  const lvlFilter = $('log-level-filter').value;
  const search = ($('log-search').value || '').trim().toLowerCase();

  return allLogs.filter(entry => {
    if (catFilter && entry.category !== catFilter) return false;
    if (lvlFilter && entry.level !== lvlFilter) return false;
    if (search) {
      const msg = (entry.message || '').toLowerCase();
      const cat = (entry.category || '').toLowerCase();
      const dataStr = entry.data ? JSON.stringify(entry.data).toLowerCase() : '';
      const hitMsg = msg.includes(search) || cat.includes(search);
      const hitData = dataStr.includes(search);
      if (!hitMsg && !hitData) return false;
      if (!hitMsg && hitData) _searchHitInDataSet.add(entry);
      else _searchHitInDataSet.delete(entry);
    } else {
      _searchHitInDataSet.delete(entry);
    }
    return true;
  });
}

function highlightSearch(text, searchLower) {
  const escaped = escapeHtml(text);
  if (!searchLower) return escaped;
  const safe = searchLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(safe, 'gi'), m => `<mark class="log-search-hit">${m}</mark>`);
}

const LOG_CAT_LABELS = {
  translate:   'translate',
  api:         'api',
  cache:       'cache',
  glossary:    'glossary',
  spa:         'spa',
  system:      'system',
};

function renderLogTable() {
  const tbody = $('log-tbody');
  const emptyMsg = $('log-empty');
  const filtered = getFilteredLogs();

  $('log-count').textContent = _t('options.log.count', { count: allLogs.length });
  const filteredCountEl = $('log-filtered-count');
  if (filtered.length !== allLogs.length) {
    filteredCountEl.textContent = _t('options.log.filteredCount', { count: filtered.length });
    filteredCountEl.hidden = false;
  } else {
    filteredCountEl.hidden = true;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyMsg.hidden = allLogs.length > 0 ? true : false;
    if (allLogs.length > 0 && filtered.length === 0) {
      emptyMsg.textContent = _t('options.log.emptyFiltered');
      emptyMsg.hidden = false;
    } else if (allLogs.length === 0) {
      emptyMsg.textContent = _t('options.log.empty');
      emptyMsg.hidden = false;
    }
    return;
  }
  emptyMsg.hidden = true;

  const visible = filtered.slice(-500);

  const openSet = new Set();
  for (const el of tbody.querySelectorAll('.log-data-detail.open')) {
    openSet.add(el.id);
  }

  const searchLower = ($('log-search').value || '').trim().toLowerCase();

  tbody.innerHTML = visible.map(entry => {
    const time = formatLogTime(entry.t);
    const catClass = `log-cat log-cat-${entry.category || 'system'}`;
    const catLabel = LOG_CAT_LABELS[entry.category] || entry.category || 'system';
    const lvlClass = `log-lvl log-lvl-${entry.level || 'info'}`;
    const lvlLabel = (entry.level || 'info').toUpperCase();
    const rowClass = entry.level === 'error' ? 'log-row-error' :
                     entry.level === 'warn'  ? 'log-row-warn'  : '';
    const msg = highlightSearch(entry.message || '', searchLower);

    let dataHtml = '';
    if (entry.data && Object.keys(entry.data).length > 0) {
      const dataJson = JSON.stringify(entry.data, null, 2);
      const dataId = `log-data-${encodeURIComponent(logKey(entry)).replace(/%/g, '_')}`;
      const isOpen = openSet.has(dataId) || _searchHitInDataSet.has(entry);
      const dataInner = highlightSearch(dataJson, searchLower);
      dataHtml = `<button class="log-data-toggle" data-target="${dataId}">${escapeHtml(isOpen ? _t('options.log.detailCollapse') : _t('options.log.detailExpand'))}</button>` +
        `<div class="log-data-detail${isOpen ? ' open' : ''}" id="${dataId}">${dataInner}</div>`;
    }

    return `<tr class="${rowClass}">` +
      `<td class="log-col-time">${time}</td>` +
      `<td class="log-col-cat"><span class="${catClass}">${catLabel}</span></td>` +
      `<td class="log-col-lvl"><span class="${lvlClass}">${lvlLabel}</span></td>` +
      `<td class="log-col-msg"><span class="log-msg-text">${msg}</span>${dataHtml}</td>` +
      `</tr>`;
  }).join('');

  if ($('log-autoscroll').checked) {
    const wrapper = $('log-table-wrapper');
    wrapper.scrollTop = wrapper.scrollHeight;
  }
}

function formatLogTime(isoStr) {
  try {
    const d = new Date(isoStr);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '??:??:??';
  }
}

$('log-table-wrapper').addEventListener('scroll', () => {
  const w = $('log-table-wrapper');
  const atBottom = w.scrollHeight - w.scrollTop - w.clientHeight < 30;
  $('log-autoscroll').checked = atBottom;
});

$('log-category-filter').addEventListener('change', renderLogTable);
$('log-level-filter').addEventListener('change', renderLogTable);
let _logSearchTimer = null;
$('log-search').addEventListener('input', () => {
  clearTimeout(_logSearchTimer);
  _logSearchTimer = setTimeout(renderLogTable, 150);
});

$('log-clear').addEventListener('click', async () => {
  try {
    await Promise.all([
      browser.runtime.sendMessage({ type: 'CLEAR_LOGS' }),
      browser.runtime.sendMessage({ type: 'CLEAR_PERSISTED_LOGS' }),
    ]);
  } catch {   }
  allLogs = [];
  _seenLogKeys.clear();
  logLatestSeq = 0;
  renderLogTable();
});

$('log-export').addEventListener('click', () => {
  const filtered = getFilteredLogs();
  const data = filtered.length !== allLogs.length ? filtered : allLogs;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = formatYmdHms(Date.now());
  a.href = url;
  a.download = `transit-log-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('log-tbody').addEventListener('click', (e) => {
  const toggle = e.target.closest('.log-data-toggle');
  if (!toggle) return;
  const targetId = toggle.dataset.target;
  const detail = document.getElementById(targetId);
  if (detail) {
    detail.classList.toggle('open');
    toggle.textContent = detail.classList.contains('open') ? _t('options.log.detailCollapse') : _t('options.log.detailExpand');
  }
});

initUsageDateRange();
load();
