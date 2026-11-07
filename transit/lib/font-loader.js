export const FONT_CACHE_NAME = 'sk-cjk-fonts-v1';

export const FONT_CONFIG = {
  baseUrl: 'https://seanmars.github.io/transit/fonts/',
  fonts: {
    'zh-CN': {
      regular: { file: 'NotoSansSC-Regular.ttf', bytes: 10540376, sha256: 'a0ecca1c67a4da5a89857703b84a44eba9fce7d7b5941bf4285e8c0a8346cf60' },
      bold: { file: 'NotoSansSC-Bold.ttf', bytes: 10530140, sha256: '2179d44af51b5fc3db254102bd9710fb50e1538754cd33349f1ae1056bf7f3c8' },
    },
    ja: {
      regular: { file: 'NotoSansJP-Regular.ttf', bytes: 5323876, sha256: '0eba77a9f62df60eda7b56719cf57bbfbd8434583f2a137a9b91d4d67cf420c0' },
      bold: { file: 'NotoSansJP-Bold.ttf', bytes: 5319412, sha256: '74823fedeaaa812df51a6a1ab156cdde3183f65dc924d02934238d8e553f28bc' },
    },
    ko: {
      regular: { file: 'NotoSansKR-Regular.ttf', bytes: 6162976, sha256: '65f278fc677a3a0128c733af662c3eb31b910c9bce81e046ccc3c6d3ede879e2' },
      bold: { file: 'NotoSansKR-Bold.ttf', bytes: 6158968, sha256: '45f69f3abd7e355bcd9f754261c5090ab3b7e1b526c6af60a71fe7d999b35073' },
    },
  },
};

export function remoteFontKeyFor(targetLanguage) {
  const lang = String(targetLanguage || '').trim();
  if (!lang) return null;
  if (/^zh[-_]?(cn|hans|sg)$/i.test(lang)) return 'zh-CN';
  if (/^ja/i.test(lang)) return 'ja';
  if (/^ko/i.test(lang)) return 'ko';
  return null;
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function openCache() {
  try { return await caches.open(FONT_CACHE_NAME); } catch { return null; }
}

async function loadOne(spec, { onProgress, fetchImpl, label }) {
  const url = FONT_CONFIG.baseUrl + spec.file;
  const cache = await openCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        if (buf.byteLength > 0) return { buffer: buf, fromCache: true };
      }
    } catch {   }
  }
  let res;
  try {
    res = await fetchImpl(url, { cache: 'no-store' });
  } catch (err) {
    console.warn('[Transit] 字型下載失敗（網路）：', spec.file, err && err.message);
    return null;
  }
  if (!res || !res.ok) {
    console.warn('[Transit] 字型下載失敗（HTTP）：', spec.file, res && res.status);
    return null;
  }
  let buffer;
  try {
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onProgress({ label, received, total: spec.bytes });
      }
      const out = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.byteLength; }
      buffer = out.buffer;
    } else {
      buffer = await res.arrayBuffer();
      onProgress({ label, received: buffer.byteLength, total: spec.bytes });
    }
  } catch (err) {
    console.warn('[Transit] 字型下載中斷：', spec.file, err && err.message);
    return null;
  }
  const hash = await sha256Hex(buffer);
  if (hash !== spec.sha256) {
    console.warn('[Transit] 字型檔 SHA-256 不符，丟棄：', spec.file, hash);
    return null;
  }
  if (cache) {
    try { await cache.put(url, new Response(buffer, { headers: { 'Content-Type': 'font/ttf' } })); }
    catch (err) { console.warn('[Transit] 字型寫入快取失敗（下次會重抓）：', err && err.message); }
  }
  return { buffer, fromCache: false };
}

export async function loadRemoteFontForLanguage(targetLanguage, opts = {}) {
  const key = remoteFontKeyFor(targetLanguage);
  if (!key) return null;
  const spec = FONT_CONFIG.fonts[key];
  if (!spec) return null;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const reg = await loadOne(spec.regular, { onProgress, fetchImpl, label: 'regular' });
  if (!reg) return { key, regular: null, bold: null, fromCache: false };
  const bold = await loadOne(spec.bold, { onProgress, fetchImpl, label: 'bold' });
  return { key, regular: reg.buffer, bold: bold ? bold.buffer : null, fromCache: reg.fromCache && !!(bold && bold.fromCache) };
}

export async function clearRemoteFontCache() {
  try { return await caches.delete(FONT_CACHE_NAME); } catch { return false; }
}
