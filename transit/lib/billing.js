export function computeCostUSD(inputTokens, outputTokens, pricing) {
  const inRate = Number(pricing?.inputPerMTok) || 0;
  const outRate = Number(pricing?.outputPerMTok) || 0;
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
}

export const DEFAULT_CACHED_RATE = 0.10;

export function computeBilledCostUSD(inputTokens, cachedTokens, outputTokens, pricing, cachedRate) {
  const rate = (typeof cachedRate === 'number' && cachedRate >= 0 && cachedRate <= 1)
    ? cachedRate
    : DEFAULT_CACHED_RATE;
  const uncached = Math.max(0, inputTokens - cachedTokens);
  const effectiveInput = uncached + cachedTokens * rate;
  return computeCostUSD(effectiveInput, outputTokens, pricing);
}

export function pricingToCachedRate(pricing) {
  const d = Number(pricing?.cachedDiscount);
  if (!Number.isFinite(d) || d < 0 || d > 1) return null;
  return 1 - d;
}

export function geminiCachedRate(pricing) {
  return pricingToCachedRate(pricing) ?? DEFAULT_CACHED_RATE;
}

export function getCustomCacheHitRate(baseUrl) {
  const url = String(baseUrl || '').toLowerCase();
  if (url.includes('anthropic.com')) return 0.10;
  if (url.includes('openai.com')) return 0.10;
  if (url.includes('deepseek.com')) return 0.02;
  if (url.includes('x.ai')) return 0.20;
  return 0.50;
}

export function resolveCustomProviderCachedRate(cp) {
  const fromSettings = pricingToCachedRate(cp);
  if (fromSettings !== null) return fromSettings;
  return getCustomCacheHitRate(cp?.baseUrl);
}

export function customProviderPricing(cp) {
  return { inputPerMTok: cp?.inputPerMTok || 0, outputPerMTok: cp?.outputPerMTok || 0 };
}

export function computeBilling(usage, pricing, cachedRate) {
  const inputTokens = usage?.inputTokens || 0;
  const outputTokens = usage?.outputTokens || 0;
  const cachedTokens = usage?.cachedTokens || 0;
  const cachedSavedRatio = 1 - cachedRate;
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    costUSD: computeCostUSD(inputTokens, outputTokens, pricing),
    billedInputTokens: Math.max(0, Math.round(inputTokens - cachedTokens * cachedSavedRatio)),
    billedCostUSD: computeBilledCostUSD(inputTokens, cachedTokens, outputTokens, pricing, cachedRate),
  };
}
