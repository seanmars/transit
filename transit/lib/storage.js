import { browser } from './compat.js';
import { DEFAULT_UNITS_PER_BATCH, DEFAULT_CHARS_PER_BATCH } from './constants.js';
import DEFAULT_SYSTEM_PROMPT from '../prompts/translate-zh-tw.js';
import DOC_NUMBER_FIDELITY_ZH from '../prompts/doc-number-fidelity-zh-tw.js';
import DOC_NUMBER_FIDELITY_EN from '../prompts/doc-number-fidelity-universal.js';
import DOC_INLINE_MARKER_INSTRUCTION from '../prompts/doc-inline-marker.js';
import DEFAULT_GLOSSARY_PROMPT from '../prompts/glossary-zh-tw.js';
import DEFAULT_SUBTITLE_SYSTEM_PROMPT from '../prompts/subtitle-zh-tw.js';
import DEFAULT_ASR_SUBTITLE_SYSTEM_PROMPT from '../prompts/asr-subtitle-zh-tw.js';
import UNIVERSAL_SYSTEM_PROMPT from '../prompts/translate-universal.js';
import UNIVERSAL_GLOSSARY_PROMPT from '../prompts/glossary-universal.js';
import UNIVERSAL_SUBTITLE_SYSTEM_PROMPT from '../prompts/subtitle-universal.js';
import UNIVERSAL_ASR_SUBTITLE_SYSTEM_PROMPT from '../prompts/asr-subtitle-universal.js';
import TARGET_LANGUAGE_REINFORCEMENT from '../prompts/target-language-reinforcement.js';

export {
  DEFAULT_SYSTEM_PROMPT,
  DOC_INLINE_MARKER_INSTRUCTION,
  DEFAULT_GLOSSARY_PROMPT,
  DEFAULT_SUBTITLE_SYSTEM_PROMPT,
  DEFAULT_ASR_SUBTITLE_SYSTEM_PROMPT,
  UNIVERSAL_SYSTEM_PROMPT,
  UNIVERSAL_GLOSSARY_PROMPT,
  UNIVERSAL_SUBTITLE_SYSTEM_PROMPT,
  UNIVERSAL_ASR_SUBTITLE_SYSTEM_PROMPT,
};

export const DEFAULT_DOC_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT + DOC_NUMBER_FIDELITY_ZH;
export const UNIVERSAL_DOC_SYSTEM_PROMPT = UNIVERSAL_SYSTEM_PROMPT + DOC_NUMBER_FIDELITY_EN;

export const DEFAULT_FORBIDDEN_TERMS = [
  { forbidden: '視頻',     replacement: '影片',     note: '' },
  { forbidden: '音頻',     replacement: '音訊',     note: '' },
  { forbidden: '軟件',     replacement: '軟體',     note: '' },
  { forbidden: '程序',     replacement: '程式',     note: '指 program；若原文是 procedure/process 用「程序」屬正確' },
  { forbidden: '進程',     replacement: '行程',     note: 'process（注意：不是「線程」）' },
  { forbidden: '線程',     replacement: '執行緒',   note: 'thread' },
  { forbidden: '數據',     replacement: '資料',     note: '' },
  { forbidden: '數據庫',   replacement: '資料庫',   note: '' },
  { forbidden: '網絡',     replacement: '網路',     note: '' },
  { forbidden: '信息',     replacement: '資訊',     note: '' },
  { forbidden: '質量',     replacement: '品質',     note: '' },
  { forbidden: '用戶',     replacement: '使用者',   note: '' },
  { forbidden: '默認',     replacement: '預設',     note: '' },
  { forbidden: '創建',     replacement: '建立',     note: '' },
  { forbidden: '實現',     replacement: '實作',     note: '' },
  { forbidden: '運行',     replacement: '執行',     note: '' },
  { forbidden: '發布',     replacement: '發表',     note: '' },
  { forbidden: '屏幕',     replacement: '螢幕',     note: '' },
  { forbidden: '劍指',     replacement: '針對',     note: '' },
  { forbidden: '痛點',     replacement: '要害',     note: '' },
  { forbidden: '硬傷',     replacement: '罩門',     note: '' },
  { forbidden: '文檔',     replacement: '文件',     note: 'document（注意：「文件」在台灣指 document，「檔案」才是 file）' },
  { forbidden: '操作系統', replacement: '作業系統', note: '' },
  { forbidden: '沒有之一', replacement: '',         note: '陳腔濫調，留空替換詞由 AI 自行改寫' },
  { forbidden: '橫空出世', replacement: '',         note: '陳腔濫調，留空替換詞由 AI 自行改寫' },
  { forbidden: '啃硬骨頭', replacement: '',         note: '中國媒體慣用比喻（攻克難題），留空替換詞由 AI 自行改寫' },
];

export const TARGET_LANGUAGES = ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'es', 'fr', 'de'];

export const SOURCE_LANG_LABELS_ZH = {
  'en':      '英文',
  'ja':      '日文',
  'ko':      '韓文',
  'fr':      '法文',
  'de':      '德文',
  'es':      '西班牙文',
  'pt':      '葡萄牙文',
  'it':      '義大利文',
  'ru':      '俄文',
  'nl':      '荷蘭文',
  'pl':      '波蘭文',
  'tr':      '土耳其文',
  'ar':      '阿拉伯文',
  'th':      '泰文',
  'vi':      '越南文',
  'id':      '印尼文',
  'hi':      '印地文',
  'zh-Hans': '簡體中文',
  'zh-Hant': '繁體中文',
  'zh-HK':   '繁體中文（港式）',
};

export const SOURCE_LANG_LABELS_EN = {
  'en':      'English',
  'ja':      'Japanese',
  'ko':      'Korean',
  'fr':      'French',
  'de':      'German',
  'es':      'Spanish',
  'pt':      'Portuguese',
  'it':      'Italian',
  'ru':      'Russian',
  'nl':      'Dutch',
  'pl':      'Polish',
  'tr':      'Turkish',
  'ar':      'Arabic',
  'th':      'Thai',
  'vi':      'Vietnamese',
  'id':      'Indonesian',
  'hi':      'Hindi',
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
  'zh-HK':   'Traditional Chinese (Hong Kong)',
};

export const UI_LANGUAGES = ['auto', 'zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'es', 'fr', 'de'];

export const LANG_LABELS = {
  'zh-TW': 'Traditional Chinese (Taiwan conventions)',
  'zh-CN': 'Simplified Chinese (China conventions, 中国用语)',
  'en':    'English',
  'ja':    'Japanese (日本語)',
  'ko':    'Korean (한국어)',
  'es':    'Spanish (español)',
  'fr':    'French (français)',
  'de':    'German (Deutsch)',
};

export const NAV_LANG_RULES = [
  ['zh-tw', 'zh-TW'], ['zh-hant', 'zh-TW'], ['zh-hk', 'zh-TW'], ['zh-mo', 'zh-TW'],
  ['zh', 'zh-CN'],
  ['ja', 'ja'], ['ko', 'ko'], ['es', 'es'], ['fr', 'fr'], ['de', 'de'],
];
export function langFromNavigator(navLang) {
  const nav = String(navLang || 'en').toLowerCase();
  for (const [prefix, lang] of NAV_LANG_RULES) {
    if (nav.startsWith(prefix)) return lang;
  }
  return 'en';
}

export function detectDefaultTargetLanguage() {
  return langFromNavigator((typeof navigator !== 'undefined' && navigator.language) || 'en');
}

const _escapeForRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const _PROMPT_DEFAULT_BLOCK_STRIP_RES = [
  ...[DEFAULT_GLOSSARY_PROMPT, UNIVERSAL_GLOSSARY_PROMPT]
    .map((p) => (p.match(/<source_fidelity>[\s\S]*?<\/source_fidelity>\n/) || [])[0])
    .filter(Boolean),
  DOC_NUMBER_FIDELITY_ZH,
  DOC_NUMBER_FIDELITY_EN,
].map((lit) => new RegExp(_escapeForRegExp(lit), 'g'));

function _normalizePromptForComparison(s) {
  let out = (s || '');
  for (const re of _PROMPT_DEFAULT_BLOCK_STRIP_RES) out = out.replace(re, '');
  s = out;
  return (s || '')
    .replace(/中國大陸/g, '中國')
    .replace(/建立符合台灣在地化語境的英中對照術語表/g, '建立「原文 → 台灣繁體中文」的對照術語表，符合台灣在地化語境')
    .replace(/日文人名的漢字須轉為台灣慣用字形（例如：相沢→相澤、斉藤→齊藤、渋谷→澀谷），假名人名用台灣通行音譯。/g, '')
    .replace(/\{"source":"相沢","target":"(?:相澤|<translated>)","type":"person"\},/g, '')
    .replace(/無通行譯名的作品名須自行譯成台灣繁體中文（可意譯）再加書名號；source 保持原文是對的，但 target 是給台灣讀者看的譯名，絕不可原文照抄、不可殘留日文假名（例如：『ノルウェイの森』→《挪威的森林》，而不是《ノルウェイの森》）。/g, '')
    .replace(/\n4\. 欄位完整：每條 entry 必須同時包含 source、target、type 三個欄位；target 必須是譯名本身，絕對不可填入分類代號（person \/ place \/ tech \/ work）。/g, '')
    .replace(/ If none exists, translate the title into [^\n]*? yourself; never leave the original title untranslated as the target\./g, '')
    .replace(/\n3\. Every entry must include all three fields source \/ target \/ type; the target must be the translated name itself, never a category token \(person \/ place \/ tech \/ work\)\./g, '')
    .replace(/特別注意：日文等原文在「？」「！」後接空格再起句是原文的排版慣例，翻譯成中文時必須移除這些空格，不可帶進譯文。/g, '')
    .replace(/\n6\. 忠於原文的句尾標點：原文句尾沒有終止標點時（日文小說的「」內對白慣例、標題、詩句等），譯文句尾也不可自行補上句號。原文的輕收節奏是作者的選擇，必須保留。/g, '')
    .replace(/\n5\. Follow [^\n]* punctuation and spacing conventions\. Do not carry over\n   source-language typographic spacing \(e\.g\. the Japanese habit of a space after ？\/！\)\n   unless it is also conventional in [^\n]*\.\n6\. Mirror the source's sentence-final punctuation: if the source sentence, quoted line,\n   or heading ends without a sentence-final mark, do not add one in the translation\./g, '')
    .replace(/沒有可靠通行譯名或不確定時，一律保留原文，嚴禁自創、猜測或音譯譯名（例如不確定某公司的中文名稱時，保留其英文名）。/g, '')
    .replace(/「線程」而非「進程」/g, '「執行緒」而非「線程」、「行程」而非「進程」')
    .trim();
}

export function isPromptUnchangedFromDefault(saved, defaultPrompt) {
  if (!saved || !saved.trim()) return true;
  return _normalizePromptForComparison(saved) === _normalizePromptForComparison(defaultPrompt);
}

export function isPromptUnchangedFromAnyTargetDefault(saved, getEffectiveFn) {
  if (!saved || !saved.trim()) return true;
  return TARGET_LANGUAGES.some((t) => isPromptUnchangedFromDefault(saved, getEffectiveFn(t, '')));
}

function _appendReinforcement(prompt, targetLang, userOverride, defaultPrompt, universalTemplate) {
  if (targetLang === 'zh-TW') return prompt;
  if (!_isAnyTargetDefault(userOverride, defaultPrompt, universalTemplate)) return prompt;
  const r = TARGET_LANGUAGE_REINFORCEMENT[targetLang];
  return r ? `${prompt}\n\n${r}` : prompt;
}

function _isAnyTargetDefault(userOverride, defaultPrompt, universalTemplate) {
  if (isPromptUnchangedFromDefault(userOverride, defaultPrompt)) return true;
  const norm = _normalizePromptForComparison(userOverride);
  for (const t of TARGET_LANGUAGES) {
    if (t === 'zh-TW') continue;
    const candidate = universalTemplate.replaceAll('{targetLanguage}', LANG_LABELS[t] || LANG_LABELS.en);
    if (norm === _normalizePromptForComparison(candidate)) return true;
    const r = TARGET_LANGUAGE_REINFORCEMENT[t];
    if (r && norm === _normalizePromptForComparison(`${candidate}\n\n${r}`)) return true;
  }
  return false;
}

function _buildEffective(targetLang, userOverride, defaultPrompt, universalTemplate) {
  const treatedAsUnchanged = _isAnyTargetDefault(userOverride, defaultPrompt, universalTemplate);
  if (treatedAsUnchanged) {
    if (targetLang === 'zh-TW') return defaultPrompt;
    return universalTemplate.replaceAll('{targetLanguage}', LANG_LABELS[targetLang] || LANG_LABELS.en);
  }
  return userOverride;
}

export function getEffectiveSystemPrompt(targetLang, userOverride) {
  const prompt = _buildEffective(targetLang, userOverride, DEFAULT_SYSTEM_PROMPT, UNIVERSAL_SYSTEM_PROMPT);
  return _appendReinforcement(prompt, targetLang, userOverride, DEFAULT_SYSTEM_PROMPT, UNIVERSAL_SYSTEM_PROMPT);
}
export function getEffectiveDocSystemPrompt(targetLang, userOverride) {
  const prompt = _buildEffective(targetLang, userOverride, DEFAULT_DOC_SYSTEM_PROMPT, UNIVERSAL_DOC_SYSTEM_PROMPT);
  return _appendReinforcement(prompt, targetLang, userOverride, DEFAULT_DOC_SYSTEM_PROMPT, UNIVERSAL_DOC_SYSTEM_PROMPT);
}
export function getEffectiveGlossaryPrompt(targetLang, userOverride) {
  return _buildEffective(targetLang, userOverride, DEFAULT_GLOSSARY_PROMPT, UNIVERSAL_GLOSSARY_PROMPT);
}
export function getEffectiveSubtitleSystemPrompt(targetLang, userOverride) {
  return _buildEffective(targetLang, userOverride, DEFAULT_SUBTITLE_SYSTEM_PROMPT, UNIVERSAL_SUBTITLE_SYSTEM_PROMPT);
}
export function getEffectiveAsrSubtitleSystemPrompt(targetLang, sourceLang = 'en') {
  const base = _buildEffective(targetLang, '', DEFAULT_ASR_SUBTITLE_SYSTEM_PROMPT, UNIVERSAL_ASR_SUBTITLE_SYSTEM_PROMPT);
  const labelMap = (targetLang === 'zh-TW') ? SOURCE_LANG_LABELS_ZH : SOURCE_LANG_LABELS_EN;
  const label = labelMap[sourceLang] || sourceLang;
  return base.replaceAll('{sourceLanguage}', label);
}

export const DEFAULT_SETTINGS = {
  apiKey: '',
  targetLanguage: detectDefaultTargetLanguage(),
  uiLanguage: 'auto',
  geminiConfig: {
    model: 'gemini-3.1-flash-lite',
    serviceTier: 'DEFAULT',
    temperature: 1.0,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    systemInstruction: DEFAULT_SYSTEM_PROMPT,
  },
  pricing: {
    inputPerMTok: 0.25,
    outputPerMTok: 1.50,
    cachedDiscount: 0.90,
  },
  glossary: {
    enabled: false,
    prompt: DEFAULT_GLOSSARY_PROMPT,
    temperature: 1.0,
    skipThreshold: 1,
    blockingThreshold: 10,
    timeoutMs: 60000,
    maxTerms: 200,
    model: 'gemini-3.1-flash-lite',
  },
  domainRules: { whitelist: [] },
  autoTranslate: false,
  autoConvertZh: true,
  debugLog: false,
  translateDoc: {
    engine: 'gemini',
    model: 'gemini-3.1-flash-lite',
    systemPrompt: DEFAULT_DOC_SYSTEM_PROMPT,
    batchSize: 50,
    applyGlossary: false,
    temperature: 1.0,
    applyFixedGlossary: true,
    subtitleStripPeriod: true,
  },
  ytSubtitle: {
    autoTranslate: true,
    temperature:   1,
    systemPrompt:  DEFAULT_SUBTITLE_SYSTEM_PROMPT,
    windowSizeS:   30,
    lookaheadS:    10,
    debugToast:    false,
    onTheFly:      false,
    engine: 'gemini',
    model: '',
    pricing: null,
    applyFixedGlossary: false,
    applyForbiddenTerms: false,
    asrMode: 'progressive',
    preferOriginalTrack: true,
    captionScale: 100,
  },
  maxRetries: 3,
  maxConcurrentBatches: 30,
  maxUnitsPerBatch: DEFAULT_UNITS_PER_BATCH,
  maxCharsPerBatch: DEFAULT_CHARS_PER_BATCH,
  maxTranslateUnits: 1000,
  partialMode: {
    enabled: false,
    maxUnits: 25,
  },
  toastOpacity: 0.7,
  toastAutoHide: true,
  showProgressToast: true,
  hideZhConvertToast: true,
  displayMode: 'single',
  displayCurrency: 'TWD',
  translationMarkStyle: 'tint',
  dualAccentColor: 'auto',
  translateEngines: {
    primary: { engine: 'gemini', model: 'gemini-3.1-flash-lite', label: 'Flash Lite' },
    fallback: { engine: 'google', model: null, label: 'Google MT' },
  },
  customShortcuts: { 2: null },
  forbiddenTerms: DEFAULT_FORBIDDEN_TERMS,
  disableUpdateNotice: false,
  floatingIcon: null,
  floatingIconOpacity: 0.7,
  floatingIconSize: 24,
  floatingIconPos: { edge: 'right', offsetY: 1 },
  hoverTranslateModifier: 'off',
  hoverTranslateMode: 'dual',
  modelPricingOverrides: {},
  customProvider: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5.4-mini',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.7,
    inputPerMTok: 0.75,
    outputPerMTok: 4.5,
    cachedDiscount: 0.90,
    thinkingLevel: 'off',
    extraBodyJson: '',
    useStrongSegMarker: true,
    fetchTimeoutSec: 90,
  },
};

const API_KEY_STORAGE_KEY = 'apiKey';
const CUSTOM_PROVIDER_API_KEY = 'customProviderApiKey';

export const LOCAL_SETTINGS_KEYS = ['fixedGlossary', 'forbiddenTerms'];
export async function migrateLargeKeysToLocalIfNeeded(syncSaved) {
  if (!syncSaved) return;
  const present = LOCAL_SETTINGS_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(syncSaved, k));
  if (present.length === 0) return;
  const patch = {};
  for (const k of present) patch[k] = syncSaved[k];
  await browser.storage.local.set(patch);
  await browser.storage.sync.remove(present);
}
export function splitSettingsPatch(patch) {
  const syncPart = { ...(patch || {}) };
  const localPart = {};
  for (const k of LOCAL_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(syncPart, k)) {
      localPart[k] = syncPart[k];
      delete syncPart[k];
    }
  }
  return { syncPart, localPart };
}
export async function overlayLocalSettings(saved) {
  const local = await browser.storage.local.get(LOCAL_SETTINGS_KEYS);
  for (const k of LOCAL_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(local, k)) saved[k] = local[k];
  }
  return saved;
}

let _settingsCachePromise = null;
let _settingsCacheListenerBound = false;

function _bindSettingsCacheInvalidator() {
  if (_settingsCacheListenerBound) return;
  _settingsCacheListenerBound = true;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' && !(area === 'local' && changes
      && (API_KEY_STORAGE_KEY in changes || CUSTOM_PROVIDER_API_KEY in changes
        || LOCAL_SETTINGS_KEYS.some((k) => k in changes)))) return;
    _settingsCachePromise = null;
  });
}

export async function getSettingsCached() {
  _bindSettingsCacheInvalidator();
  if (!_settingsCachePromise) {
    _settingsCachePromise = getSettings().catch((err) => {
      _settingsCachePromise = null;
      throw err;
    });
  }
  return _settingsCachePromise;
}

export async function getSettings() {
  const saved = await browser.storage.sync.get(null);
  await migrateLargeKeysToLocalIfNeeded(saved);
  const localAll = await browser.storage.local.get([API_KEY_STORAGE_KEY, CUSTOM_PROVIDER_API_KEY, ...LOCAL_SETTINGS_KEYS]);
  for (const k of LOCAL_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(localAll, k)) saved[k] = localAll[k];
  }
  const apiKey = localAll[API_KEY_STORAGE_KEY] || '';
  const target = (typeof saved.targetLanguage === 'string' && TARGET_LANGUAGES.includes(saved.targetLanguage))
    ? saved.targetLanguage
    : detectDefaultTargetLanguage();
  const merged = {
    ...DEFAULT_SETTINGS,
    ...saved,
    targetLanguage: target,
    uiLanguage: (typeof saved.uiLanguage === 'string' && UI_LANGUAGES.includes(saved.uiLanguage))
      ? saved.uiLanguage : 'auto',
    geminiConfig: { ...DEFAULT_SETTINGS.geminiConfig, ...(saved.geminiConfig || {}) },
    pricing: { ...DEFAULT_SETTINGS.pricing, ...(saved.pricing || {}) },
    domainRules: { ...DEFAULT_SETTINGS.domainRules, ...(saved.domainRules || {}) },
    glossary: { ...DEFAULT_SETTINGS.glossary, ...(saved.glossary || {}) },
    ytSubtitle: { ...DEFAULT_SETTINGS.ytSubtitle, ...(saved.ytSubtitle || {}) },
    partialMode: { ...DEFAULT_SETTINGS.partialMode, ...(saved.partialMode || {}) },
    translateEngines: normalizeTranslateEngines(saved),
    forbiddenTerms: Array.isArray(saved.forbiddenTerms)
      ? saved.forbiddenTerms
      : (target === 'zh-TW' ? DEFAULT_SETTINGS.forbiddenTerms : []),
    customProvider: { ...DEFAULT_SETTINGS.customProvider, ...(saved.customProvider || {}) },
    translateDoc: normalizeTranslateDoc(saved.translateDoc),
  };
  merged.apiKey = apiKey;
  merged.customProvider.apiKey = localAll[CUSTOM_PROVIDER_API_KEY] || '';
  return merged;
}

export const TRANSLATE_ENGINE_IDS = ['gemini', 'google', 'openai-compat'];
export const DOC_ENGINE_IDS = ['gemini', 'openai-compat'];

function _defaultEngineLabel(engine, model) {
  if (engine === 'google') return 'Google MT';
  if (engine === 'openai-compat') return 'Custom';
  return model || DEFAULT_SETTINGS.geminiConfig.model;
}

function _sameEngine(a, b) {
  return !!a && !!b && a.engine === b.engine && (a.model || null) === (b.model || null);
}

// 清理單一引擎設定: 不合法的 engine 改用 def; 只有 gemini 需要 model
export function sanitizeEngineSpec(raw, def) {
  if (!raw || typeof raw !== 'object') return { ...def };
  const engine = TRANSLATE_ENGINE_IDS.includes(raw.engine) ? raw.engine : def.engine;
  const model = engine === 'gemini'
    ? ((typeof raw.model === 'string' && raw.model) ? raw.model : DEFAULT_SETTINGS.geminiConfig.model)
    : null;
  const label = (typeof raw.label === 'string' && raw.label.trim())
    ? raw.label.trim().slice(0, 30)
    : _defaultEngineLabel(engine, model);
  return { engine, model, label };
}

// 舊版三組 preset (slot 2 是主要) 轉成主要 + failback
function _enginesFromLegacyPresets(presets) {
  const D = DEFAULT_SETTINGS.translateEngines;
  const bySlot = (slot) => presets.find((p) => p && p.slot === slot);
  const primary = sanitizeEngineSpec(bySlot(2) || presets[0], D.primary);
  const fallback = [bySlot(3), bySlot(1)]
    .map((p) => (p ? sanitizeEngineSpec(p, D.fallback) : null))
    .find((p) => p && !_sameEngine(p, primary));
  if (fallback) return { primary, fallback };
  return { primary, fallback: primary.engine === 'google' ? { ...D.primary } : { ...D.fallback } };
}

export function normalizeTranslateEngines(saved) {
  const D = DEFAULT_SETTINGS.translateEngines;
  const te = saved && saved.translateEngines;
  if (te && typeof te === 'object') {
    return {
      primary: sanitizeEngineSpec(te.primary, D.primary),
      fallback: sanitizeEngineSpec(te.fallback, D.fallback),
    };
  }
  if (saved && Array.isArray(saved.translatePresets) && saved.translatePresets.length > 0) {
    return _enginesFromLegacyPresets(saved.translatePresets);
  }
  return { primary: { ...D.primary }, fallback: { ...D.fallback } };
}

// 文件翻譯只支援 LLM (Gemini / 自訂模型), 不支援 Google Translate
export function normalizeTranslateDoc(raw) {
  const D = DEFAULT_SETTINGS.translateDoc;
  const merged = { ...D, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!DOC_ENGINE_IDS.includes(merged.engine)) merged.engine = D.engine;
  if (merged.engine === 'gemini') {
    if (typeof merged.model !== 'string' || !merged.model) merged.model = D.model;
  } else {
    merged.model = null;
  }
  return merged;
}

// 寫入 translateDoc 時只改 engine / model, 不展開其他預設值 (避免把預設 prompt 寫進 sync, 也避免超過 8 KB 上限)
export function docEngineFields(engine, model) {
  const D = DEFAULT_SETTINGS.translateDoc;
  const e = DOC_ENGINE_IDS.includes(engine) ? engine : D.engine;
  return { engine: e, model: e === 'gemini' ? ((typeof model === 'string' && model) ? model : D.model) : null };
}

// 引擎無法使用的原因 (錯誤代碼); 可以使用時回傳 null
export function engineUnavailableReason(spec, settings) {
  if (!spec) return 'engineMissing';
  if (spec.engine === 'gemini' && !String(settings?.apiKey || '').trim()) return 'apiKeyMissing';
  if (spec.engine === 'openai-compat' && !String(settings?.customProvider?.baseUrl || '').trim()) return 'baseUrlMissing';
  return null;
}

// 翻譯鏈: 主要引擎 + failback 引擎 (兩者相同時不設 failback)
export function resolveTranslateChain(settings) {
  const { primary, fallback: rawFallback } = normalizeTranslateEngines(settings);
  const fallback = _sameEngine(primary, rawFallback) ? null : rawFallback;
  return {
    primary,
    fallback,
    primaryReason: engineUnavailableReason(primary, settings),
    fallbackReason: fallback ? engineUnavailableReason(fallback, settings) : null,
  };
}

// 主要和 failback 都無法使用時回傳 true
export function translateChainUnavailable(chain) {
  return !!chain.primaryReason && (!chain.fallback || !!chain.fallbackReason);
}

const _LEGACY_ENGINE_KEYS = ['translatePresets', 'popupButtonSlot', 'autoTranslateSlot'];

// 舊版 preset 設定轉成 translateEngines 和 translateDoc.engine, 然後移除舊 key
export async function migrateTranslateEnginesIfNeeded() {
  const saved = await browser.storage.sync.get(['translateEngines', 'translateDoc', ..._LEGACY_ENGINE_KEYS]);
  const { translateDocPresetSlot } = await browser.storage.local.get('translateDocPresetSlot');
  const hasLegacy = _LEGACY_ENGINE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(saved, k));
  if (!hasLegacy && translateDocPresetSlot == null) return false;
  const patch = {};
  if (!saved.translateEngines) patch.translateEngines = normalizeTranslateEngines(saved);
  const doc = (saved.translateDoc && typeof saved.translateDoc === 'object') ? saved.translateDoc : {};
  if (!doc.engine) {
    const presets = Array.isArray(saved.translatePresets) ? saved.translatePresets : [];
    const docSlot = Number(translateDocPresetSlot) || 1;
    const p = presets.find((x) => x && x.slot === docSlot);
    if (p && DOC_ENGINE_IDS.includes(p.engine)) {
      patch.translateDoc = { ...doc, ...docEngineFields(p.engine, p.model) };
    }
  }
  if (Object.keys(patch).length > 0) await browser.storage.sync.set(patch);
  await browser.storage.sync.remove(_LEGACY_ENGINE_KEYS);
  await browser.storage.local.remove('translateDocPresetSlot');
  return true;
}

export async function setSettings(patch) {
  if (!patch) return;
  const rest = { ...patch };

  if (Object.prototype.hasOwnProperty.call(rest, 'apiKey')) {
    await browser.storage.local.set({ [API_KEY_STORAGE_KEY]: rest.apiKey });
    delete rest.apiKey;
  }

  if (rest.customProvider && Object.prototype.hasOwnProperty.call(rest.customProvider, 'apiKey')) {
    const cp = { ...rest.customProvider };
    await browser.storage.local.set({ [CUSTOM_PROVIDER_API_KEY]: cp.apiKey });
    delete cp.apiKey;
    rest.customProvider = cp;
  }

  const { syncPart, localPart } = splitSettingsPatch(rest);
  if (Object.keys(localPart).length > 0) {
    await browser.storage.local.set(localPart);
  }
  if (Object.keys(syncPart).length > 0) {
    await browser.storage.sync.set(syncPart);
  }
}
