(function (global) {
  'use strict';

  // 只有一個翻譯快速鍵; key 沿用 2 (舊版主要預設), 保留使用者已錄製的自訂鍵位
  var SLOTS = [2];

  var MANIFEST_DEFAULTS = {
    2: { code: 'KeyS', alt: true, shift: false, ctrl: false, meta: false }
  };

  var MODIFIER_CODES = {
    AltLeft: 1, AltRight: 1,
    ShiftLeft: 1, ShiftRight: 1,
    ControlLeft: 1, ControlRight: 1,
    MetaLeft: 1, MetaRight: 1,
    CapsLock: 1
  };

  var KEY_LABELS = {
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backquote: '`',
    Minus: '-', Equal: '=', Backslash: '\\',
    Space: 'Space', Enter: '↵', Tab: '⇥',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Backspace: '⌫', Delete: '⌦',
    Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn'
  };

  function keyLabel(code) {
    if (KEY_LABELS[code]) return KEY_LABELS[code];
    var m = /^Key([A-Z])$/.exec(code);
    if (m) return m[1];
    m = /^Digit(\d)$/.exec(code);
    if (m) return m[1];
    return code;
  }

  function eventToShortcut(e) {
    if (!e || !e.code || MODIFIER_CODES[e.code]) return null;
    return {
      code: e.code,
      alt: !!e.altKey,
      shift: !!e.shiftKey,
      ctrl: !!e.ctrlKey,
      meta: !!e.metaKey
    };
  }

  function matches(e, s) {
    if (!s || !s.code || !e) return false;
    return e.code === s.code &&
      !!e.altKey === !!s.alt &&
      !!e.shiftKey === !!s.shift &&
      !!e.ctrlKey === !!s.ctrl &&
      !!e.metaKey === !!s.meta;
  }

  function shortcutEquals(a, b) {
    if (!a || !b) return false;
    return a.code === b.code &&
      !!a.alt === !!b.alt &&
      !!a.shift === !!b.shift &&
      !!a.ctrl === !!b.ctrl &&
      !!a.meta === !!b.meta;
  }

  function format(s) {
    if (!s || !s.code) return '';
    var out = '';
    if (s.ctrl) out += '⌃';
    if (s.alt) out += '⌥';
    if (s.shift) out += '⇧';
    if (s.meta) out += '⌘';
    return out + keyLabel(s.code);
  }

  function macifyCommandShortcut(str, isMac) {
    if (!str || typeof str !== 'string') return str || '';
    if (!isMac) return str;
    return str
      .replace(/\bCommand\b|\bCmd\b|\bMeta\b/gi, '⌘')
      .replace(/\bControl\b|\bCtrl\b/gi, '⌃')
      .replace(/\bOption\b|\bAlt\b/gi, '⌥')
      .replace(/\bShift\b/gi, '⇧')
      .replace(/\s*\+\s*/g, '');
  }

  function validate(s) {
    if (!s || !s.code) return { ok: false, reason: 'shortcut.invalid.needKey' };
    if (s.code === 'Escape') return { ok: false, reason: 'shortcut.invalid.esc' };
    if (!s.alt && !s.ctrl && !s.meta) return { ok: false, reason: 'shortcut.invalid.needMod' };
    for (var i = 0; i < SLOTS.length; i++) {
      var def = MANIFEST_DEFAULTS[SLOTS[i]];
      if (def && shortcutEquals(s, def)) {
        return { ok: false, reason: 'shortcut.invalid.isDefault', detail: format(def) };
      }
    }
    return { ok: true };
  }

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.code !== 'string' || !raw.code) return null;
    return {
      code: raw.code,
      alt: !!raw.alt,
      shift: !!raw.shift,
      ctrl: !!raw.ctrl,
      meta: !!raw.meta
    };
  }

  function sanitizeTable(raw) {
    var table = {};
    for (var i = 0; i < SLOTS.length; i++) {
      var slot = SLOTS[i];
      table[slot] = raw && typeof raw === 'object' ? sanitize(raw[slot]) : null;
    }
    return table;
  }

  var api = {
    SLOTS: SLOTS,
    MANIFEST_DEFAULTS: MANIFEST_DEFAULTS,
    keyLabel: keyLabel,
    eventToShortcut: eventToShortcut,
    matches: matches,
    shortcutEquals: shortcutEquals,
    format: format,
    macifyCommandShortcut: macifyCommandShortcut,
    validate: validate,
    sanitize: sanitize,
    sanitizeTable: sanitizeTable
  };
  if (typeof window !== 'undefined') window.__SKShortcuts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
