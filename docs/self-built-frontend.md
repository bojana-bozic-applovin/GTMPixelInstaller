# Self-built frontend — GTM install in code

This supplement covers **custom/self-built storefronts** where GTM is not yet on the live site. The main skill still configures Axon tags via the GTM API after GTM is deployed.

## When it applies

- Custom Next.js, React, Vue, Nuxt, or Hydrogen **storefront** (not Shopify Liquid, WooCommerce, Shopline, Shoplazza)
- Setup returns `no_gtm_container`, `paste_snippet`, or `snippet_not_detected`
- Advertiser provides a **frontend repo path**

## Flow

1. Create GTM container (`--create-container`) if needed
2. Analyze repo (`detect-repo.mjs` or manual read)
3. Install GTM per stack ([gtm-install-by-stack.md](../skills/gtm-pixel-setup/references/gtm-install-by-stack.md))
4. Optionally add [dataLayer events](../skills/gtm-pixel-setup/references/datalayer-events.md)
5. Deploy → re-run setup with `--public-id GTM-XXXXXX`

## Agent instructions

Claude follows [`skills/gtm-pixel-setup/SELF_BUILT_GTM.md`](../skills/gtm-pixel-setup/SELF_BUILT_GTM.md) — a separate doc so the main [`SKILL.md`](../skills/gtm-pixel-setup/SKILL.md) stays unchanged for platform sites.

## CLI

```bash
cd skills/gtm-pixel-setup
node scripts/detect-repo.mjs --repo-path /path/to/frontend
```

More detail: [`skills/gtm-pixel-setup/README-self-built.md`](../skills/gtm-pixel-setup/README-self-built.md)
