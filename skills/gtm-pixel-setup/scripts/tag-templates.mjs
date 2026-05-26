// GTM tag & trigger template generator for the Axon pixel setup.
// Pure functions: each returns a string (HTML) or a plain object (GTM resource).

const DEFAULT_FIELD_MAP = {
  image_url: ['image_url', 'imageURL'],
  item_variant_id: ['item_variant_id', 'item_variant'],
  item_category_id: ['item_category_id'],
  item_brand: ['item_brand', 'vendor'],
  item_id: ['item_id', 'id', 'product_id'],
  item_name: ['item_name', 'name', 'title', 'product_title'],
  price: ['price', 'final_price'],
  quantity: ['quantity']
};

const CANONICAL = {
  view_item: 'view_item',
  add_to_cart: 'add_to_cart',
  begin_checkout: 'begin_checkout',
  purchase: 'purchase'
};

// Validate a dataLayer/field name is a plain JS identifier so we can safely
// emit `i.<name>` into the generated script without escaping surprises.
function assertSafeIdent(name, label) {
  if (typeof name !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(name)}`);
  }
}

function assertSafeEventName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_:\-.]+$/.test(name)) {
    throw new Error(`Invalid event name: ${JSON.stringify(name)}`);
  }
}

// Build a JS expression that reads an Axon-canonical field from item `i`,
// trying sources in the order given by fieldMap (or defaults).
function srcExpr(canonicalKey, fieldMap) {
  const sources = (fieldMap && fieldMap[canonicalKey]) || DEFAULT_FIELD_MAP[canonicalKey];
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(`fieldMap.${canonicalKey} must be a non-empty array`);
  }
  sources.forEach((s) => assertSafeIdent(s, `fieldMap.${canonicalKey} entry`));
  const parts = sources.map((s) => `i.${s}`);
  return parts.length === 1 ? parts[0] : `(${parts.join('||')})`;
}

// Price reader: handles Shopify cents (int > 100) vs dollar strings/numbers.
// Builds an inline expression using the configured price source list.
function priceExpr(fieldMap) {
  const sources = (fieldMap && fieldMap.price) || DEFAULT_FIELD_MAP.price;
  sources.forEach((s) => assertSafeIdent(s, 'fieldMap.price entry'));
  const parseChain = sources.map((s) => `i.${s}`).join('||');
  // Cents heuristic keyed off the primary price source only.
  const primary = sources[0];
  return `(typeof i.${primary}==='number'&&i.${primary}>100?i.${primary}/100:(parseFloat(${parseChain})||0))`;
}

function quantityExpr(fieldMap) {
  const sources = (fieldMap && fieldMap.quantity) || DEFAULT_FIELD_MAP.quantity;
  sources.forEach((s) => assertSafeIdent(s, 'fieldMap.quantity entry'));
  return sources.map((s) => `i.${s}`).join('||') + '||1';
}

// Shared ecommerce-tag body generator.
function ecommerceTagHtml({ eventName, canonicalName, fieldMap, extraFields }) {
  assertSafeEventName(eventName);
  const fm = fieldMap || {};

  const readItemId = srcExpr('item_id', fm);
  const readItemName = srcExpr('item_name', fm);
  const readImage = srcExpr('image_url', fm);
  const readVariant = srcExpr('item_variant_id', fm);
  const readPrice = priceExpr(fm);
  const readQty = quantityExpr(fm);

  const ecSearch =
    `var ec=(function(){var dl=window.dataLayer||[];var ev=arguments[0];` +
    `for(var i=dl.length-1;i>=0;i--){if((!ev||dl[i].event===ev)&&dl[i].ecommerce)return dl[i].ecommerce;}` +
    `return{};})(${JSON.stringify(eventName)});`;

  const mapItems =
    `var items=(ec.items||[]).map(function(i){` +
      `var o={` +
        `item_id:String(${readItemId}||''),` +
        `item_name:${readItemName}||'',` +
        `price:${readPrice},` +
        `quantity:${readQty}` +
      `};` +
      `var img=${readImage};` +
      `if(img)o.image_url=(img.indexOf('//')===0?'https:'+img:img);` +
      `var v=${readVariant};` +
      `if(v)o.item_variant_id=String(v);` +
      `if(i.item_category_id)o.item_category_id=i.item_category_id;` +
      `if(i.item_brand||i.vendor)o.item_brand=i.item_brand||i.vendor;` +
      `if(i.item_list_id)o.item_list_id=i.item_list_id;` +
      `if(i.affiliation)o.affiliation=i.affiliation;` +
      `return o;` +
    `});`;

  const fallback = `if(!items.length)items=[{item_id:'unknown',item_name:'',price:0,quantity:1}];`;
  const value = `var value=ec.value||(items[0]?items[0].price*(items[0].quantity||1):0);`;

  const udExtract =
    `var ud=ec.user_data||null;` +
    `if(!ud){var dl2=window.dataLayer||[];` +
    `for(var j=dl2.length-1;j>=0;j--){` +
      `if(dl2[j]&&dl2[j].user_data){ud=dl2[j].user_data;break;}` +
    `}}`;

  const payloadExtras = extraFields ? ',' + extraFields : '';
  const track =
    `var p={items:items,currency:ec.currency||'USD',value:value${payloadExtras}};` +
    `if(ud)p.user_data=ud;` +
    `axon('track',${JSON.stringify(canonicalName)},p);`;

  return `<script>\n(function(){\n${ecSearch}\n${mapItems}\n${fallback}\n${value}\n${udExtract}\n${track}\n})();\n</script>`;
}

// ---- Tag HTML generators ---------------------------------------------------

export function initTagHtml({ eventKey } = {}) {
  if (typeof eventKey !== 'string' || eventKey.length === 0) {
    throw new Error('initTagHtml: eventKey is required');
  }
  // JSON.stringify gives us a safely-escaped double-quoted JS string literal.
  const keyLiteral = JSON.stringify(eventKey);
  return `<script>
var AXON_EVENT_KEY = ${keyLiteral};
!function(e,r){
  var t=["https://s.axon.ai/pixel.js","https://res4.applovin.com/p/l/loader.iife.js"];
  if(!e.axon){
    var a=e.axon=function(){
      a.performOperation?a.performOperation.apply(a,arguments):a.operationQueue.push(arguments)
    };
    a.operationQueue=[];
    a.ts=Date.now();
    a.eventKey=AXON_EVENT_KEY;
    for(var n=r.getElementsByTagName("script")[0],o=0;o<t.length;o++){
      var i=r.createElement("script");
      i.async=!0;
      i.src=t[o];
      n.parentNode.insertBefore(i,n);
    }
  }
}(window,document);
axon("init");
</script>`;
}

export function pageViewTagHtml() {
  return `<script>axon("track","page_view",{});</script>`;
}

export function viewItemTagHtml({ eventName, fieldMap } = {}) {
  return ecommerceTagHtml({
    eventName,
    canonicalName: CANONICAL.view_item,
    fieldMap
  });
}

export function addToCartTagHtml({ eventName, fieldMap } = {}) {
  return ecommerceTagHtml({
    eventName,
    canonicalName: CANONICAL.add_to_cart,
    fieldMap
  });
}

export function beginCheckoutTagHtml({ eventName, fieldMap, dedupeId } = {}) {
  const extras = dedupeId ? `dedupe_id:ec.transaction_id||''` : '';
  return ecommerceTagHtml({
    eventName,
    canonicalName: CANONICAL.begin_checkout,
    fieldMap,
    extraFields: extras || undefined
  });
}

export function purchaseTagHtml({ eventName, fieldMap, dedupeId } = {}) {
  const base = `shipping:ec.shipping||0,tax:ec.tax||0,transaction_id:ec.transaction_id||''`;
  const extras = dedupeId ? `${base},dedupe_id:ec.transaction_id||''` : base;
  return ecommerceTagHtml({
    eventName,
    canonicalName: CANONICAL.purchase,
    fieldMap,
    extraFields: extras
  });
}

export function generateLeadTagHtml({ eventName = 'generate_lead' } = {}) {
  assertSafeEventName(eventName);
  const evLiteral = JSON.stringify(eventName);
  return `<script>
(function(){
var ec=(function(){var dl=window.dataLayer||[];var ev=${evLiteral};for(var i=dl.length-1;i>=0;i--){if(dl[i].event===ev){return dl[i].ecommerce||dl[i];}}return{};}());
var ud=ec.user_data||null;
if(!ud){var dl2=window.dataLayer||[];for(var j=dl2.length-1;j>=0;j--){if(dl2[j]&&dl2[j].user_data){ud=dl2[j].user_data;break;}}}
var p={currency:ec.currency||'USD',value:parseFloat(ec.value||ec.revenue||0)||0};
if(ud)p.user_data=ud;
axon('track','generate_lead',p);
})();
</script>`;
}

// ---- Trigger builders ------------------------------------------------------

export function initializationTrigger(name = 'Axon -- Initialization') {
  return { name, type: 'init' };
}

export function allPagesTrigger(name = 'Axon -- All Pages') {
  return { name, type: 'pageview' };
}

export function customEventTrigger({ name, eventName } = {}) {
  if (!name) throw new Error('customEventTrigger: name is required');
  assertSafeEventName(eventName);
  return {
    name,
    type: 'customEvent',
    customEventFilter: [
      {
        type: 'equals',
        parameter: [
          { type: 'template', key: 'arg0', value: '{{_event}}' },
          { type: 'template', key: 'arg1', value: eventName }
        ]
      }
    ]
  };
}

export function pageUrlContainsTrigger({ name, urlSubstring } = {}) {
  if (!name) throw new Error('pageUrlContainsTrigger: name is required');
  if (typeof urlSubstring !== 'string' || urlSubstring.length === 0) {
    throw new Error('pageUrlContainsTrigger: urlSubstring is required');
  }
  return {
    name,
    type: 'pageview',
    filter: [
      {
        type: 'contains',
        parameter: [
          { type: 'template', key: 'arg0', value: '{{Page URL}}' },
          { type: 'template', key: 'arg1', value: urlSubstring }
        ]
      }
    ]
  };
}

// ---- Tag spec builder ------------------------------------------------------

export function customHtmlTag({ name, html, firingTriggerId, priority } = {}) {
  if (!name) throw new Error('customHtmlTag: name is required');
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('customHtmlTag: html is required');
  }
  if (!Array.isArray(firingTriggerId) || firingTriggerId.length === 0) {
    throw new Error('customHtmlTag: firingTriggerId must be a non-empty array');
  }

  const tag = {
    name,
    type: 'html',
    parameter: [
      { type: 'template', key: 'html', value: html },
      { type: 'boolean', key: 'supportDocumentWrite', value: 'false' }
    ],
    firingTriggerId: firingTriggerId.map(String)
  };

  if (priority !== undefined && priority !== null) {
    tag.priority = { type: 'integer', key: 'priority', value: String(priority) };
  }

  return tag;
}
