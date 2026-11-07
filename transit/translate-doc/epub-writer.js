import { resolveBlockFragment } from './block-output.js';

const XML_SER = new XMLSerializer();
const XML_DECL = '<?xml version="1.0" encoding="utf-8"?>\n';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

function getSK() {
  const SK = window.__SK;
  if (!SK || typeof SK.deserializeWithPlaceholders !== 'function') {
    throw new Error('serializer not loaded');
  }
  return SK;
}

export function applyBlockTranslation(SK, xhtmlDoc, block, override, bilingual = false) {
  const el = block.el;
  if (!el) {
    if (block.fragStart) return applyFragmentTranslation(SK, xhtmlDoc, block, override, bilingual);
    return false;
  }
  if (!block._srcChildNodes) {
    block._srcChildNodes = [...el.childNodes].map((n) => n.cloneNode(true));
  } else {
    el.replaceChildren(...block._srcChildNodes.map((n) => n.cloneNode(true)));
  }
  const content = resolveBlockContent(SK, xhtmlDoc, block, override);
  if (!content) return false;
  if (bilingual) return insertDualTranslation(xhtmlDoc, el, content);
  el.replaceChildren(content);
  return true;
}

function resolveBlockContent(SK, xhtmlDoc, block, override) {
  const picked = resolveBlockFragment(SK, block, override);
  return picked ? xhtmlDoc.importNode(picked.frag, true) : null;
}

function applyFragmentTranslation(SK, xhtmlDoc, block, override, bilingual) {
  if (!block._srcFragNodes) {
    const nodes = [];
    let cur = block.fragStart;
    while (cur) {
      nodes.push(cur);
      if (cur === block.fragEnd) break;
      cur = cur.nextSibling;
    }
    const parent = block.fragStart.parentNode;
    if (!parent) return false;
    block._fragParent = parent;
    block._fragNext = block.fragEnd.nextSibling;
    block._srcFragNodes = nodes.map((n) => n.cloneNode(true));
    block._placedNodes = nodes;
  }
  const parent = block._fragParent;
  for (const n of block._placedNodes) {
    if (n.parentNode) n.parentNode.removeChild(n);
  }
  const next = (block._fragNext && block._fragNext.parentNode === parent) ? block._fragNext : null;
  const insert = (node) => parent.insertBefore(node, next);
  const srcClones = block._srcFragNodes.map((n) => n.cloneNode(true));

  const content = resolveBlockContent(SK, xhtmlDoc, block, override);
  if (!content) {
    for (const n of srcClones) insert(n);
    block._placedNodes = srcClones;
    return false;
  }
  if (bilingual) {
    for (const n of srcClones) insert(n);
    const holder = xhtmlDoc.createElementNS(XHTML_NS, 'span');
    holder.setAttribute('class', 'sk-dual-tr');
    holder.appendChild(content);
    for (const n of [...holder.querySelectorAll('[id]')]) n.removeAttribute('id');
    insert(holder);
    block._placedNodes = [...srcClones, holder];
    return true;
  }
  const placed = content.nodeType === 11 ? [...content.childNodes] : [content];
  insert(content);
  block._placedNodes = placed;
  return true;
}

const DUAL_INNER_TAGS = new Set(['li', 'td', 'th', 'dd', 'dt', 'caption', 'figcaption']);
const DUAL_STYLE_ID = 'sk-dual-style';
const DUAL_CSS = '\n.sk-dual-src { font-size: 0.9em; opacity: 0.72; }\nspan.sk-dual-tr { display: block; margin-top: 0.2em; }\n';

export function insertDualTranslation(xhtmlDoc, el, content) {
  const tag = (el.localName || '').toLowerCase();
  const inner = DUAL_INNER_TAGS.has(tag);
  const holder = xhtmlDoc.createElementNS(XHTML_NS, inner ? 'span' : (tag || 'div'));
  holder.setAttribute('class', 'sk-dual-tr');
  holder.appendChild(content);
  for (const n of [...holder.querySelectorAll('[id]')]) n.removeAttribute('id');
  const cls = el.getAttribute('class');
  if (!(cls || '').split(/\s+/).includes('sk-dual-src')) {
    el.setAttribute('class', cls ? `${cls} sk-dual-src` : 'sk-dual-src');
  }
  if (inner) {
    el.appendChild(holder);
  } else if (el.parentNode) {
    el.parentNode.insertBefore(holder, el.nextSibling);
  } else {
    return false;
  }
  return true;
}

function removeDualArtifacts(xhtmlDoc) {
  for (const n of [...xhtmlDoc.querySelectorAll('.sk-dual-tr')]) n.remove();
  for (const n of [...xhtmlDoc.querySelectorAll('.sk-dual-src')]) {
    const rest = (n.getAttribute('class') || '')
      .split(/\s+/).filter((c) => c && c !== 'sk-dual-src').join(' ');
    if (rest) n.setAttribute('class', rest);
    else n.removeAttribute('class');
  }
}

function applyDualStyle(xhtmlDoc, enabled) {
  const existing = xhtmlDoc.getElementById ? xhtmlDoc.getElementById(DUAL_STYLE_ID) : null;
  if (existing) existing.remove();
  if (!enabled) return;
  const head = xhtmlDoc.getElementsByTagNameNS('*', 'head')[0];
  if (!head) return;
  const style = xhtmlDoc.createElementNS(XHTML_NS, 'style');
  style.setAttribute('id', DUAL_STYLE_ID);
  style.setAttribute('type', 'text/css');
  style.textContent = DUAL_CSS;
  head.appendChild(style);
}

const ANNOTATED_RE = /^(.+)（(.+)）\s*$/;

const CJK_EDGE_RE = /[㐀-鿿豈-﫿]/;
const LATIN_EDGE_RE = /[A-Za-z0-9]/;

function spliceWithCjkSpacing(text, start, end, keep) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  let mid = keep;
  if (before && CJK_EDGE_RE.test(before[before.length - 1]) && LATIN_EDGE_RE.test(mid[0] || '')) {
    mid = ' ' + mid;
  }
  if (after && LATIN_EDGE_RE.test(mid[mid.length - 1] || '') && CJK_EDGE_RE.test(after[0])) {
    mid = mid + ' ';
  }
  return { text: before + mid + after, nextFrom: before.length + mid.length };
}

function replaceOccurrences(text, full, keep, skipFirst) {
  if (!text || !text.includes(full)) return { text, changed: false, sawAny: false };
  let out = text;
  let from = 0;
  let first = true;
  let changed = false;
  while (true) {
    const idx = out.indexOf(full, from);
    if (idx === -1) break;
    if (skipFirst && first) {
      first = false;
      from = idx + full.length;
      continue;
    }
    const spliced = spliceWithCjkSpacing(out, idx, idx + full.length, keep);
    out = spliced.text;
    changed = true;
    from = spliced.nextFrom;
  }
  return { text: out, changed, sawAny: true };
}

export function computeAnnotationDedupe(epubDoc, glossary) {
  const out = new Map();
  const rules = [];
  for (const e of glossary || []) {
    if (!e || e.dedupeAnnotation !== true || typeof e.target !== 'string') continue;
    const m = e.target.match(ANNOTATED_RE);
    if (!m) continue;
    const stripTitle = (s) => {
      const t = s.trim();
      const tw = t.match(/^《(.+)》$/);
      return tw ? tw[1].trim() : t;
    };
    const src = typeof e.source === 'string' ? stripTitle(e.source) : '';
    let sourceTok = m[2];
    let targetTok = m[1];
    if (src && stripTitle(m[1]) === src) { sourceTok = m[1]; targetTok = m[2]; }
    else if (src && stripTitle(m[2]) === src) { sourceTok = m[2]; targetTok = m[1]; }
    rules.push({ full: e.target, keep: e.dedupeKeep === 'target' ? targetTok : sourceTok, seen: false });
  }
  if (rules.length === 0) return out;

  for (const ch of epubDoc.chapters) {
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'done') continue;
      if (typeof b.editedHtml === 'string' && b.editedHtml.length > 0) {
        const div = document.createElement('div');
        div.innerHTML = b.editedHtml;
        let editedChanged = false;
        const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (!node.nodeValue) continue;
          for (const rule of rules) {
            const rt = replaceOccurrences(node.nodeValue, rule.full, rule.keep, !rule.seen);
            if (rt.sawAny) rule.seen = true;
            if (rt.changed) {
              node.nodeValue = rt.text;
              editedChanged = true;
            }
          }
        }
        if (editedChanged) out.set(b.blockId, { editedHtml: div.innerHTML });
        continue;
      }
      let t = b.translation || '';
      let raw = b.translationRaw || '';
      let changed = false;
      for (const rule of rules) {
        const seenBefore = rule.seen;
        const rt = replaceOccurrences(t, rule.full, rule.keep, !seenBefore);
        t = rt.text;
        if (rt.sawAny) rule.seen = true;
        if (rt.changed) changed = true;
        if (raw) {
          const rr = replaceOccurrences(raw, rule.full, rule.keep, !seenBefore);
          if (rr.changed) { raw = rr.text; changed = true; }
        }
      }
      if (changed) out.set(b.blockId, { translation: t, translationRaw: raw });
    }
  }
  return out;
}

const SPACING_STYLE_ID = 'sk-paragraph-spacing';
const SPACING_CSS = '\np { margin-top: 0.5em !important; }\n';

function applyParagraphSpacing(xhtmlDoc, enabled) {
  const existing = xhtmlDoc.getElementById
    ? xhtmlDoc.getElementById(SPACING_STYLE_ID)
    : null;
  if (existing) existing.remove();
  if (!enabled) return;
  const head = xhtmlDoc.getElementsByTagNameNS('*', 'head')[0];
  if (!head) return;
  const style = xhtmlDoc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
  style.setAttribute('id', SPACING_STYLE_ID);
  style.setAttribute('type', 'text/css');
  style.textContent = SPACING_CSS;
  head.appendChild(style);
}

function updateChapterLang(xhtmlDoc, targetLanguage) {
  const html = xhtmlDoc.documentElement;
  if (!html || !targetLanguage) return;
  html.setAttribute('lang', targetLanguage);
  html.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', targetLanguage);
}

function serializeChapter(ch) {
  let out = XML_SER.serializeToString(ch.xhtmlDoc);
  if (ch.hadXmlDeclaration && !/^\s*<\?xml/i.test(out)) out = XML_DECL + out;
  return out;
}

function buildUpdatedOpf(opfText, targetLanguage, { upgradeTo3 = false, navFilename = null } = {}) {
  const doc = new DOMParser().parseFromString(opfText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  const OPF_NS = 'http://www.idpf.org/2007/opf';

  if (targetLanguage) {
    const langEls = doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'language');
    if (langEls.length > 0) {
      langEls[0].textContent = targetLanguage;
      for (let i = langEls.length - 1; i >= 1; i--) langEls[i].remove();
    } else {
      const metadata = doc.getElementsByTagNameNS('*', 'metadata')[0];
      if (metadata) {
        const el = doc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:language');
        el.textContent = targetLanguage;
        metadata.appendChild(el);
      }
    }
  }

  if (upgradeTo3) {
    doc.documentElement.setAttribute('version', '3.0');
    const metadata = doc.getElementsByTagNameNS('*', 'metadata')[0];
    if (metadata) {
      let modified = null;
      for (const m of metadata.getElementsByTagNameNS('*', 'meta')) {
        if (m.getAttribute('property') === 'dcterms:modified') { modified = m; break; }
      }
      if (!modified) {
        modified = doc.createElementNS(OPF_NS, 'meta');
        modified.setAttribute('property', 'dcterms:modified');
        metadata.appendChild(modified);
      }
      modified.textContent = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    if (navFilename) {
      const manifest = doc.getElementsByTagNameNS('*', 'manifest')[0];
      if (manifest) {
        const item = doc.createElementNS(OPF_NS, 'item');
        item.setAttribute('id', 'sk-nav');
        item.setAttribute('href', navFilename);
        item.setAttribute('media-type', 'application/xhtml+xml');
        item.setAttribute('properties', 'nav');
        manifest.appendChild(item);
      }
    }
  }

  let out = XML_SER.serializeToString(doc);
  if (/^\s*<\?xml/i.test(opfText) && !/^\s*<\?xml/i.test(out)) out = XML_DECL + out;
  return out;
}

function opfHasNavItem(opfText) {
  const doc = new DOMParser().parseFromString(opfText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return false;
  for (const item of doc.getElementsByTagNameNS('*', 'item')) {
    if ((item.getAttribute('properties') || '').split(/\s+/).includes('nav')) return true;
  }
  return false;
}

function hrefRelativeToOpfDir(fullPath, opfDir) {
  if (!opfDir) return fullPath;
  if (fullPath.startsWith(opfDir + '/')) return fullPath.slice(opfDir.length + 1);
  const ups = opfDir.split('/').filter(Boolean).map(() => '..').join('/');
  return ups + '/' + fullPath;
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildNavDoc(epubDoc, targetLanguage) {
  const items = epubDoc.chapters
    .filter((c) => c.title)
    .map((c) => `      <li><a href="${escapeXml(hrefRelativeToOpfDir(c.href, epubDoc.opf.dir))}">${escapeXml(c.title)}</a></li>`)
    .join('\n');
  const lang = escapeXml(targetLanguage || epubDoc.meta.language || 'en');
  return `${XML_DECL}<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head><title>${escapeXml(epubDoc.meta.title)}</title></head>
<body>
  <nav epub:type="toc">
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>`;
}

export function buildTranslatedEpub(epubDoc, targetLanguage, opts = {}) {
  const SK = getSK();
  const { strToU8, zipSync } = window.fflate;
  const { upgradeTo3 = false, glossary = null, paragraphSpacing = false, bilingual = false } = opts;

  const dedupe = computeAnnotationDedupe(epubDoc, glossary);

  const modified = new Map();
  let translatedChapters = 0;
  let appliedBlocks = 0;
  for (const ch of epubDoc.chapters) {
    if (!ch.xhtmlDoc || ch.parseFailed) continue;
    removeDualArtifacts(ch.xhtmlDoc);
    let chApplied = 0;
    for (const b of ch.blocks) {
      if (b.translationStatus !== 'done') continue;
      if (applyBlockTranslation(SK, ch.xhtmlDoc, b, dedupe.get(b.blockId), bilingual)) chApplied++;
    }
    if (chApplied > 0) {
      updateChapterLang(ch.xhtmlDoc, targetLanguage);
      applyParagraphSpacing(ch.xhtmlDoc, paragraphSpacing);
      applyDualStyle(ch.xhtmlDoc, bilingual);
      modified.set(ch.href, serializeChapter(ch));
      translatedChapters++;
      appliedBlocks += chApplied;
    }
  }

  let navFilename = null;
  let navPath = null;
  if (upgradeTo3 && !opfHasNavItem(epubDoc.opf.text)) {
    navFilename = 'sk-nav.xhtml';
    navPath = epubDoc.opf.dir ? `${epubDoc.opf.dir}/${navFilename}` : navFilename;
    while (epubDoc.zip.entries[navPath]) {
      navFilename = 'sk-' + navFilename;
      navPath = epubDoc.opf.dir ? `${epubDoc.opf.dir}/${navFilename}` : navFilename;
    }
    modified.set(navPath, buildNavDoc(epubDoc, targetLanguage));
  }

  const updatedOpf = buildUpdatedOpf(epubDoc.opf.text, targetLanguage, { upgradeTo3, navFilename });
  if (updatedOpf) modified.set(epubDoc.opf.path, updatedOpf);

  const entries = epubDoc.zip.entries;
  const zipInput = {};
  const mimetypeU8 = entries['mimetype'] || strToU8('application/epub+zip');
  zipInput['mimetype'] = [mimetypeU8, { level: 0 }];
  for (const path of Object.keys(entries)) {
    if (path === 'mimetype') continue;
    if (path.endsWith('/')) continue;
    const u8 = modified.has(path) ? strToU8(modified.get(path)) : entries[path];
    zipInput[path] = isPrecompressedMediaPath(path) ? [u8, { level: 0 }] : u8;
  }
  if (navPath && !zipInput[navPath]) zipInput[navPath] = strToU8(modified.get(navPath));
  const bytes = zipSync(zipInput, { level: 6 });
  return { bytes, translatedChapters, appliedBlocks };
}

const PRECOMPRESSED_MEDIA_RE = /\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|ico|ttf|otf|woff2?|eot|mp3|m4a|aac|ogg|oga|wav|mp4|m4v|webm|ogv|zip|jar|gz|br|pdf)$/i;
export function isPrecompressedMediaPath(path) {
  return PRECOMPRESSED_MEDIA_RE.test(String(path || ''));
}

export function translatedEpubFilename(originalName, { bilingual = false } = {}) {
  const base = (originalName || 'book').replace(/\.epub$/i, '');
  return base + (bilingual ? '-transit-dual.epub' : '-transit.epub');
}
