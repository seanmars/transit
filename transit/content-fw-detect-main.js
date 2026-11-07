(() => {
  const cache = new WeakMap();

  function detect(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return 'none';
    if (cache.has(el)) return cache.get(el);
    let result = 'none';
    for (const k in el) {
      if (k.charCodeAt(0) !== 95  ) continue;
      if (k.startsWith('__reactFiber$') || k.startsWith('__reactProps$')) {
        result = 'react';
        break;
      }
    }
    if (result === 'none' && (el.__vue_app__ || el.__vueParentComponent || el.__vue__)) {
      result = 'vue';
    }
    if (result !== 'none') cache.set(el, result);
    return result;
  }

  window.addEventListener('transit-fw-detect-request', (e) => {
    const el = e.target;
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    const result = detect(el);
    el.dispatchEvent(new CustomEvent('transit-fw-detect-response', {
      detail: { result },
      bubbles: false,
    }));
  }, true  );
})();
