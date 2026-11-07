#!/usr/bin/env node
// 從單一來源圖產生擴充功能與網站使用的所有 icon 尺寸.
// 需要 ImageMagick 7 (`magick` 指令).
//
// 用法:
//   pnpm icons
//   pnpm icons -- --src res/logo.png --radius 0.3
//
// 參數:
//   --src <path>     來源圖 (正方形), 預設 res/logo.png
//   --radius <ratio> 圓角半徑佔邊長的比例 (0 = 不切圓角), 預設 0.3
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 輸出目標: [尺寸, 相對於 ROOT 的路徑]
const TARGETS = [
  [16, 'transit/icons/icon-16.png'],
  [32, 'transit/icons/icon-32.png'],
  [48, 'transit/icons/icon-48.png'],
  [128, 'transit/icons/icon-128.png'],
  [128, 'docs/icon-128.png'],
];

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function magick(args) {
  return execFileSync('magick', args, { encoding: 'utf8' });
}

function ensureMagick() {
  try {
    magick(['-version']);
  } catch {
    console.error('找不到 ImageMagick 的 `magick` 指令, 請先安裝 ImageMagick 7.');
    process.exit(1);
  }
}

function readSize(src) {
  const [w, h] = magick(['identify', '-format', '%w %h', src]).trim().split(' ').map(Number);
  return { w, h };
}

function main() {
  ensureMagick();

  const src = path.resolve(ROOT, argValue('--src', 'res/logo.png'));
  const radiusRatio = Number(argValue('--radius', '0.3'));

  if (!fs.existsSync(src)) {
    console.error(`來源圖不存在: ${src}`);
    process.exit(1);
  }
  if (!(radiusRatio >= 0 && radiusRatio <= 0.5)) {
    console.error(`--radius 必須介於 0 到 0.5: ${radiusRatio}`);
    process.exit(1);
  }

  const { w, h } = readSize(src);
  if (w !== h) {
    console.error(`來源圖必須是正方形, 目前是 ${w}x${h}`);
    process.exit(1);
  }

  // 在原尺寸畫圓角 mask, 套到來源圖後再縮小, 邊緣才會平滑.
  const r = Math.round(w * radiusRatio);
  const maskArgs = radiusRatio > 0
    ? [
        '(', '-size', `${w}x${h}`, 'xc:black',
        '-fill', 'white', '-draw', `roundrectangle 0,0,${w - 1},${h - 1},${r},${r}`, ')',
        '-alpha', 'off', '-compose', 'CopyOpacity', '-composite',
      ]
    : [];

  for (const [size, rel] of TARGETS) {
    const out = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    magick([
      src, '-alpha', 'off',
      ...maskArgs,
      '-filter', 'Lanczos', '-resize', `${size}x${size}`,
      '-strip', `PNG32:${out}`,
    ]);
    console.log(`  ${rel} (${size}x${size})`);
  }
  console.log(`完成: 來源 ${path.relative(ROOT, src)}, 圓角比例 ${radiusRatio}`);
}

main();
