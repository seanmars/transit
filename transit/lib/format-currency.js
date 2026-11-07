(function (global) {
  'use strict';

  var FALLBACK_USD_TWD_RATE = 31.6;

  function formatUSD(n) {
    if (!n) return '$0';
    if (n < 0.01) return '$' + n.toFixed(4);
    if (n < 1) return '$' + n.toFixed(3);
    return '$' + n.toFixed(2);
  }

  function formatTWD(usd, rate) {
    if (!usd || !rate) return 'NT$ 0';
    var twd = usd * rate;
    if (twd < 0.1) return 'NT$ ' + twd.toFixed(3);
    return 'NT$ ' + twd.toFixed(1);
  }

  function formatMoney(usd, state) {
    var st = state || {};
    if (st.currency === 'TWD') return formatTWD(usd, st.rate || FALLBACK_USD_TWD_RATE);
    return formatUSD(usd);
  }

  var api = {
    FALLBACK_USD_TWD_RATE: FALLBACK_USD_TWD_RATE,
    formatUSD: formatUSD,
    formatTWD: formatTWD,
    formatMoney: formatMoney,
  };
  if (typeof window !== 'undefined') window.__SKFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
