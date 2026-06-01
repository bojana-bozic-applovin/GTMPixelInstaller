# GTM installation by frontend stack

Use when installing GTM in a **self-built** repo. Container ID (`GTM-XXXXXX`) comes from `--create-container` or the advertiser's GTM dashboard.

**Never inject GTM on `checkout.shopify.com`.** Headless Shopify: storefront only; checkout via Axon Shopify App.

Official fallback: [Google — Install a web container](https://support.google.com/tagmanager/answer/14847097)

---

## Detection order

From `package.json` + project layout:

1. **Next.js** — `"next"` in dependencies
2. **Nuxt** — `"nuxt"` in dependencies
3. **Vue 3** — `"vue"` (no next/nuxt)
4. **React** — `"react"` without `"next"`
5. **Static / other** — raw Google snippets

Grep for existing install: `GTM-`, `googletagmanager`, `@next/third-parties`, `react-gtm-module`, `@zadigetvoltaire/vue-gtm`.

---

## Next.js — `@next/third-parties` (preferred)

```bash
npm install @next/third-parties
```

`app/layout.tsx`:

```tsx
import { GoogleTagManager } from '@next/third-parties/google';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <GoogleTagManager gtmId={process.env.NEXT_PUBLIC_GTM_ID!} />
      </body>
    </html>
  );
}
```

Env: `NEXT_PUBLIC_GTM_ID=GTM-XXXXXX`

Pages Router: same component in `_app.tsx` or snippets in `_document.tsx`.

---

## React (Vite / CRA) — `react-gtm-module`

```bash
npm install react-gtm-module
```

Entry (`src/main.tsx`):

```javascript
import TagManager from 'react-gtm-module';

TagManager.initialize({
  gtmId: import.meta.env.VITE_GTM_ID || process.env.REACT_APP_GTM_ID,
});
```

React Router — fire page views on route change:

```javascript
useEffect(() => {
  TagManager.dataLayer({ dataLayer: { event: 'page_view' } });
}, [location.pathname]);
```

Env: `VITE_GTM_ID` or `REACT_APP_GTM_ID`

---

## Vue 3 — `@zadigetvoltaire/vue-gtm`

```bash
npm install @zadigetvoltaire/vue-gtm
```

`main.ts`:

```typescript
import { createGtm } from '@zadigetvoltaire/vue-gtm';

app.use(createGtm({ id: import.meta.env.VITE_GTM_ID, vueRouter: router }));
```

Env: `VITE_GTM_ID`

---

## Nuxt 3

If `@nuxtjs/gtm` present, configure in `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  modules: ['@nuxtjs/gtm'],
  gtm: { id: process.env.NUXT_PUBLIC_GTM_ID },
});
```

Otherwise use vue-gtm in a client plugin.

Env: `NUXT_PUBLIC_GTM_ID`

---

## Hydrogen (Shopify headless)

Inject in `app/root.tsx` using `@next/third-parties/google` or raw snippet. **Not** on checkout domain.

---

## Fallback — raw snippets

Replace `GTM-XXXXXX` with container ID.

**Head** (high in `<head>`):

```html
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXXX');</script>
```

**Body** (after `<body>`):

```html
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXX"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
```

---

## Post-install

- Set env in deployment platform
- `npm install` + deploy
- Re-run setup with `--public-id GTM-XXXXXX`
