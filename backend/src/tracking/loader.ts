/**
 * @module tracking/loader
 *
 * The tracking script of one Advertiser, served at `/t/<key>.js` and loaded by the one snippet the
 * site pastes in its `<head>` (`docs/phase-10.md` § 8.10). Transcribed from multi-search
 * (`src/tracking/loader.ts`, our code), Google's part only: Microsoft joins with lot B of phase 11.
 *
 * ```html
 * <script>
 *   (function (w, d, s, u) {
 *     w.msq = w.msq || function () { (w.msq.q = w.msq.q || []).push(arguments); };
 *     var j = d.createElement(s); j.async = 1; j.src = u; d.head.appendChild(j);
 *   })(window, document, 'script', 'https://<host>/t/<key>.js');
 * </script>
 * ```
 *
 * The site then calls `msq('consent', { ads: 'granted' | 'denied' })` from its consent banner and
 * `msq('conversion', { goal, value, currency, orderId })` where a conversion happens — the calls of
 * multi-search's script, kept so that a site already tagged keeps its code. The script keeps the calls
 * the snippet queued, replaces `window.msq` by its dispatcher and replays them in order.
 *
 * **Consent: refused until the site grants it ("basic" consent mode).** Before
 * `msq('consent', { ads: 'granted' })` the script loads no third-party script, sets no cookie and sends
 * nothing: conversions wait in a bounded queue (50). On the first grant it sets Google's consent
 * defaults to denied *before* Google's tag — `gtag('consent', 'default', { ad_storage, ad_user_data,
 * ad_personalization: 'denied' })` —, then grants them, then loads `gtag/js` and sends the queued
 * conversions. `analytics_storage` is left alone: Consent Mode is global to the page, the signal we
 * receive is about ads only, and denying it would switch off the site's own Google Analytics.
 *
 * A later `denied` sends the `update`, drops the queue and stops sending conversions; a new `granted`
 * sends the `update` back. A `denied` before any grant drops the queue and loads nothing.
 *
 * A conversion is fired once on every Google tag of the goal, with one event id (the site's `orderId`,
 * else a random id), so that the platform deduplicates a conversion sent twice.
 *
 * The script is ES5, has no dependency and never throws into the page: every platform call is wrapped
 * in `try`/`catch`, and an unknown goal or command is reported once with `console.warn`.
 */
import type { LoaderConfig } from './loader-config';

/**
 * The body of the script, run with `window`, `document` and the embedded {@link LoaderConfig} as
 * `config`. Plain ES5: no arrow, `let`, `const`, class or template literal.
 */
const RUNTIME: string = String.raw`
  'use strict';
  var MAX_PENDING = 50;
  var MAX_ID_LENGTH = 64;
  var EXPONENTS = {
    BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, UYI: 0,
    VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
    BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
    CLF: 4, UYW: 4
  };
  var hasOwn = Object.prototype.hasOwnProperty;

  var previous = window.msq;
  if (previous && previous.loaded) return;
  var queued = (previous && previous.q) || [];

  var consent = null;
  var loaded = false;
  var pending = [];
  var warned = {};

  function warn(key, message) {
    if (warned[key]) return;
    warned[key] = true;
    try {
      window.console.warn('[omnipotent] ' + message);
    } catch (ignored) {}
  }

  function safe(platform, call) {
    try {
      call();
    } catch (error) {
      warn('error:' + platform, platform + ' call failed: ' + (error && error.message));
    }
  }

  function inject(src) {
    var script = document.createElement('script');
    script.async = true;
    script.src = src;
    (document.head || document.documentElement).appendChild(script);
  }

  function gtag() {
    window.dataLayer.push(arguments);
  }

  function googleConsent(state) {
    return { ad_storage: state, ad_user_data: state, ad_personalization: state };
  }

  function loadGoogle() {
    var ids = config.googleTagIds;
    if (!ids.length) return;
    window.dataLayer = window.dataLayer || [];
    gtag('consent', 'default', googleConsent('denied'));
    gtag('consent', 'update', googleConsent('granted'));
    gtag('js', new Date());
    for (var i = 0; i < ids.length; i++) gtag('config', ids[i]);
    inject('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ids[0]));
  }

  function applyConsent(state) {
    if (config.googleTagIds.length) {
      safe('google', function () { gtag('consent', 'update', googleConsent(state)); });
    }
  }

  function exponent(currency) {
    return hasOwn.call(EXPONENTS, currency) ? EXPONENTS[currency] : 2;
  }

  function toAmount(raw) {
    var value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.replace(/\s/g, '') ? Number(raw) : NaN;
    return isFinite(value) && value >= 0 ? value : null;
  }

  function toCurrency(raw) {
    return typeof raw === 'string' && /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : null;
  }

  function eventId(orderId) {
    if ((typeof orderId === 'string' && orderId) || (typeof orderId === 'number' && isFinite(orderId))) {
      return String(orderId).slice(0, MAX_ID_LENGTH);
    }
    var crypto = window.crypto;
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'op-' + new Date().getTime().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function build(goal, params) {
    var value = null;
    var currency = null;
    if (goal.valueMode === 'fixed') {
      value = goal.defaultValue;
      currency = goal.currency;
    } else if (goal.valueMode === 'dynamic') {
      var given = toAmount(params.value);
      var givenCurrency = params.currency == null ? goal.currency : toCurrency(params.currency);
      if (given !== null && givenCurrency) {
        value = given;
        currency = givenCurrency;
      } else {
        value = goal.defaultValue;
        currency = goal.currency;
      }
    }
    var event = { goal: goal, id: eventId(params.orderId), value: null, currency: null };
    if (value !== null && currency) {
      var factor = Math.pow(10, exponent(currency));
      event.value = Math.round(Number((value * factor).toFixed(6))) / factor;
      event.currency = currency;
    }
    return event;
  }

  function sendGoogle(targets, event) {
    safe('google', function () {
      var sendTo = [];
      for (var i = 0; i < targets.length; i++) sendTo.push(targets[i].sendTo);
      var params = { send_to: sendTo, transaction_id: event.id };
      if (event.value !== null) {
        params.value = event.value;
        params.currency = event.currency;
      }
      gtag('event', 'conversion', params);
    });
  }

  function send(event) {
    if (event.goal.google.length) sendGoogle(event.goal.google, event);
  }

  function setConsent(params) {
    var ads = params && params.ads;
    if (ads !== 'granted' && ads !== 'denied') {
      warn('consent', 'msq("consent") expects { ads: "granted" } or { ads: "denied" }');
      return;
    }
    if (ads === consent) return;
    consent = ads;
    if (ads === 'denied') {
      pending = [];
      if (loaded) applyConsent('denied');
      return;
    }
    if (loaded) {
      applyConsent('granted');
    } else {
      loaded = true;
      safe('google', loadGoogle);
    }
    var flushed = pending;
    pending = [];
    for (var i = 0; i < flushed.length; i++) send(flushed[i]);
  }

  function convert(params) {
    if (!params || typeof params !== 'object') {
      warn('conversion', 'msq("conversion") expects { goal: "<key>", value, currency, orderId }');
      return;
    }
    var key = String(params.goal);
    if (!hasOwn.call(config.goals, key)) {
      warn('goal:' + key, 'unknown conversion goal "' + key + '"');
      return;
    }
    var event = build(config.goals[key], params);
    if (consent === 'granted') send(event);
    else if (consent === null && pending.length < MAX_PENDING) pending.push(event);
  }

  function dispatch(args) {
    try {
      var command = args[0];
      if (command === 'consent') setConsent(args[1]);
      else if (command === 'conversion') convert(args[1]);
      else warn('command:' + command, 'unknown command "' + command + '"');
    } catch (error) {
      warn('error', 'msq call failed: ' + (error && error.message));
    }
  }

  function msq() {
    dispatch(arguments);
  }
  msq.loaded = true;
  window.msq = msq;
  for (var i = 0; i < queued.length; i++) dispatch(queued[i]);
`;

/** Characters that must not appear raw in a script: they could close it or end a string in ES5 engines. */
const UNSAFE_IN_SCRIPT = /[<>&\u2028\u2029]/g;

/**
 * Serialize a value as a JavaScript expression that is safe to embed in a script, even inline in an
 * HTML page: `<`, `>`, `&`, U+2028 and U+2029 become `\uXXXX` escapes, which only appear inside JSON
 * strings and mean the same character there.
 *
 * @param value - Any JSON value
 * @returns The JSON text with the unsafe characters escaped
 *
 * @example
 * ```typescript
 * embedJson({ id: '</script>' }); // '{"id":"\\u003c/script\\u003e"}'
 * ```
 */
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(
    UNSAFE_IN_SCRIPT,
    (character: string): string => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

/**
 * Render the tracking script of one Advertiser: a self-contained ES5 IIFE embedding its configuration.
 *
 * @param config - The tags and goals of the Advertiser
 * @returns The JavaScript source to serve
 *
 * @example
 * ```typescript
 * reply.type('application/javascript; charset=utf-8').send(renderLoader(config));
 * ```
 */
export function renderLoader(config: LoaderConfig): string {
  return (
    '/* Omnipotent tracking script */\n' +
    `(function (window, document, config) {${RUNTIME}})(window, document, ${embedJson(config)});\n`
  );
}
