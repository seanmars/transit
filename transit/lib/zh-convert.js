import { browser } from './compat.js';
import { ConverterFactory } from './vendor/opencc/opencc-core.js';

const CHAINS = {
  cn2twp: [
    ['STPhrases', 'STCharacters'],
    ['TWPhrases'],
    ['TWVariantsPhrases', 'TWVariants'],
  ],
  twp2cn: [
    ['TWPhrasesRev', 'TWVariantsRevPhrases', 'TWVariantsRev'],
    ['TSPhrases', 'TSCharacters'],
  ],
};

export const ZH_CONVERT_DIRECTIONS = Object.keys(CHAINS);

const _dictPromises = new Map();
function loadDictText(name) {
  if (!_dictPromises.has(name)) {
    const p = (async () => {
      const url = browser.runtime.getURL(`lib/vendor/opencc/dict/${name}.txt`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OpenCC 字典載入失敗:${name}（HTTP ${res.status}）`);
      return res.text();
    })();
    p.catch(() => _dictPromises.delete(name));
    _dictPromises.set(name, p);
  }
  return _dictPromises.get(name);
}

const _converterPromises = new Map();
export function getZhConverter(direction) {
  const chain = CHAINS[direction];
  if (!chain) return Promise.reject(new Error(`未知的簡繁轉換方向:${direction}`));
  if (!_converterPromises.has(direction)) {
    const p = (async () => {
      const groups = await Promise.all(chain.map((g) => Promise.all(g.map(loadDictText))));
      const converter = ConverterFactory(...groups);
      for (const g of chain) for (const name of g) _dictPromises.delete(name);
      return converter;
    })();
    p.catch(() => _converterPromises.delete(direction));
    _converterPromises.set(direction, p);
  }
  return _converterPromises.get(direction);
}

export async function convertZhBatch(texts, direction) {
  const convert = await getZhConverter(direction);
  return texts.map((t) => (typeof t === 'string' ? convert(t) : t));
}
