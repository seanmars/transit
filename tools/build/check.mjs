#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
if (!vm.SourceTextModule) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', SELF, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const ROOT = path.resolve(path.dirname(SELF), '..', '..');
const EXT = path.join(ROOT, 'transit');
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'test', 'test-results', 'dist']);
const failures = [];
const fail = (msg) => failures.push(msg);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...walk(path.join(dir, e.name))); }
    else out.push(path.join(dir, e.name));
  }
  return out;
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function checkSyntax() {
  const files = [...walk(EXT), ...walk(path.join(ROOT, 'tools'))]
    .filter((f) => /\.(m?js|cjs)$/.test(f));
  for (const f of ['playwright.config.js', 'jest.config.cjs']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) files.push(p);
  }
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) fail(`syntax: ${rel(f)}\n${(r.stderr || '').trim()}`);
  }
  return files.length;
}

function checkManifest(tag) {
  const manifestPath = path.join(EXT, 'manifest.json');
  let m;
  try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (e) { fail(`manifest: 無法解析 (${e.message})`); return null; }
  if (!/^\d+\.\d+\.\d+$/.test(m.version || '')) fail(`manifest: version "${m.version}" 不是 X.Y.Z 格式`);
  if (tag && tag.replace(/^v/, '') !== m.version) fail(`manifest: version ${m.version} 與 tag ${tag} 不一致`);
  const refs = [
    m.background?.service_worker,
    ...(m.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
    m.action?.default_popup,
    ...Object.values(m.action?.default_icon || {}),
    m.options_ui?.page,
    m.options_page,
    ...Object.values(m.icons || {}),
    ...(m.web_accessible_resources || []).flatMap((w) => w.resources || []),
  ].filter((r) => typeof r === 'string' && !r.includes('*'));
  for (const r of new Set(refs)) {
    if (!fs.existsSync(path.join(EXT, r))) fail(`manifest: 找不到 ${r}`);
  }
  return m;
}

function htmlFiles() {
  return walk(EXT).filter((f) => f.endsWith('.html'));
}

function checkScriptTags() {
  const entries = [];
  for (const f of htmlFiles()) {
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)\ssrc="([^"]+)"[^>]*>/g)) {
      if (/^https?:/.test(m[2])) continue;
      const target = path.resolve(path.dirname(f), m[2]);
      if (!fs.existsSync(target)) fail(`html: ${rel(f)} 引用不存在的 ${m[2]}`);
      if (/type="module"/.test(m[1])) entries.push(target);
    }
  }
  return entries;
}

async function checkModuleGraph(entries) {
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    const mod = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file });
    cache.set(file, mod);
    return mod;
  };
  const linker = (specifier, referencing) => {
    if (!specifier.startsWith('.')) throw new Error(`不支援的 import "${specifier}"`);
    const target = path.resolve(path.dirname(referencing.identifier), specifier);
    if (!fs.existsSync(target)) throw new Error(`${rel(referencing.identifier)} import 不存在的 ${specifier}`);
    return load(target);
  };
  for (const entry of entries) {
    if (!fs.existsSync(entry)) continue;
    try { await load(entry).link(linker); }
    catch (e) { fail(`module: ${rel(entry)}: ${e.message}`); }
  }
  return cache.size;
}

function checkI18nSubset() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build', 'generate-i18n-content.mjs'), '--check'], { encoding: 'utf8' });
  if (r.status !== 0) fail(`i18n: ${(r.stderr || r.stdout || '').trim()}`);
}

const tag = argValue('--tag');
const syntaxCount = checkSyntax();
const manifest = checkManifest(tag);
const entries = checkScriptTags();
if (manifest?.background?.type === 'module') entries.unshift(path.join(EXT, manifest.background.service_worker));
const moduleCount = await checkModuleGraph(entries);
checkI18nSubset();

console.log(`語法檢查 ${syntaxCount} 個檔案,module graph ${moduleCount} 個 module,manifest version ${manifest?.version ?? '?'}`);
if (failures.length) {
  console.error(`\n✗ ${failures.length} 個問題:`);
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log('✓ 全部檢查通過');
