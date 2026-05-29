// Minimal Google Tag Manager API v2 client.
// Zero dependencies. Uses native fetch (Node 24+).
// Docs: https://developers.google.com/tag-platform/tag-manager/api/v2/reference

const BASE_URL = 'https://tagmanager.googleapis.com/tagmanager/v2';

export class GTMClient {
  constructor(accessToken) {
    if (!accessToken) throw new Error('GTMClient: accessToken is required');
    this.accessToken = accessToken;
  }

  async _request(method, path, body, { retries = 3, backoff = 2000 } = {}) {
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    const headers = { Authorization: `Bearer ${this.accessToken}` };
    const init = { method, headers };
    if (body !== undefined && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetch(url, init);
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
      }
      if (res.status === 429) {
        if (attempt === retries) {
          throw new Error(`GTM API 429: Resource exhausted (RESOURCE_EXHAUSTED) — rate limit hit after ${retries} retries`);
        }
        const wait = backoff * Math.pow(2, attempt);
        process.stderr.write(`   [rate-limit] GTM API 429 — waiting ${wait / 1000}s before retry ${attempt + 1}/${retries}...\n`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const err = (data && data.error) || {};
        const msg = err.message || res.statusText || 'Unknown error';
        const status = err.status || res.status;
        throw new Error(`GTM API ${res.status}: ${msg} (${status})`);
      }
      return data;
    }
  }

  async _paginate(path, field) {
    const results = [];
    let pageToken;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const p = pageToken ? `${path}${sep}pageToken=${encodeURIComponent(pageToken)}` : path;
      const data = await this._request('GET', p);
      if (data && Array.isArray(data[field])) results.push(...data[field]);
      pageToken = data && data.nextPageToken;
    } while (pageToken);
    return results;
  }

  // ---------- Read operations ----------

  async listAccounts() {
    return this._paginate('/accounts', 'account');
  }

  async listContainers(accountId) {
    return this._paginate(`/accounts/${accountId}/containers`, 'container');
  }

  async listWorkspaces(accountId, containerId) {
    return this._paginate(
      `/accounts/${accountId}/containers/${containerId}/workspaces`,
      'workspace'
    );
  }

  async getUserPermissions(accountId) {
    return this._paginate(`/accounts/${accountId}/user_permissions`, 'userPermission');
  }

  // ---------- Container ops ----------

  async createContainer(accountId, { name, usageContext = ['web'] } = {}) {
    return this._request('POST', `/accounts/${accountId}/containers`, { name, usageContext });
  }

  // ---------- Workspace ops ----------

  async createWorkspace(accountId, containerId, { name, description } = {}) {
    return this._request(
      'POST',
      `/accounts/${accountId}/containers/${containerId}/workspaces`,
      { name, description }
    );
  }

  async deleteWorkspace(accountId, containerId, workspaceId) {
    return this._request(
      'DELETE',
      `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`
    );
  }

  // ---------- Entity listing ----------

  async listTags(accountId, containerId, workspaceId) {
    return this._paginate(
      `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/tags`,
      'tag'
    );
  }

  async listTriggers(accountId, containerId, workspaceId) {
    return this._paginate(
      `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/triggers`,
      'trigger'
    );
  }

  async listVariables(accountId, containerId, workspaceId) {
    return this._paginate(
      `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/variables`,
      'variable'
    );
  }

  // ---------- Entity create/delete ----------

  async createTag(accountId, containerId, workspaceId, tag) {
    return this._request(
      'POST',
      `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/tags`,
      tag
    );
  }

  async createTrigger(accountId, containerId, workspaceId, trigger) {
    return this._request(
      'POST',
      `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/triggers`,
      trigger
    );
  }

  async deleteTag(accountId, containerId, workspaceId, tagId) {
    return this._request(
      'DELETE',
      `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/tags/${tagId}`
    );
  }

  async deleteTrigger(accountId, containerId, workspaceId, triggerId) {
    return this._request(
      'DELETE',
      `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}/triggers/${triggerId}`
    );
  }

  // ---------- Publish ----------

  async createVersion(accountId, containerId, workspaceId, { name, notes } = {}) {
    return this._request(
      'POST',
      `/accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}:create_version`,
      { name, notes }
    );
  }

  async publishVersion(accountId, containerId, versionId) {
    return this._request(
      'POST',
      `/accounts/${accountId}/containers/${containerId}/versions/${versionId}:publish`
    );
  }

  // ---------- Convenience ----------

  async submitWorkspace(accountId, containerId, workspaceId, { name, notes } = {}) {
    const createRes = await this.createVersion(accountId, containerId, workspaceId, { name, notes });
    const version = createRes && createRes.containerVersion;
    if (!version || !version.containerVersionId) {
      throw new Error('GTM submitWorkspace: createVersion returned no containerVersion');
    }
    await this.publishVersion(accountId, containerId, version.containerVersionId);
    return { version, published: true };
  }

  async findContainerByPublicId(publicId) {
    const accounts = await this.listAccounts();
    for (const account of accounts) {
      const containers = await this.listContainers(account.accountId);
      for (const container of containers) {
        if (container.publicId === publicId) return { account, container };
      }
    }
    return null;
  }
}
