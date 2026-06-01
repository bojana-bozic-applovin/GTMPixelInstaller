# dataLayer events for self-built frontends

Axon GTM tags read **GA4-style** `ecommerce` objects from `window.dataLayer`. Self-built sites should push **standard names**: `view_item`, `add_to_cart`, `begin_checkout`, `purchase`, `generate_lead`.

Spec: [Axon Events and objects](https://support.axon.ai/en/growth/promoting-your-websites/axon-pixel-integration/events-and-objects)

---

## Required by account type

| Type | Push from frontend | GTM handles |
|------|-------------------|-------------|
| Ecommerce | `view_item`, `add_to_cart`, `begin_checkout`, `purchase` | `page_view` via All Pages tag |
| Lead-gen | `generate_lead` | `page_view` via All Pages tag |

Shopify headless storefront: only `view_item` + `add_to_cart`; checkout events via Shopify App.

---

## Item fields (`ecommerce.items[]`)

| Field | Required | Notes |
|-------|----------|-------|
| `item_id` | Yes | string |
| `item_name` | Recommended | |
| `price` | Recommended | dollars, not cents |
| `quantity` | Recommended; required for ATC/purchase | |
| `item_variant_id` | Recommended | |
| `image_url` | Recommended | full URL |

---

## Examples

```javascript
window.dataLayer = window.dataLayer || [];

// view_item — product page mount
window.dataLayer.push({
  event: 'view_item',
  ecommerce: {
    currency: 'USD',
    value: 29.99,
    items: [{ item_id: 'SKU1', item_name: 'Product', price: 29.99, quantity: 1 }],
  },
});

// add_to_cart — after successful add
window.dataLayer.push({
  event: 'add_to_cart',
  ecommerce: { currency: 'USD', value: 29.99, items: [{ item_id: 'SKU1', item_name: 'Product', price: 29.99, quantity: 1 }] },
});

// begin_checkout
window.dataLayer.push({
  event: 'begin_checkout',
  ecommerce: { currency: 'USD', value: 59.98, items: [{ item_id: 'SKU1', item_name: 'Product', price: 29.99, quantity: 2 }] },
});

// purchase — order confirmation
window.dataLayer.push({
  event: 'purchase',
  ecommerce: {
    transaction_id: 'ORDER-123',
    currency: 'USD',
    value: 100,
    tax: 8,
    shipping: 5,
    items: [{ item_id: 'SKU1', item_name: 'Product', price: 50, quantity: 2 }],
  },
});

// generate_lead — form success
window.dataLayer.push({
  event: 'generate_lead',
  currency: 'USD',
  value: 0,
});
```

---

## Where to hook

| Event | Search repo for |
|-------|-----------------|
| `view_item` | product page, `[slug]`, `ProductDetail` |
| `add_to_cart` | `addToCart`, cart API success |
| `begin_checkout` | `/checkout`, checkout button |
| `purchase` | thank-you / order confirmation |
| `generate_lead` | form `onSubmit` success |

Only add missing events. Confirm plan with advertiser before editing.
