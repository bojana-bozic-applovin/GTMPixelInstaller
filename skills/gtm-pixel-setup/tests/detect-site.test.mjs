// Unit tests for Shopline/Shoplazza detection and the gtag->dataLayer bridge.
// Run: node --test  (from skills/gtm-pixel-setup)
//
// Platform fixtures under tests/fixtures/ are real marker-bearing lines pulled
// from live storefronts (3 Shopline + 3 Shoplazza, incl. custom domains), so the
// regexes are validated against real CDN/runtime strings, not hand-written HTML.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { detectPlatform, usesGtagEcommerceFor } from '../scripts/detect-site.mjs';
import { gtagBridgeTagHtml } from '../scripts/tag-templates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

// ---- Shopline detection (incl. custom .tw / .hk domains) ----
for (const f of ['shopline-cloudy.html', 'shopline-tami.html', 'shopline-yogiyogi.html']) {
  test(`detects Shopline from ${f}`, () => {
    assert.equal(detectPlatform(fixture(f)), 'shopline');
  });
}

// ---- Shoplazza detection ----
for (const f of ['shoplazza-analoglamb.html', 'shoplazza-fsjshoes.html', 'shoplazza-oshoplive.html']) {
  test(`detects Shoplazza from ${f}`, () => {
    assert.equal(detectPlatform(fixture(f)), 'shoplazza');
  });
}

// ---- usesGtagEcommerce flag is set for the two gtag platforms only ----
test('usesGtagEcommerceFor is true for shopline/shoplazza, false otherwise', () => {
  assert.equal(usesGtagEcommerceFor('shopline'), true);
  assert.equal(usesGtagEcommerceFor('shoplazza'), true);
  for (const p of ['shopify', 'woocommerce', 'bigcommerce', 'magento', 'custom']) {
    assert.equal(usesGtagEcommerceFor(p), false);
  }
});

// ---- Regression: existing platforms still detected ----
test('existing platform fingerprints are unaffected', () => {
  assert.equal(detectPlatform('<script src="https://cdn.shopify.com/x.js"></script>'), 'shopify');
  assert.equal(detectPlatform('<link href="/wp-content/plugins/woocommerce/a.css">'), 'woocommerce');
  assert.equal(detectPlatform('<div class="bc-sf-filter"></div>'), 'bigcommerce');
  assert.equal(detectPlatform('<script>Magento_Theme</script>'), 'magento');
  assert.equal(detectPlatform('<html><body>just a site</body></html>'), 'custom');
});

// ---- False-positive guard: vendor-mention pages are NOT Shoplazza stores ----
// Real noise from the wild: news/theme sites that merely link shoplazza.cn or
// reference a "shoplazza" plugin image. These must fall through to 'custom'.
test('vendor-mention pages do not false-match Shoplazza', () => {
  const noise = `<a href="https://www.shoplazza.cn/" target="_blank">shoplazza</a>
    <img src="/partners/images/shoplazza.jpg"> 店匠shoplazza一键采集插件`;
  assert.equal(detectPlatform(noise), 'custom');
});

// ---- gtag->dataLayer bridge behaviour ----
function runBridge() {
  const html = gtagBridgeTagHtml();
  const js = html.replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
  const window = { dataLayer: [] };
  // eslint-disable-next-line no-new-func
  new Function('window', js)(window);
  return window;
}

test('bridge translates a gtag view_item arg-array into an Axon dataLayer event', () => {
  const window = runBridge();
  window.dataLayer.push(['event', 'view_item', { currency: 'USD', value: 10, items: [{ item_id: 'A1' }] }]);
  const bridged = window.dataLayer.find((e) => e && e.event === 'axon_view_item');
  assert.ok(bridged, 'expected an axon_view_item push');
  assert.equal(bridged.ecommerce.currency, 'USD');
  assert.equal(bridged.ecommerce.items[0].item_id, 'A1');
});

test('bridge sweeps events that fired before it installed (backlog)', () => {
  // Simulate gtag having already pushed before the bridge tag ran.
  const html = gtagBridgeTagHtml();
  const js = html.replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
  const window = { dataLayer: [['event', 'purchase', { transaction_id: 'T9', value: 42, items: [] }]] };
  // eslint-disable-next-line no-new-func
  new Function('window', js)(window);
  const bridged = window.dataLayer.find((e) => e && e.event === 'axon_purchase');
  assert.ok(bridged, 'expected backlog purchase to be bridged');
  assert.equal(bridged.ecommerce.transaction_id, 'T9');
});

test('bridge ignores non-ecommerce gtag events and avoids re-processing its own output', () => {
  const window = runBridge();
  window.dataLayer.push(['event', 'page_view', { page_location: '/x' }]); // not in MAP
  window.dataLayer.push(['config', 'G-XXXX', {}]);                         // not an event
  const bridgedCount = window.dataLayer.filter((e) => e && typeof e.event === 'string' && e.event.startsWith('axon_')).length;
  assert.equal(bridgedCount, 0);
});
