// Google OAuth 2.0 local-loopback flow for the Axon pixel installer.
// Zero npm deps — Node 24 built-ins only.
// Docs: https://developers.google.com/identity/protocols/oauth2/native-app

import http from 'node:http';
import crypto from 'node:crypto';
import { URL, URLSearchParams } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makePkce() {
  const verifier = b64url(crypto.randomBytes(48)).slice(0, 64);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function readCache(tokenPath) {
  try {
    const raw = await fs.readFile(tokenPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCache(tokenPath, data) {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

async function deleteCache(tokenPath) {
  try {
    await fs.unlink(tokenPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function tryOpenBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // best-effort, ignore
  }
}

async function exchangeToken(params) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.text();
  let json;
  try { json = JSON.parse(body); } catch { json = null; }
  if (!res.ok || !json || !json.access_token) {
    const detail = json?.error_description || json?.error || body || `HTTP ${res.status}`;
    const err = new Error(`Token endpoint error: ${detail}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function exchangeViaProxy(proxyUrl, endpoint, body) {
  const res = await fetch(`${proxyUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    const detail = json?.error_description || json?.error || `HTTP ${res.status}`;
    const err = new Error(`Token proxy error: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function startLoopbackServer(expectedState, onResult) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://127.0.0.1`);
        if (reqUrl.pathname !== '/' && reqUrl.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html><meta charset="utf-8"><title>Axon pixel installer</title><body style="font:16px/1.5 system-ui;padding:2rem"><h2>Authentication failed</h2><p>${error}</p></body>`);
          onResult({ error: new Error(`OAuth error: ${error}`) });
          return;
        }
        if (!code || !state) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing code or state');
          return;
        }
        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('State mismatch');
          onResult({ error: new Error('OAuth state mismatch (possible CSRF)') });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><title>Axon pixel installer</title><body style="font:16px/1.5 system-ui;padding:2rem;color:#111"><h2 style="margin:0 0 .5rem">Axon pixel installer</h2><p>Authentication successful — you can close this tab.</p></body>');
        onResult({ code });
      } catch (err) {
        try { res.writeHead(500); res.end('Error'); } catch {}
        onResult({ error: err });
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function runLoopbackFlow({ clientId, clientSecret, tokenProxyUrl, scopes }) {
  const state = b64url(crypto.randomBytes(24));
  const { verifier, challenge } = makePkce();

  let resolveResult;
  const resultPromise = new Promise((resolve) => { resolveResult = resolve; });
  const server = await startLoopbackServer(state, (r) => resolveResult(r));
  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  const urlStr = authUrl.toString();
  console.error('\n[axon] Google authentication required.');
  console.error('[axon] Opening your browser. If it does not open, paste this URL:');
  console.error(urlStr);
  console.error('[axon] Waiting for you to approve access (up to 5 min)...\n');
  tryOpenBrowser(urlStr);

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('OAuth flow timed out after 5 minutes')), FLOW_TIMEOUT_MS));

  let code;
  try {
    const outcome = await Promise.race([resultPromise, timeout]);
    if (outcome.error) throw outcome.error;
    code = outcome.code;
  } finally {
    server.close();
  }

  let tokens;
  if (tokenProxyUrl) {
    tokens = await exchangeViaProxy(tokenProxyUrl, '/token', { code, code_verifier: verifier, redirect_uri: redirectUri });
  } else {
    const tokenParams = { client_id: clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri };
    if (clientSecret) tokenParams.client_secret = clientSecret;
    tokens = await exchangeToken(tokenParams);
  }

  console.error('[axon] Authentication successful.\n');
  return tokens;
}

async function refreshAccessToken({ clientId, clientSecret, tokenProxyUrl, refreshToken }) {
  if (tokenProxyUrl) {
    return exchangeViaProxy(tokenProxyUrl, '/refresh', { refresh_token: refreshToken });
  }
  const params = { client_id: clientId, refresh_token: refreshToken, grant_type: 'refresh_token' };
  if (clientSecret) params.client_secret = clientSecret;
  return exchangeToken(params);
}

function tokenToCache(tokens, prevRefresh) {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || prevRefresh || null,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000 - 60_000,
    scope: tokens.scope,
    token_type: tokens.token_type,
  };
}

export async function ensureToken({ clientId, clientSecret, tokenProxyUrl, scopes, tokenPath }) {
  if (!clientId) throw new Error('ensureToken: clientId is required');
  if (!tokenPath) throw new Error('ensureToken: tokenPath is required');
  if (!Array.isArray(scopes) || scopes.length === 0) throw new Error('ensureToken: scopes must be a non-empty array');

  const cached = await readCache(tokenPath);
  if (cached?.access_token && typeof cached.expires_at === 'number' && cached.expires_at > Date.now()) {
    return { access_token: cached.access_token, expires_at: cached.expires_at };
  }

  if (cached?.refresh_token) {
    try {
      const refreshed = await refreshAccessToken({ clientId, clientSecret, tokenProxyUrl, refreshToken: cached.refresh_token });
      const next = tokenToCache(refreshed, cached.refresh_token);
      await writeCache(tokenPath, next);
      return { access_token: next.access_token, expires_at: next.expires_at };
    } catch (err) {
      await deleteCache(tokenPath);
    }
  }

  const tokens = await runLoopbackFlow({ clientId, clientSecret, tokenProxyUrl, scopes });
  const next = tokenToCache(tokens, null);
  await writeCache(tokenPath, next);
  return { access_token: next.access_token, expires_at: next.expires_at };
}

export async function revokeToken({ tokenPath }) {
  if (!tokenPath) throw new Error('revokeToken: tokenPath is required');
  await deleteCache(tokenPath);
}
