export function detectProvider(baseUrl, model) {
  const url = String(baseUrl || '').toLowerCase();
  const m = String(model || '').toLowerCase();

  if (/openrouter\.ai/.test(url)) return 'openrouter';
  if (/api\.deepseek\.com/.test(url)) return 'deepseek';
  if (/api\.anthropic\.com|claude/.test(url)) return 'claude';
  if (/api\.x\.ai/.test(url)) return 'grok';
  if (/api\.openai\.com/.test(url) && /^o[1-9]/.test(m)) return 'openai-o';
  if (/dashscope|aliyun/.test(url)) return 'qwen';

  return 'openai-compat-generic';
}

export function buildNativeThinking(provider, level) {
  if (!level || level === 'auto') return {};

  switch (provider) {
    case 'openrouter':
      if (level === 'off') return { reasoning: { exclude: true } };
      return { reasoning: { effort: level } };

    case 'deepseek':
      return { thinking: { type: level === 'off' ? 'disabled' : 'enabled' } };

    case 'claude':
      if (level === 'off') return { thinking: { type: 'disabled' } };
      return { thinking: { type: 'adaptive' } };

    case 'openai-o':
      return { reasoning_effort: level === 'off' ? 'minimal' : level };

    case 'grok':
      if (level === 'off') return {};
      return { reasoning_effort: level };

    case 'qwen':
      return { enable_thinking: level !== 'off' };

    case 'openai-compat-generic':
    default:
      return { reasoning_effort: level === 'off' ? 'none' : level };
  }
}

export function safeParseJson(raw, onWarn) {
  if (!raw || typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const v = JSON.parse(trimmed);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    if (onWarn) onWarn('extraBodyJson 不是物件,已忽略');
    return {};
  } catch (e) {
    if (onWarn) onWarn(`extraBodyJson 解析失敗: ${e.message}`);
    return {};
  }
}

export function deepMerge(a, b) {
  if (!isPlainObject(b)) return b === undefined ? a : b;
  if (!isPlainObject(a)) return { ...b };
  const out = { ...a };
  for (const k of Object.keys(b)) {
    if (isPlainObject(a[k]) && isPlainObject(b[k])) {
      out[k] = deepMerge(a[k], b[k]);
    } else {
      out[k] = b[k];
    }
  }
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function buildThinkingPayload({ baseUrl, model, level, extraBodyRaw, onWarn }) {
  const provider = detectProvider(baseUrl, model);
  const native = buildNativeThinking(provider, level);
  const extra = safeParseJson(extraBodyRaw, onWarn);
  return deepMerge(native, extra);
}
