(function (SK) {
  'use strict';
  if (!SK) return;
  const SC = window.__SKShortcuts;
  if (!SC) return;
  if (SK.customShortcuts) return;

  let table = null;

  function loadTable() {
    if (!browser || !browser.storage || !browser.storage.sync) return;
    try {
      browser.storage.sync.get({ customShortcuts: {} }).then((values) => {
        table = SC.sanitizeTable(values && values.customShortcuts);
      }).catch(() => {   });
    } catch (_) {   }
  }

  if (browser.storage && browser.storage.onChanged) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !('customShortcuts' in changes)) return;
      table = SC.sanitizeTable(changes.customShortcuts.newValue);
    });
  }

  function onKeyDown(e) {
    if (!table) return;
    if (e.repeat) return;
    if ((e.isComposing || e.keyCode === 229) && !e.altKey && !e.ctrlKey) return;
    for (const slot of SC.SLOTS) {
      const s = table[slot];
      if (s && SC.matches(e, s)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typeof SK.handleTranslate === 'function') {
          SK.sendLog && SK.sendLog('info', 'system', 'custom shortcut matched', { slot });
          SK.handleTranslate();
        }
        return;
      }
    }
  }
  window.addEventListener('keydown', onKeyDown, true);

  SK.customShortcuts = { installed: true };
  loadTable();
})(window.__SK);
