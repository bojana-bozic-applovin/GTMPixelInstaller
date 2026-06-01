# Self-built frontend — install GTM (and dataLayer) in code

**When to use this doc:** read and follow it when ANY of these apply:

- Advertiser's site is **custom/self-built** (Next.js, React, Vue, Nuxt, Hydrogen storefront, etc.) — not Shopify Liquid, WooCommerce, Shopline, Shoplazza, etc.
- Setup returned `needInput.kind: no_gtm_container`, `paste_snippet`, or `snippet_not_detected`
- Advertiser asks to **install GTM in their codebase** or provides a **frontend repo path**

**When NOT to use:** platform/CMS sites with live GTM already detected — continue the main [`SKILL.md`](SKILL.md) flow only.

---

## Overview

```text
Create container (--create-container) → analyze repo → install GTM in code
  → (optional) add dataLayer events → deploy → re-run setup with --public-id
```

Reference docs (read before editing code):

- [references/repo-analysis-checklist.md](references/repo-analysis-checklist.md)
- [references/gtm-install-by-stack.md](references/gtm-install-by-stack.md)
- [references/datalayer-events.md](references/datalayer-events.md)

Optional CLI:

```bash
node scripts/detect-repo.mjs --repo-path "<REPO_PATH>"
```

---

## Step 0: Intake (add to Phase 1)

After Event Key and Site URL, ask:

> "Is your storefront custom-built (your team's code), or a hosted platform like Shopify or WooCommerce?"

If **platform** → stop here; use main SKILL.md only.

If **self-built**, ask:

> "Do you have access to the frontend code repository? If yes, share the local path or clone URL."

Store as `REPO_PATH`. If they only have snippet paste access (no repo), give manual instructions from [references/gtm-install-by-stack.md](references/gtm-install-by-stack.md) using `needInput.publicId` / `GTM_ID`.

> "After GTM is on the site, does your app already push ecommerce events to `dataLayer` (`view_item`, `add_to_cart`, etc.)?"

If **no** or **partial** → also follow [references/datalayer-events.md](references/datalayer-events.md) in Step 3.

---

## Step 1: Create GTM container (if needed)

If no container yet, from `skills/gtm-pixel-setup/`:

```bash
node scripts/setup.mjs --event-key "<EVENT_KEY>" --site-url "<SITE_URL>" [--lead-gen] --create-container [--account-id <id>]
```

On `paste_snippet`, store `GTM_ID = needInput.publicId` for Step 2.

---

## Step 2: Analyze repo (before any edits)

1. Run `node scripts/detect-repo.mjs --repo-path "<REPO_PATH>"` OR use Read/Grep per [repo-analysis-checklist.md](references/repo-analysis-checklist.md).
2. Present summary to advertiser — **wait for confirmation before Edit**:

> **Repo analysis:**
> - Framework: [Next.js App Router / Vue / …]
> - GTM already in repo: [yes/no]
> - dataLayer events found: [list or none]
> - Files I'll change: [list]
>
> Proceed?

---

## Step 3: Install GTM in code

Follow [gtm-install-by-stack.md](references/gtm-install-by-stack.md) for the detected framework.

Set env var to `GTM_ID` (e.g. `NEXT_PUBLIC_GTM_ID`, `VITE_GTM_ID`).

**Shopify headless storefront:** install GTM on storefront only — never on `checkout.shopify.com`.

If dataLayer events are missing, add pushes per [datalayer-events.md](references/datalayer-events.md). Self-built sites use **standard GA4 names** (`view_item`, not `*_stape` or `dl_*`).

---

## Step 4: Deploy

Tell advertiser:

1. `npm install` (if new packages)
2. Set `GTM_ID` in local + production env
3. Deploy frontend
4. Confirm live: view page source for `GTM-XXXXXX`, or re-run dry-run

---

## Step 5: Resume main skill (Phase 2)

After deploy:

```bash
node scripts/setup.mjs --event-key "<EVENT_KEY>" --site-url "<SITE_URL>" [--lead-gen] --public-id "<GTM_ID>" --dry-run
```

Then full install without `--dry-run`. Continue main SKILL.md from Phase 2 Step 2 → Shopify App (if needed) → Pixel Helper verification.

If `snippet_not_detected` but GTM is definitely live (e.g. injected client-only), re-run with `--skip-snippet-check`.

If `datalayer_unknown` on a self-built site after instrumentation, re-run dry-run; if still failing, use `--sniff` and `--event-names-json`.

---

## Agent rules

- **Always confirm** repo analysis before editing files.
- **Minimal diffs** — only GTM install + required dataLayer hooks.
- **Do not** modify `setup.mjs`, `detect-site.mjs`, or tag templates for this flow.
- **Platform sites** — never ask for repo access.
