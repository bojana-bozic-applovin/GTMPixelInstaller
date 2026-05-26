# Axon Pixel Installer

Install the Axon tracking pixel on your website in ~5 minutes using Claude Code and the Google Tag Manager API. No Chrome extension required.

---

## What you'll need

**Axon Ads Manager**
- An active Axon advertiser account
- Your **Axon event key** — found in Axon Ads Manager → Account Settings → Keys
  (looks like `971e76ba-6851-4838-a7ea-60314ee67a6b`)

**Google Tag Manager**
- A GTM **Web container** already installed on your site
- A Google account with **Edit and Publish** permission on that container
  (check in GTM → Admin → User Management)

**Your machine**
- [Claude Code](https://claude.ai/code) installed
- Node.js 20+ — Claude will install it automatically if it's missing

**Shopify stores only**
- Shopify admin access to install the Axon Shopify App (handles checkout + purchase events)
- If your store is headless (Hydrogen or Next.js), GTM must already be on your frontend before running this

---

## How to run it

1. Open this project in Claude Code.
2. Say: **"Install the Axon pixel."**
3. Claude will ask for your event key and site URL, then handle everything else.

That's it. Claude runs a pre-flight check first so you can confirm what it detected before any changes are made.

---

## What Claude does

| Phase | What happens |
|---|---|
| Pre-flight | Detects your platform, GTM container, and dataLayer naming. Shows a summary for your approval before writing anything. |
| Setup | Authenticates with your Google account (browser opens once), creates triggers and tags in a fresh GTM workspace, publishes a new container version. |
| Shopify App (if needed) | Provides a direct install link for the Axon Shopify App to cover checkout and purchase events. |
| Verification | Walks you through confirming each event fires using the Axon Pixel Helper Chrome extension. |

---

## Integration tracks

| Track | Used for | Events via GTM | Events via Shopify App |
|---|---|---|---|
| `gtm-only` | WooCommerce, BigCommerce, Magento, custom sites | All 5 required events | — |
| `shopify-headless` | All Shopify stores with hosted checkout | page_view, view_item, add_to_cart | begin_checkout, purchase |
| `lead-gen` | SaaS / lead-gen sites | page_view, generate_lead | — |

Claude selects the right track automatically based on your site.

---

## Auto-detected dataLayer naming

Claude handles these naming conventions without any manual configuration:

| Stack | Event names used |
|---|---|
| Standard GA4 | `view_item`, `add_to_cart`, `begin_checkout`, `purchase` |
| Stape server-side GTM | `view_item_stape`, `add_to_cart_stape`, etc. |
| Elevar | `dl_view_item`, `dl_add_to_cart`, etc. |

If your site uses custom event names, Claude will ask your developer for the names and configure the triggers to match.

---

## Required events

`page_view` · `view_item` · `add_to_cart` · `begin_checkout` · `purchase`

Setup is complete when all required events show green or orange in the Axon Pixel Helper.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "This app isn't verified" in Google sign-in | Click **Advanced → Go to app (unsafe)** to continue |
| Wrong GTM container detected | Tell Claude your GTM container ID (e.g. `GTM-XXXXXX`) and it will re-run with that |
| Events not firing after publish | Run the dataLayer sniffer — Claude will walk you through it |
| `add_to_cart` missing, others fire | Tell Claude — it will add an XHR interceptor tag and republish |
| "Axon Pixel already installed" error in Ads Manager | Your domain is linked to a different Axon account — submit a ticket at [support.axon.ai](https://support.axon.ai) |
| Shopify App events not showing in Ads Manager | Wait up to 30 minutes after install; use the Pixel Helper for real-time confirmation |

---

## Skill documentation

Full technical reference for the GTM setup skill is in [`skills/gtm-pixel-setup/README.md`](skills/gtm-pixel-setup/README.md).
