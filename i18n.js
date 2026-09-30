/* i18n.js — Japanese / English switching, shared by the yukmmz.github.io apps.
 * Keep this file identical in every app; app-specific strings live in the app.
 *
 *   I18N.init('<app>/lang', { ja: {...}, en: {...} });   // once, before first render
 *   I18N.t('key', { n: 3 })   -> string, with {n} replaced
 *   I18N.set('en')            -> switch, persist, re-apply, notify listeners
 *   I18N.onChange(fn)         -> fn(lang) after every switch
 *   I18N.apply(root?)         -> fill the markup below under root (default: document)
 *
 * Markup:
 *   data-i18n="key"             textContent
 *   data-i18n-html="key"        innerHTML (only for the app's own constant strings)
 *   data-i18n-title="key"       title attribute
 *   data-i18n-aria-label="key"  aria-label attribute
 *   data-i18n-placeholder="key" placeholder attribute
 *
 * The first visit follows the browser language (ja* -> Japanese, else English).
 * A missing English string falls back to Japanese, then to the key itself.
 */
(function (global) {
  'use strict';

  var LANGS = ['ja', 'en'];
  var dict = { ja: {}, en: {} };
  var lang = 'ja';
  var storageKey = null;
  var listeners = [];

  function detect() {
    var nav = (global.navigator && (global.navigator.language || '')) || '';
    return nav.toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en';
  }

  function readSaved() {
    try { return global.localStorage.getItem(storageKey); } catch (e) { return null; }
  }

  function t(key, params) {
    var table = dict[lang] || {};
    var s = Object.prototype.hasOwnProperty.call(table, key) ? table[key]
          : Object.prototype.hasOwnProperty.call(dict.ja, key) ? dict.ja[key] : key;
    if (params) {
      s = String(s).replace(/\{(\w+)\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m;
      });
    }
    return s;
  }

  var ATTRS = [
    ['data-i18n-title', 'title'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder']
  ];

  function each(root, selector, fn) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    var list = root.querySelectorAll(selector);
    for (var i = 0; i < list.length; i++) fn(list[i]);
  }

  function apply(root) {
    var doc = global.document;
    if (doc && doc.documentElement) doc.documentElement.lang = lang;
    root = root || doc;
    each(root, '[data-i18n]', function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    each(root, '[data-i18n-html]', function (el) { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    ATTRS.forEach(function (pair) {
      each(root, '[' + pair[0] + ']', function (el) { el.setAttribute(pair[1], t(el.getAttribute(pair[0]))); });
    });
  }

  global.I18N = {
    init: function (key, strings) {
      storageKey = key;
      dict = strings;
      var saved = readSaved();
      lang = LANGS.indexOf(saved) >= 0 ? saved : detect();
      apply();
    },
    t: t,
    lang: function () { return lang; },
    set: function (next) {
      if (LANGS.indexOf(next) < 0) return;
      lang = next;
      try { global.localStorage.setItem(storageKey, next); } catch (e) { /* ignore */ }
      apply();
      for (var i = 0; i < listeners.length; i++) listeners[i](lang);
    },
    onChange: function (fn) { listeners.push(fn); },
    apply: apply
  };
})(typeof window !== 'undefined' ? window : this);
