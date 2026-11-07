(function (global) {
  'use strict';

  var NAV_KEYS = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Home: 1, End: 1, PageUp: 1, PageDown: 1 };

  function createEditLinkRepair(opts) {
    var isEditableHost = (opts && opts.isEditableHost) || function () { return true; };

    var pendingAnchor = null;

    function reset() { pendingAnchor = null; }

    function closestEditable(node) {
      var el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
      if (!el || !el.closest) return null;
      var host = el.closest('[contenteditable="true"]');
      return host && isEditableHost(host) ? host : null;
    }

    function anchorOf(node, host) {
      var el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
      if (!el || !el.closest) return null;
      var a = el.closest('a');
      return a && a !== host && host.contains(a) ? a : null;
    }

    function nextSkipEmpty(node) {
      var n = node.nextSibling;
      while (n && n.nodeType === Node.TEXT_NODE && n.data === '') n = n.nextSibling;
      return n;
    }
    function prevSkipEmpty(node) {
      var n = node.previousSibling;
      while (n && n.nodeType === Node.TEXT_NODE && n.data === '') n = n.previousSibling;
      return n;
    }

    function repair(data) {
      var anchor = pendingAnchor;
      if (!anchor || !anchor.isConnected || !data) return false;
      var doc = anchor.ownerDocument;
      var sel = (doc.defaultView || global).getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
      var node = sel.focusNode;
      var offset = sel.focusOffset;
      if (!node || node.nodeType !== Node.TEXT_NODE) return false;
      if (anchor.contains(node)) return true;
      if (offset < data.length || node.data.slice(offset - data.length, offset) !== data) return false;

      var t;
      if (offset === node.data.length && nextSkipEmpty(node) === anchor) {
        node.deleteData(offset - data.length, data.length);
        if (node.data === '') node.remove();
        t = anchor.firstChild;
        if (t && t.nodeType === Node.TEXT_NODE) {
          t.insertData(0, data);
        } else {
          t = doc.createTextNode(data);
          anchor.insertBefore(t, anchor.firstChild);
        }
        sel.collapse(t, data.length);
        return true;
      }
      if (offset === data.length && prevSkipEmpty(node) === anchor) {
        node.deleteData(0, data.length);
        if (node.data === '') node.remove();
        t = anchor.lastChild;
        if (t && t.nodeType === Node.TEXT_NODE) {
          t.appendData(data);
        } else {
          t = doc.createTextNode(data);
          anchor.appendChild(t);
        }
        sel.collapse(t, t.data.length);
        return true;
      }
      return false;
    }

    function onBeforeInput(e) {
      if (!e.inputType || e.inputType.indexOf('delete') !== 0) return;
      var host = closestEditable(e.target);
      if (!host) return;
      var ranges = typeof e.getTargetRanges === 'function' ? e.getTargetRanges() : [];
      var found = null;
      for (var i = 0; i < ranges.length && !found; i++) {
        found = anchorOf(ranges[i].startContainer, host) || anchorOf(ranges[i].endContainer, host);
      }
      pendingAnchor = found;
    }

    function onInput(e) {
      if (e.inputType !== 'insertText' && e.inputType !== 'insertReplacementText') return;
      if (e.isComposing) return;
      if (!closestEditable(e.target)) return;
      repair(e.data || '');
    }

    function onCompositionEnd(e) {
      if (!closestEditable(e.target)) return;
      repair(e.data || '');
    }

    function onPointerDown() { reset(); }

    function onKeyDown(e) { if (NAV_KEYS[e.key]) reset(); }

    return {
      onBeforeInput: onBeforeInput,
      onInput: onInput,
      onCompositionEnd: onCompositionEnd,
      onPointerDown: onPointerDown,
      onKeyDown: onKeyDown,
      reset: reset,
      _repair: repair,
      _getPending: function () { return pendingAnchor; },
      _setPending: function (a) { pendingAnchor = a; }
    };
  }

  var api = { createEditLinkRepair: createEditLinkRepair };
  if (typeof window !== 'undefined') window.__SKEditLinkRepair = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
