# Repo analysis checklist (self-built only)

Run before editing a frontend repo. Pair with:

```bash
node scripts/detect-repo.mjs --repo-path "<REPO_PATH>"
```

---

## Steps

1. **Framework** — read `package.json` (`next`, `nuxt`, `vue`, `react`, `@shopify/hydrogen`)
2. **Existing GTM** — grep `GTM-`, `googletagmanager`, `@next/third-parties`, `react-gtm-module`
3. **dataLayer** — grep `dataLayer.push`, required event names
4. **Entry files** — `app/layout.tsx`, `pages/_document.tsx`, `src/main.tsx`, `app/root.tsx`
5. **Business hooks** — product, cart, checkout, order confirm, lead forms
6. **Summary + confirm** — list files to edit; wait for advertiser OK
7. **After edits** — `npm install`, env vars, deploy, `--public-id` re-run

---

## Edge cases

| Case | Action |
|------|--------|
| Monorepo | analyze storefront package only |
| No repo access | send [gtm-install-by-stack.md](./gtm-install-by-stack.md) for manual apply |
| Platform site (Shopline, etc.) | do not use this checklist — main SKILL flow |
