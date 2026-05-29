#!/usr/bin/env node
// Axon pixel installer — orchestrator.
// Wires OAuth → detect → GTM create → publish into a single command-line entrypoint.
// Communicates with the calling Claude skill via stderr (progress) + stdout (final JSON).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureToken } from './oauth.mjs';
import { GTMClient } from './gtm-client.mjs';
import { detectSite, verifyContainerOnSite } from './detect-site.mjs';
import * as T from './tag-templates.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');
const TOKEN_PATH = path.join(__dirname, '..', '.cache', 'token.json');

// Axon's OAuth client — safe to embed in public tools (Desktop app + PKCE).
// Advertisers never need a config.json; config.json overrides this for dev.
const AXON_CLIENT_ID = '594681556243-grc40h1kfprlp3a47hf39bfp6drj8g6k.apps.googleusercontent.com';
const AXON_SCOPES = [
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
  'https://www.googleapis.com/auth/tagmanager.delete.containers',
  'https://www.googleapis.com/auth/tagmanager.publish',
  'https://www.googleapis.com/auth/tagmanager.readonly',
];

const CHECKOUT_PATTERNS = {
  woocommerce: { checkout: '/checkout', confirm: 'order-received' },
  bigcommerce: { checkout: '/checkout', confirm: '/order-confirmation' },
  magento: { checkout: '/checkout', confirm: '/checkout/onepage/success' },
  shopify: { checkout: '/checkout', confirm: '/thank' },
  custom: { checkout: '/checkout', confirm: '/thank' },
};

function stderr(msg) { process.stderr.write(String(msg) + '\n'); }
function stdout(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function die(obj, code = 1) { stdout(obj); process.exit(code); }

// ---------- CLI parsing ----------

function parseArgs(argv) {
  const args = { cleanup: 'prompt' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { mode: 'help' };
    if (a === '--sniff') return { mode: 'sniff' };
    if (a === '--verify') return { mode: 'verify' };
    if (a === '--revoke') return { mode: 'revoke' };
    if (a === '--event-key') args.eventKey = argv[++i];
    else if (a === '--site-url') args.siteUrl = argv[++i];
    else if (a === '--account-id') args.accountId = argv[++i];
    else if (a === '--container-id') args.containerId = argv[++i];
    else if (a === '--public-id') args.publicId = argv[++i];
    else if (a === '--cleanup') args.cleanup = argv[++i];
    else if (a === '--event-names-json') args.eventNamesJson = argv[++i];
    else if (a === '--atc-hook') args.atcHook = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--lead-gen') args.leadGen = true;
    else if (a === '--create-container') args.createContainer = true;
    else if (a === '--skip-snippet-check') args.skipSnippetCheck = true;
    else { stderr(`Unknown arg: ${a}`); process.exit(64); }
  }
  return { mode: 'install', ...args };
}

function printHelp() {
  stderr(`Axon Pixel Installer

Usage:
  node setup.mjs --event-key <KEY> --site-url <URL> [opts]

Modes:
  --sniff               Print path to the DevTools sniffer snippet and exit
  --verify              Print path to the DevTools verifier snippet and exit
  --revoke              Delete the cached OAuth token
  -h, --help            Show this help

Options:
  --account-id <id>
  --container-id <id>
  --public-id <GTM-XXXX>          Target an existing container by public ID
  --create-container              No GTM on the site? Create a new container (asks which account)
  --skip-snippet-check            Skip the post-paste "is the GTM snippet live?" re-check
  --cleanup replace|skip|prompt   How to handle existing Axon tags
  --event-names-json <path>       Use sniffer output to tune dataLayer naming
  --atc-hook                      Also install the /cart/add XHR hook tag
  --dry-run                       Don't call the GTM write API; just log what would happen
`);
}

// ---------- Main install flow ----------

async function loadConfig() {
  try {
    const cfg = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
    return cfg;
  } catch {
    // No config.json — use hardcoded Axon credentials (normal for external advertisers)
    return { clientId: AXON_CLIENT_ID, scopes: AXON_SCOPES };
  }
}

async function loadSnifferNaming(eventNamesJsonPath) {
  const sniff = JSON.parse(await fs.readFile(eventNamesJsonPath, 'utf8'));
  const map = sniff.eventFieldMap || {};
  const pick = (canonical) => {
    const stape = canonical + '_stape';
    if (map[stape]) return stape;
    if (map[canonical]) return canonical;
    return canonical;
  };
  const eventNames = {
    view_item: pick('view_item'),
    add_to_cart: pick('add_to_cart'),
    begin_checkout: pick('begin_checkout'),
    purchase: pick('purchase'),
  };
  const sample = map[eventNames.view_item] || Object.values(map)[0] || {};
  const fieldMap = {};
  if (sample.hasImageUrl === 'imageURL') fieldMap.image_url = ['imageURL', 'image_url'];
  if (sample.itemVariantField === 'item_variant') fieldMap.item_variant_id = ['item_variant', 'item_variant_id'];
  return { eventNames, fieldMap };
}

function defaultNaming(site) {
  const eventNames = {
    view_item: 'view_item',
    add_to_cart: 'add_to_cart',
    begin_checkout: 'begin_checkout',
    purchase: 'purchase',
  };
  let fieldMap;
  const found = site.dataLayerEventNames || [];
  // Use stape variants if the stape integration is detected OR if stape event
  // names appear in the HTML. When stape is detected, default to _stape suffixes
  // even if the event names aren't visible in static HTML (they may be in external JS).
  const hasStapeEvents = found.some(n => n.endsWith('_stape'));
  if (site.usesStape || hasStapeEvents) {
    eventNames.view_item = 'view_item_stape';
    eventNames.add_to_cart = 'add_to_cart_stape';
    eventNames.begin_checkout = 'begin_checkout_stape';
    eventNames.purchase = 'purchase_stape';
    fieldMap = {
      image_url: ['image_url', 'imageURL'],
      item_variant_id: ['item_variant_id', 'item_variant'],
    };
  } else if (site.usesElevar || found.some(n => ['dl_view_item', 'dl_add_to_cart', 'dl_begin_checkout', 'dl_purchase'].includes(n))) {
    eventNames.view_item = 'dl_view_item';
    eventNames.add_to_cart = 'dl_add_to_cart';
    eventNames.begin_checkout = 'dl_begin_checkout';
    eventNames.purchase = 'dl_purchase';
  } else if (site.usesGtagEcommerce) {
    // Shopline/Shoplazza: the gtag->dataLayer bridge tag re-emits GA4 gtag
    // ecommerce events under these namespaced names. Triggers listen on them.
    eventNames.view_item = 'axon_view_item';
    eventNames.add_to_cart = 'axon_add_to_cart';
    eventNames.begin_checkout = 'axon_begin_checkout';
    eventNames.purchase = 'axon_purchase';
  }
  return { eventNames, fieldMap };
}

async function findContainer(gtm, site, args) {
  if (args.containerId && args.accountId) {
    const containers = await gtm.listContainers(args.accountId);
    const c = containers.find((x) => String(x.containerId) === String(args.containerId));
    if (!c) throw new Error(`Container ${args.containerId} not found in account ${args.accountId}`);
    const accounts = await gtm.listAccounts();
    const a = accounts.find((x) => String(x.accountId) === String(args.accountId));
    return { account: a, container: c };
  }
  const matches = [];
  const accounts = await gtm.listAccounts();
  for (const account of accounts) {
    let containers;
    try { containers = await gtm.listContainers(account.accountId); }
    catch { continue; }
    for (const container of containers) {
      if (site.gtmContainerIds.includes(container.publicId)) {
        matches.push({ account, container });
      }
    }
  }
  return matches;
}

function isWebContainer(container) {
  const ctx = container.usageContext;
  if (!Array.isArray(ctx)) return false;
  // Reject explicit server containers
  if (ctx.includes('server')) return false;
  return ctx.includes('web');
}

function atcHookTagHtml() {
  return `<script>
(function(){
if(window.__axonAtcHook) return;
window.__axonAtcHook=true;
var rx=/\\/cart\\/add(\\.js)?(\\?|$)/i;
function norm(n){return (typeof n==='number'&&n>100)?n/100:(parseFloat(n)||0);}
function fire(data){
  try{
    if(!window.axon||!data) return;
    var list=[];
    if(Array.isArray(data.items)) list=data.items;
    else if(data.id||data.variant_id||data.product_id) list=[data];
    var items=list.map(function(i){
      var o={item_id:String(i.product_id||i.id||''),item_name:i.product_title||i.title||'',price:norm(i.price||i.final_price||i.final_line_price),quantity:i.quantity||1};
      var v=i.variant_id||i.id; if(v) o.item_variant_id=String(v);
      if(i.item_brand||i.vendor) o.item_brand=i.item_brand||i.vendor;
      var img=i.image||(i.featured_image&&i.featured_image.url);
      if(img) o.image_url=img.indexOf('//')===0?'https:'+img:img;
      return o;
    });
    if(!items.length) return;
    var value=items.reduce(function(s,it){return s+(it.price*it.quantity);},0);
    window.axon('track','add_to_cart',{items:items,currency:(window.Shopify&&window.Shopify.currency&&window.Shopify.currency.active)||'USD',value:value});
  }catch(e){}
}
if(window.fetch){
  var of=window.fetch;
  window.fetch=function(){
    var a=arguments,url='',m='GET';
    try{url=typeof a[0]==='string'?a[0]:(a[0]&&a[0].url)||'';}catch(e){}
    try{m=(typeof a[0]==='object'&&a[0]&&a[0].method)||(a[1]&&a[1].method)||'GET';}catch(e){}
    var isAtc=rx.test(url)&&String(m).toUpperCase()==='POST';
    var p=of.apply(this,a);
    if(isAtc){p.then(function(r){if(!r||!r.ok)return;r.clone().json().then(fire).catch(function(){});}).catch(function(){});}
    return p;
  };
}
var xo=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){try{this.__axU=u||'';this.__axM=(m||'').toUpperCase();}catch(e){}return xo.apply(this,arguments);};
var xs=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send=function(){var xhr=this;if(xhr.__axM==='POST'&&rx.test(xhr.__axU||'')){xhr.addEventListener('load',function(){try{if(xhr.status>=200&&xhr.status<300){fire(JSON.parse(xhr.responseText));}}catch(e){}});}return xs.apply(this,arguments);};
})();
</script>`;
}

// Ask 1: custom site with no GTM installed. Create a Web container in the
// advertiser's account (asking which account if there's more than one), then
// hand back the on-page snippet for them to paste. Dies with a need_input.
async function handleCreateContainer(gtm, site, args) {
  const accounts = await gtm.listAccounts();
  let account;
  if (args.accountId) {
    account = accounts.find((a) => String(a.accountId) === String(args.accountId));
    if (!account) {
      die({ status: 'error', error: { kind: 'account_not_found', message: `GTM account ${args.accountId} not found for this Google login.` }, detected: site }, 2);
    }
  } else if (accounts.length === 1) {
    account = accounts[0];
  } else if (accounts.length === 0) {
    die({ status: 'error', error: { kind: 'no_gtm_account', message: 'This Google account has no GTM accounts. Create one at tagmanager.google.com first.' }, detected: site }, 2);
  } else {
    die({
      status: 'need_input',
      needInput: {
        kind: 'select_account',
        message: 'Which GTM account should I create the new container in?',
        options: accounts.map((a) => ({ accountId: a.accountId, accountName: a.name })),
      },
      detected: site,
      retryHint: 'Re-run with --create-container --account-id <id>',
    }, 10);
  }

  let hostname = site.siteUrl;
  try { hostname = new URL(site.siteUrl).hostname; } catch {}
  const name = `${hostname} (Axon)`.slice(0, 100);
  stderr(`   creating GTM Web container "${name}" in account "${account.name}"...`);
  const container = await gtm.createContainer(account.accountId, { name, usageContext: ['web'] });
  const snippet = T.gtmInstallSnippet(container.publicId);
  die({
    status: 'need_input',
    needInput: {
      kind: 'paste_snippet',
      message: `Created GTM container ${container.publicId} in account "${account.name}". Paste this snippet into your site, then we'll confirm it's live and finish setup.`,
      publicId: container.publicId,
      accountId: account.accountId,
      containerId: container.containerId,
      snippet,
      spaKind: site.spaKind,
      platform: site.platform,
    },
    detected: site,
    retryHint: `After pasting, re-run with --public-id ${container.publicId}`,
  }, 10);
}

async function install(args) {
  // 1. Load OAuth config
  stderr('[1/8] Loading OAuth config...');
  const config = await loadConfig();

  // 2. Start OAuth + site detection in parallel
  stderr('[2/8] Authenticating and detecting site (parallel)...');
  const [siteResult, tokenResult] = await Promise.allSettled([
    detectSite(args.siteUrl),
    ensureToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      tokenProxyUrl: config.tokenProxyUrl,
      scopes: config.scopes,
      tokenPath: TOKEN_PATH,
    }),
  ]);

  if (tokenResult.status === 'rejected') {
    die({
      status: 'error',
      error: { kind: 'oauth_failed', message: tokenResult.reason.message },
    });
  }
  const token = tokenResult.value;
  const site = siteResult.status === 'fulfilled'
    ? siteResult.value
    : { platform: 'custom', gtmContainerIds: [], errors: [siteResult.reason && siteResult.reason.message] };

  stderr(`   platform=${site.platform}; GTM=[${site.gtmContainerIds.join(',')}]; stape=${site.usesStape ? 'yes' : 'no'}`);
  if (site.errors && site.errors.length) stderr(`   detect warnings: ${site.errors.join('; ')}`);

  const gtm = new GTMClient(token.access_token);

  // 3. Find target container
  stderr('[3/8] Matching GTM container...');

  // Custom site, advertiser opted to create a container — do it and hand back the snippet.
  if (args.createContainer) {
    await handleCreateContainer(gtm, site, args);
  }

  // What we actually saw in the page source, before we fold in a manually-supplied
  // ID — used to decide whether to re-check that a pasted snippet is live.
  const detectedOnSite = [...site.gtmContainerIds];
  if (args.publicId) {
    const id = args.publicId.toUpperCase().startsWith('GTM-') ? args.publicId.toUpperCase() : `GTM-${args.publicId.toUpperCase()}`;
    if (!site.gtmContainerIds.includes(id)) site.gtmContainerIds.push(id);
  }
  const matchesOrPair = await findContainer(gtm, site, args);

  let account, container;
  if (Array.isArray(matchesOrPair)) {
    if (matchesOrPair.length === 0) {
      if (!site.gtmContainerIds.length) {
        // No GTM on the site. Offer to create one, or take an existing ID.
        die({
          status: 'need_input',
          needInput: {
            kind: 'no_gtm_container',
            message: 'No GTM container was found on the site. I can create a new one in your Google Tag Manager account for you to install, or you can provide an existing GTM container ID.',
            options: ['create', 'provide'],
          },
          detected: site,
          retryHint: 'Re-run with --create-container (to create one) or --public-id <GTM-XXXXXX> (to use an existing one)',
        }, 10);
      }
      die({
        status: 'error',
        error: {
          kind: 'no_container_match',
          message: `None of the GTM containers on the site (${site.gtmContainerIds.join(', ')}) are accessible from this Google account.`,
        },
        detected: site,
      }, 2);
    }
    if (matchesOrPair.length > 1) {
      die({
        status: 'need_input',
        needInput: {
          kind: 'container',
          message: 'Multiple matching containers. Which one should I use?',
          options: matchesOrPair.map((m) => ({
            accountId: m.account.accountId,
            containerId: m.container.containerId,
            accountName: m.account.name,
            containerName: m.container.name,
            publicId: m.container.publicId,
            usageContext: m.container.usageContext,
          })),
        },
        detected: site,
        retryHint: 'Re-run with --account-id <id> --container-id <id>',
      }, 10);
    }
    ({ account, container } = matchesOrPair[0]);
  } else {
    ({ account, container } = matchesOrPair);
  }

  stderr(`   container=${container.publicId} "${container.name}" (account "${account.name}")`);

  if (!isWebContainer(container)) {
    die({
      status: 'error',
      error: {
        kind: 'wrong_container_type',
        message: `Container ${container.publicId} has usageContext=${JSON.stringify(container.usageContext)}. Axon requires a Web container — Server/iOS/Android don't support Custom HTML tags.`,
      },
      detected: site,
    }, 3);
  }

  // Ask 1: if we're targeting a container that wasn't in the page source (just
  // created, or freshly pasted), confirm the snippet is actually live before we
  // build tags into a container the site can't load. Overridable, since some
  // sites inject GTM in ways we can't read from static HTML.
  if (args.publicId && !detectedOnSite.includes(container.publicId) && !args.skipSnippetCheck) {
    stderr(`   confirming GTM snippet is live on ${site.siteUrl}...`);
    const check = await verifyContainerOnSite(args.siteUrl, container.publicId);
    if (!check.found) {
      die({
        status: 'need_input',
        needInput: {
          kind: 'snippet_not_detected',
          message: `Couldn't find ${container.publicId} on ${site.siteUrl} yet. If you just pasted the snippet, publish/clear cache and retry. If GTM is installed in a way we can't read from page source, you can skip this check.`,
          publicId: container.publicId,
          idsFound: check.ids,
        },
        detected: site,
        retryHint: `Re-run with --public-id ${container.publicId} once it's live, or add --skip-snippet-check to bypass`,
      }, 10);
    }
    stderr(`   ✓ GTM snippet confirmed on site`);
  }

  // Track + event naming decisions are made up-front so --dry-run can short-circuit before any writes.
  const track = args.leadGen ? 'lead-gen'
    : (site.platform === 'shopify' && site.isHostedCheckout !== false ? 'shopify-headless' : 'gtm-only');
  const { eventNames, fieldMap } = args.eventNamesJson
    ? await loadSnifferNaming(args.eventNamesJson)
    : defaultNaming(site);

  // Bridge platforms (Shopline/Shoplazza) fire GA4 gtag ecommerce events. When we
  // use the bridged `axon_*` names, install the gtag->dataLayer bridge tag and fire
  // all four ecommerce events off the platform's own GA4 events (Custom Event
  // triggers on the bridged names) rather than URL triggers — we can't rely on a
  // known order-confirmation URL for these platforms.
  const useGtagBridge = track !== 'lead-gen'
    && /^axon_/.test(eventNames.view_item || '');

  // For custom sites where we can't determine event naming, exit and let Claude hand off to the dev.
  if (!args.leadGen && !args.eventNamesJson && site.platform === 'custom') {
    const knownNames = ['view_item', 'add_to_cart', 'begin_checkout', 'purchase',
      'view_item_stape', 'add_to_cart_stape', 'dl_view_item', 'dl_add_to_cart'];
    const hasRecognizedNames = (site.dataLayerEventNames || []).some(n => knownNames.includes(n));
    if (!site.usesStape && !site.usesElevar && !hasRecognizedNames) {
      die({
        status: 'need_input',
        needInput: {
          kind: 'datalayer_unknown',
          message: 'Custom site — could not detect dataLayer event names.',
        },
        detected: site,
        retryHint: 'Re-run with --event-names-json <path> once you have the event names from the dev.',
      }, 10);
    }
  }

  if (args.dryRun) {
    die({
      status: 'ok',
      dryRun: true,
      track,
      eventNames,
      fieldMap,
      detected: site,
      account: { accountId: account.accountId, name: account.name },
      container: { containerId: container.containerId, publicId: container.publicId, name: container.name },
      plan: {
        workspace: `axon-setup-<timestamp>`,
        triggersToCreate: track === 'gtm-only' ? 6 : 4,
        tagsToCreate: (track === 'gtm-only' ? 6 : 4) + (args.atcHook ? 1 : 0) + (useGtagBridge ? 1 : 0),
        gtagBridge: useGtagBridge,
      },
    }, 0);
  }

  // 4. Create a fresh workspace
  stderr('[4/8] Creating workspace...');
  const wsName = `axon-setup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const workspace = await gtm.createWorkspace(account.accountId, container.containerId, {
    name: wsName,
    description: 'Axon pixel — installed by gtm-pixel-setup skill',
  });
  stderr(`   workspace=${workspace.workspaceId} (${wsName})`);

  // If anything after this point throws, try to clean up the workspace so we don't leave orphans.
  const cleanupOnFailure = async () => {
    try {
      await gtm.deleteWorkspace(account.accountId, container.containerId, workspace.workspaceId);
      stderr(`   [cleanup] deleted workspace ${workspace.workspaceId}`);
    } catch (e) {
      stderr(`   [cleanup] could not delete workspace ${workspace.workspaceId}: ${e.message}`);
    }
  };

  try {

  // 5. Scan existing tags
  stderr('[5/8] Scanning existing Axon tags...');
  const [existingTags, existingTriggers] = await Promise.all([
    gtm.listTags(account.accountId, container.containerId, workspace.workspaceId),
    gtm.listTriggers(account.accountId, container.containerId, workspace.workspaceId),
  ]);
  // Matches new "Axon -- xxx" and legacy "Axon - xxx - CheckoutChamp" style names
  const axonPattern = /^Axon\s*-/i;
  const conflictingTags = existingTags.filter((t) => axonPattern.test(t.name));
  const conflictingTriggers = existingTriggers.filter((t) => axonPattern.test(t.name));

  if (conflictingTags.length > 0 && args.cleanup === 'prompt') {
    // Abort this workspace and ask Claude to come back with a decision.
    await gtm.deleteWorkspace(account.accountId, container.containerId, workspace.workspaceId).catch(() => {});
    die({
      status: 'need_input',
      needInput: {
        kind: 'cleanup',
        message: `Found ${conflictingTags.length} existing Axon tags.`,
        existingTags: conflictingTags.map((t) => ({ name: t.name, type: t.type })),
        options: ['replace', 'skip'],
      },
      detected: site,
      retryHint: 'Re-run with --cleanup replace or --cleanup skip',
    }, 10);
  }

  if (args.cleanup === 'replace' && (conflictingTags.length || conflictingTriggers.length)) {
    stderr(`   removing ${conflictingTags.length} tags + ${conflictingTriggers.length} triggers`);
    await Promise.all(conflictingTags.map((t) =>
      gtm.deleteTag(account.accountId, container.containerId, workspace.workspaceId, t.tagId).catch(() => {})
    ));
    await Promise.all(conflictingTriggers.map((t) =>
      gtm.deleteTrigger(account.accountId, container.containerId, workspace.workspaceId, t.triggerId).catch(() => {})
    ));
  }

  stderr(`   track=${track}; eventNames=${JSON.stringify(eventNames)}`);

  // 6. Create triggers + tags
  stderr('[6/8] Creating triggers...');
  const accountId = account.accountId;
  const containerId = container.containerId;
  const workspaceId = workspace.workspaceId;

  const trig = {};
  trig.init = await gtm.createTrigger(accountId, containerId, workspaceId, T.initializationTrigger());
  trig.allPages = await gtm.createTrigger(accountId, containerId, workspaceId, T.allPagesTrigger());

  if (track === 'lead-gen') {
    trig.generateLead = await gtm.createTrigger(accountId, containerId, workspaceId, T.customEventTrigger({
      name: 'Axon -- Generate Lead Event', eventName: 'generate_lead',
    }));
  } else {
    trig.viewItem = await gtm.createTrigger(accountId, containerId, workspaceId, T.customEventTrigger({
      name: 'Axon -- View Item Event', eventName: eventNames.view_item,
    }));
    trig.addToCart = await gtm.createTrigger(accountId, containerId, workspaceId, T.customEventTrigger({
      name: 'Axon -- Add to Cart Event', eventName: eventNames.add_to_cart,
    }));

    if (track === 'gtm-only') {
      if (useGtagBridge) {
        // gtag platforms (Shopline/Shoplazza) fire real GA4 begin_checkout/purchase
        // events; trigger on those (via the bridge) rather than a URL we'd have to guess.
        trig.checkout = await gtm.createTrigger(accountId, containerId, workspaceId, T.customEventTrigger({
          name: 'Axon -- Begin Checkout Event', eventName: eventNames.begin_checkout,
        }));
        trig.confirm = await gtm.createTrigger(accountId, containerId, workspaceId, T.customEventTrigger({
          name: 'Axon -- Purchase Event', eventName: eventNames.purchase,
        }));
      } else {
        const co = CHECKOUT_PATTERNS[site.platform] || CHECKOUT_PATTERNS.custom;
        trig.checkout = await gtm.createTrigger(accountId, containerId, workspaceId, T.pageUrlContainsTrigger({
          name: 'Axon -- Checkout Page', urlSubstring: co.checkout,
        }));
        trig.confirm = await gtm.createTrigger(accountId, containerId, workspaceId, T.pageUrlContainsTrigger({
          name: 'Axon -- Order Confirmation', urlSubstring: co.confirm,
        }));
      }
    }
  }

  stderr('[7/8] Creating tags...');
  const eventKey = args.eventKey;

  await gtm.createTag(accountId, containerId, workspaceId, T.customHtmlTag({
    name: 'Axon -- Init',
    html: T.initTagHtml({ eventKey }),
    firingTriggerId: [trig.init.triggerId],
    priority: 100,
  }));

  // Shopline/Shoplazza: translate GA4 gtag() ecommerce events into the
  // {event:'axon_*', ecommerce:{...}} dataLayer pushes the Axon triggers match.
  // Higher priority than Init so the dataLayer.push wrapper installs first.
  if (useGtagBridge) {
    await gtm.createTag(accountId, containerId, workspaceId, T.customHtmlTag({
      name: 'Axon -- gtag dataLayer Bridge',
      html: T.gtagBridgeTagHtml(),
      firingTriggerId: [trig.init.triggerId],
      priority: 110,
    }));
  }
  await gtm.createTag(accountId, containerId, workspaceId, T.customHtmlTag({
    name: 'Axon -- page_view',
    html: T.pageViewTagHtml(),
    firingTriggerId: [trig.allPages.triggerId],
  }));

  if (track === 'lead-gen') {
    await gtm.createTag(accountId, containerId, workspaceId, T.customHtmlTag({
      name: 'Axon -- generate_lead',
      html: T.generateLeadTagHtml({ eventName: 'generate_lead' }),
      firingTriggerId: [trig.generateLead.triggerId],
    }));
  } else {
    await gtm.createTag(accountId, containerId, workspaceId, T.customHtmlTag({
      name: 'Axon -- view_item',
      html: T.viewItemTagHtml({ eventName: eventNames.view_item, fieldMap }),
      firingTriggerId: [trig.viewItem.triggerId],
    }));
    await gtm.createTag(accountId, containerId, workspaceId, T.customHtmlTag({
      name: 'Axon -- add_to_cart',
      html: T.addToCartTagHtml({ eventName: eventNames.add_to_cart, fieldMap }),
      firingTriggerId: [trig.addToCart.triggerId],
    }));

    if (track === 'gtm-only') {
      await gtm.createTag(accountId, containerId, workspaceId, T.customHtmlTag({
        name: 'Axon -- begin_checkout',
        html: T.beginCheckoutTagHtml({ eventName: eventNames.begin_checkout, fieldMap }),
        firingTriggerId: [trig.checkout.triggerId],
      }));
      await gtm.createTag(accountId, containerId, workspaceId, T.customHtmlTag({
        name: 'Axon -- purchase',
        html: T.purchaseTagHtml({ eventName: eventNames.purchase, fieldMap, dedupeId: false }),
        firingTriggerId: [trig.confirm.triggerId],
      }));
    }
  }

  if (args.atcHook) {
    await gtm.createTag(accountId, containerId, workspaceId, T.customHtmlTag({
      name: 'Axon -- ATC Listener (cart/add XHR hook)',
      html: atcHookTagHtml(),
      firingTriggerId: [trig.init.triggerId],
    }));
  }

  // 8. Publish
  stderr('[8/8] Publishing...');
  let result;
  try {
    result = await gtm.submitWorkspace(accountId, containerId, workspaceId, {
      name: `Axon pixel setup ${new Date().toISOString().slice(0, 16)}`,
      notes: 'Created by gtm-pixel-setup skill',
    });
  } catch (e) {
    if (/GTM API 403/.test(e.message)) {
      throw new Error(`no_publish_permission: ${e.message}`);
    }
    throw e;
  }
  // gtm-client.submitWorkspace returns { version: <containerVersion>, published: true }
  // where `version` IS the containerVersion object with a .containerVersionId.
  const versionNumber = (result && result.version && result.version.containerVersionId) || '?';
  stderr(`   published version ${versionNumber}`);

  // 9. Summary
  const shopifyShop = site.shopifyShop || '';
  const shopifyAppLink = track === 'shopify-headless'
    ? `https://apps.shopify.com/axon${shopifyShop ? '?shop=' + encodeURIComponent(shopifyShop) : ''}`
    : null;

  die({
    status: 'ok',
    track,
    version: versionNumber,
    workspaceId,
    containerPublicId: container.publicId,
    containerName: container.name,
    accountName: account.name,
    shopifyAppLink,
    detected: {
      platform: site.platform,
      shopifyShop,
      isHostedCheckout: site.isHostedCheckout,
      usesStape: site.usesStape,
      usesElevar: site.usesElevar,
      usesGtagEcommerce: site.usesGtagEcommerce,
      gtagBridge: useGtagBridge,
      isSPA: site.isSPA,
      spaKind: site.spaKind,
      gtmContainerIds: site.gtmContainerIds,
      productUrlPattern: site.productUrlPattern,
    },
    eventNames,
    next:
      track === 'shopify-headless'
        ? `1. Install Axon Shopify App: ${shopifyAppLink}
2. After it shows Active, run: node setup.mjs --verify, and paste verifier into DevTools on storefront AND checkout.shopify.com`
        : useGtagBridge
          ? `Run: node setup.mjs --verify, paste verifier into DevTools on your storefront, then walk the full funnel including a test purchase. NOTE: ${site.platform} fires ecommerce via GA4 gtag() events that the Axon bridge translates — confirm view_item, add_to_cart, begin_checkout AND purchase each fire (the latter two depend on this store emitting GA4 begin_checkout/purchase events; if either is missing, capture names with --sniff and re-run with --event-names-json).`
          : `Run: node setup.mjs --verify, paste verifier into DevTools on your storefront, walk the full funnel including a test purchase.`,
  }, 0);

  } catch (err) {
    // Something failed between workspace creation and publish — clean up the orphan.
    await cleanupOnFailure();
    throw err;
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.mode === 'help') { printHelp(); return; }

  if (args.mode === 'sniff') {
    return stdout({ status: 'ok', snippetPath: path.join(__dirname, 'sniff-events.js') });
  }
  if (args.mode === 'verify') {
    return stdout({ status: 'ok', snippetPath: path.join(__dirname, 'verify-events.js') });
  }
  if (args.mode === 'revoke') {
    const { revokeToken } = await import('./oauth.mjs');
    await revokeToken({ tokenPath: TOKEN_PATH });
    return stdout({ status: 'ok', message: 'OAuth token cache deleted.' });
  }

  if (!args.eventKey || !args.siteUrl) {
    stderr('Error: --event-key and --site-url are required. Use --help.');
    die({ status: 'error', error: { kind: 'bad_args', message: '--event-key and --site-url required' } }, 64);
  }

  // Reject event keys that look like domain names or placeholders instead of real UUIDs.
  // Real Axon event keys are UUIDs: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(args.eventKey)) {
    die({
      status: 'error',
      error: {
        kind: 'invalid_event_key',
        message: `Event key "${args.eventKey}" does not look like a valid Axon event key. ` +
          'Event keys are UUIDs (e.g. 971e76ba-6851-4838-a7ea-60314ee67a6b). ' +
          'Find yours in Axon Ads Manager → Account Settings → Keys.',
      },
    }, 64);
  }

  await install(args);
}

main().catch((err) => {
  stderr(`[fatal] ${err.stack || err.message}`);
  const msg = err.message || String(err);
  let kind = 'unknown';
  if (/no_publish_permission/.test(msg) || (/GTM API 403/.test(msg) && /insufficient.*scopes|PERMISSION_DENIED/i.test(msg))) kind = 'no_publish_permission';
  else if (/GTM API 403/.test(msg)) kind = 'no_edit_permission';
  else if (/GTM API 401/.test(msg)) kind = 'oauth_expired';
  else if (/GTM API 404/.test(msg)) kind = 'not_found';
  else if (/oauth/i.test(msg)) kind = 'oauth_failed';
  die({ status: 'error', error: { kind, message: msg } }, 1);
});
