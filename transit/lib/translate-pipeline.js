import { computeBilling } from './billing.js';

export function createTranslatePipeline(deps) {
  const {
    cache, usageDB, debugLog, detectForbiddenTermLeaks, filterEchoPairsForCache,
    buildFixedGlossaryEntries, preferArticleGlossaryEntries, mergeExtraForbiddenTerms,
    buildCacheKeySuffix, logWebBatchUsage,
  } = deps;

  async function prepareBatch({ payload, sender, settings, cacheTag, applyFixedGlossary, applyForbiddenTerms, keyParts, logLabel, logExtra = {} }) {
    const texts = payload?.texts || [];
    const glossary = payload?.glossary || null;
    let fixedGlossaryEntries = buildFixedGlossaryEntries(
      applyFixedGlossary ? settings.fixedGlossary : null,
      sender,
    );
    fixedGlossaryEntries = preferArticleGlossaryEntries(
      fixedGlossaryEntries,
      payload?.glossary,
      payload?.preferArticleGlossary,
    );
    const forbiddenTermsList = mergeExtraForbiddenTerms(
      (applyForbiddenTerms && Array.isArray(settings.forbiddenTerms)) ? settings.forbiddenTerms : [],
      payload?.extraForbiddenTerms,
    );
    const cacheKeySuffix = await buildCacheKeySuffix({
      cacheTag, glossary, fixedGlossaryEntries, forbiddenTermsList, ...keyParts,
    });
    const cached = await cache.getBatch(texts, cacheKeySuffix);
    const missingIdxs = [];
    const missingTexts = [];
    cached.forEach((tr, i) => {
      if (tr == null) {
        missingIdxs.push(i);
        missingTexts.push(texts[i]);
      }
    });
    const cacheHits = texts.length - missingTexts.length;
    debugLog('info', 'cache', `${logLabel} batch cache lookup`, {
      ...logExtra, total: texts.length, hits: cacheHits, misses: missingTexts.length,
    });
    return { texts, glossary, fixedGlossaryEntries, forbiddenTermsList, cacheKeySuffix, cached, missingIdxs, missingTexts, cacheHits };
  }

  async function logDiscardedUsage({ sender, engine, model, usage, pricing, cachedRate, segments, cacheHits, why, logLabel, logExtra = {} }) {
    if (!usage || !(usage.inputTokens > 0 || usage.outputTokens > 0)) return false;
    try {
      const billing = computeBilling(usage, pricing, cachedRate);
      await usageDB.logTranslation({
        url: sender?.tab?.url || '',
        title: sender?.tab?.title || '',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens || 0,
        billedInputTokens: billing.billedInputTokens,
        billedCostUSD: billing.billedCostUSD,
        segments: segments || 0,
        cacheHits: cacheHits || 0,
        timestamp: Date.now(),
        engine,
        model: model || 'unknown',
        partialFailure: true,
      });
      debugLog('warn', 'api', `${logLabel} usage logged on discard path`, {
        ...logExtra, why, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function writeBatchCache({ missingTexts, fresh, cacheKeySuffix, targetLanguage, logLabel }) {
    const cacheable = filterEchoPairsForCache(missingTexts, fresh, targetLanguage);
    if (cacheable.skipped > 0) {
      debugLog('warn', 'cache', `${logLabel} echo translations not cached`, { skipped: cacheable.skipped });
    }
    await cache.setBatch(cacheable.texts, cacheable.translations, cacheKeySuffix);
    return cacheable.texts.length;
  }

  async function runTranslatePipeline(ctx) {
    const { sender, settings, engine, modelLabel, pricing, cachedRate, translate, isWebPath, logLabel, logExtra = {} } = ctx;
    const prep = await prepareBatch(ctx);
    const { missingTexts, missingIdxs, cached, cacheHits, cacheKeySuffix, glossary, fixedGlossaryEntries, forbiddenTermsList } = prep;

    let fresh = [];
    let batchUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    let hadMismatch = false;
    if (missingTexts.length) {
      const t0 = Date.now();
      const totalChars = missingTexts.reduce((s, t) => s + (t?.length || 0), 0);
      debugLog('info', 'api', `${logLabel} translateBatch start`, { ...logExtra, texts: missingTexts.length, chars: totalChars });
      let res;
      try {
        res = await translate(missingTexts, glossary, fixedGlossaryEntries, forbiddenTermsList);
      } catch (err) {
        await logDiscardedUsage({
          sender, engine, model: modelLabel, usage: err?.usage, pricing, cachedRate,
          segments: missingTexts.length, cacheHits, why: 'translateBatch failed mid-way', logLabel,
          logExtra: { error: err?.message },
        });
        throw err;
      }
      fresh = res.translations;
      batchUsage = res.usage;
      hadMismatch = res.hadMismatch || false;

      detectForbiddenTermLeaks(fresh, missingTexts, forbiddenTermsList, {
        warn: (category, message, data) => debugLog('warn', category, message, data),
      });
      const billing = computeBilling(batchUsage, pricing, cachedRate);
      debugLog('info', 'api', `${logLabel} translateBatch done`, {
        ...logExtra,
        count: missingTexts.length,
        chars: totalChars,
        elapsed: Date.now() - t0,
        inputTokens: batchUsage.inputTokens,
        outputTokens: batchUsage.outputTokens,
        cachedTokens: batchUsage.cachedTokens || 0,
        costUSD: billing.costUSD,
        tabUrl: sender?.tab?.url,
      });
      await writeBatchCache({ missingTexts, fresh, cacheKeySuffix, targetLanguage: settings.targetLanguage, logLabel });
    }

    const billing = computeBilling(batchUsage, pricing, cachedRate);
    const logged = isWebPath
      ? await logWebBatchUsage({
        sender, engine, model: modelLabel,
        usage: batchUsage, billedInputTokens: billing.billedInputTokens, billedCostUSD: billing.billedCostUSD,
        segments: missingTexts.length, cacheHits,
      })
      : false;

    const result = cached.slice();
    missingIdxs.forEach((idx, k) => { result[idx] = fresh[k]; });
    return {
      result,
      usage: {
        inputTokens: batchUsage.inputTokens,
        outputTokens: batchUsage.outputTokens,
        cachedTokens: batchUsage.cachedTokens || 0,
        costUSD: billing.costUSD,
        billedInputTokens: billing.billedInputTokens,
        billedCostUSD: billing.billedCostUSD,
        cacheHits,
        logged,
      },
      hadMismatch,
    };
  }

  return { prepareBatch, logDiscardedUsage, writeBatchCache, runTranslatePipeline, computeBilling };
}
