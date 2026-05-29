# Axon Pixel Installer

Install the Axon tracking pixel on your site in ~5 minutes with Claude Code and
the Google Tag Manager API. No Chrome extension required.

## What you'll need
- **Axon event key** — Axon Ads Manager → Account Settings → Keys
- **Your domain URL**
- **Edit + Publish access to your GTM container.** No GTM yet? Claude can create
  one — you'll just paste a short snippet into your site. Step-by-step
  instructions are provided.
- **Claude Code** + **Node.js 20+** (Claude installs Node if it's missing)
- **To verify:** Chrome (for the Axon Pixel Helper); placing one test order to
  confirm `purchase` is recommended.
- **Shopify only** (not needed for WooCommerce, BigCommerce, Magento, Shopline,
  Shoplazza, or custom sites — those run entirely through GTM):
  - **Admin access to your Shopify store** — to install the Axon Shopify App
    (Claude gives you the link during setup; it handles checkout + purchase).
  - **Headless storefronts (Hydrogen/Next.js) with no GTM yet:** Claude creates
    the container and hands over the exact snippet — you or your developer add it
    to the site's code and deploy.

## How to run it
1. Open this project in Claude Code.
2. Say **"Install the Axon pixel."**
3. Give Claude your event key and site URL. It detects everything, shows a summary
   for your approval, then creates the tags and publishes.

## Supported platforms
Shopify, WooCommerce, BigCommerce, Magento, Shopline, Shoplazza, and custom sites.
Claude auto-detects the platform and picks the right setup:

| Track | Platforms | How events fire |
|---|---|---|
| `gtm-only` | WooCommerce, BigCommerce, Magento, Shopline, Shoplazza, custom | All 5 via GTM |
| `shopify-headless` | Shopify (hosted checkout) | page_view / view_item / add_to_cart via GTM; begin_checkout / purchase via the Axon Shopify App |
| `lead-gen` | SaaS / lead-gen | page_view + generate_lead |

## dataLayer naming — auto-detected
Standard GA4, Stape (`*_stape`), Elevar (`dl_*`), and GA4 `gtag()` platforms like
Shopline/Shoplazza (auto-bridged). Custom names → Claude asks your dev and matches
them. No manual config.

## Verifying
Required events: `page_view` · `view_item` · `add_to_cart` · `begin_checkout` · `purchase`

Claude walks you through the **Axon Pixel Helper** (tap to confirm each event),
recommends one test order for `purchase`, then has you check the **Axon dashboard**
(~30-min lag) to confirm Axon is receiving them.

## Troubleshooting
| Symptom | Fix |
|---|---|
| No GTM on your site | Claude can create a container and give you a snippet to paste |
| "App isn't verified" in Google sign-in | Advanced → Go to app (unsafe) |
| Wrong container detected | Give Claude your `GTM-XXXXXX` ID |
| Events not firing after publish | Claude runs the dataLayer sniffer |
| `add_to_cart` missing, others fire | Claude adds an XHR hook and republishes |
| "Axon Pixel already installed" in Ads Manager | Domain linked to another Axon account — ticket at [support.axon.ai](https://support.axon.ai) |

Full skill reference: [`skills/gtm-pixel-setup/README.md`](skills/gtm-pixel-setup/README.md)
