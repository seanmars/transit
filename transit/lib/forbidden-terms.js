export function detectForbiddenTermLeaks(translations, originals, forbiddenTerms, logger) {
  if (!Array.isArray(forbiddenTerms) || forbiddenTerms.length === 0) return;
  if (!Array.isArray(translations) || translations.length === 0) return;
  if (!logger || typeof logger.warn !== 'function') return;

  for (let i = 0; i < translations.length; i++) {
    const tr = translations[i] || '';
    if (!tr) continue;
    const src = (Array.isArray(originals) && originals[i]) || '';
    for (const t of forbiddenTerms) {
      if (!t || !t.forbidden) continue;
      if (tr.indexOf(t.forbidden) !== -1) {
        logger.warn('forbidden-term-leak', `黑名單詞「${t.forbidden}」漏進譯文`, {
          forbidden: t.forbidden,
          replacement: t.replacement,
          sourceSnippet: src.slice(0, 120),
          translationSnippet: tr.slice(0, 120),
        });
      }
    }
  }
}
