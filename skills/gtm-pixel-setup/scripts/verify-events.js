/*
 * Axon Pixel Verifier
 * -------------------
 * Purpose: Pasteable DevTools Console snippet the advertiser runs on their
 * storefront AFTER the Axon pixel has been published via GTM. It observes
 * every axon() call and every POST to b.applovin.com/v1/pixel while the user
 * walks the funnel, then prints a pass/fail JSON report covering the 5
 * required events: page_view, view_item, add_to_cart, begin_checkout, purchase.
 *
 * Usage:
 *   1. Open storefront in Chrome, open DevTools (F12) -> Console.
 *   2. Paste this entire file into the Console and press Enter.
 *   3. Walk the funnel in the SAME tab:
 *        home -> product page -> add to cart -> checkout -> (test) purchase
 *      For Shopify hosted checkout, begin_checkout + purchase fire on
 *      checkout.shopify.com -- paste the snippet there too and run report
 *      on that origin.
 *   4. When done run:  __axonVerify.report()
 *      and paste the resulting JSON back to Claude.
 *
 * Idempotent, try/catch-wrapped, does NOT decode the gzipped pixel body.
 */
(function () {
  'use strict';
  try {
    if (window.__axonVerify) { console.log('[Axon Verifier] already installed'); return; }

    var axonCalls = [];
    var pixelRequests = [];
    var REQUIRED = ['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase'];
    var PIXEL_HOST = 'b.applovin.com/v1/pixel';

    // --- wrap window.axon, preserve static properties --------------------
    try {
      var origAxon = window.axon;
      var wrapped = function () {
        try {
          var args = Array.prototype.slice.call(arguments);
          if (args[0] === 'track') {
            axonCalls.push({ event: args[1], payload: args[2], ts: Date.now(), pageUrl: location.href });
          }
        } catch (e) {}
        if (typeof origAxon === 'function') return origAxon.apply(this, arguments);
      };
      if (origAxon && (typeof origAxon === 'object' || typeof origAxon === 'function')) {
        try {
          var keys = Object.keys(origAxon);
          for (var i = 0; i < keys.length; i++) {
            try { wrapped[keys[i]] = origAxon[keys[i]]; } catch (e) {}
          }
        } catch (e) {}
      }
      window.axon = wrapped;
    } catch (e) { console.warn('[Axon Verifier] wrap axon failed:', e); }

    // --- wrap window.fetch ----------------------------------------------
    try {
      var origFetch = window.fetch;
      if (typeof origFetch === 'function') {
        window.fetch = function (input, init) {
          var url = '', method = 'GET';
          try {
            if (typeof input === 'string') url = input;
            else if (input && input.url) url = input.url;
            if (init && init.method) method = String(init.method).toUpperCase();
            else if (input && input.method) method = String(input.method).toUpperCase();
          } catch (e) {}
          var entry = null;
          try {
            if (method === 'POST' && url.indexOf(PIXEL_HOST) !== -1) {
              entry = { method: 'POST', url: url, at: Date.now(), status: null };
              pixelRequests.push(entry);
            }
          } catch (e) {}
          var p = origFetch.apply(this, arguments);
          if (entry && p && typeof p.then === 'function') {
            p.then(function (res) { try { entry.status = res && res.status; } catch (e) {} },
                   function () { try { entry.status = 'error'; } catch (e) {} });
          }
          return p;
        };
      }
    } catch (e) { console.warn('[Axon Verifier] wrap fetch failed:', e); }

    // --- wrap XMLHttpRequest --------------------------------------------
    try {
      var XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
      if (XHR && typeof XHR.open === 'function' && typeof XHR.send === 'function') {
        var origOpen = XHR.open, origSend = XHR.send;
        XHR.open = function (method, url) {
          try {
            this.__axonVerifyMethod = method && String(method).toUpperCase();
            this.__axonVerifyUrl = url || '';
          } catch (e) {}
          return origOpen.apply(this, arguments);
        };
        XHR.send = function () {
          try {
            var m = this.__axonVerifyMethod, u = this.__axonVerifyUrl || '';
            if (m === 'POST' && u.indexOf(PIXEL_HOST) !== -1) {
              var entry = { method: 'POST', url: u, at: Date.now(), status: null };
              pixelRequests.push(entry);
              var self = this;
              this.addEventListener('loadend', function () {
                try { entry.status = self.status; } catch (e) {}
              });
            }
          } catch (e) {}
          return origSend.apply(this, arguments);
        };
      }
    } catch (e) { console.warn('[Axon Verifier] wrap XHR failed:', e); }

    // --- classifier -----------------------------------------------------
    function isInt(v) {
      if (typeof v === 'number') return Math.floor(v) === v;
      if (v === null || v === undefined || v === '') return false;
      return /^-?\d+$/.test(String(v));
    }
    function classify(event, calls) {
      if (!calls || calls.length === 0) return 'missing';
      var bestColor = 'green';
      for (var i = 0; i < calls.length; i++) {
        var p = calls[i].payload || {};
        var items = Array.isArray(p.items) ? p.items : (p.items ? [p.items] : []);
        var first = items[0] || {};
        var hasCurrency = !!(p.currency || first.currency);
        if (event !== 'page_view') {
          if (items.length === 0) return 'red';
          if (!hasCurrency) return 'red';
          var hasImage = !!first.image_url;
          var hasVariant = first.item_variant_id !== undefined && first.item_variant_id !== null && first.item_variant_id !== '';
          if (!hasImage || !hasVariant || !isInt(first.item_category_id)) bestColor = 'orange';
        }
      }
      return bestColor;
    }
    function summarize(c) {
      try {
        var p = c.payload || {};
        var items = Array.isArray(p.items) ? p.items : (p.items ? [p.items] : []);
        var first = items[0] || {};
        return {
          event: c.event,
          itemsCount: items.length,
          currency: p.currency || first.currency || null,
          value: p.value !== undefined ? p.value : (first.price !== undefined ? first.price : null),
          hasImageUrl: !!first.image_url,
          hasItemVariantId: first.item_variant_id !== undefined && first.item_variant_id !== null && first.item_variant_id !== '',
          hasItemCategoryIdInt: isInt(first.item_category_id),
          ts: c.ts,
          pageUrl: c.pageUrl
        };
      } catch (e) { return { event: c && c.event, error: String(e) }; }
    }

    // --- public API -----------------------------------------------------
    window.__axonVerify = {
      raw: function () { return { axonCalls: axonCalls, pixelRequests: pixelRequests }; },
      clear: function () { axonCalls.length = 0; pixelRequests.length = 0; },
      report: function () {
        var r;
        try {
          var eventKey = null;
          try { eventKey = window.axon && window.axon.eventKey; } catch (e) {}
          var firedByName = {}, callsByEvent = {};
          for (var i = 0; i < REQUIRED.length; i++) { firedByName[REQUIRED[i]] = 0; callsByEvent[REQUIRED[i]] = []; }
          for (var j = 0; j < axonCalls.length; j++) {
            var name = axonCalls[j].event;
            if (firedByName[name] !== undefined) { firedByName[name]++; callsByEvent[name].push(axonCalls[j]); }
          }
          var status = {}, missing = [], firedCount = 0, goodCount = 0;
          for (var k = 0; k < REQUIRED.length; k++) {
            var evt = REQUIRED[k], cls = classify(evt, callsByEvent[evt]);
            status[evt] = cls;
            if (cls === 'missing') missing.push(evt); else firedCount++;
            if (cls === 'green' || cls === 'orange') goodCount++;
          }
          r = {
            generatedAt: new Date().toISOString(),
            pageUrl: location.href,
            pixelLoaded: typeof window.axon === 'function' || (window.axon && typeof window.axon === 'object'),
            eventKeyPresent: !!eventKey,
            eventKey: eventKey ? (String(eventKey).slice(0, 8) + '...') : null,
            axonVersion: (window.axon && window.axon.version) || null,
            axonCalls: axonCalls.map(summarize),
            pixelRequests: pixelRequests.slice(),
            eventsFiredByName: firedByName,
            requiredEventsStatus: status,
            summary: { totalRequired: REQUIRED.length, fired: firedCount, greenOrOrange: goodCount, missing: missing }
          };
        } catch (e) { r = { error: String(e) }; }
        try { console.log(JSON.stringify(r, null, 2)); } catch (e) { console.log(r); }
        return r;
      }
    };

    console.log('[Axon Verifier] Ready. Now:\n  1. Walk your funnel: homepage -> product -> add to cart -> checkout -> (test) purchase\n  2. For Shopify hosted checkout: begin_checkout + purchase fire on checkout.shopify.com -- run this snippet again there.\n  3. When done, run __axonVerify.report() and paste the JSON back to Claude.');
  } catch (outer) {
    try { console.warn('[Axon Verifier] install failed:', outer); } catch (e) {}
  }
})();
