/* ==========================================================================
   Transit theme: 所有介面顏色的單一來源.
   - 深色: Dracula, 淺色: Alucard (Dracula 官方淺色版).
   - 使用者在設定頁選「跟隨系統 / 淺色 / 深色」(storage.sync 的 themeMode);
     元素上的 data-theme 屬性表示指定的主題, 沒有屬性時依系統 prefers-color-scheme.
   - 擴充功能頁面讀 lib/theme.css (由 tools/build/generate-theme-css.mjs 從本檔產生, 勿手改).
   - Content script 的 shadow DOM 元件 (toast, 浮動按鈕, 編輯工具列) 用 TransitTheme.css(':host'),
     並以 TransitTheme.bind(host) 套用使用者選的主題 (設定頁「介面主題」).
   要換色或新增 token 時只改本檔, 再跑 `pnpm theme:css`.
   ========================================================================== */
(function (global) {
  'use strict';

  // 官方色票: https://spec.draculatheme.com/ , https://github.com/dracula/dracula-theme
  const DRACULA = {
    background: '#282A36', currentLine: '#44475A', foreground: '#F8F8F2', comment: '#6272A4',
    red: '#FF5555', orange: '#FFB86C', yellow: '#F1FA8C', green: '#50FA7B',
    cyan: '#8BE9FD', purple: '#BD93F9', pink: '#FF79C6',
    // 背景深淺階 (Dracula 官方 AnsiBlack 與常見的延伸階)
    bgDarker: '#191A21', bgDark: '#21222C', bgLight: '#343746', bgLighter: '#424450',
  };
  const ALUCARD = {
    background: '#FFFBEB', currentLine: '#6C664B', foreground: '#1F1F1F', comment: '#6C664B',
    red: '#CB3A2A', orange: '#A34D14', yellow: '#846E15', green: '#14710A',
    cyan: '#036A96', purple: '#644AC9', pink: '#A3144D',
    // 背景深淺階 (依 Alucard 背景色延伸)
    bgDarker: '#EBE4CB', bgDark: '#F4EFD9', bgLight: '#F8F3DF', bgLighter: '#EEE8D1',
  };

  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`;
  }

  function hues(p) {
    return {
      'hue-red': p.red, 'hue-orange': p.orange, 'hue-yellow': p.yellow, 'hue-green': p.green,
      'hue-cyan': p.cyan, 'hue-purple': p.purple, 'hue-pink': p.pink, 'hue-comment': p.comment,
    };
  }

  const p = DRACULA;
  const dark = {
    // 中性色
    'bg': p.bgDark,
    'surface': p.background,
    'surface-2': p.bgLight,
    'surface-3': p.bgLighter,
    'ink': p.foreground,
    'ink-2': '#DCDCE4',
    'muted': '#A6ADCE',
    'faint': '#7F8BB5',
    'line': p.currentLine,
    'line-strong': p.comment,
    'line-hover': '#8592C0',
    // 品牌色
    'accent': p.purple,
    'accent-hover': '#CDABFA',
    'accent-soft': alpha(p.purple, 0.14),
    'accent-line': alpha(p.purple, 0.45),
    'accent-ring': alpha(p.purple, 0.35),
    'on-accent': p.background,
    // 狀態色
    'ok': p.green, 'ok-bg': alpha(p.green, 0.12), 'ok-line': alpha(p.green, 0.4),
    'warn': p.orange, 'warn-bg': alpha(p.orange, 0.12), 'warn-line': alpha(p.orange, 0.4),
    'danger': p.red, 'danger-bg': alpha(p.red, 0.12), 'danger-line': alpha(p.red, 0.4),
    // 側欄 / popup header
    'side-bg': p.bgDarker,
    'side-ink': p.foreground,
    'side-text': '#C9CCDC',
    'side-muted': '#8E97BE',
    'side-hover': alpha(p.foreground, 0.05),
    'side-active': alpha(p.purple, 0.16),
    'side-accent': p.pink,
    'side-line': alpha(p.foreground, 0.08),
    // 浮在內容上方的深色條 (儲存提示, 編輯工具列)
    'float-bg': p.currentLine,
    'float-ink': p.foreground,
    'float-muted': '#C9CCDC',
    // 其他
    'paper': '#FFFFFF', // 文件頁面 (PDF 渲染) 的紙張底色, 深淺色都維持白色
    'toggle-knob': p.foreground,
    'toggle-off-hover': p.comment,
    'highlight': alpha(p.yellow, 0.35),
    'backdrop': 'rgb(0 0 0 / 0.55)',
    'shadow-rgb': '0 0 0',
    'chart-1': p.purple, 'chart-1-fill': alpha(p.purple, 0.12),
    'chart-2': p.green, 'chart-2-fill': alpha(p.green, 0.1),
    ...hues(p),
  };

  const q = ALUCARD;
  const light = {
    'bg': q.bgDark,
    'surface': q.background,
    'surface-2': q.bgLight,
    'surface-3': q.bgLighter,
    'ink': q.foreground,
    'ink-2': '#3B3A36',
    'muted': q.comment,
    'faint': '#958E72',
    'line': '#E3DCC2',
    'line-strong': '#CFC7AA',
    'line-hover': '#B5AD8E',
    'accent': q.purple,
    'accent-hover': '#5338B5',
    'accent-soft': alpha(q.purple, 0.1),
    'accent-line': alpha(q.purple, 0.35),
    'accent-ring': alpha(q.purple, 0.25),
    'on-accent': q.background,
    'ok': q.green, 'ok-bg': alpha(q.green, 0.08), 'ok-line': alpha(q.green, 0.35),
    'warn': q.orange, 'warn-bg': alpha(q.orange, 0.08), 'warn-line': alpha(q.orange, 0.35),
    'danger': q.red, 'danger-bg': alpha(q.red, 0.08), 'danger-line': alpha(q.red, 0.35),
    'side-bg': q.bgDarker,
    'side-ink': q.foreground,
    'side-text': '#3B3A36',
    'side-muted': q.comment,
    'side-hover': alpha(q.foreground, 0.05),
    'side-active': alpha(q.purple, 0.12),
    'side-accent': q.pink,
    'side-line': alpha(q.foreground, 0.1),
    'float-bg': q.foreground,
    'float-ink': q.background,
    'float-muted': '#CFC7AA',
    'paper': '#FFFFFF',
    'toggle-knob': '#FFFFFF',
    'toggle-off-hover': '#B5AD8E',
    'highlight': alpha(q.yellow, 0.28),
    'backdrop': 'rgb(31 31 31 / 0.4)',
    'shadow-rgb': '60 52 30',
    'chart-1': q.purple, 'chart-1-fill': alpha(q.purple, 0.1),
    'chart-2': q.green, 'chart-2-fill': alpha(q.green, 0.08),
    ...hues(q),
  };

  function block(selector, scheme, tokens) {
    const lines = Object.entries(tokens).map(([k, v]) => `  --${k}: ${v};`);
    return `${selector} {\n  color-scheme: ${scheme};\n${lines.join('\n')}\n}`;
  }

  // 產生完整 theme CSS. scope 是 ':root' (頁面) 或 ':host' (shadow DOM 元件).
  // data-theme="light" / "dark" 是使用者指定; 沒有 data-theme 時跟隨系統.
  function css(scope) {
    const withAttr = (attr) => (scope === ':host' ? `:host(${attr})` : `${scope}${attr}`);
    const systemLight = block(withAttr(':not([data-theme])'), 'light', light).replace(/^/gm, '  ');
    return [
      block(scope, 'dark', dark),
      block(withAttr('[data-theme="light"]'), 'light', light),
      `@media (prefers-color-scheme: light) {\n${systemLight}\n}`,
    ].join('\n\n') + '\n';
  }

  // ---- 使用者設定: themeMode = 'system' | 'light' | 'dark' (storage.sync) ----
  const MODES = ['system', 'light', 'dark'];
  const STORAGE_KEY = 'themeMode';
  // 擴充功能頁面用 localStorage 快取, 讓頁面在第一次繪製前就套用正確主題, 避免閃一下.
  // Content script 的 localStorage 屬於網頁本身, 不能寫入.
  const CACHE_KEY = 'transit-theme-mode';
  const isExtensionPage = typeof location !== 'undefined' && location.protocol === 'chrome-extension:';

  function normalize(mode) {
    return MODES.includes(mode) ? mode : 'system';
  }

  function apply(el, mode) {
    const m = normalize(mode);
    if (m === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', m);
    if (isExtensionPage) {
      try { global.localStorage.setItem(CACHE_KEY, m); } catch (_e) {}
    }
  }

  // 套用目前設定到 el, 並在設定改變時自動更新.
  function bind(el) {
    if (isExtensionPage) {
      try { apply(el, global.localStorage.getItem(CACHE_KEY)); } catch (_e) {}
    }
    const api = global.browser ?? global.chrome;
    if (!api?.storage?.sync) return;
    api.storage.sync.get(STORAGE_KEY).then((r) => apply(el, r[STORAGE_KEY]), () => {});
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[STORAGE_KEY]) apply(el, changes[STORAGE_KEY].newValue);
    });
  }

  global.TransitTheme = Object.freeze({
    palettes: { dracula: DRACULA, alucard: ALUCARD },
    tokens: { dark, light },
    modes: MODES,
    css, normalize, apply, bind,
  });

  // 擴充功能頁面 (options, popup, translate-doc) 在 <head> 載入本檔時自動套用到 <html>.
  if (isExtensionPage && global.document?.documentElement) bind(global.document.documentElement);
})(globalThis);
