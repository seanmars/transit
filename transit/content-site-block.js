// 禁用網站: 依設定頁的禁用清單判斷目前頁面是否停用 Transit.
// 其他 content script 在開始翻譯前呼叫 SK.isSiteBlocked() 檢查; 自動觸發的流程先 await SK.checkSiteBlocked().
(function (SK) {
  'use strict';
  if (!SK || SK.disabled) return;
  const D = window.__SKDomain;
  const STORAGE_KEY = 'blockedSites';

  let blocked = false;
  const listeners = [];

  // iframe 也檢查上層頁面的網域, 被禁用網站內嵌的 iframe 一起停用
  function pageHosts() {
    const hosts = [location.hostname];
    try {
      const anc = location.ancestorOrigins;
      if (anc) {
        for (let i = 0; i < anc.length; i++) hosts.push(new URL(anc[i]).hostname);
      }
    } catch (_) {   }
    return hosts.filter(Boolean);
  }

  function evaluate(cfg) {
    if (!D || !cfg || cfg.enabled === false) return false;
    const entries = D.parseSiteBlockList(cfg.list);
    if (!entries.length) return false;
    return pageHosts().some((h) => D.matchSiteBlock(h, entries));
  }

  function apply(next) {
    if (next === blocked) return;
    blocked = next;
    SK.sendLog?.('info', 'system', 'site block state changed', { blocked, url: location.href });
    for (const fn of listeners) {
      try { fn(blocked); } catch (_) {   }
    }
  }

  SK.isSiteBlocked = () => blocked;
  SK.onSiteBlockChange = (fn) => { if (typeof fn === 'function') listeners.push(fn); };
  SK.notifySiteBlocked = () => {
    SK.showToast?.('info', SK.t('toast.siteBlocked'), { autoHideMs: 3000 });
  };

  const ready = browser.storage.sync.get(STORAGE_KEY)
    .then((r) => { apply(evaluate(r && r[STORAGE_KEY])); })
    .catch(() => {   });

  // 等第一次讀取設定完成後回傳目前狀態; 自動觸發的流程用這個, 避免在讀到設定前就開始翻譯
  SK.checkSiteBlocked = async () => { await ready; return blocked; };

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !(STORAGE_KEY in changes)) return;
    apply(evaluate(changes[STORAGE_KEY].newValue));
  });
})(window.__SK);
