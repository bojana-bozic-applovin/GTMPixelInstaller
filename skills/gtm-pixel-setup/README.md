# gtm-pixel-setup

Claude Code skill that installs the Axon pixel via the Google Tag Manager API in
~5 minutes. No Chrome extension. The advertiser signs in with Google once; the
rest is automated.

## What it does
Given an Axon event key and site URL:
1. **Pre-flight** detection (platform, GTM container, dataLayer naming) — confirms before writing.
2. **OAuth** into the advertiser's Google account (local-loopback).
3. **Detects** platform (Shopify, WooCommerce, BigCommerce, Magento, Shopline, Shoplazza, custom), GTM container, and Stape / Elevar / GA4-gtag dataLayer.
4. **No GTM on the site?** Offers to create a Web container and returns an install snippet to paste, then re-checks it's live before continuing.
5. **Creates** triggers + Custom HTML tags in a fresh workspace and publishes.
6. **Hands off** for Shopify App install (`shopify-headless`) and tap-through verification.

## Integration tracks
| Track | Used for | Events via GTM | Via Shopify App |
|---|---|---|---|
| `gtm-only` | WooCommerce, BigCommerce, Magento, Shopline, Shoplazza, custom | All 5 | — |
| `shopify-headless` | Shopify, hosted checkout (Liquid, Hydrogen, Next.js) | page_view, view_item, add_to_cart | begin_checkout, purchase |
| `lead-gen` | SaaS / lead-gen | page_view, generate_lead | — |

`shopify-headless` splits because GTM can't run on `checkout.shopify.com` — the Axon
Shopify App covers that domain.

## Auto-detection
| Stack | Trigger event names |
|---|---|
| Standard GA4 | `view_item`, `add_to_cart`, `begin_checkout`, `purchase` |
| Stape | `view_item_stape`, … |
| Elevar | `dl_view_item`, … |
| GA4 `gtag()` — Shopline, Shoplazza | bridged to `axon_view_item`, … via an injected gtag→dataLayer bridge tag |

Custom/unrecognized naming → hands off to the dev with the standard names and the
[Axon Events reference](https://support.axon.ai/en/growth/promoting-your-websites/axon-pixel-integration/events-and-objects) rather than guessing.

## Before you start
- **Axon event key** (Ads Manager → Account Settings → Keys) and your **site URL**.
- **Google account** with Edit + Publish on a GTM **Web** container. No container?
  The skill can create one (it asks first); you'll paste the returned snippet into
  your site to finish.
- **Node 20+** (auto-checked/installed).
- **Verification:** Chrome for the Axon Pixel Helper; a test order to confirm
  `purchase` is recommended.
- **Shopify only** (not for the all-GTM platforms above): admin access to your
  Shopify store to install the Axon Shopify App. Headless (Hydrogen/Next.js) with
  no GTM yet — the skill creates the container; you or your developer add the
  snippet to the frontend and deploy.

## Usage
Open Claude Code and say **"Install the Axon pixel."** Claude gathers the event key
and site URL, runs pre-flight, publishes, and walks through verification.

## CLI reference
```bash
node scripts/setup.mjs --event-key UUID --site-url URL [opts]

--dry-run                 Pre-flight only — no writes
--lead-gen                Install page_view + generate_lead only
--public-id GTM-XXXX      Target an existing container
--create-container        No GTM on site? Create one (asks which account)
--skip-snippet-check      Skip the post-paste "is the snippet live?" re-check
--account-id / --container-id   Pick a specific container
--cleanup replace|skip    Handle existing Axon tags
--event-names-json PATH   Tune dataLayer naming from sniffer output
--atc-hook                Add the /cart/add XHR hook tag
--sniff | --verify | --revoke | --help
```

## Exit codes
`0` success · `1` fatal · `2` no matching container · `3` wrong container type ·
`10` decision needed (re-run with args) · `64` bad arguments

## Output contract
Progress on **stderr**; one JSON object on **stdout**:
```json
{
  "status": "ok" | "need_input" | "error",
  "track": "gtm-only" | "shopify-headless" | "lead-gen",
  "version": 42,
  "containerPublicId": "GTM-XXXXXX",
  "detected": { "platform": "shopline", "usesStape": false, "usesElevar": false,
                "usesGtagEcommerce": true, "gtagBridge": true, "spaKind": null },
  "eventNames": { "view_item": "axon_view_item", "add_to_cart": "axon_add_to_cart" },
  "error": { "kind": "...", "message": "..." },
  "needInput": { "kind": "container | no_gtm_container | select_account | paste_snippet | snippet_not_detected | cleanup | datalayer_unknown", "options": [] }
}
```

## File layout
```
gtm-pixel-setup/
├── SKILL.md              # Claude operating instructions
├── README.md             # This file
├── tests/                # node:test suite + real-storefront fixtures
└── scripts/
    ├── setup.mjs         # CLI entrypoint
    ├── oauth.mjs         # Google OAuth 2.0 local-loopback
    ├── gtm-client.mjs    # Tag Manager API v2 wrapper (incl. createContainer)
    ├── detect-site.mjs   # Platform / GTM / Stape / Elevar / gtag detector
    ├── tag-templates.mjs # Tag HTML, trigger specs, gtag bridge, GTM snippet
    ├── sniff-events.js   # DevTools snippet — identify dataLayer event names
    └── verify-events.js  # DevTools snippet — confirm events fire
```

## Troubleshooting
| Symptom | Fix |
|---|---|
| No GTM on the site | Re-run with `--create-container`; paste the returned snippet, then re-run with `--public-id` |
| `no_container_match` (Hydrogen/Next.js) | Add GTM to the frontend, then re-run |
| `wrong_container_type` | Use a Web container; pass `--container-id` |
| `datalayer_unknown` | Ask dev for event names; re-run with `--event-names-json` |
| Events missing after publish | Run `--sniff`, then `--event-names-json` |
| `add_to_cart` missing | Re-run with `--atc-hook` |
| "Axon Pixel already installed" | Domain bound to another Axon account — ticket at support.axon.ai |

## Development
```bash
npm test                 # node:test suite (detection, bridge, snippet)
node scripts/setup.mjs --help
node -e "import('./scripts/detect-site.mjs').then(m=>m.detectSite('https://example.com')).then(r=>console.log(r))"
```

v1.2 — 2026-05-29
