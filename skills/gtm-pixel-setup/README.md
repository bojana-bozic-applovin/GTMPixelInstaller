# gtm-pixel-setup

Claude Code skill that installs the Axon tracking pixel via the Google Tag Manager API in ~5 minutes. No Chrome extension needed. The advertiser signs in with Google once; the rest is automated.

## What it does

Given an Axon event key and the advertiser's site URL, the skill:

1. Runs a pre-flight detection check — platform, GTM container, dataLayer naming — and confirms with the advertiser before writing anything.
2. Authenticates the advertiser's Google account (OAuth 2.0, local-loopback).
3. Auto-detects platform (Shopify, WooCommerce, BigCommerce, Magento, custom), GTM container ID, Stape server-side tagging, and Elevar data layer from the site HTML.
4. Creates a fresh workspace in the matching GTM container.
5. Creates triggers and Custom HTML tags for all required events using the correct event naming for the detected stack.
6. Publishes a new container version.
7. Hands off to the advertiser for Shopify App install (`shopify-headless` track) and event verification.

## Integration tracks

| Track | Used for | Events via GTM | Events via Shopify App |
|---|---|---|---|
| `gtm-only` | WooCommerce, BigCommerce, Magento, custom sites | All 5 | — |
| `shopify-headless` | All Shopify stores with hosted checkout (Liquid, Hydrogen, Next.js) | page_view, view_item, add_to_cart | begin_checkout, purchase |
| `lead-gen` | SaaS / lead-gen sites | page_view, generate_lead | — |

**Why `shopify-headless` uses a split:** GTM cannot be injected on `checkout.shopify.com` — it's a separate Shopify-controlled domain. The Axon Shopify App covers that gap regardless of whether the storefront is Liquid or a headless framework.

## Auto-detection

The detector handles these naming conventions automatically — no user input needed:

| Stack | Trigger event names |
|---|---|
| Standard GA4 | `view_item`, `add_to_cart`, `begin_checkout`, `purchase` |
| Stape server-side GTM | `view_item_stape`, `add_to_cart_stape`, `begin_checkout_stape`, `purchase_stape` |
| Elevar | `dl_view_item`, `dl_add_to_cart`, `dl_begin_checkout`, `dl_purchase` |

If none of the above are detected (custom site with non-standard naming), the skill hands off to the advertiser's developer with the standard names and the [Axon Events & Objects reference](https://support.axon.ai/en/growth/promoting-your-websites/axon-pixel-integration/events-and-objects) rather than guessing.

## Before you start

**Axon Ads Manager**
- An active Axon advertiser account
- Your **Axon event key** — found in Axon Ads Manager → Account Settings → Keys. Looks like `971e76ba-6851-4838-a7ea-60314ee67a6b`

**Google Tag Manager**
- A GTM **Web container** already installed on your site. This skill creates Axon tags and triggers inside an existing container — it does not create the container itself. If you don't have GTM on your site yet, add it first via [tagmanager.google.com](https://tagmanager.google.com)
- A Google account with **Edit and Publish** permission on that container — check in GTM → Admin → User Management

**Your machine**
- Node.js version 20 or higher. Claude will check for this automatically and install it if missing — no action needed unless the automatic install fails, in which case you'll be directed to [nodejs.org](https://nodejs.org/en/download)

**Shopify headless only (Hydrogen / Next.js)**
- GTM must already be installed on your headless frontend before running this skill — the skill writes Axon tags into that container. If it isn't there yet, ask your developer to add it first
- Shopify admin access to install the Axon Shopify App (handles checkout and purchase events on checkout.shopify.com)

## Usage

Advertiser opens Claude Code and says:

> "Install the Axon pixel."

Claude handles the rest — gathering the event key and site URL, running a pre-flight check, publishing tags, and walking through verification.

## File layout

```
gtm-pixel-setup/
├── SKILL.md              # Claude operating instructions
├── README.md             # This file
└── scripts/
    ├── setup.mjs         # CLI entrypoint
    ├── oauth.mjs         # Google OAuth 2.0 local-loopback flow
    ├── gtm-client.mjs    # Tag Manager API v2 wrapper
    ├── detect-site.mjs   # Platform / GTM / Stape / Elevar / dataLayer detector
    ├── tag-templates.mjs # Parameterized tag HTML + trigger specs
    ├── sniff-events.js   # DevTools snippet — identify dataLayer event names
    └── verify-events.js  # DevTools snippet — confirm events fire after publish
```

## CLI reference

```bash
# Pre-flight check (no writes — confirm detection before running)
node scripts/setup.mjs --event-key UUID --site-url https://example.com --dry-run

# Install the pixel (ecommerce)
node scripts/setup.mjs --event-key UUID --site-url https://example.com

# Install the pixel (lead-gen / SaaS — installs page_view + generate_lead only)
node scripts/setup.mjs --event-key UUID --site-url https://example.com --lead-gen

# Explicit container (override auto-detect or pick from multiple)
node scripts/setup.mjs --event-key UUID --site-url https://example.com \
  --account-id 1234567890 --container-id 98765

# Handle existing Axon tags
node scripts/setup.mjs --event-key UUID --site-url https://example.com --cleanup replace
node scripts/setup.mjs --event-key UUID --site-url https://example.com --cleanup skip

# Tune dataLayer naming from sniffer output
node scripts/setup.mjs --event-key UUID --site-url https://example.com --event-names-json ./sniff.json

# Add /cart/add XHR hook tag (for themes that don't push add_to_cart to dataLayer)
node scripts/setup.mjs --event-key UUID --site-url https://example.com --atc-hook

# Utilities
node scripts/setup.mjs --sniff      # print path to sniffer snippet
node scripts/setup.mjs --verify     # print path to verifier snippet
node scripts/setup.mjs --revoke     # delete cached OAuth token
node scripts/setup.mjs --help
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Fatal error (OAuth, API, …) |
| 2 | No matching GTM container |
| 3 | Wrong container type (Server, not Web) |
| 10 | Decision needed — re-run with additional args |
| 64 | Bad CLI arguments |

## Output contract

The script writes progress to **stderr** and a single JSON object to **stdout** on completion:

```json
{
  "status": "ok" | "need_input" | "error",
  "track": "gtm-only" | "shopify-headless" | "lead-gen",
  "version": 42,
  "workspaceId": "123",
  "containerPublicId": "GTM-XXXXXX",
  "shopifyAppLink": "https://apps.shopify.com/axon?shop=xxx.myshopify.com",
  "detected": {
    "platform": "shopify",
    "usesStape": true,
    "usesElevar": false,
    "isSPA": false,
    "spaKind": null
  },
  "eventNames": { "view_item": "view_item_stape", "add_to_cart": "add_to_cart_stape" },
  "error": { "kind": "...", "message": "..." },
  "needInput": { "kind": "container" | "cleanup" | "datalayer_unknown", "options": [...] }
}
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `no_container_match` on Hydrogen/Next.js Shopify site | GTM not yet installed on the headless frontend | Ask dev to add GTM snippet to `app/root.tsx` (Hydrogen) or `app/layout.tsx` (Next.js), then re-run |
| `no_container_match` on other sites | Wrong Google account signed in, or GTM not on the site | Verify Google account; confirm GTM snippet is in the page source |
| `wrong_container_type` | Container is Shopify's Google Tag or a Server container | Use a standard Web container; pass its ID via `--container-id` |
| `datalayer_unknown` | Custom site with unrecognized event names | Ask dev for dataLayer event names; re-run with `--event-names-json` |
| Events missing after publish | dataLayer naming mismatch between trigger and site | Run `--sniff`, collect output, re-run with `--event-names-json` |
| `add_to_cart` missing, others fire | Site doesn't push a standard ATC dataLayer event | Re-run with `--atc-hook` to add the XHR interceptor tag |
| `access_denied` | User declined OAuth consent | Retry, or use the manual skill |
| "An Axon Pixel is already installed on this site" in Ads Manager | Domain bound to a different Axon account | Submit a support ticket at support.axon.ai to clear the domain binding |
| Shopify App events not showing in Ads Manager dashboard | Dashboard lag after install | Wait up to 30 minutes; use the Pixel Helper extension for real-time verification |

## Development

```bash
# Smoke tests (no writes, no network)
node scripts/setup.mjs --help
node scripts/setup.mjs --sniff
node scripts/setup.mjs --verify

# Run the detector against a real site
node -e "import('./scripts/detect-site.mjs').then(m => m.detectSite('https://example.com')).then(r => console.log(JSON.stringify(r, null, 2)))"

# Full dry run against a real site (requires OAuth token cached from a previous run)
node scripts/setup.mjs --event-key <real-uuid> --site-url https://example.com --dry-run
```

---

v1.1 — 2026-05-15
