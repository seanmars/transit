(function (SK) {
  'use strict';
  if (!SK || SK.disabled) return;
  if (window !== window.top) return;

  const LONGPRESS_MS = 500;
  const DRAG_THRESHOLD_PX = 8;
  const DRAG_THRESHOLD_TOUCH_PX = 16;
  const DEFAULT_ICON_SIZE = 24;
  const HIT_PADDING = 16;
  const EDGE_MARGIN = 6;
  const DEFAULT_OPACITY = 0.7;
  const DEFAULT_POS = { edge: 'right', offsetY: 1 };
  let iconSize = DEFAULT_ICON_SIZE;
  let hitSize = iconSize + HIT_PADDING;

  let host, shadow, btn, menuEl;
  try {
    host = document.createElement('div');
    host.id = 'transit-floating-host';
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483600; display: none;';
    shadow = host.attachShadow({ mode: 'closed' });
  } catch (_e) {
    return;
  }

  const iconUrl = (() => {
    try { return browser.runtime.getURL('icons/icon-48.png'); }
    catch (_e) { return ''; }
  })();

  const CSS = `
    :host, * { box-sizing: border-box; }
    @media print { :host { display: none !important; } }
    .fab {
      position: relative;
      width: var(--fab-hit, 32px);
      height: var(--fab-hit, 32px);
      border: none;
      padding: 0;
      background: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition: transform .15s ease, filter .15s ease;
    }
    .fab:active { transform: scale(.92); }
    .fab img {
      width: var(--fab-icon, 16px);
      height: var(--fab-icon, 16px);
      display: block;
      filter: drop-shadow(0 1px 3px rgba(0,0,0,.4));
      pointer-events: none;
      -webkit-user-drag: none;
      user-drag: none;
    }
    .fab.dragging img { filter: drop-shadow(0 4px 10px rgba(0,0,0,.45)); }
    .menu {
      position: absolute;
      bottom: 0;
      min-width: 168px;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,.22);
      padding: 6px;
      display: none;
      flex-direction: column;
      gap: 2px;
      font: 13px -apple-system, 'PingFang TC', 'Microsoft JhengHei', sans-serif;
    }
    .menu.show { display: flex; }
    .menu.side-left  { left: calc(var(--fab-hit, 32px) + 8px); }
    .menu.side-right { right: calc(var(--fab-hit, 32px) + 8px); }
    .menu.v-down { bottom: auto; top: 0; }
    .menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      border-radius: 8px;
      background: none;
      border: none;
      width: 100%;
      text-align: left;
      color: #1d1d1f;
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }
    .menu-item:hover { background: #f0f0f3; }
    .menu-divider { height: 1px; background: #e5e5ea; margin: 4px 8px; }
    .menu-item.feature .slot.feature-icon { font-size: 13px; line-height: 1; }
    .menu-item.yt-subtitle .slot.yt-icon { font-size: 9px; font-weight: 700; letter-spacing: -.5px; }
    .menu-item .slot {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      border-radius: 5px;
      background: #0071e3;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .menu-item .label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  `;

  shadow.innerHTML = `
    <button class="fab" id="fab" type="button" aria-label="Transit">
      ${iconUrl ? `<img src="${iconUrl}" alt="">` : ''}
    </button>
    <div class="menu" id="menu" role="menu"></div>
  `;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch (_e) {
    const styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    shadow.prepend(styleEl);
  }
  btn = shadow.getElementById('fab');
  menuEl = shadow.getElementById('menu');
  document.documentElement.appendChild(host);

  let pos = { ...DEFAULT_POS };
  let currentOpacity = DEFAULT_OPACITY;

  function resolveEnabled(v) {
    return typeof v === 'boolean' ? v : true;
  }

  let lastEnabled = null;
  function applyEnabled(enabled) {
    if (lastEnabled === false && enabled === true) {
      applyPos(null);
      persistPos();
    }
    lastEnabled = enabled;
    host.style.display = enabled ? 'block' : 'none';
    if (!enabled) closeMenu();
  }

  function applyOpacity(v) {
    if (typeof v === 'number') currentOpacity = Math.max(0.1, Math.min(1, v));
    host.style.opacity = menuOpen ? '1' : String(currentOpacity);
  }

  function applySize(v) {
    iconSize = (v === 16 || v === 24 || v === 32) ? v : DEFAULT_ICON_SIZE;
    hitSize = iconSize + HIT_PADDING;
    host.style.setProperty('--fab-icon', iconSize + 'px');
    host.style.setProperty('--fab-hit', hitSize + 'px');
    applyPos(pos);
  }

  function sanitizePos(p) {
    const edge = (p && (p.edge === 'left' || p.edge === 'right')) ? p.edge : DEFAULT_POS.edge;
    let offsetY = p && typeof p.offsetY === 'number' ? p.offsetY : DEFAULT_POS.offsetY;
    if (!(offsetY >= 0 && offsetY <= 1)) offsetY = DEFAULT_POS.offsetY;
    return { edge, offsetY };
  }

  function clampTop(top, viewportH, hit) {
    const maxFree = Math.max(0, viewportH - hit);
    return Math.max(0, Math.min(maxFree, top));
  }

  function applyPos(p) {
    pos = sanitizePos(p);
    const rawTop = Math.round(pos.offsetY * Math.max(0, window.innerHeight - hitSize));
    const top = clampTop(rawTop, window.innerHeight, hitSize);
    host.style.top = top + 'px';
    host.style.bottom = 'auto';
    if (pos.edge === 'left') {
      host.style.left = EDGE_MARGIN + 'px';
      host.style.right = 'auto';
    } else {
      host.style.right = EDGE_MARGIN + 'px';
      host.style.left = 'auto';
    }
    menuEl.classList.toggle('side-left', pos.edge === 'left');
    menuEl.classList.toggle('side-right', pos.edge === 'right');
  }

  function persistPos() {
    try { browser.storage.sync.set({ floatingIconPos: pos }); } catch (_e) {}
  }

  let menuOpen = false;
  let outsideHandler = null;

  function engineLabel(spec) {
    return (spec && (spec.label || spec.model || spec.engine)) || '';
  }

  async function buildMenu() {
    let plan = null;
    try { plan = await SK.resolveTranslatePlan?.(); } catch (_e) {}
    menuEl.textContent = '';
    {
      const item = document.createElement('button');
      item.className = 'menu-item';
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.dataset.action = 'translate';
      const slotBadge = document.createElement('span');
      slotBadge.className = 'slot';
      slotBadge.textContent = '▶';
      const label = document.createElement('span');
      label.className = 'label';
      // 顯示翻譯鏈: 主要引擎 → failback 引擎
      const chainText = plan
        ? (plan.fallback ? engineLabel(plan.engine) + ' → ' + engineLabel(plan.fallback) : engineLabel(plan.engine))
        : '';
      label.textContent = chainText || SK.t('popup.action.translate');
      item.appendChild(slotBadge);
      item.appendChild(label);
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        runTranslate(true);
      });
      menuEl.appendChild(item);
    }
    const divider = document.createElement('div');
    divider.className = 'menu-divider';
    menuEl.appendChild(divider);
    if (typeof SK.isYouTubePage === 'function' && SK.isYouTubePage()) {
      const ytActive = !!(SK.YT && SK.YT.active);
      const ytItem = document.createElement('button');
      ytItem.className = 'menu-item yt-subtitle';
      ytItem.type = 'button';
      ytItem.setAttribute('role', 'menuitem');
      ytItem.dataset.yt = 'subtitle';
      ytItem.dataset.active = ytActive ? '1' : '0';
      const ytIcon = document.createElement('span');
      ytIcon.className = 'slot yt-icon';
      ytIcon.textContent = 'CC';
      const ytLabel = document.createElement('span');
      ytLabel.className = 'label';
      const ytKey = ytActive ? 'floating.ytSubtitleOff' : 'floating.ytSubtitleOn';
      ytLabel.textContent = (typeof SK.t === 'function')
        ? SK.t(ytKey)
        : (ytActive ? '關閉字幕翻譯' : '啟動字幕翻譯');
      ytItem.appendChild(ytIcon);
      ytItem.appendChild(ytLabel);
      ytItem.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        toggleYtSubtitle();
      });
      menuEl.appendChild(ytItem);
    }
    const featureItem = document.createElement('button');
    featureItem.className = 'menu-item feature';
    featureItem.type = 'button';
    featureItem.setAttribute('role', 'menuitem');
    featureItem.dataset.feature = 'menu';
    const fIcon = document.createElement('span');
    fIcon.className = 'slot feature-icon';
    fIcon.textContent = '☰';
    const fLabel = document.createElement('span');
    fLabel.className = 'label';
    fLabel.textContent = (typeof SK.t === 'function' ? SK.t('floating.featureMenu') : '功能選單');
    featureItem.appendChild(fIcon);
    featureItem.appendChild(fLabel);
    featureItem.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      openFeaturePanel();
    });
    menuEl.appendChild(featureItem);
  }

  async function openMenu() {
    if (host.style.display === 'none') return;
    await buildMenu();
    menuEl.classList.add('show');
    menuEl.classList.remove('v-down');
    try {
      const hostRect = host.getBoundingClientRect();
      if (hostRect.bottom - menuEl.offsetHeight < 0) menuEl.classList.add('v-down');
    } catch (_e) {   }
    menuOpen = true;
    host.style.opacity = '1';
    outsideHandler = (ev) => {
      const path = ev.composedPath ? ev.composedPath() : [];
      if (path.includes(host)) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', outsideHandler, true);
    window.addEventListener('scroll', closeMenu, { passive: true, capture: true });
  }

  function closeMenu() {
    if (!menuOpen) return;
    menuEl.classList.remove('show');
    menuOpen = false;
    host.style.opacity = String(currentOpacity);
    if (outsideHandler) {
      document.removeEventListener('pointerdown', outsideHandler, true);
      outsideHandler = null;
    }
    window.removeEventListener('scroll', closeMenu, true);
  }

  let panelHost = null, panelFrame = null, panelMsgHandler = null, panelKeyHandler = null;

  function openFeaturePanel() {
    openFeaturePanelIframe();
  }

  const PANEL_CSS = `
    :host, * { box-sizing: border-box; }
    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.4);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      -webkit-tap-highlight-color: transparent;
    }
    .frame {
      border: none;
      width: min(94vw, 360px);
      height: min(86vh, 620px);
      max-height: 86vh;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 18px 56px rgba(0,0,0,.4);
      overflow: hidden;
    }
  `;

  function closeFeaturePanel() {
    if (!panelHost) return;
    try { panelHost.remove(); } catch (_e) {}
    panelHost = null;
    panelFrame = null;
    if (panelMsgHandler) { window.removeEventListener('message', panelMsgHandler); panelMsgHandler = null; }
    if (panelKeyHandler) { window.removeEventListener('keydown', panelKeyHandler, true); panelKeyHandler = null; }
  }

  function openFeaturePanelIframe() {
    if (panelHost) return;
    let popupUrl = '';
    try { popupUrl = browser.runtime.getURL('popup/popup.html') + '?panel=1'; } catch (_e) { return; }
    let pHost, pShadow;
    try {
      pHost = document.createElement('div');
      pHost.id = 'transit-panel-host';
      pHost.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483640;';
      pShadow = pHost.attachShadow({ mode: 'closed' });
    } catch (_e) { return; }
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    const frame = document.createElement('iframe');
    frame.className = 'frame';
    frame.setAttribute('title', 'Transit');
    frame.src = popupUrl;
    backdrop.appendChild(frame);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) closeFeaturePanel();
    });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(PANEL_CSS);
      pShadow.adoptedStyleSheets = [sheet];
    } catch (_e) {
      const styleEl = document.createElement('style');
      styleEl.textContent = PANEL_CSS;
      pShadow.appendChild(styleEl);
    }
    pShadow.appendChild(backdrop);
    document.documentElement.appendChild(pHost);
    panelHost = pHost;
    panelFrame = frame;
    panelMsgHandler = (ev) => {
      if (!panelFrame || ev.source !== panelFrame.contentWindow || !ev.data) return;
      if (ev.data.type === 'transit-close-panel') {
        closeFeaturePanel();
      } else if (ev.data.type === 'transit-panel-size') {
        if (typeof ev.data.height === 'number') {
          const capH = Math.round(window.innerHeight * 0.86);
          panelFrame.style.height = Math.max(200, Math.min(ev.data.height, capH)) + 'px';
        }
        if (typeof ev.data.width === 'number' && ev.data.width > 0) {
          const capW = Math.round(window.innerWidth * 0.94);
          panelFrame.style.width = Math.max(240, Math.min(ev.data.width, capW)) + 'px';
        }
      }
    };
    window.addEventListener('message', panelMsgHandler);
    panelKeyHandler = (ev) => { if (ev.key === 'Escape') closeFeaturePanel(); };
    window.addEventListener('keydown', panelKeyHandler, true);
  }

  function runTranslate(force) {
    if (typeof SK.handleTranslate === 'function') {
      SK.handleTranslate({ force: force === true });
    }
  }

  function toggleYtSubtitle() {
    const active = !!(SK.YT && SK.YT.active);
    if (active) {
      try { SK.stopYouTubeTranslation?.(); } catch (_e) {}
    } else {
      try { SK.translateYouTubeSubtitles?.().catch(() => {}); } catch (_e) {}
    }
  }

  let _shortPressCooldown = false;

  async function handleShortPress() {
    if (_shortPressCooldown) return;
    _shortPressCooldown = true;
    setTimeout(() => { _shortPressCooldown = false; }, 400);
    runTranslate();
  }

  let press = null;

  function clearPressTimer() {
    if (press && press.timer) { clearTimeout(press.timer); press.timer = null; }
  }

  btn.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    closeMenu();
    try { btn.setPointerCapture(e.pointerId); } catch (_e) {}
    press = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY, timer: null, moved: false, longFired: false,
      dragThreshold: e.pointerType === 'touch' ? DRAG_THRESHOLD_TOUCH_PX : DRAG_THRESHOLD_PX,
    };
    press.timer = setTimeout(() => {
      if (!press || press.moved) return;
      press.longFired = true;
      press.timer = null;
      openMenu();
    }, LONGPRESS_MS);
  });

  btn.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (press.longFired) return;
    const dx = e.clientX - press.startX;
    const dy = e.clientY - press.startY;
    if (!press.moved && Math.hypot(dx, dy) > press.dragThreshold) {
      press.moved = true;
      clearPressTimer();
      closeMenu();
      btn.classList.add('dragging');
    }
    if (press.moved) {
      const half = hitSize / 2;
      const left = Math.max(0, Math.min(window.innerWidth - hitSize, e.clientX - half));
      const top = Math.max(0, Math.min(window.innerHeight - hitSize, e.clientY - half));
      host.style.left = left + 'px';
      host.style.right = 'auto';
      host.style.top = top + 'px';
      host.style.bottom = 'auto';
    }
  });

  function endPress(e) {
    if (!press || e.pointerId !== press.id) return;
    clearPressTimer();
    try { btn.releasePointerCapture(e.pointerId); } catch (_e) {}
    const { moved, longFired } = press;
    press = null;
    btn.classList.remove('dragging');
    if (moved) {
      const edge = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
      const offsetY = Math.max(0, Math.min(1,
        (e.clientY - hitSize / 2) / Math.max(1, window.innerHeight - hitSize)));
      applyPos({ edge, offsetY });
      persistPos();
      return;
    }
    if (longFired) return;
    handleShortPress();
  }

  btn.addEventListener('pointerup', endPress);
  btn.addEventListener('pointercancel', (e) => {
    if (!press || e.pointerId !== press.id) return;
    clearPressTimer();
    press = null;
    btn.classList.remove('dragging');
  });

  window.addEventListener('resize', () => {
    if (press && press.moved) return;
    applyPos(pos);
  }, { passive: true });

  browser.storage.sync.get(['floatingIcon', 'floatingIconOpacity', 'floatingIconSize', 'floatingIconPos']).then((s) => {
    applyOpacity(s.floatingIconOpacity);
    applySize(s.floatingIconSize);
    applyPos(s.floatingIconPos);
    applyEnabled(resolveEnabled(s.floatingIcon));
  }).catch(() => {
    applyOpacity(undefined);
    applySize(undefined);
    applyPos(undefined);
    applyEnabled(resolveEnabled(undefined));
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.floatingIcon) applyEnabled(resolveEnabled(changes.floatingIcon.newValue));
    if (changes.floatingIconOpacity) applyOpacity(changes.floatingIconOpacity.newValue);
    if (changes.floatingIconSize) applySize(changes.floatingIconSize.newValue);
    if (changes.floatingIconPos) applyPos(changes.floatingIconPos.newValue);
  });

  SK._floating = {
    host, btn, menuEl,
    openMenu, closeMenu, buildMenu,
    handleShortPress,
    _resetShortPressCooldown: () => { _shortPressCooldown = false; },
    runTranslate,
    toggleYtSubtitle,
    applyEnabled, applyOpacity, applySize, applyPos,
    resolveEnabled,
    clampTop,
    openFeaturePanel, openFeaturePanelIframe, closeFeaturePanel,
    isPanelOpen: () => !!panelHost,
    getPanelFrameSrc: () => (panelFrame ? panelFrame.src : null),
    getPanelFrameSize: () => (panelFrame ? { w: panelFrame.style.width, h: panelFrame.style.height } : null),
    isMenuOpen: () => menuOpen,
    getOpacity: () => host.style.opacity,
    getIconSize: () => iconSize,
    getPos: () => ({ ...pos }),
    getTop: () => host.style.top,
  };
})(window.__SK);
