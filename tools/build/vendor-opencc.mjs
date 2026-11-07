#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'transit', 'lib', 'vendor', 'opencc', 'dict');

const DICTS = [
  'STPhrases', 'STCharacters',
  'TWPhrases', 'TWVariantsPhrases', 'TWVariants',
  'TWPhrasesRev', 'TWVariantsRevPhrases', 'TWVariantsRev',
  'TSPhrases', 'TSCharacters',
];

const pkgDir = process.argv[2];
if (!pkgDir) {
  console.error('用法:node tools/build/vendor-opencc.mjs <path-to-extracted-opencc-js-package>');
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
for (const name of DICTS) {
  const modPath = pathToFileURL(resolve(pkgDir, 'dist', 'esm-lib', 'dict', `${name}.js`)).href;
  const { default: data } = await import(modPath);
  if (typeof data !== 'string' || !data.includes('|')) {
    throw new Error(`${name}: 非預期的字典格式`);
  }
  await writeFile(join(OUT_DIR, `${name}.txt`), data, 'utf8');
  console.log(`${name}.txt  ${(data.length / 1024).toFixed(1)}K`);
}
console.log(`完成 → ${OUT_DIR}`);
