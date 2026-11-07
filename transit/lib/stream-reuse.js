export function planStreamingPartialReuse(cached, texts) {
  const missingIdxs = [];
  const missingTexts = [];
  const cachedSegments = [];
  for (let i = 0; i < texts.length; i++) {
    if (cached[i] == null) {
      missingIdxs.push(i);
      missingTexts.push(texts[i]);
    } else {
      cachedSegments.push({ idx: i, translation: cached[i] });
    }
  }
  return { missingIdxs, missingTexts, cachedSegments };
}
