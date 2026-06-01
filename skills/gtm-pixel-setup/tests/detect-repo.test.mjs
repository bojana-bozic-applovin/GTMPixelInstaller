// Unit + integration tests for the self-built-frontend repo scanner.
// Run: node --test  (from skills/gtm-pixel-setup)
//
// detectFramework / scanContent / suggestFiles are pure and tested directly.
// detectRepo walks the filesystem, so it's exercised against a throwaway repo
// built under os.tmpdir() and removed afterwards.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectFramework,
  scanContent,
  suggestFiles,
  detectRepo,
} from '../scripts/detect-repo.mjs';

// ---- detectFramework: deps + layout decide framework/router ----

test('detectFramework picks Next.js App Router when app/layout exists', () => {
  const r = detectFramework({ dependencies: { next: '14.0.0' } }, ['/r/app/layout.tsx']);
  assert.deepEqual(r, { framework: 'nextjs', router: 'app' });
});

test('detectFramework falls back to Next.js Pages Router without app/layout', () => {
  const r = detectFramework({ dependencies: { next: '13.0.0' } }, ['/r/pages/_document.tsx']);
  assert.deepEqual(r, { framework: 'nextjs', router: 'pages' });
});

test('detectFramework recognises Shopify Hydrogen ahead of React', () => {
  const r = detectFramework({ dependencies: { '@shopify/hydrogen': '2024.1.0', react: '18' } }, []);
  assert.equal(r.framework, 'shopify-hydrogen');
});

test('detectFramework recognises Nuxt, Vue, and React in precedence order', () => {
  assert.equal(detectFramework({ dependencies: { nuxt: '3' } }, []).framework, 'nuxt');
  assert.equal(detectFramework({ dependencies: { vue: '3' } }, []).framework, 'vue');
  assert.equal(detectFramework({ dependencies: { react: '18' } }, []).framework, 'react');
});

test('detectFramework reads devDependencies too', () => {
  assert.equal(detectFramework({ devDependencies: { vue: '3' } }, []).framework, 'vue');
});

test('detectFramework returns static for a plain index.html and unknown otherwise', () => {
  assert.equal(detectFramework({}, ['/r/public/index.html']).framework, 'static');
  assert.deepEqual(detectFramework({}, ['/r/main.go']), { framework: 'unknown', router: null });
});

// ---- scanContent: GTM ids, libs, dataLayer, event names ----

test('scanContent extracts every GTM container id it sees', () => {
  const s = scanContent("a GTM-ABC12 and GTM-XYZ9876 here");
  assert.deepEqual(s.gtmIds.sort(), ['GTM-ABC12', 'GTM-XYZ9876']);
});

test('scanContent flags a known GTM library even with no inline id', () => {
  assert.equal(scanContent("import { GoogleTagManager } from '@next/third-parties/google'").hasGtmLib, true);
  assert.equal(scanContent("import TagManager from 'react-gtm-module'").hasGtmLib, true);
  assert.equal(scanContent("just some unrelated code").hasGtmLib, false);
});

test('scanContent detects dataLayer usage', () => {
  assert.equal(scanContent('window.dataLayer = window.dataLayer || [];').hasDataLayer, true);
  assert.equal(scanContent("dataLayer.push({ event: 'x' })").hasDataLayer, true);
  assert.equal(scanContent('no analytics here').hasDataLayer, false);
});

test('scanContent picks up GA4 event names in string and event: forms', () => {
  const s = scanContent("track('view_item'); push({ event: \"purchase\" }); 'generate_lead'");
  assert.ok(s.events.includes('view_item'));
  assert.ok(s.events.includes('purchase'));
  assert.ok(s.events.includes('generate_lead'));
  assert.ok(!s.events.includes('add_to_cart'));
});

// ---- suggestFiles: entry points + business-logic files ----

test('suggestFiles surfaces framework entry files and product/cart/checkout files', () => {
  const out = suggestFiles([
    '/r/app/layout.tsx',
    '/r/src/components/ProductCard.tsx',
    '/r/src/pages/checkout.tsx',
    '/r/src/utils/format.ts',          // neither entry nor business — should drop
  ]);
  assert.ok(out.includes('/r/app/layout.tsx'));
  assert.ok(out.some((f) => /ProductCard/.test(f)));
  assert.ok(out.some((f) => /checkout/.test(f)));
  assert.ok(!out.includes('/r/src/utils/format.ts'));
});

// ---- detectRepo: end-to-end over a temp Next.js repo ----

test('detectRepo analyses a Next.js App Router repo end to end', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'detect-repo-'));
  try {
    await mkdir(join(dir, 'app'), { recursive: true });
    await mkdir(join(dir, 'app', 'product'), { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'demo-storefront',
      dependencies: { next: '14.2.0', react: '18.3.0' },
    }));
    await writeFile(join(dir, 'app', 'layout.tsx'), 'export default function L({ children }) { return children; }');
    await writeFile(
      join(dir, 'app', 'product', 'page.tsx'),
      "window.dataLayer.push({ event: 'view_item', value: 1 });",
    );

    const r = await detectRepo(dir);
    assert.equal(r.framework, 'nextjs');
    assert.equal(r.router, 'app');
    assert.equal(r.packageName, 'demo-storefront');
    assert.equal(r.hasGtm, false);                       // no GTM installed yet
    assert.equal(r.hasDataLayer, true);
    assert.ok(r.dataLayerEvents.includes('view_item'));
    // view_item is present, so it's not in the missing list; the rest are.
    assert.ok(!r.missingEcommerceEvents.includes('view_item'));
    assert.ok(r.missingEcommerceEvents.includes('purchase'));
    assert.deepEqual(r.missingLeadEvents, ['generate_lead']);
    assert.ok(r.suggestedFiles.some((f) => /app\/layout\.tsx$/.test(f)));
    assert.ok(r.suggestedFiles.some((f) => /product/.test(f)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detectRepo reports existing GTM when a container id is in the source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'detect-repo-gtm-'));
  try {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'has-gtm', dependencies: { react: '18' } }));
    await writeFile(join(dir, 'index.html'), '<script>GTM-LIVE99</script>');
    const r = await detectRepo(dir);
    assert.equal(r.hasGtm, true);
    assert.ok(r.gtmContainerIds.includes('GTM-LIVE99'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
