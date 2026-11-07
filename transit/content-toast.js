(function(SK) {
  if (!SK || SK.disabled) return;
  const toastHost = document.createElement('div');
  toastHost.id = 'transit-toast-host';
  toastHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
  const shadow = toastHost.attachShadow({ mode: 'closed' });
  const TOAST_CSS = `
      :host, * { box-sizing: border-box; }
      .toast {
        position: fixed;
        width: max-content;
        min-width: 180px;
        max-width: min(320px, calc(100vw - 40px));
        padding: 14px 16px 12px 16px;
        background: #ffffff;
        color: #1d1d1f;
        border-radius: 12px;
        box-shadow: 0 8px 28px rgba(0,0,0,.18);
        font: 13px -apple-system, 'PingFang TC', 'Microsoft JhengHei', sans-serif;
        display: none;
        flex-direction: column;
        gap: 8px;
      }
      .toast.show { display: flex; }
      .toast.pos-bottom-right { bottom: 24px; right: 24px; }
      .toast.pos-bottom-left  { bottom: 24px; left: 24px; }
      .toast.pos-top-right    { top: 24px; right: 24px; }
      .toast.pos-top-left     { top: 24px; left: 24px; }
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .msg {
        flex: 1;
        font-weight: 500;
        color: #1d1d1f;
      }
      .detail {
        font-size: 12px;
        color: #6e6e73;
        font-variant-numeric: tabular-nums;
        margin-top: -2px;
        white-space: pre-line;
        line-height: 1.4;
      }
      .detail[hidden] { display: none; }
      .update-notice {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 6px;
        padding: 6px 10px;
        background: #fff8e1;
        border: 1px solid #f5b800;
        border-radius: 6px;
        font-size: 12px;
        color: #2c2a1f;
      }
      .update-notice[hidden] { display: none; }
      .welcome-notice {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 6px;
        padding: 6px 10px;
        background: #ecfdf3;
        border: 1px solid #b6efc9;
        border-radius: 6px;
        font-size: 12px;
        color: #1d3a26;
      }
      .welcome-notice[hidden] { display: none; }
      .welcome-notice strong { color: #117a3e; }
      .welcome-notice .wn-msg { flex: 1; }
      .welcome-notice .wn-dismiss {
        background: none;
        border: 0;
        color: #6e6e73;
        font-size: 11px;
        cursor: pointer;
        padding: 0 4px;
      }
      .welcome-notice .wn-dismiss:hover { color: #1d1d1f; }
      .update-notice .un-link {
        color: #0071e3;
        text-decoration: none;
        font-weight: 500;
      }
      .update-notice .un-link:hover { text-decoration: underline; }
      .update-notice .un-dismiss {
        margin-left: auto;
        background: none;
        border: 0;
        color: #6e6e73;
        font-size: 11px;
        cursor: pointer;
        padding: 0 4px;
      }
      .update-notice .un-dismiss:hover { color: #1d1d1f; }
      .timer {
        font-variant-numeric: tabular-nums;
        color: #86868b;
        font-size: 12px;
      }
      .close {
        cursor: pointer;
        background: none; border: 0;
        font-size: 18px; line-height: 1;
        color: #86868b;
        padding: 0 2px;
      }
      .close:hover { color: #1d1d1f; }
      .bar {
        position: relative;
        height: 4px;
        width: 100%;
        background: #e8e8ed;
        border-radius: 2px;
        overflow: hidden;
      }
      .bar-fill {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 0%;
        background: #0071e3;
        border-radius: 2px;
        transition: width .3s ease;
      }
      .toast.indeterminate .bar-fill {
        width: 30%;
        animation: slide 1.4s ease-in-out infinite;
      }
      @keyframes slide {
        0%   { left: -30%; }
        100% { left: 100%; }
      }
      .toast.success .bar-fill { background: #34c759; width: 100%; }
      .toast.error   .bar-fill { background: #ff3b30; width: 100%; }
      .toast.mismatch .bar-fill {
        background: #ff9500;
        animation: blink-yellow .6s ease-in-out infinite;
      }
      @keyframes blink-yellow {
        0%, 100% { opacity: 1; }
        50%      { opacity: .4; }
      }
      .toast-action {
        display: inline-block;
        margin-top: 8px;
        background: #0071e3;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s ease;
      }
      .toast-action:hover { background: #0058b8; }
      .toast-action:active { background: #004a99; }
      .toast-action[hidden] { display: none; }
  `;
  shadow.innerHTML = `
    <div class="toast" id="toast">
      <div class="row">
        <span class="msg" id="msg">翻譯中…</span>
        <span class="timer" id="timer"></span>
        <button class="close" id="close" title="關閉">×</button>
      </div>
      <div class="detail" id="detail" hidden></div>
      <div class="update-notice" id="update-notice" hidden>
        <span>📦</span>
        <a class="un-link" id="un-link" href="#" target="_blank" rel="noopener"></a>
        <button class="un-dismiss" id="un-dismiss" type="button" title="今天不再提示">×</button>
      </div>
      <div class="welcome-notice" id="welcome-notice" hidden>
        <span>🎉</span>
        <span class="wn-msg" id="wn-msg"></span>
        <button class="wn-dismiss" id="wn-dismiss" type="button" title="今天不再提示">×</button>
      </div>
      <button class="toast-action" id="toast-action" type="button" hidden></button>
      <div class="bar"><div class="bar-fill" id="fill"></div></div>
    </div>
  `;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(TOAST_CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch (_e) {
    const styleEl = document.createElement('style');
    styleEl.textContent = TOAST_CSS;
    shadow.prepend(styleEl);
  }
  document.documentElement.appendChild(toastHost);

  function applyToastOpacity(opacity) {
    toastHost.style.opacity = Math.max(0.1, Math.min(1, opacity ?? 0.7));
  }

  const VALID_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
  let currentToastPosition = 'bottom-right';
  function applyToastPosition(pos) {
    const toastInner = shadow.getElementById('toast');
    if (!toastInner) return;
    const p = VALID_POSITIONS.includes(pos) ? pos : 'bottom-right';
    currentToastPosition = p;
    toastInner.className = toastInner.className.replace(/\bpos-\S+/g, '').trim() + ' pos-' + p;
  }

  let toastAutoHide = true;
  let showProgressToast = true;
  let hideZhConvertToast = true;

  browser.storage.sync.get(['toastOpacity', 'toastPosition', 'toastAutoHide', 'showProgressToast', 'hideZhConvertToast']).then((s) => {
    applyToastOpacity(s.toastOpacity);
    applyToastPosition(s.toastPosition);
    if (typeof s.toastAutoHide === 'boolean') toastAutoHide = s.toastAutoHide;
    if (typeof s.showProgressToast === 'boolean') showProgressToast = s.showProgressToast;
    if (typeof s.hideZhConvertToast === 'boolean') hideZhConvertToast = s.hideZhConvertToast;
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.toastOpacity) {
      applyToastOpacity(changes.toastOpacity.newValue);
    }
    if (area === 'sync' && changes.toastPosition) {
      applyToastPosition(changes.toastPosition.newValue);
    }
    if (area === 'sync' && changes.toastAutoHide) {
      toastAutoHide = changes.toastAutoHide.newValue ?? true;
    }
    if (area === 'sync' && changes.showProgressToast) {
      showProgressToast = changes.showProgressToast.newValue ?? true;
      if (!showProgressToast && SK.hideToast) SK.hideToast();
    }
    if (area === 'sync' && changes.hideZhConvertToast) {
      hideZhConvertToast = changes.hideZhConvertToast.newValue ?? true;
    }
  });

  const toastEl = shadow.getElementById('toast');
  const toastMsgEl = shadow.getElementById('msg');
  const toastDetailEl = shadow.getElementById('detail');
  const toastActionEl = shadow.getElementById('toast-action');
  let toastActionHandler = null;
  toastActionEl.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof toastActionHandler === 'function') {
      try { toastActionHandler(); } catch (err) {   }
    }
  });
  const updateNoticeEl = shadow.getElementById('update-notice');
  const updateNoticeLink = shadow.getElementById('un-link');
  const updateNoticeDismiss = shadow.getElementById('un-dismiss');
  function dismissUpdateNotice() {
    updateNoticeEl.hidden = true;
    try { SK.safeSendMessage({ type: 'UPDATE_NOTICE_DISMISSED' }).catch(() => {}); }
    catch {   }
  }
  updateNoticeLink.addEventListener('click', dismissUpdateNotice);
  updateNoticeDismiss.addEventListener('click', (e) => { e.preventDefault(); dismissUpdateNotice(); });

  const welcomeNoticeEl = shadow.getElementById('welcome-notice');
  const welcomeNoticeMsg = shadow.getElementById('wn-msg');
  const welcomeNoticeDismiss = shadow.getElementById('wn-dismiss');
  function dismissWelcomeNotice() {
    welcomeNoticeEl.hidden = true;
    try { SK.safeSendMessage({ type: 'WELCOME_NOTICE_TOAST_SHOWN' }).catch(() => {}); }
    catch {   }
  }
  welcomeNoticeDismiss.addEventListener('click', (e) => { e.preventDefault(); dismissWelcomeNotice(); });
  const toastTimerEl = shadow.getElementById('timer');
  const toastFillEl = shadow.getElementById('fill');
  const toastCloseBtn = shadow.getElementById('close');
  toastCloseBtn.addEventListener('click', () => SK.hideToast());
  let toastTickHandle = null;
  let toastStartTime = 0;
  let toastHideHandle = null;
  let toastOutsideHandler = null;

  function removeOutsideClickHandler() {
    if (toastOutsideHandler) {
      document.removeEventListener('mousedown', toastOutsideHandler, true);
      toastOutsideHandler = null;
    }
  }

  SK.formatElapsed = function formatElapsed(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return SK.t('toast.elapsedSec', { s });
    const m = Math.floor(s / 60);
    return SK.t('toast.elapsedMinSec', { m, s: s % 60 });
  };

  SK.formatTokens = function formatTokens(n) {
    return n.toLocaleString('en-US');
  };

  const _F = window.__SKFormat;
  SK.formatUSD = _F.formatUSD;
  SK.formatTWD = _F.formatTWD;

  SK.formatMoney = function formatMoney(usd) {
    return _F.formatMoney(usd, SK.currencyState || { currency: 'TWD', rate: _F.FALLBACK_USD_TWD_RATE });
  };

  SK.currencyState = SK.currencyState || { currency: 'TWD', rate: _F.FALLBACK_USD_TWD_RATE };

  SK.shouldShowToast = function shouldShowToast() {
    return showProgressToast;
  };

  SK.shouldHideZhConvertToast = function shouldHideZhConvertToast() {
    return hideZhConvertToast;
  };

  SK.showToast = function showToast(kind, msg, opts = {}) {
    if (!SK.shouldShowToast()) return;
    toastCloseBtn.title = SK.t('toast.close');
    updateNoticeDismiss.title = SK.t('toast.dismissToday');
    welcomeNoticeDismiss.title = SK.t('toast.dismissToday');
    if (toastHideHandle) {
      clearTimeout(toastHideHandle);
      toastHideHandle = null;
    }
    removeOutsideClickHandler();

    const classes = ['toast', 'show', kind, 'pos-' + currentToastPosition];
    if (kind === 'loading' && opts.progress == null) classes.push('indeterminate');
    if (opts.mismatch) classes.push('mismatch');
    toastEl.className = classes.join(' ');
    toastMsgEl.textContent = msg;

    if (opts.detail) {
      toastDetailEl.textContent = opts.detail;
      toastDetailEl.hidden = false;
    } else {
      toastDetailEl.textContent = '';
      toastDetailEl.hidden = true;
    }

    if (opts.action && opts.action.label) {
      toastActionEl.textContent = opts.action.label;
      toastActionEl.hidden = false;
      toastActionHandler = opts.action.onClick;
    } else {
      toastActionEl.hidden = true;
      toastActionEl.textContent = '';
      toastActionHandler = null;
    }

    if (opts.updateNotice && opts.updateNotice.version && opts.updateNotice.releaseUrl) {
      updateNoticeLink.textContent = SK.t('toast.updateNoticeLink', { version: opts.updateNotice.version });
      updateNoticeLink.href = opts.updateNotice.releaseUrl;
      updateNoticeEl.hidden = false;
    } else {
      updateNoticeEl.hidden = true;
    }

    if (opts.welcomeNotice && opts.welcomeNotice.version) {
      welcomeNoticeMsg.innerHTML = SK.t('toast.welcomeNotice.html', { version: opts.welcomeNotice.version });
      welcomeNoticeEl.hidden = false;
    } else {
      welcomeNoticeEl.hidden = true;
    }

    if (opts.progress != null) {
      toastFillEl.style.width = Math.round(opts.progress * 100) + '%';
    } else if (kind === 'success' || kind === 'error') {
      toastFillEl.style.width = '100%';
    } else {
      toastFillEl.style.width = '0%';
    }

    if (opts.startTimer) {
      toastStartTime = Date.now();
      clearInterval(toastTickHandle);
      toastTimerEl.textContent = SK.t('toast.elapsedSec', { s: 0 });
      toastTickHandle = setInterval(() => {
        toastTimerEl.textContent = SK.formatElapsed(Date.now() - toastStartTime);
      }, 500);
    }
    if (opts.stopTimer) {
      clearInterval(toastTickHandle);
      toastTickHandle = null;
      if (toastStartTime) {
        toastTimerEl.textContent = SK.formatElapsed(Date.now() - toastStartTime);
      }
    }

    if (opts.autoHideMs) {
      toastHideHandle = setTimeout(() => {
        toastHideHandle = null;
        SK.hideToast();
      }, opts.autoHideMs);
    }

    if (kind === 'success' && !opts.autoHideMs && !opts.action) {
      if (toastAutoHide) {
        toastHideHandle = setTimeout(() => {
          toastHideHandle = null;
          SK.hideToast();
        }, 5000);
      }
      setTimeout(() => {
        if (!toastEl.className.includes('show')) return;
        removeOutsideClickHandler();
        toastOutsideHandler = (ev) => {
          const path = ev.composedPath ? ev.composedPath() : [];
          if (path.includes(toastHost)) return;
          SK.hideToast();
        };
        document.addEventListener('mousedown', toastOutsideHandler, true);
      }, 0);
    }
  };

  SK._getToastRect = function _getToastRect() {
    const r = toastEl.getBoundingClientRect();
    return { width: r.width, height: r.height };
  };

  SK.hideToast = function hideToast() {
    toastEl.className = 'toast pos-' + currentToastPosition;
    toastDetailEl.hidden = true;
    toastActionEl.hidden = true;
    toastActionEl.textContent = '';
    toastActionHandler = null;
    clearInterval(toastTickHandle);
    toastTickHandle = null;
    if (toastHideHandle) {
      clearTimeout(toastHideHandle);
      toastHideHandle = null;
    }
    removeOutsideClickHandler();
  };

})(window.__SK);
