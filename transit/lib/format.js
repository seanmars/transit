export function formatBytes(b) {
  if (b < 1024) return b + ' B';
  const kb = (b / 1024).toFixed(1);
  if (Number(kb) < 1024) return kb + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}

export function formatTokens(n) {
  if (n < 1_000) return String(n);
  const k = (n / 1_000).toFixed(1);
  if (Number(k) < 1_000) return k + 'K';
  return (n / 1_000_000).toFixed(2) + 'M';
}

export function formatUSD(n) {
  if (!n) return '$0';
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 1) return '$' + n.toFixed(3);
  return '$' + n.toFixed(2);
}

export function formatTWD(usd, rate) {
  if (!usd || !rate) return 'NT$ 0';
  const twd = usd * rate;
  if (twd < 0.1) return 'NT$ ' + twd.toFixed(3);
  return 'NT$ ' + twd.toFixed(1);
}

export function formatMoney(usd, opts = {}) {
  const currency = opts.currency || 'USD';
  if (currency === 'TWD') {
    return formatTWD(usd, opts.rate || 0);
  }
  return formatUSD(usd);
}

export function parseUserNum(rawValue, defaultValue) {
  const v = String(rawValue ?? '').trim();
  if (v === '') return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

export function formatYmd(ts) {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export function formatYmdHms(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
         `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function buildUsageCsvFilename(fromMs, toMs) {
  return `transit-usage-${formatYmd(fromMs)}-${formatYmd(toMs)}.csv`;
}
