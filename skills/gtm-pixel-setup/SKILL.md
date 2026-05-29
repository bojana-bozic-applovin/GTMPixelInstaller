---
name: gtm-pixel-setup
description: "Install the Axon tracking pixel via the Google Tag Manager API in ~5 minutes. Preferred over the manual Chrome-based flow. Handles all platforms: Shopify (hosted or self-hosted checkout), WooCommerce, BigCommerce, Magento, custom. Creates all required triggers, tags, and publishes. Use when an advertiser needs Axon pixel setup via GTM, mentions 'install Axon pixel', 'GTM pixel setup', 'set up tracking tags', or any request to automate GTM tag creation for Axon."
metadata:
  user_invocable: true
---

# Axon Pixel — GTM Setup via the Tag Manager API

You are helping an advertiser install the Axon tracking pixel using the **Google Tag Manager API**. This is fast (~5 min) and fully automated. No Chrome extension needed. The advertiser only has to (a) sign in with Google once, (b) run a verifier snippet at the end.

Required events the integration must fire:
`page_view` · `view_item` · `add_to_cart` · `begin_checkout` · `purchase`

Integration tracks:
- **`gtm-only`**: All 5 events via GTM. Used for WooCommerce, BigCommerce, Magento, Shopline, Shoplazza, and custom sites.
- **`shopify-headless`**: GTM handles page_view, view_item, add_to_cart on the storefront. The Axon Shopify App handles begin_checkout and purchase on checkout.shopify.com (GTM can't reach that domain). Used for all Shopify stores with hosted checkout — standard Liquid and Hydrogen/Next.js alike.
- **`lead-gen`**: GTM handles page_view + generate_lead only. No ecommerce events.

**gtag-bridge platforms (Shopline & Shoplazza):** these run `gtm-only` but fire their
ecommerce through GA4 `gtag('event','view_item',{...})` argument-arrays instead of
`dataLayer.push({event:...})`. GTM Custom Event triggers can't match arg-arrays, so the
installer auto-adds an **`Axon -- gtag dataLayer Bridge`** tag (on the init trigger) that
re-emits those as `{event:'axon_<name>', ecommerce:{...}}`. All four ecommerce triggers
then listen on the bridged `axon_*` names — including begin_checkout/purchase, which fire
on the store's own GA4 events rather than a checkout URL. This is fully automatic; the
advertiser does nothing extra. (`detected.gtagBridge: true` in the output flags it.)

### Platform test matrix

| Platform | Fingerprint | Track | Ecommerce source | Notes |
|---|---|---|---|---|
| Shopify | `cdn.shopify.com`, `.myshopify.com` | `shopify-headless`* | dataLayer / app | *or `gtm-only` if self-hosted checkout |
| WooCommerce | `wp-content/plugins/woocommerce` | `gtm-only` | dataLayer | |
| BigCommerce | `bigcommerce.com/s-`, `bc-sf-filter` | `gtm-only` | dataLayer | |
| Magento | `Mage.Cookies`, `Magento_Theme` | `gtm-only` | dataLayer | |
| **Shopline** | `cdn.shoplineapp.com`, `shoplytics`, `myshopline.com` | `gtm-only` | **GA4 gtag → bridge** | survives custom domains (verified on `.tw`/`.hk`) |
| **Shoplazza** | `window.SHOPLAZZA`, `shoplazza-product-snippet` | `gtm-only` | **GA4 gtag → bridge** | exposes `gtag('set','user_data',{...})` |
| Custom | — | `gtm-only` | dataLayer (sniffed) | falls to `datalayer_unknown` if names not detected |

Do not mark setup complete until at least 4 of 5 events are confirmed via the verifier (or all 5 on `gtm-only`).

---

## Fallback branching

If at any point OAuth cannot proceed (Workspace admin blocks third-party apps, verification warning stops them, etc.), offer the `gtm-pixel-setup-manual` skill as an alternative and stop.

---

## Pre-check: Node.js

Before Phase 1, silently verify Node.js is installed and at version 20 or higher. Do not explain what Node.js is — just handle it and move on.

**Step 1 — Check:**

```bash
node --version 2>/dev/null || echo "NOT_FOUND"
```

If the output is `NOT_FOUND` or the major version is below 20, install it. Otherwise proceed silently to Phase 1.

**Step 2 — Detect OS and install:**

```bash
uname -s 2>/dev/null || echo "Windows"
```

**macOS** (`uname` returns `Darwin`):

Try Homebrew first:
```bash
command -v brew && brew install node@20 && brew link node@20 --force --overwrite
```

After Homebrew installs, refresh PATH for the current shell session (handles both Apple Silicon and Intel):
```bash
export PATH="/opt/homebrew/bin:$PATH" 2>/dev/null; export PATH="/usr/local/bin:$PATH" 2>/dev/null
```

If Homebrew is not installed, use nvm:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm install 20 && nvm use 20
```

(nvm handles its own PATH update via the `source` command above — no extra step needed.)

**Windows** (`uname` fails or returns `Windows`):

Try winget first (built into Windows 10/11):
```powershell
winget install OpenJS.NodeJS.LTS --silent
```

After winget installs, refresh PATH for the current PowerShell session:
```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

If winget is unavailable, try Chocolatey:
```powershell
choco install nodejs-lts -y
```

After Chocolatey installs, refresh PATH the same way:
```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

If neither works, tell the advertiser:
> "I wasn't able to install Node.js automatically. Please download and install it from [nodejs.org](https://nodejs.org/en/download) — choose the LTS version. Once installed, let me know and we'll continue."

Then stop and wait for them.

**Step 3 — Verify:**

```bash
node --version
```

- If ≥ v20: tell the advertiser "All set — let's get your pixel installed." and move to Phase 1.
- If install failed or version is still wrong: show the nodejs.org fallback message above and stop.
- If it was already installed and correct: proceed to Phase 1 with no message.

---

## Phase 1: Gather the two things we can't detect

Ask:

> "What's your Axon event key? You'll find it in Axon Ads Manager → Account Settings → Keys. It's a UUID that looks like `971e76ba-6851-4838-a7ea-60314ee67a6b`."

**Do not proceed until you have the event key.** Never substitute a placeholder, domain name, or guessed value — the key is what ties every pixel event to the advertiser's account. If the user doesn't have it handy, tell them where to find it and wait.

Validate format before running: the key must match `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (8-4-4-4-12 hex). If it doesn't, reject it and ask again.

Store as `EVENT_KEY`.

> "What's the URL of your website?"

Store as `SITE_URL`. Normalize — add `https://` if missing.

> "One more thing: is this an ecommerce store selling products with a checkout, or a lead-gen / SaaS site where the goal is signups or form fills?"

Store as `SITE_TYPE` (`ecommerce` or `lead-gen`). If lead-gen, add `--lead-gen` to all subsequent script runs. Lead-gen installs only `page_view` + `generate_lead`. The `generate_lead` tag requires `currency` and `value` in the dataLayer push — let the advertiser know their site must push those fields on the lead event.

You do not need to ask about platform, SPA, checkout type, or URL patterns — the detector figures those out.

---

## Phase 2: Run the setup script

Always run from the `skills/gtm-pixel-setup/` directory.

**Step 1 — Pre-flight detection check (before writing anything):**

```bash
node scripts/setup.mjs --event-key "<EVENT_KEY>" --site-url "<SITE_URL>" [--lead-gen] --dry-run
```

Parse the `detected`, `track`, and `eventNames` fields from the output and show the advertiser a plain-English summary before proceeding:

> "Here's what I found for [site]:
> - Platform: [platform]
> - GTM container: [publicId] ("[containerName]")
> - Setup track: [A = GTM only / B = GTM + Shopify App / lead-gen]
> - Trigger event names I'll use: [eventNames values, or `page_view` + `generate_lead` for lead-gen]
> - [Stape detected — using `_stape` suffixes / Elevar detected — using `dl_` prefix / Standard GA4 names]
>
> Does this look right? If anything is off, let me know before I proceed."

Wait for confirmation. If they flag an issue (wrong container, wrong event names), resolve it before running the real setup. If `status === "need_input"` from the dry-run, handle it per the decision handling section below before proceeding.

**Step 2 — Full setup (after confirmation):**

```bash
node scripts/setup.mjs --event-key "<EVENT_KEY>" --site-url "<SITE_URL>" [--lead-gen]
```

The script will:
1. Authenticate the advertiser's Google account (OAuth 2.0, local-loopback — browser opens automatically).
2. Fetch and detect the advertiser's site — platform, GTM container IDs, product URL pattern, Stape usage, dataLayer event-name hints.
3. Find the matching GTM container. If multiple/ambiguous, exit asking Claude to pick. If **no GTM is on the site**, exit asking whether to create a container (`--create-container`) or use an existing ID (`--public-id`); after creation it hands back a snippet to paste and re-checks it's live on the next run.
4. Check the user has Edit + Publish permission on that container. If not, bail with a clear error.
5. Create a dedicated workspace (`axon-setup-<timestamp>`).
6. Generate triggers + Custom HTML tags using the detected event names.
7. Create them via the API.
8. Create a container version and publish.
9. Print a summary JSON: track (`gtm-only` | `shopify-headless` | `lead-gen`), version number, Shopify App install link (`shopify-headless` only), next steps.

### Handling script output

**Never show raw script output, JSON blobs, exit codes, or error stack traces to the user.** Parse the output silently and only surface clean, friendly messages.

The script emits:
- **Progress lines** on stderr — do NOT relay these verbatim. Only show a brief status like "Setting up your pixel..." or "Almost done...".
- **OAuth prompt** on stderr — surface only the URL, with a friendly message like "Please sign in with Google to continue."
- **A final JSON blob** on stdout — parse it silently. Shape:
  ```json
  {
    "status": "ok" | "need_input" | "error",
    "track": "gtm-only" | "shopify-headless" | "lead-gen",
    "version": 42,
    "shopifyAppLink": "https://apps.shopify.com/axon?shop=houswise.myshopify.com",
    "detected": { "platform": "shopify", "gtmContainerIds": ["GTM-XXX"], "usesStape": true },
    "error": { "message": "...", "kind": "no_edit_permission" | "no_container_match" | "multiple_containers" | "oauth_denied" | "..." },
    "needInput": { "kind": "container" | "no_gtm_container" | "select_account" | "paste_snippet" | "snippet_not_detected" | "cleanup" | "datalayer_unknown", "options": [...] }
  }
  ```

### Decision handling

If `status === "need_input"`:

- `kind: "container"` — multiple matching containers (list them and ask which). Re-run with `--account-id <id> --container-id <id>`.
- `kind: "no_gtm_container"` — **no GTM on the site at all** (common for custom-built sites). Ask the advertiser which way they want to go: "I couldn't find Google Tag Manager on your site. I can **create a new GTM container** for you in your Google account (you'll paste one snippet into your site), or if you already have one, give me the **container ID** (`GTM-XXXXXX`, top-right of your GTM dashboard). Which would you prefer?"
  - **Create** → re-run with `--create-container`.
  - **Existing ID** → re-run with `--public-id <GTM-XXXXXX>`.
- `kind: "select_account"` — creating a container but the login has more than one GTM account. List `options[].accountName` and ask which to create it in. Re-run with `--create-container --account-id <id>`.
- `kind: "paste_snippet"` — we just created container `needInput.publicId`. Give the advertiser the snippet to paste, **tailored to their stack** using `needInput.spaKind` / `detected.platform`:
  - Present `needInput.snippet.head` ("paste immediately after the opening `<head>` tag, as high as possible") and `needInput.snippet.body` ("paste immediately after the opening `<body>` tag").
  - If `spaKind === "next"`: "In Next.js, add it via `@next/third-parties/google` `<GoogleTagManager gtmId="…" />` in `app/layout.tsx`, or a `<Script>` in the root layout."
  - If `spaKind === "nuxt"`: "In Nuxt, use the `@zadigetvoltaire/nuxt-gtm` module or add it in `nuxt.config` / `app.vue`."
  - If `spaKind === "hydrogen"`: "In Hydrogen, inject the snippet in `app/root.tsx`."
  - Otherwise: "Paste into your site template's `<head>` and `<body>` (or your theme's header/footer include)."
  - Tell them to publish/deploy, then come back. Re-run with `--public-id <publicId>` — we'll confirm it's live and finish.
- `kind: "snippet_not_detected"` — the targeted container isn't visible on the site yet. Tell them: "I couldn't see `<publicId>` live on your site yet — make sure the snippet is published and caches are cleared, then let me know." Re-run with `--public-id <publicId>` to re-check. Only if they're confident GTM is installed in a way we can't read from page source (rare), re-run adding `--skip-snippet-check`.
- `kind: "cleanup"` — existing Axon tags found. Ask whether to replace (`--cleanup replace`), skip (`--cleanup skip`), or abort. Re-run with the chosen flag.
- `kind: "datalayer_unknown"` — custom site with no recognizable dataLayer event names. Do not run the sniffer. Instead, send the advertiser this message and stop until they come back with the answer:

  > "I couldn't detect the event names your site uses. Ask your developer which names your site pushes to the dataLayer for these four actions, and share this reference doc so they know what's expected:
  >
  > - Product view → `view_item`
  > - Add to cart → `add_to_cart`
  > - Checkout start → `begin_checkout`
  > - Purchase complete → `purchase`
  >
  > 📄 [Axon Events & Objects reference](https://support.axon.ai/en/growth/promoting-your-websites/axon-pixel-integration/events-and-objects)
  >
  > If your site already uses these exact names, come back and we'll continue. If your dev uses different names, share them and I'll configure the triggers to match."

  Once they return with names, save them to a JSON file as `{ "eventFieldMap": { "<name>": {} } }` for each event and re-run with `--event-names-json <path>`.

If `status === "error"`:
- `oauth_denied` — they rejected consent. Ask if they want to retry or switch to the manual skill.
- `no_edit_permission` — they need Edit + Publish on the container; contact whoever owns it.
- `no_container_match` — check `detected.spaKind` first:
  - If `spaKind` is `hydrogen` or `next` and `platform` is `shopify`: this is a headless Shopify site. GTM is not installed on the frontend yet. Tell the advertiser: "Your site is headless Shopify (Hydrogen/Next.js), which means GTM isn't installed on the frontend yet. To proceed: ask your developer to add a GTM web container to your frontend — for Hydrogen, inject the GTM snippet in `app/root.tsx`; for Next.js, use `@next/third-parties/google` or a `<Script>` tag in `app/layout.tsx`. Note: per Axon's documentation, do not fire the GTM pixel on `checkout.shopify.com` — checkout and purchase events are handled by the Axon Shopify App. Once GTM is on your frontend, come back and we'll finish setup."
  - Otherwise: likely signed in with the wrong Google account, or GTM isn't on the site.
- Anything else — surface the error verbatim and ask how they'd like to proceed.

### Non-standard dataLayer: the sniffer

If events go missing in Phase 4 verification, run the sniffer:

```bash
node scripts/setup.mjs --sniff
```

This prints the DevTools snippet path. Read it, then give the advertiser these instructions:
1. Open your site's homepage in Chrome.
2. Open DevTools → Console.
3. Paste the snippet (copy contents of the file path printed above).
4. Visit a product page, click Add to Cart.
5. Paste `__axonSniff.report()` into the console.
6. Copy the JSON output and send it back.

Save the JSON to a file and re-run `setup.mjs --event-names-json <path>` to regenerate tags with the correct naming.

---

## Phase 3: Shopify headless only — Shopify App install

**Skip for `gtm-only` and `lead-gen`.**

If `status === "ok"` and `track === "shopify-headless"`, tell the advertiser:

> "Your GTM tags are live — that's page_view, view_item, and add_to_cart on your storefront. Two more events (begin_checkout and purchase) need the Axon Shopify App, since GTM can't reach checkout.shopify.com.
>
> Open this link in your Shopify admin: `<shopifyAppLink>`
> - Click **Add app** → complete the install.
> - When prompted about theme extension, click **Continue without theme extension** if asked.
> - Connect the Axon ad account the event key belongs to.
>
> Let me know when the app shows **Active** in Axon Ads Manager → Settings → Integrations."

Wait for confirmation before moving to verification.

> **Note:** The Axon Ads Manager setup dashboard can take up to 30 minutes to reflect Shopify App events after install. The Pixel Helper extension shows real-time firing — use that for immediate verification. A still-loading dashboard is not a broken setup.

---

## Phase 4: Verify with the Axon Pixel Helper

Before the funnel walk, ask the advertiser to confirm their GTM triggers are correct. A mismatch between what a trigger listens for and what the dataLayer actually pushes causes a silent failure — the Pixel Helper shows nothing rather than an error, making it hard to diagnose.

Tell the advertiser:

> "Before we test, please open GTM → Triggers and confirm these exist with exactly these settings:
>
> | Trigger name | Type | Event name / filter |
> |---|---|---|
> | Axon -- Initialization | Initialization | (no filter — fires on all pages) |
> | Axon -- All Pages | Page View | (no filter — fires on all pages) |
> | Axon -- View Item Event | Custom Event | `view_item` *(or `view_item_stape` / `dl_view_item` / `axon_view_item` if detected)* |
> | Axon -- Add to Cart Event | Custom Event | `add_to_cart` *(or detected variant)* |
> | Axon -- Checkout Page | Page View | URL contains `/checkout` *(`gtm-only`, URL-based platforms)* |
> | Axon -- Order Confirmation | Page View | URL contains `/thank` or `/order-received` *(`gtm-only`, URL-based platforms)* |
>
> On **Shopline / Shoplazza** (gtag-bridge), the last two are Custom Event triggers instead — **Axon -- Begin Checkout Event** (`axon_begin_checkout`) and **Axon -- Purchase Event** (`axon_purchase`) — plus an **Axon -- gtag dataLayer Bridge** tag. That's expected.
>
> For lead-gen, you'll see Axon -- Generate Lead Event (Custom Event: `generate_lead`) instead of the ecommerce triggers.
>
> If the event name in any trigger doesn't match what your site actually pushes to the dataLayer, that trigger will never fire. Let me know if anything looks wrong."

Wait for their confirmation before proceeding to the funnel walk.

Tell the advertiser:

> "To confirm everything is firing correctly, install the **Axon Pixel Helper** Chrome extension:
> 👉 https://chromewebstore.google.com/detail/axon-pixel-helper/cbnepobjhiakaeolafffknhlmmbhigbk
>
> Pin it to your Chrome toolbar, then walk your funnel with it open."

Walk them through these steps, in order:
1. Homepage → look for **Page View**.
2. Product page → look for **View Item**.
3. Add to Cart → look for **Add to Cart**.
4. Begin checkout → look for **Begin Checkout**.
5. **Test purchase (all tracks).** Have them place a real test order and then cancel/refund it — they work at the company, so they can. Look for **Purchase** on the order confirmation page. This is the only way to verify purchase end-to-end; the headless `purchase` (Shopify App) and the `gtm-only` / gtag-bridge `purchase` all need a real order to fire.

#### Collecting results — tap-only, no typing

**Do not ask the advertiser to type, paste, or fill in a template.** Pixel Helper shows a colored dot per event; capture each via the **multiple-choice question tool** (`AskUserQuestion`), one event at a time as they complete each step. For each event, present these four options (single-select):

- `🟢 Green — fired correctly`
- `🟠 Orange — fired, missing a field`
- `🔴 Red — error`
- `⚪ Didn't appear`

Because the picker caps at 4 questions per screen, ask per funnel step (one tap right after they see the dot) rather than all five at once.

**Review & revise (required).** After all five, show a recap of their selections and present a confirm picker: `✅ Yes — all correct` / `✏️ No — I need to fix one`. If they pick **No**, present a tap-list of the five events (split across the picker's question limit), re-open the 🟢/🟠/🔴/⚪ picker only for the ones they flag, update the recap, and show the review again. **Loop until they tap ✅** — nothing is final until then, so a mis-tap is always recoverable.

Interpret each result:
- **🟢 Green** — fired with all required fields.
- **🟠 Orange** — fired but a recommended field is missing (`image_url`, `item_variant_id`, or `item_category_id`). Pixel works, but catalog ads won't serve. **Only here** ask them to screenshot that event in Pixel Helper so you can name the exact missing field, then: "To unlock catalog ads, ask your dev to add [field] to the dataLayer."
- **🔴 Red** — a required field is missing or payload malformed. Ask for a screenshot of that event to see what's missing.
- **⚪ Didn't appear** — event didn't fire. Check trigger, URL pattern, or dataLayer event name.

**Setup is complete when page_view, view_item, add_to_cart, begin_checkout, and purchase are green or orange** (purchase confirmed via the test order above).

### Confirm Axon is receiving the events (server-side)

The Pixel Helper confirms events **fire** in the browser. To confirm Axon is actually **receiving and counting** them, have the advertiser check the **Axon Ads Manager dashboard** for the event activity. Collect this as a tap-only `AskUserQuestion` too:

- `Yes — I can see the events`
- `Not yet — it's still within ~30 min`
- `No — nothing after 30+ min`

> **Note:** the dashboard can take **up to ~30 minutes** to reflect incoming events. A still-loading dashboard right after setup is **not** a broken setup — the Pixel Helper (real-time) is the immediate check; the dashboard is the authoritative "Axon is receiving it" confirmation once it catches up.

This split matters: an event can fire green in Pixel Helper but still be deduped or blocked server-side, so the dashboard is the source of truth for "it's actually landing." We don't have a programmatic way to read this — it's the advertiser checking their own dashboard.

---

## Phase 5 (optional): Recommended events

After all required events are verified, offer to add:
`add_payment_info`, `sign_up`, `login`, `search`, `view_cart`, `remove_from_cart`, `subscribe`

Ask: "Your site's dataLayer would need to already push these events. Want to check which of these your site fires?"

If the advertiser confirms any fire, re-run with `--add-recommended event1,event2,...`. The script will create a trigger and tag per event and publish a new version.

**Do not create tags for events the dataLayer doesn't push** — they'll fire with empty payloads.

---

## Optional: Enhanced user identification

After all required events are verified, offer this attribution improvement:

> "Optional but recommended: to improve user matching rates, ask your developer to mirror the `_axwrt` cookie as an `axwrt` HTTP cookie with a 1-year expiration on your domain. This is a backend change — your dev can find the implementation details in the [Axon GTM integration docs](https://support.axon.ai/en/growth/promoting-your-websites/axon-pixel-integration/google-tag-manager)."

---

## Troubleshooting

| Symptom | Cause | Next step |
|---|---|---|
| OAuth browser window doesn't open | Browser launcher failed | Tell user to copy the URL printed on stderr and paste it manually |
| "This app isn't verified" warning | App still in testing mode | Ask user to click "Advanced → Go to app (unsafe)" |
| `access_denied` in OAuth response | User declined consent, or Workspace admin blocks third-party OAuth | Retry, or switch to `gtm-pixel-setup-manual` |
| `no_container_match` | Wrong Google account, or GTM not installed on the site | Ask user to verify the account they signed in with, and that GTM is on the site |
| `no_edit_permission` | Read access only | Container owner must grant Edit + Publish in GTM → Admin → User Management |
| `no_publish_permission` | Edit but not Publish | Container owner must upgrade permissions |
| `multiple_containers` | Multiple containers on site or in the Google account | Ask which; re-run with `--container-id` |
| Events don't fire after publish | GTM snippet missing, wrong container ID, or dataLayer naming mismatch | Confirm with `window.google_tag_manager` in DevTools; run the sniffer |
| `add_to_cart` missing, others fire | Site doesn't push a standard ATC dataLayer event | Run `setup.mjs --atc-hook` to add the XHR interceptor tag |
| "Container is a Google Tag / Server container" | Wrong container type | Use a standard Web container; pass its ID via `--container-id` |
| "An Axon Pixel is already installed on this site" in Axon Ads Manager (not GTM) | Domain bound to a different Axon account (e.g. a previous agency account) | GTM setup can complete, but the pixel won't send data until the domain binding is cleared. Tell the advertiser: "This domain is currently linked to a different Axon account. Submit a support ticket at support.axon.ai mentioning the domain and requesting the binding be cleared." |

---

## Notes for Claude

- **Never run setup without a real UUID event key.** Stop and ask if you don't have it.
- **Use Read, Bash, and Edit tools only.** No browser driving.
- **Keep the user informed** between phases — they're waiting on OAuth, Shopify App install, and funnel walks.
- **Trust the detector** for standard sites. Only escalate to the sniffer if verification shows missing events.
- **Dry-run before destructive changes**: if existing Axon tags are detected, always ask before replacing.
- **Workspaces are cheap** — always create a fresh one. Never edit the Default Workspace in place.
- **Shopify App install is manual** — don't try to automate it.
- **Never expose internals** — no JSON, no exit codes, no stack traces, no stderr lines. Translate everything into plain friendly language.
