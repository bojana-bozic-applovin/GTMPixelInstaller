/* ==========================================================================
 * Axon dataLayer Sniffer — pasteable DevTools snippet
 * --------------------------------------------------------------------------
 * PURPOSE:
 *   Captures every window.dataLayer.push() that fires on the site while the
 *   advertiser walks the funnel (homepage -> PDP -> add-to-cart -> checkout).
 *   Produces a JSON summary that Claude's gtm-pixel-setup skill uses to
 *   template Axon tags with the correct event names and field mappings.
 *
 * USAGE:
 *   1. Open the site in Chrome, open DevTools -> Console.
 *   2. Paste this entire file and press Enter.
 *   3. Walk the funnel: view a product, add to cart, start checkout.
 *   4. Run: __axonSniff.report()
 *   5. Copy the JSON output, paste it back into Claude.
 *
 * NOTES:
 *   - Idempotent: pasting twice is safe.
 *   - ES2017 only (no optional chaining, no nullish coalescing).
 *   - Every access is wrapped in try/catch so it cannot break the site.
 * ========================================================================== */

(function () {
  try {
    if (typeof window === 'undefined') return;
    if (window.__axonSniff && window.__axonSniff.__installed) {
      try { console.log('[Axon Sniffer] already installed.'); } catch (e) {}
      return;
    }

    // Deep-ish clone that strips functions, handles cycles, truncates strings.
    function safeClone(v, maxStrLen) {
      var seen = typeof WeakSet === 'function' ? new WeakSet() : null;
      var limit = typeof maxStrLen === 'number' ? maxStrLen : 500;
      function walk(x) {
        try {
          if (x === null || x === undefined) return x;
          var t = typeof x;
          if (t === 'function') return '[fn]';
          if (t === 'string') return x.length > limit ? x.slice(0, limit) + '...[truncated]' : x;
          if (t === 'number' || t === 'boolean') return x;
          if (t !== 'object') return String(x);
          if (seen && seen.has(x)) return '[circular]';
          if (seen) seen.add(x);
          if (Array.isArray(x)) {
            var arr = [];
            for (var i = 0; i < x.length && i < 50; i++) arr.push(walk(x[i]));
            return arr;
          }
          var out = {};
          var keys = Object.keys(x);
          for (var k = 0; k < keys.length && k < 50; k++) out[keys[k]] = walk(x[keys[k]]);
          return out;
        } catch (err) { return '[unserializable]'; }
      }
      return walk(v);
    }

    // Shallow copy of an item, string fields truncated to 60 chars.
    function truncItem(item) {
      try {
        if (!item || typeof item !== 'object') return item;
        var out = {};
        var keys = Object.keys(item);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          var v = item[k];
          if (typeof v === 'string' && v.length > 60) out[k] = v.slice(0, 60) + '...';
          else if (v && typeof v === 'object') out[k] = '[object]';
          else out[k] = v;
        }
        return out;
      } catch (e) { return '[trunc-error]'; }
    }

    function classifyCategoryType(val) {
      if (val === undefined || val === null) return 'missing';
      if (typeof val === 'number' && isFinite(val) && Math.floor(val) === val) return 'integer';
      if (typeof val === 'string' && /^\d+$/.test(val)) return 'integer';
      return 'string';
    }

    function extractMeta(payload) {
      var meta = {
        event: null, topKeys: [], ecommerceKeys: [], firstItemKeys: [],
        firstItem: null, hasImageUrlFlat: false, imageUrlField: false,
        itemCategoryField: 'none', itemCategoryType: 'missing',
        itemVariantField: 'none', hasUserData: false,
        pageUrl: '', ts: new Date().toISOString()
      };
      try {
        meta.pageUrl = location.href;
        if (!payload || typeof payload !== 'object') return meta;
        meta.event = typeof payload.event === 'string' ? payload.event : '(no-event-key)';
        meta.topKeys = Object.keys(payload);
        meta.hasUserData = !!(payload.user_data || payload.userData || payload.user);
        var ec = payload.ecommerce;
        if (ec && typeof ec === 'object') {
          meta.ecommerceKeys = Object.keys(ec);
          var items = Array.isArray(ec.items) ? ec.items : (Array.isArray(ec.products) ? ec.products : null);
          if (items && items.length && typeof items[0] === 'object' && items[0] !== null) {
            var it = items[0];
            meta.firstItemKeys = Object.keys(it);
            meta.firstItem = truncItem(it);
            if ('image_url' in it) { meta.hasImageUrlFlat = true; meta.imageUrlField = 'image_url'; }
            else if ('imageURL' in it) { meta.hasImageUrlFlat = true; meta.imageUrlField = 'imageURL'; }
            if ('item_category_id' in it) meta.itemCategoryField = 'item_category_id';
            else if ('item_category' in it) meta.itemCategoryField = 'item_category';
            var catVal = meta.itemCategoryField !== 'none' ? it[meta.itemCategoryField] : undefined;
            meta.itemCategoryType = classifyCategoryType(catVal);
            if ('item_variant_id' in it) meta.itemVariantField = 'item_variant_id';
            else if ('item_variant' in it) meta.itemVariantField = 'item_variant';
          }
        }
      } catch (e) {}
      return meta;
    }

    var captured = [];

    // Snapshot everything already in dataLayer.
    try {
      if (!Array.isArray(window.dataLayer)) window.dataLayer = window.dataLayer || [];
      if (Array.isArray(window.dataLayer)) {
        for (var i = 0; i < window.dataLayer.length; i++) {
          try {
            var snap = safeClone(window.dataLayer[i], 500);
            captured.push({ meta: extractMeta(snap), payload: snap, source: 'snapshot' });
          } catch (e) {}
        }
      }
    } catch (e) {}

    // Wrap push.
    try {
      var dl = window.dataLayer;
      if (dl && typeof dl.push === 'function') {
        var origPush = dl.push.bind(dl);
        dl.push = function () {
          try {
            for (var a = 0; a < arguments.length; a++) {
              var cloned = safeClone(arguments[a], 500);
              captured.push({ meta: extractMeta(cloned), payload: cloned, source: 'push' });
            }
          } catch (e) {}
          return origPush.apply(dl, arguments);
        };
      }
    } catch (e) {}

    function buildReport() {
      var r = {
        generatedAt: new Date().toISOString(),
        siteUrl: location.origin,
        userAgent: navigator.userAgent,
        totalEventsCaptured: captured.length,
        uniqueEventNames: [],
        eventFieldMap: {},
        dataLayerRaw: []
      };
      try {
        var nameSet = {};
        for (var i = 0; i < captured.length; i++) {
          var m = captured[i].meta;
          var name = m.event || '(no-event-key)';
          nameSet[name] = true;
          if (!r.eventFieldMap[name]) {
            r.eventFieldMap[name] = {
              count: 0, topKeys: m.topKeys || [], ecommerceKeys: m.ecommerceKeys || [],
              firstItemKeys: m.firstItemKeys || [],
              hasImageUrl: m.hasImageUrlFlat ? m.imageUrlField : false,
              itemCategoryField: m.itemCategoryField,
              itemCategoryType: m.itemCategoryType,
              itemVariantField: m.itemVariantField,
              hasUserData: !!m.hasUserData,
              samplePayload: captured[i].payload
            };
          }
          r.eventFieldMap[name].count++;
          if (!r.eventFieldMap[name].hasUserData && m.hasUserData) r.eventFieldMap[name].hasUserData = true;
        }
        r.uniqueEventNames = Object.keys(nameSet);
        var start = Math.max(0, captured.length - 20);
        for (var j = start; j < captured.length; j++) r.dataLayerRaw.push(captured[j].payload);
      } catch (e) { r.error = String(e); }
      return r;
    }

    window.__axonSniff = {
      __installed: true,
      __version: 1,
      report: function () {
        try {
          var r = buildReport();
          console.log(JSON.stringify(r, null, 2));
          return r;
        } catch (e) { console.log('[Axon Sniffer] report error:', e); }
      },
      clear: function () { captured.length = 0; try { console.log('[Axon Sniffer] cleared.'); } catch (e) {} },
      raw: function () { return captured.slice(); }
    };

    try {
      console.log('[Axon Sniffer] Ready. Now:');
      console.log('  1. Visit a product page.');
      console.log('  2. Click Add to Cart.');
      console.log('  3. (Optional) Proceed to checkout.');
      console.log('  4. Run __axonSniff.report() and copy the JSON output.');
    } catch (e) {}
  } catch (outer) {
    try { console.log('[Axon Sniffer] install failed:', outer); } catch (e) {}
  }
})();
