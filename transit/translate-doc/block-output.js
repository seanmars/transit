export function pickBlockOutput(b, override, { rawNeedsSlots = false } = {}) {
  if (!b) return null;
  const edited = override?.editedHtml ?? b.editedHtml;
  if (typeof edited === 'string' && edited.length > 0) return { source: 'edited', value: edited };
  const raw = override?.translationRaw ?? b.translationRaw;
  if (typeof raw === 'string' && raw.length > 0 && (!rawNeedsSlots || Array.isArray(b.slots))) {
    return { source: 'raw', value: raw };
  }
  const plain = override?.translation ?? b.translation;
  if (typeof plain === 'string' && plain.length > 0) return { source: 'plain', value: plain };
  return null;
}

export function editedHtmlToPlain(html) {
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const div = document.createElement('div');
      div.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
      return div.textContent;
    }
  } catch (_) {   }
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function sanitizeEditedHtml(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  for (const bad of container.querySelectorAll('script, style, template')) bad.remove();
  for (const el of container.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  }
  const frag = document.createDocumentFragment();
  while (container.firstChild) frag.appendChild(container.firstChild);
  return frag;
}

export function resolveBlockFragment(SK, b, override, { renderPlain } = {}) {
  const edited = override?.editedHtml ?? b?.editedHtml;
  if (typeof edited === 'string' && edited.length > 0) {
    return { frag: sanitizeEditedHtml(edited), source: 'edited' };
  }
  const raw = override?.translationRaw ?? b?.translationRaw;
  if (typeof raw === 'string' && raw.length > 0 && Array.isArray(b?.slots)
      && typeof SK?.deserializeWithPlaceholders === 'function') {
    try {
      const { frag, ok } = SK.deserializeWithPlaceholders(raw, b.slots, { cloneReuse: true });
      if (ok || (b.slots.length === 0 && frag.childNodes.length > 0)) return { frag, source: 'raw' };
    } catch (_) {   }
  }
  const plain = override?.translation ?? b?.translation;
  if (typeof plain === 'string' && plain.length > 0) {
    if (typeof renderPlain === 'function') return { frag: renderPlain(plain), source: 'plain' };
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(plain));
    return { frag, source: 'plain' };
  }
  return null;
}
