import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DELIMITER, MARKER_COMPACT, buildEffectiveSystemInstruction } from '../../transit/lib/system-instruction.js';

const ROUNDS = Number(process.argv[2] || 3);
const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const API_KEY = fs.readFileSync(path.join(os.homedir(), '.transit-test-key'), 'utf-8').trim();

function extractPrompt(name) {
  const src = fs.readFileSync(new URL('../../transit/lib/storage.js', import.meta.url), 'utf-8');
  const anchor = `const ${name} = \``;
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`找不到 ${name}`);
  let i = start + anchor.length;
  let out = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { out += src[i + 1]; i += 2; continue; }
    if (ch === '`') break;
    out += ch; i++;
  }
  return out;
}
const BASE_SYSTEM = extractPrompt('DEFAULT_SYSTEM_PROMPT');

const TEXTS = [
  'Fair enough, that was not the fault of the remaining presenters; the real problem was the format itself. Television was flooded with a new wave of reality shows such as ⟦0⟧Changing Rooms⟦/0⟧ and ⟦1⟧Ground Force⟦/1⟧, where every presenter seemed utterly at ease, chatting and joking as if the cameras were not there.',
  'He started his career at a small magazine before moving into television production.',
];
const GLOSSARY = [
  { source: 'Changing Rooms', target: '《變換房間》（Changing Rooms）', type: 'work' },
  { source: 'Ground Force', target: '《大地之力》（Ground Force）', type: 'work' },
];

const markedTexts = TEXTS.map((t, i) => MARKER_COMPACT.fmt(i + 1) + t);
const joined = markedTexts.join(DELIMITER);
const effectiveSystem = buildEffectiveSystemInstruction(BASE_SYSTEM, TEXTS, joined, GLOSSARY, null, null);

console.log('── 注入的術語表指令段 ──');
const gIdx = effectiveSystem.indexOf('術語對照表');
console.log(effectiveSystem.slice(Math.max(0, gIdx - 40), gIdx + 220));
console.log('────────────\n');

async function callOnce(model) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: joined }] }],
    systemInstruction: { parts: [{ text: effectiveSystem }] },
    generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'minimal' } },
  };
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`${model} API ${resp.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

for (const model of MODELS) {
  let keepBoth = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const out = await callOnce(model);
    const seg1 = out.split(/<<<TRZX_SEP>>>/)[0];
    const hasCR = seg1.includes('（Changing Rooms）') || seg1.includes('(Changing Rooms)');
    const hasGF = seg1.includes('（Ground Force）') || seg1.includes('(Ground Force)');
    const leadOk = seg1.includes('《變換房間》') && seg1.includes('《大地之力》');
    const doubled = /《《|》》/.test(seg1);
    if (hasCR && hasGF) keepBoth++;
    console.log(`[${model}] round ${r + 1}: 對照保留 CR=${hasCR} GF=${hasGF} 譯名=${leadOk} 雙書名號=${doubled}`);
    console.log(`  ${seg1.replace(/\n/g, ' ').slice(0, 220)}`);
  }
  console.log(`>> ${model}: ${keepBoth}/${ROUNDS} 輪兩個對照都保留\n`);
}
