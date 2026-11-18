#!/usr/bin/env node
// 從 transit/lib/theme.js 產生 transit/lib/theme.css.
// --check: 只比對, 不一致時 exit 1 (由 tools/build/check.mjs 呼叫).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_PATH = path.join(ROOT, 'transit', 'lib', 'theme.js');
const OUTPUT_PATH = path.join(ROOT, 'transit', 'lib', 'theme.css');

function buildThemeCss() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(SOURCE_PATH, 'utf8'), sandbox, { filename: SOURCE_PATH });
  const header = [
    '/* ==========================================================================',
    '   Transit theme (自動產生, 勿手改)',
    '   來源: lib/theme.js. 修改後執行 `pnpm theme:css`.',
    '   ========================================================================== */',
    '',
  ].join('\n');
  return header + '\n' + sandbox.TransitTheme.css(':root');
}

const expected = buildThemeCss();
if (process.argv.includes('--check')) {
  const actual = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : '';
  if (actual !== expected) {
    console.error('lib/theme.css 與 lib/theme.js 不一致, 請執行 `pnpm theme:css`');
    process.exit(1);
  }
} else {
  fs.writeFileSync(OUTPUT_PATH, expected);
  console.log(`已產生 ${path.relative(ROOT, OUTPUT_PATH)}`);
}
