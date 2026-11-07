export const DEFAULT_GEMINI_CACHED_DISCOUNT = 0.90;

export const MODEL_PRICING = {
  'gemini-3.1-flash-lite': { inputPerMTok: 0.25, outputPerMTok: 1.50, cachedDiscount: DEFAULT_GEMINI_CACHED_DISCOUNT },
  'gemini-3.5-flash-lite': { inputPerMTok: 0.30, outputPerMTok: 2.50, cachedDiscount: 0 },
  'gemini-3-flash-preview':        { inputPerMTok: 0.50, outputPerMTok: 3.00, cachedDiscount: DEFAULT_GEMINI_CACHED_DISCOUNT },
  'gemini-3.8-flash':              { inputPerMTok: 0.75, outputPerMTok: 3.75, cachedDiscount: DEFAULT_GEMINI_CACHED_DISCOUNT },
};

export const LAST_CALIBRATED_DATE = '2026-09';

export function getPricingForModel(model, settings = null) {
  if (!model) return null;
  const override = settings?.modelPricingOverrides?.[model] || {};
  const builtIn = MODEL_PRICING[model] || null;
  const oIn = Number(override.inputPerMTok);
  const oOut = Number(override.outputPerMTok);
  const oDisc = Number(override.cachedDiscount);
  const overrideHasPrices = Number.isFinite(oIn) && Number.isFinite(oOut);
  if (!builtIn && !overrideHasPrices) return null;
  return {
    inputPerMTok:  overrideHasPrices ? oIn  : builtIn.inputPerMTok,
    outputPerMTok: overrideHasPrices ? oOut : builtIn.outputPerMTok,
    cachedDiscount: (Number.isFinite(oDisc) && oDisc >= 0 && oDisc <= 1)
      ? oDisc
      : (builtIn?.cachedDiscount ?? DEFAULT_GEMINI_CACHED_DISCOUNT),
  };
}
