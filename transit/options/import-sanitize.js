import { TARGET_LANGUAGES, UI_LANGUAGES, DOC_ENGINE_IDS, normalizeTranslateEngines } from '../lib/storage.js';

export function sanitizeImport(raw, _t, SC = globalThis.__SKShortcuts) {
  const clean = {};
  const warnings = [];

  const topRules = {
    autoTranslate:       { type: 'boolean' },
    autoConvertZh:       { type: 'boolean' },
    debugLog:            { type: 'boolean' },
    maxRetries:          { type: 'number', min: 0, max: 10, int: true },
    maxConcurrentBatches:{ type: 'number', min: 1, max: 50, int: true },
    maxUnitsPerBatch:    { type: 'number', min: 1, max: 100, int: true },
    maxCharsPerBatch:    { type: 'number', min: 500, max: 20000, int: true },
    maxTranslateUnits:   { type: 'number', min: 0, max: 10000, int: true },
    toastAutoHide:       { type: 'boolean' },
    modelPricingOverrides: { type: 'object' },
    showProgressToast:   { type: 'boolean' },
    hideZhConvertToast:  { type: 'boolean' },
    floatingIcon:        { type: 'boolean', nullable: true },
    floatingIconSize:    { type: 'number', oneOf: [16, 24, 32] },
    floatingIconOpacity: { type: 'number', min: 0.1, max: 1 },
    floatingIconPos:     { type: 'object' },
    hoverTranslateModifier: { type: 'string', oneOf: ['off', 'shift', 'alt', 'ctrl'] },
    hoverTranslateMode:     { type: 'string', oneOf: ['single', 'dual'] },
    targetLanguage:      { type: 'string', oneOf: TARGET_LANGUAGES },
    uiLanguage:          { type: 'string', oneOf: UI_LANGUAGES },
    displayMode:         { type: 'string', oneOf: ['single', 'dual'] },
    displayCurrency:     { type: 'string', oneOf: ['USD', 'TWD'] },
    translationMarkStyle:{ type: 'string', oneOf: ['tint', 'bar', 'dashed', 'none'] },
    dualAccentColor:     { type: 'string' },
    toastOpacity:        { type: 'number', min: 0.1, max: 1 },
    toastPosition:       { type: 'string', oneOf: ['bottom-right', 'bottom-left', 'top-right', 'top-left'] },
    disableUpdateNotice: { type: 'boolean' },
  };

  for (const [key, rule] of Object.entries(topRules)) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (rule.nullable && (v === null || v === undefined)) { clean[key] = null; continue; }
    if (typeof v !== rule.type) { warnings.push(_t('options.import.warningSkipType', { key })); continue; }
    if (rule.type === 'number') {
      if (!Number.isFinite(v)) { warnings.push(_t('options.import.warningSkipNum', { key })); continue; }
      if (rule.min !== undefined && v < rule.min) { warnings.push(_t('options.import.warningSkipMin', { key, value: v, min: rule.min })); continue; }
      if (rule.max !== undefined && v > rule.max) { warnings.push(_t('options.import.warningSkipMax', { key, value: v, max: rule.max })); continue; }
      if (rule.int && !Number.isInteger(v)) { warnings.push(_t('options.import.warningSkipInt', { key })); continue; }
    }
    if (rule.oneOf && !rule.oneOf.includes(v)) { warnings.push(_t('options.import.warningSkipOneOf', { key, value: v })); continue; }
    clean[key] = v;
  }

  if (raw.geminiConfig && typeof raw.geminiConfig === 'object') {
    const gc = raw.geminiConfig;
    const gcClean = {};
    const gcRules = {
      model:            { type: 'string' },
      serviceTier:      { type: 'string', oneOf: ['DEFAULT', 'FLEX', 'STANDARD', 'PRIORITY'] },
      temperature:      { type: 'number', min: 0, max: 2 },
      topP:             { type: 'number', min: 0, max: 1 },
      topK:             { type: 'number', min: 1, max: 100, int: true },
      maxOutputTokens:  { type: 'number', min: 256, max: 65535, int: true },
      systemInstruction:{ type: 'string' },
    };
    for (const [key, rule] of Object.entries(gcRules)) {
      if (!(key in gc)) continue;
      const v = gc[key];
      const fullKey = `geminiConfig.${key}`;
      if (typeof v !== rule.type) { warnings.push(_t('options.import.warningSkipType', { key: fullKey })); continue; }
      if (rule.type === 'number') {
        if (!Number.isFinite(v)) { warnings.push(_t('options.import.warningSkipNum', { key: fullKey })); continue; }
        if (rule.min !== undefined && v < rule.min) { warnings.push(_t('options.import.warningSkipMin', { key: fullKey, value: v, min: rule.min })); continue; }
        if (rule.max !== undefined && v > rule.max) { warnings.push(_t('options.import.warningSkipMax', { key: fullKey, value: v, max: rule.max })); continue; }
        if (rule.int && !Number.isInteger(v)) { warnings.push(_t('options.import.warningSkipInt', { key: fullKey })); continue; }
      }
      if (rule.oneOf && !rule.oneOf.includes(v)) { warnings.push(_t('options.import.warningSkipOneOf', { key: fullKey, value: v })); continue; }
      gcClean[key] = v;
    }
    if (Object.keys(gcClean).length > 0) clean.geminiConfig = gcClean;
  }

  if (raw.translateDoc && typeof raw.translateDoc === 'object') {
    const td = raw.translateDoc;
    const tdClean = {};
    if (typeof td.systemPrompt === 'string') tdClean.systemPrompt = td.systemPrompt;
    else if ('systemPrompt' in td) warnings.push(_t('options.import.warningTransDocPrompt'));
    if (typeof td.applyGlossary === 'boolean') tdClean.applyGlossary = td.applyGlossary;
    else if ('applyGlossary' in td) warnings.push(_t('options.import.warningTransDocApply'));
    if (typeof td.applyFixedGlossary === 'boolean') tdClean.applyFixedGlossary = td.applyFixedGlossary;
    else if ('applyFixedGlossary' in td) warnings.push(_t('options.import.warningSkipType', { key: 'translateDoc.applyFixedGlossary' }));
    if (typeof td.temperature === 'number' && Number.isFinite(td.temperature)
        && td.temperature >= 0 && td.temperature <= 2) {
      tdClean.temperature = td.temperature;
    } else if ('temperature' in td) warnings.push(_t('options.import.warningTransDocTemp'));
    if (typeof td.batchSize === 'number' && Number.isInteger(td.batchSize)
        && td.batchSize >= 1 && td.batchSize <= 100) {
      tdClean.batchSize = td.batchSize;
    } else if ('batchSize' in td) warnings.push(_t('options.import.warningSkipType', { key: 'translateDoc.batchSize' }));
    for (const boolKey of ['epubParagraphSpacing', 'consistencyScan', 'epubAutoFixSpacing', 'subtitleStripPeriod']) {
      if (typeof td[boolKey] === 'boolean') tdClean[boolKey] = td[boolKey];
      else if (boolKey in td) warnings.push(_t('options.import.warningSkipType', { key: `translateDoc.${boolKey}` }));
    }
    if (DOC_ENGINE_IDS.includes(td.engine)) {
      tdClean.engine = td.engine;
      tdClean.model = (td.engine === 'gemini' && typeof td.model === 'string' && td.model) ? td.model : null;
    } else if ('engine' in td) warnings.push(_t('options.import.warningSkipType', { key: 'translateDoc.engine' }));
    if (Object.keys(tdClean).length > 0) clean.translateDoc = tdClean;
  }

  if (raw.pricing && typeof raw.pricing === 'object') {
    const pr = raw.pricing;
    const prClean = {};
    for (const key of ['inputPerMTok', 'outputPerMTok']) {
      if (!(key in pr)) continue;
      const v = pr[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        warnings.push(_t('options.import.warningSkipNeg', { key })); continue;
      }
      prClean[key] = v;
    }
    if ('cachedDiscount' in pr) {
      const v = pr.cachedDiscount;
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) {
        prClean.cachedDiscount = v;
      } else {
        warnings.push(_t('options.import.warningSkipNeg', { key: 'cachedDiscount' }));
      }
    }
    if (Object.keys(prClean).length > 0) clean.pricing = prClean;
  }

  if (raw.glossary && typeof raw.glossary === 'object') {
    const gl = raw.glossary;
    const glClean = {};
    if (typeof gl.enabled === 'boolean') glClean.enabled = gl.enabled;
    if (typeof gl.prompt === 'string') glClean.prompt = gl.prompt;
    if (typeof gl.temperature === 'number' && gl.temperature >= 0 && gl.temperature <= 2) glClean.temperature = gl.temperature;
    if (typeof gl.timeoutMs === 'number' && gl.timeoutMs >= 3000 && gl.timeoutMs <= 60000) glClean.timeoutMs = gl.timeoutMs;
    if (typeof gl.skipThreshold === 'number' && Number.isInteger(gl.skipThreshold) && gl.skipThreshold >= 0) glClean.skipThreshold = gl.skipThreshold;
    if (typeof gl.blockingThreshold === 'number' && Number.isInteger(gl.blockingThreshold) && gl.blockingThreshold >= 0) glClean.blockingThreshold = gl.blockingThreshold;
    if (typeof gl.maxTerms === 'number' && Number.isInteger(gl.maxTerms) && gl.maxTerms >= 1 && gl.maxTerms <= 500) glClean.maxTerms = gl.maxTerms;
    if (typeof gl.model === 'string') glClean.model = gl.model.trim();
    if (Object.keys(glClean).length > 0) clean.glossary = glClean;
  }

  if (Array.isArray(raw.forbiddenTerms)) {
    const cleanTerms = [];
    for (const t of raw.forbiddenTerms) {
      if (!t || typeof t !== 'object') continue;
      const forbidden = typeof t.forbidden === 'string' ? t.forbidden.trim() : '';
      const replacement = typeof t.replacement === 'string' ? t.replacement.trim() : '';
      const note = typeof t.note === 'string' ? t.note : '';
      if (!forbidden) continue;
      cleanTerms.push({ forbidden, replacement, note });
    }
    clean.forbiddenTerms = cleanTerms;
    if (cleanTerms.length !== raw.forbiddenTerms.length) {
      warnings.push(_t('options.import.warningForbiddenSkip', { count: raw.forbiddenTerms.length - cleanTerms.length }));
    }
  }

  if (raw.customProvider && typeof raw.customProvider === 'object') {
    const cp = raw.customProvider;
    const cpClean = {};
    if (typeof cp.baseUrl === 'string') cpClean.baseUrl = cp.baseUrl.trim();
    if (typeof cp.model === 'string') cpClean.model = cp.model.trim();
    if (typeof cp.systemPrompt === 'string') cpClean.systemPrompt = cp.systemPrompt;
    if (cp.temperature === null) cpClean.temperature = null;
    else if (typeof cp.temperature === 'number' && cp.temperature >= 0 && cp.temperature <= 2) {
      cpClean.temperature = cp.temperature;
    }
    if (typeof cp.fetchTimeoutSec === 'number' && cp.fetchTimeoutSec >= 5 && cp.fetchTimeoutSec <= 600) cpClean.fetchTimeoutSec = cp.fetchTimeoutSec;
    if (typeof cp.inputPerMTok === 'number' && cp.inputPerMTok >= 0) cpClean.inputPerMTok = cp.inputPerMTok;
    if (typeof cp.outputPerMTok === 'number' && cp.outputPerMTok >= 0) cpClean.outputPerMTok = cp.outputPerMTok;
    if (cp.cachedDiscount === null) cpClean.cachedDiscount = null;
    else if (typeof cp.cachedDiscount === 'number'
        && Number.isFinite(cp.cachedDiscount)
        && cp.cachedDiscount >= 0 && cp.cachedDiscount <= 1) {
      cpClean.cachedDiscount = cp.cachedDiscount;
    }
    if (typeof cp.thinkingLevel === 'string'
        && ['auto', 'off', 'low', 'medium', 'high'].includes(cp.thinkingLevel)) {
      cpClean.thinkingLevel = cp.thinkingLevel;
    }
    if (typeof cp.extraBodyJson === 'string') cpClean.extraBodyJson = cp.extraBodyJson.trim();
    if (typeof cp.useStrongSegMarker === 'boolean') cpClean.useStrongSegMarker = cp.useStrongSegMarker;
    if (Object.prototype.hasOwnProperty.call(cp, 'apiKey')) {
      warnings.push(_t('options.import.warningCpApiKey'));
    }
    if (Object.keys(cpClean).length > 0) clean.customProvider = cpClean;
  }

  if (raw.domainRules && typeof raw.domainRules === 'object') {
    const dr = raw.domainRules;
    const drClean = {};
    for (const key of ['whitelist']) {
      if (!(key in dr)) continue;
      if (Array.isArray(dr[key]) && dr[key].every(x => typeof x === 'string')) {
        drClean[key] = dr[key];
      } else {
        warnings.push(_t('options.import.warningDomainRules', { key }));
      }
    }
    if (Object.keys(drClean).length > 0) clean.domainRules = drClean;
  }

  if (raw.fixedGlossary && typeof raw.fixedGlossary === 'object') {
    const fg = raw.fixedGlossary;
    const fgClean = {};
    const sanitizeEntries = (arr) => {
      if (!Array.isArray(arr)) return [];
      const out = [];
      for (const e of arr) {
        if (!e || typeof e !== 'object') continue;
        const source = typeof e.source === 'string' ? e.source : '';
        const target = typeof e.target === 'string' ? e.target : '';
        if (!source && !target) continue;
        out.push({ source, target });
      }
      return out;
    };
    if (Array.isArray(fg.global)) {
      fgClean.global = sanitizeEntries(fg.global);
    }
    if (fg.byDomain && typeof fg.byDomain === 'object' && !Array.isArray(fg.byDomain)) {
      const byDomainClean = {};
      for (const [domain, entries] of Object.entries(fg.byDomain)) {
        if (typeof domain !== 'string' || !domain) continue;
        const cleanEntries = sanitizeEntries(entries);
        if (cleanEntries.length > 0) byDomainClean[domain] = cleanEntries;
      }
      fgClean.byDomain = byDomainClean;
    }
    if (Object.keys(fgClean).length > 0) clean.fixedGlossary = fgClean;
  }

  if (Array.isArray(raw.translatePresets)) {
    const cleanPresets = [];
    for (const p of raw.translatePresets) {
      if (!p || typeof p !== 'object') continue;
      if (![1, 2, 3].includes(p.slot)) continue;
      const engine = ['gemini', 'google', 'openai-compat'].includes(p.engine) ? p.engine : 'gemini';
      let model = null;
      if (typeof p.model === 'string') model = p.model;
      else if (p.model === null) model = null;
      const label = typeof p.label === 'string' ? p.label : '';
      cleanPresets.push({ slot: p.slot, engine, model, label });
    }
    // 舊版匯出檔: 三組 preset 轉成主要 + failback
    if (cleanPresets.length > 0 && !raw.translateEngines) {
      clean.translateEngines = normalizeTranslateEngines({ translatePresets: cleanPresets });
    }
  }

  if (raw.translateEngines && typeof raw.translateEngines === 'object') {
    clean.translateEngines = normalizeTranslateEngines({ translateEngines: raw.translateEngines });
  }

  if (raw.ytSubtitle && typeof raw.ytSubtitle === 'object') {
    const yt = raw.ytSubtitle;
    const ytClean = {};
    const ytRules = {
      autoTranslate:       { type: 'boolean' },
      temperature:         { type: 'number', min: 0, max: 2 },
      systemPrompt:        { type: 'string' },
      windowSizeS:         { type: 'number', min: 10, max: 120 },
      lookaheadS:          { type: 'number', min: 3, max: 30 },
      debugToast:          { type: 'boolean' },
      onTheFly:            { type: 'boolean' },
      engine:              { type: 'string', oneOf: ['gemini', 'google', 'openai-compat'] },
      model:               { type: 'string' },
      applyFixedGlossary:  { type: 'boolean' },
      applyForbiddenTerms: { type: 'boolean' },
      asrMode:             { type: 'string', oneOf: ['heuristic', 'progressive', 'llm'] },
      preferOriginalTrack: { type: 'boolean' },
      captionScale:        { type: 'number', min: 50, max: 400 },
    };
    for (const [key, rule] of Object.entries(ytRules)) {
      if (!(key in yt)) continue;
      const v = yt[key];
      const fullKey = `ytSubtitle.${key}`;
      if (typeof v !== rule.type) { warnings.push(_t('options.import.warningSkipType', { key: fullKey })); continue; }
      if (rule.type === 'number' && !Number.isFinite(v)) { warnings.push(_t('options.import.warningSkipNum', { key: fullKey })); continue; }
      if (rule.min !== undefined && v < rule.min) { warnings.push(_t('options.import.warningSkipMin', { key: fullKey, value: v, min: rule.min })); continue; }
      if (rule.max !== undefined && v > rule.max) { warnings.push(_t('options.import.warningSkipMax', { key: fullKey, value: v, max: rule.max })); continue; }
      if (rule.oneOf && !rule.oneOf.includes(v)) { warnings.push(_t('options.import.warningSkipOneOf', { key: fullKey, value: v })); continue; }
      ytClean[key] = v;
    }
    if ('pricing' in yt) {
      if (yt.pricing === null) {
        ytClean.pricing = null;
      } else if (yt.pricing && typeof yt.pricing === 'object') {
        const pr = yt.pricing;
        const prClean = {};
        for (const k of ['inputPerMTok', 'outputPerMTok']) {
          if (!(k in pr)) continue;
          const v = pr[k];
          if (v === null) { prClean[k] = null; continue; }
          if (typeof v === 'number' && Number.isFinite(v) && v >= 0) prClean[k] = v;
        }
        if (Object.keys(prClean).length > 0) ytClean.pricing = prClean;
      }
    }
    if (Object.keys(ytClean).length > 0) clean.ytSubtitle = ytClean;
  }

  if (raw.partialMode && typeof raw.partialMode === 'object') {
    const pm = raw.partialMode;
    const pmClean = {};
    if (typeof pm.enabled === 'boolean') pmClean.enabled = pm.enabled;
    if (typeof pm.maxUnits === 'number' && Number.isInteger(pm.maxUnits) && pm.maxUnits >= 5 && pm.maxUnits <= 50) {
      pmClean.maxUnits = pm.maxUnits;
    }
    if (Object.keys(pmClean).length > 0) clean.partialMode = pmClean;
  }

  if ('customShortcuts' in raw) {
    const cs = raw.customShortcuts;
    if (SC && cs && typeof cs === 'object' && !Array.isArray(cs)) {
      clean.customShortcuts = SC.sanitizeTable(cs);
    } else {
      warnings.push(_t('options.import.warningSkipType', { key: 'customShortcuts' }));
    }
  }

  return { clean, warnings };
}

export function importChangesCustomProviderOrigin(currentBaseUrl, clean) {
  const nextBaseUrl = clean && clean.customProvider && clean.customProvider.baseUrl;
  if (typeof nextBaseUrl !== 'string') return false;
  const originOf = (u) => {
    try { return new URL(String(u || '').trim()).origin; } catch { return null; }
  };
  const prev = originOf(currentBaseUrl);
  const next = originOf(nextBaseUrl);
  if (!prev || !next) return true;
  return prev !== next;
}
