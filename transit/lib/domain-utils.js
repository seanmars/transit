(function (global) {
  'use strict';

  function normalizeDomainEntry(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!s) return '';
    var wildcard = '';
    if (s.indexOf('*.') === 0) { wildcard = '*.'; s = s.slice(2); }
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    s = s.split(/[/?#]/)[0];
    s = s.replace(/:\d+$/, '').replace(/\.+$/, '');
    return wildcard + s;
  }

  function matchDomain(hostname, whitelist) {
    if (!hostname || !Array.isArray(whitelist) || !whitelist.length) return false;
    var host = String(hostname).toLowerCase();
    var normHost = host.replace(/^www\./, '');
    return whitelist.some(function (raw) {
      var pattern = normalizeDomainEntry(raw);
      if (!pattern) return false;
      if (pattern.indexOf('*.') === 0) {
        var suffix = pattern.slice(1);
        return host === pattern.slice(2) || host.endsWith(suffix);
      }
      return normHost === pattern.replace(/^www\./, '');
    });
  }

  function normalizeScopeEntry(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    var host = normalizeDomainEntry(s);
    if (!host) return '';
    var stripped = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    var slash = stripped.indexOf('/');
    var path = slash === -1 ? '' : normalizePath(stripped.slice(slash).split(/[?#]/)[0]);
    return path ? host + path : host;
  }

  function normalizePath(p) {
    var out = String(p == null ? '' : p).replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    return out === '' || out === '/' ? '' : (out.charAt(0) === '/' ? out : '/' + out);
  }

  function safeDecode(p) {
    try { return decodeURIComponent(p); } catch (e) { return p; }
  }

  function splitScopeKey(raw) {
    var s = String(raw == null ? '' : raw).trim();
    var legacyUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /[?#]/.test(s);
    var host = normalizeDomainEntry(s);
    if (legacyUrl) return { host: host, path: '' };
    var slash = s.indexOf('/');
    return { host: host, path: slash === -1 ? '' : normalizePath(s.slice(slash)) };
  }

  function matchingDomainKeys(hostname, byDomain, pathname) {
    if (!hostname || !byDomain || typeof byDomain !== 'object' || Array.isArray(byDomain)) return [];
    var page = pathname == null ? null : safeDecode(normalizePath(String(pathname)));
    var scopes = {};
    var hits = Object.keys(byDomain).filter(function (key) {
      var scope = splitScopeKey(key);
      scopes[key] = scope;
      if (!matchDomain(hostname, [scope.host])) return false;
      if (!scope.path || page === null) return true;
      var want = safeDecode(scope.path);
      return page === want || page.indexOf(want + '/') === 0;
    });
    return hits.sort(function (a, b) {
      var d = scopes[a].path.length - scopes[b].path.length;
      if (d !== 0) return d;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
  }

  var api = {
    normalizeDomainEntry: normalizeDomainEntry,
    normalizeScopeEntry: normalizeScopeEntry,
    matchDomain: matchDomain,
    matchingDomainKeys: matchingDomainKeys,
    splitScopeKey: splitScopeKey
  };
  global.__SKDomain = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
