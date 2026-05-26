// detect-site.mjs
// Lightweight HTML-based storefront detector. Falls back to Playwright for SPAs.

import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (compatible; AxonPixelInstaller/1.0)';
const TIMEOUT_MS = 10_000;

const EVENT_NAME_CANDIDATES = [
  'view_item_stape', 'add_to_cart_stape', 'page_view_stape', 'purchase_stape',
  'begin_checkout_stape', 'view_item_list_stape', 'select_item_stape',
  'view_item', 'add_to_cart', 'page_view', 'purchase', 'begin_checkout',
  'view_item_list', 'select_item', 'remove_from_cart', 'add_payment_info',
  'add_shipping_info', 'view_cart',
  'cart:add', 'cart:update', 'product:view',
  'dl_add_to_cart', 'dl_view_item', 'dl_purchase', 'dl_begin_checkout',
  'dl_view_item_list', 'dl_select_item', 'dl_remove_from_cart',
];

function canonicalizeUrl(input) {
  let u = String(input || '').trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '');
  return u;
}

async function fetchHtml(url, errors) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const finalUrl = res.url || url;
    if (!res.ok) {
      errors.push(`fetch ${url} -> HTTP ${res.status}`);
      return { html: '', finalUrl };
    }
    const html = await res.text();
    return { html, finalUrl };
  } catch (err) {
    errors.push(`fetch ${url} -> ${err?.name || 'Error'}: ${err?.message || String(err)}`);
    return { html: '', finalUrl: url };
  } finally {
    clearTimeout(t);
  }
}

function detectPlatform(html) {
  if (/cdn\.shopify\.com|\.myshopify\.com|window\.Shopify\b|<meta[^>]+shopify/i.test(html)) {
    return 'shopify';
  }
  if (/wp-content\/plugins\/woocommerce|<meta[^>]+generator[^>]+WooCommerce/i.test(html)) {
    return 'woocommerce';
  }
  if (/bigcommerce\.com\/s-|bc-sf-filter/i.test(html)) {
    return 'bigcommerce';
  }
  if (/Mage\.Cookies|mage\/requirejs-config|Magento_Theme/i.test(html)) {
    return 'magento';
  }
  return 'custom';
}

function extractShopifyShop(html) {
  const m1 = html.match(/Shopify\.shop\s*=\s*["']([a-z0-9-]+\.myshopify\.com)["']/i);
  if (m1) return m1[1].toLowerCase();
  const m2 = html.match(/["'=\/]([a-z0-9-]+\.myshopify\.com)/i);
  if (m2) return m2[1].toLowerCase();
  return null;
}

function extractGtmIds(html) {
  const re = /GTM-([A-Z0-9]{5,8})/g;
  const out = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = 'GTM-' + m[1];
    out.add(id);
  }
  return [...out];
}

function detectSpa(html) {
  if (/__NEXT_DATA__|\/_next\/static/.test(html)) return { isSPA: true, spaKind: 'next' };
  if (/__NUXT__|\/_nuxt\//.test(html)) return { isSPA: true, spaKind: 'nuxt' };
  if (/data-shopify-hydrogen|hydrogen\.config|shopify-hydrogen/i.test(html)) {
    return { isSPA: true, spaKind: 'hydrogen' };
  }
  const hasRoot = /id=["']root["']/.test(html);
  const reactish = /react(-dom)?(\.production|\.development)?\.min\.js|__REACT_DEVTOOLS_GLOBAL_HOOK__|data-reactroot/i.test(html);
  if (hasRoot && reactish) return { isSPA: true, spaKind: 'custom-spa' };
  return { isSPA: false, spaKind: null };
}

function productUrlPatternFor(platform, html) {
  if (platform === 'magento') {
    if (!/\/product\//i.test(html)) return '.html';
  }
  return '/products/';
}

function extractSampleProductUrl(html, baseUrl) {
  const m = html.match(/href=["']([^"']*\/products?\/[^"'?#]+)["']/i);
  if (!m) return null;
  try {
    return new URL(m[1], baseUrl).toString();
  } catch {
    return null;
  }
}

function detectStape(html) {
  // Match stape.io CDN, _stape event suffix, stape_gtm, or Shopify app extension slug
  return /stape\.io|_stape|stape_gtm|stape-remix|stape-ga4/i.test(html);
}

function detectElevar(html) {
  // Match Elevar CDN, data layer variable name, or global object
  return /static\.elevar\.com|elevar-data-layer|ElDataLayer|window\.ElevarDataLayer/i.test(html);
}

function extractEventNames(html) {
  const found = new Set();
  for (const name of EVENT_NAME_CANDIDATES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`['"\`]${escaped}['"\`]`);
    if (re.test(html)) found.add(name);
  }
  return [...found];
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').trim().slice(0, 300);
}

function detectHostedCheckout(platform, html) {
  if (platform !== 'shopify') return false;
  // Default TRUE for Shopify; only flip false on very strong evidence.
  const selfHostedHint = /checkout\.liquid|"checkout_url"\s*:\s*"\/checkout/i.test(html);
  return !selfHostedHint;
}

async function playwrightScan(url, errors) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'User-Agent': UA });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
    const html = await page.content();
    await browser.close();
    return html;
  } catch (err) {
    errors.push(`playwright scan: ${err?.message || String(err)}`);
    try { await browser?.close(); } catch {}
    return '';
  }
}

export async function detectSite(siteUrl) {
  const errors = [];
  const canonical = canonicalizeUrl(siteUrl);

  const result = {
    siteUrl: canonical,
    platform: 'custom',
    shopifyShop: null,
    isHostedCheckout: false,
    gtmContainerIds: [],
    isSPA: false,
    spaKind: null,
    productUrlPattern: '/products/',
    sampleProductUrl: null,
    usesStape: false,
    usesElevar: false,
    dataLayerEventNames: [],
    title: '',
    errors,
  };

  const { html: homeHtml, finalUrl: homeFinalUrl } = await fetchHtml(canonical, errors);

  try {
    if (homeHtml) {
      result.platform = detectPlatform(homeHtml);
      result.shopifyShop = result.platform === 'shopify' ? extractShopifyShop(homeHtml) : null;
      result.isHostedCheckout = detectHostedCheckout(result.platform, homeHtml);
      result.gtmContainerIds = extractGtmIds(homeHtml);
      const spa = detectSpa(homeHtml);
      result.isSPA = spa.isSPA;
      result.spaKind = spa.spaKind;
      result.productUrlPattern = productUrlPatternFor(result.platform, homeHtml);
      result.sampleProductUrl = extractSampleProductUrl(homeHtml, homeFinalUrl);
      result.usesStape = detectStape(homeHtml);
      result.usesElevar = detectElevar(homeHtml);
      result.dataLayerEventNames = extractEventNames(homeHtml);
      result.title = extractTitle(homeHtml);
    }
  } catch (err) {
    errors.push(`homepage parse: ${err?.message || String(err)}`);
  }

  // Playwright fallback for SPAs where GTM is injected client-side
  if (result.gtmContainerIds.length === 0 && result.isSPA) {
    const renderedHtml = await playwrightScan(canonical, errors);
    if (renderedHtml) {
      const ids = extractGtmIds(renderedHtml);
      if (ids.length) result.gtmContainerIds = ids;
      if (!result.usesStape && detectStape(renderedHtml)) result.usesStape = true;
      if (!result.usesElevar && detectElevar(renderedHtml)) result.usesElevar = true;
      const evts = extractEventNames(renderedHtml);
      if (evts.length) {
        const merged = new Set([...result.dataLayerEventNames, ...evts]);
        result.dataLayerEventNames = [...merged];
      }
    }
  }

  if (result.sampleProductUrl) {
    const { html: prodHtml } = await fetchHtml(result.sampleProductUrl, errors);
    if (prodHtml) {
      try {
        const prodEvents = extractEventNames(prodHtml);
        const merged = new Set([...result.dataLayerEventNames, ...prodEvents]);
        result.dataLayerEventNames = [...merged];
        if (!result.usesStape && detectStape(prodHtml)) result.usesStape = true;
        if (!result.usesElevar && detectElevar(prodHtml)) result.usesElevar = true;
        const prodGtm = extractGtmIds(prodHtml);
        if (prodGtm.length) {
          const mergedGtm = new Set([...result.gtmContainerIds, ...prodGtm]);
          result.gtmContainerIds = [...mergedGtm];
        }
      } catch (err) {
        errors.push(`product parse: ${err?.message || String(err)}`);
      }
    }
  }

  return result;
}
