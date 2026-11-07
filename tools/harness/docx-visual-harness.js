import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const WORD_TMP = path.join(os.homedir(),
  'Library/Containers/com.microsoft.Word/Data/tmp/TemporaryItems');
const TIMEOUT_MS = Number(process.env.WORD_TIMEOUT_MS || 60_000);

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
let OUT_DIR = null;
const inputs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') { OUT_DIR = argv[++i]; continue; }
  if (argv[i] === '--force') continue;
  inputs.push(argv[i]);
}
if (!OUT_DIR || inputs.length === 0) {
  console.error('用法：node tools/harness/docx-visual-harness.js <docx 檔或目錄...> --out <輸出目錄>');
  process.exit(1);
}
OUT_DIR = path.resolve(ROOT, OUT_DIR);
fs.mkdirSync(OUT_DIR, { recursive: true });

const files = inputs.flatMap((p) => {
  const abs = path.resolve(ROOT, p);
  if (!fs.existsSync(abs)) { console.error('找不到：', abs); process.exit(1); }
  if (fs.statSync(abs).isDirectory()) {
    return fs.readdirSync(abs).filter((f) => /\.docx$/i.test(f) && !f.startsWith('~$'))
      .sort().map((f) => path.join(abs, f));
  }
  return [abs];
});

const SCRIPT = path.join(os.tmpdir(), `sk-docx-w2pdf-${process.pid}.applescript`);
fs.writeFileSync(SCRIPT, `on run argv
	set inPosix to item 1 of argv
	set outPosix to item 2 of argv
	set outHFS to (POSIX file outPosix) as string
	tell application "Microsoft Word"
		set display alerts to none
		open POSIX file inPosix
		set theDoc to active document
		save as theDoc file format format PDF file name outHFS
		close theDoc saving no
	end tell
	return outPosix
end run
`);
const CLEANUP = path.join(os.tmpdir(), `sk-docx-cleanup-${process.pid}.applescript`);
fs.writeFileSync(CLEANUP, `tell application "Microsoft Word"
	set display alerts to none
	repeat while (count of documents) > 0
		close document 1 saving no
	end repeat
end tell
`);

function cleanup() {
  try {
    execFileSync('osascript', [CLEANUP], { timeout: 20_000, stdio: 'pipe' });
  } catch (err) {
    console.log('  [cleanup 失敗]', String(err.stderr || err.message).trim().slice(0, 160));
  }
}

const report = [];
let ok = 0;
let fail = 0;
let skipped = 0;
const t0all = Date.now();

for (const file of files) {
  const name = path.basename(file);
  const leaf = `${name.replace(/\.docx$/i, '')}.pdf`;
  const dest = path.join(OUT_DIR, leaf);
  if (!FORCE && fs.existsSync(dest)) {
    skipped++;
    console.log(`SKIP   ${name}`);
    continue;
  }
  const tmpIn = path.join(WORD_TMP, name);
  const tmpOut = path.join(WORD_TMP, leaf);
  try { fs.rmSync(tmpOut, { force: true }); } catch {   }
  fs.mkdirSync(WORD_TMP, { recursive: true });
  fs.copyFileSync(file, tmpIn);

  const t0 = Date.now();
  let status;
  let detail = '';
  try {
    execFileSync('osascript', [SCRIPT, tmpIn, tmpOut], {
      timeout: TIMEOUT_MS, killSignal: 'SIGKILL', stdio: 'pipe',
    });
    if (fs.existsSync(tmpOut)) {
      fs.renameSync(tmpOut, dest);
      status = 'OK';
      detail = `${Math.round(fs.statSync(dest).size / 1024)}KB`;
      ok++;
    } else {
      status = 'FAIL';
      detail = 'osascript 沒報錯但 PDF 沒產出';
      fail++;
      cleanup();
    }
  } catch (err) {
    status = 'FAIL';
    detail = err.killed || err.signal
      ? `TIMEOUT(${TIMEOUT_MS / 1000}s，可能卡 dialog）`
      : String(err.stderr || err.message).trim().replace(/\s+/g, ' ').slice(0, 200);
    fail++;
    cleanup();
  }
  try { fs.rmSync(tmpIn, { force: true }); } catch {   }
  const ms = Date.now() - t0;
  report.push({ file: name, status, ms, detail });
  console.log(`${status.padEnd(6)} ${String(ms).padStart(6)}ms  ${name}  ${detail}`);
}

cleanup();
const reportPath = path.join(OUT_DIR, 'docx-visual-report.json');
let prev = [];
if (fs.existsSync(reportPath)) {
  try { prev = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); } catch { prev = []; }
}
const merged = [...prev.filter((r) => !report.some((n) => n.file === r.file)), ...report];
fs.writeFileSync(reportPath, JSON.stringify(merged, null, 2));
console.log(`\n=== Word→PDF: OK=${ok} FAIL=${fail} SKIP=${skipped} / ${files.length}`
  + `（${Math.round((Date.now() - t0all) / 1000)}s） ===`);
if (fail) {
  console.log('失敗清單：');
  for (const r of report.filter((x) => x.status === 'FAIL')) console.log('  ', r.file, '—', r.detail);
}
console.log('report:', reportPath);
process.exit(fail > 0 ? 1 : 0);
