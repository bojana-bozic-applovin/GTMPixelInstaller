# Self-built frontend supplement

Addon to the main [README.md](./README.md). Platform sites (Shopify, WooCommerce, Shopline, etc.) do **not** need this.

## What this adds

For **custom frontends** with no GTM on the live site, the agent can:

1. Create a GTM Web container (`--create-container` — already in main CLI)
2. **Edit the frontend repo** to install GTM (Next.js, React, Vue, Nuxt, raw snippet)
3. Optionally add standard GA4 `dataLayer` pushes for Axon events
4. After deploy, resume the normal Axon tag install

## Docs

| File | Purpose |
|------|---------|
| [SELF_BUILT_GTM.md](./SELF_BUILT_GTM.md) | Agent workflow (read this first) |
| [references/repo-analysis-checklist.md](./references/repo-analysis-checklist.md) | Pre-edit repo scan |
| [references/gtm-install-by-stack.md](./references/gtm-install-by-stack.md) | Stack-specific GTM install |
| [references/datalayer-events.md](./references/datalayer-events.md) | Event payloads |

## CLI

```bash
node scripts/detect-repo.mjs --repo-path /path/to/frontend
```

No changes to `setup.mjs` are required for this flow — use existing `--create-container` and `--public-id`.

## Project-level overview

[../../docs/self-built-frontend.md](../../docs/self-built-frontend.md)
