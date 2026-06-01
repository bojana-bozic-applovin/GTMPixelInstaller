#!/usr/bin/env node
// Frontend repo detector for self-built GTM / dataLayer setup.
// Usage: node detect-repo.mjs --repo-path /path/to/repo

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ECOMMERCE_EVENTS = ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'];
const LEAD_EVENTS = ['generate_lead'];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--repo-path') args.repoPath = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function readText(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return ''; }
}

async function walkFiles(dir, maxDepth = 4, depth = 0, out = []) {
  if (depth > maxDepth) return out;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (['node_modules', '.git', 'dist', 'build', '.next'].includes(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) await walkFiles(full, maxDepth, depth + 1, out);
    else if (/\.(tsx?|jsx?|vue|html|mjs|cjs)$/.test(ent.name)) out.push(full);
  }
  return out;
}

export function detectFramework(pkg, files) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const paths = files.map((f) => f.replace(/\\/g, '/'));
  if (deps['@shopify/hydrogen']) return { framework: 'shopify-hydrogen', router: 'hydrogen' };
  if (deps.next) {
    const appRouter = paths.some((p) => /\/app\/layout\.(tsx|jsx)$/.test(p));
    return { framework: 'nextjs', router: appRouter ? 'app' : 'pages' };
  }
  if (deps.nuxt || deps['nuxt3']) return { framework: 'nuxt', router: 'nuxt' };
  if (deps.vue && !deps.next) return { framework: 'vue', router: 'vue' };
  if (deps.react) return { framework: 'react', router: 'spa' };
  if (paths.some((p) => p.endsWith('/index.html'))) return { framework: 'static', router: 'static' };
  return { framework: 'unknown', router: null };
}

export function scanContent(text) {
  const gtmIds = new Set();
  const re = /GTM-[A-Z0-9]{5,8}/g;
  let m;
  while ((m = re.exec(text)) !== null) gtmIds.add(m[0]);
  const hasGtmLib = /googletagmanager|@next\/third-parties|react-gtm-module|@zadigetvoltaire\/vue-gtm|@nuxtjs\/gtm/.test(text);
  const hasDataLayer = /dataLayer\.push|window\.dataLayer/.test(text);
  const events = new Set();
  for (const ev of [...ECOMMERCE_EVENTS, ...LEAD_EVENTS, 'page_view']) {
    const escaped = ev.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`['"\`]${escaped}['"\`]|event:\\s*['"\`]${escaped}['"\`]`).test(text)) events.add(ev);
  }
  return { gtmIds: [...gtmIds], hasGtmLib, hasDataLayer, events: [...events] };
}

export function suggestFiles(files) {
  const patterns = [
    /\/app\/layout\.(tsx|jsx)$/, /\/pages\/_document\.(tsx|jsx|js)$/,
    /\/app\/root\.(tsx|jsx)$/, /\/src\/main\.(tsx|jsx|ts|js)$/,
    /\/index\.html$/, /\/nuxt\.config\.(ts|js|mjs)$/,
  ];
  const productPatterns = [/product/i, /cart/i, /checkout/i, /order/i, /thank/i];
  const entry = files.filter((f) => patterns.some((p) => p.test(f.replace(/\\/g, '/')))).slice(0, 8);
  const business = files.filter((f) => productPatterns.some((p) => p.test(f))).map((f) => f.replace(/\\/g, '/')).slice(0, 12);
  return [...new Set([...entry.map((f) => f.replace(/\\/g, '/')), ...business])].slice(0, 20);
}

export async function detectRepo(repoPath) {
  const root = path.resolve(repoPath);
  const pkgPath = path.join(root, 'package.json');
  let pkg = {};
  if (await fileExists(pkgPath)) {
    try { pkg = JSON.parse(await readText(pkgPath)); } catch { /* empty */ }
  }
  const files = await walkFiles(root);
  const { framework, router } = detectFramework(pkg, files);
  let combined = await readText(pkgPath);
  for (const f of files.slice(0, 200)) combined += '\n' + (await readText(f));
  const scan = scanContent(combined);
  return {
    repoPath: root,
    framework,
    router,
    packageName: pkg.name || null,
    hasGtm: scan.gtmIds.length > 0 || scan.hasGtmLib,
    gtmContainerIds: scan.gtmIds,
    hasDataLayer: scan.hasDataLayer,
    dataLayerEvents: scan.events,
    missingEcommerceEvents: ECOMMERCE_EVENTS.filter((e) => !scan.events.includes(e)),
    missingLeadEvents: LEAD_EVENTS.filter((e) => !scan.events.includes(e)),
    suggestedFiles: suggestFiles(files),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.repoPath) {
    process.stderr.write('Usage: node detect-repo.mjs --repo-path <path>\n');
    process.exit(args.help ? 0 : 64);
  }
  process.stdout.write(JSON.stringify(await detectRepo(args.repoPath), null, 2) + '\n');
}

// Only run the CLI when executed directly, not when imported (e.g. by tests).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    process.stderr.write(String(err.stack || err.message) + '\n');
    process.exit(1);
  });
}
