/**
 * channels.js — config-driven channel/category model + a shared server registry.
 *
 * Built-in channels come from `config.json` (per-deployment). User-created
 * channels/categories and retired ids live in a Redis-backed registry on the
 * brain (`GET/POST/PUT/DELETE /channels`, `POST/PUT/DELETE /categories`), so the
 * same set appears across origins/devices. localStorage is read only as a
 * fallback when the registry endpoint is unreachable.
 *
 * Channel/category authority (locked with Gary): public channels viewable by
 * guest; private channels require governor/sentinel; channel + category
 * creation/retirement is governor/sentinel-only (enforced server-side too).
 */
(function () {
  'use strict';

  const LS_CREATED = 'sophia_channels_created';
  const LS_RETIRED = 'sophia_channels_retired';
  const LS_CATEGORIES = 'sophia_categories_created';

  // In-memory cache of the shared registry (loaded from the server).
  let registry = { channels: [], categories: [], retired: [] };

  function baseUrl() {
    const cfg = window.AppConfig || {};
    return (cfg.sophiaBaseUrl || 'https://sophia.truesight.me').replace(/\/+$/, '');
  }

  function _lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
  }

  function flattenChannels(config) {
    const out = [];
    (config.categories || []).forEach((cat) => {
      (cat.channels || []).forEach((ch) => {
        out.push({
          categoryId: cat.id,
          categoryName: cat.name,
          id: ch.id,
          name: ch.name || ch.id,
          visibility: ch.visibility || 'public',
          builtin: true,
        });
      });
    });
    return out;
  }

  /** Load the shared registry from the brain. Falls back to localStorage. */
  async function loadRegistry(token) {
    try {
      const resp = await fetch(baseUrl() + '/channels', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (resp.ok) {
        const d = await resp.json();
        registry = {
          channels: (d.channels || []).map((c) => Object.assign({}, c, { created: true })),
          categories: d.categories || [],
          retired: d.retired || [],
        };
        return registry;
      }
    } catch (e) { /* fall back to localStorage */ }
    registry = {
      channels: _lsGet(LS_CREATED).map((c) => Object.assign({}, c, { created: true })),
      categories: _lsGet(LS_CATEGORIES),
      retired: _lsGet(LS_RETIRED),
    };
    return registry;
  }

  function allCategories(config) {
    const built = (config.categories || []).map((c) => c.name);
    const created = registry.categories.filter((n) => built.indexOf(n) === -1);
    return built.concat(created);
  }

  function allChannels(config) {
    const retired = new Set(registry.retired);
    const built = flattenChannels(config).filter((c) => !retired.has(c.id));
    const created = registry.channels.filter((c) => !retired.has(c.id));
    return built.concat(created);
  }

  function visibleChannels(config, role) {
    const all = allChannels(config);
    if (role === 'governor' || role === 'sentinel') return all;
    return all.filter((ch) => ch.visibility !== 'private');
  }

  function isRetired(id) {
    return registry.retired.indexOf(id) !== -1;
  }

  function isBuiltinChannel(id) {
    return !registry.channels.some((c) => c.id === id);
  }

  function isBuiltinCategory(name) {
    return registry.categories.indexOf(name) === -1;
  }

  // ---- server CRUD (async; updates the in-memory cache on success) ----

  async function _req(method, path, body, token) {
    const resp = await fetch(baseUrl() + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (token || '') },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      let detail = 'HTTP ' + resp.status;
      try {
        const j = await resp.json();
        if (j && (j.detail || j.error)) detail = j.detail || j.error;
      } catch (e) { /* ignore */ }
      throw new Error(detail);
    }
    return resp.json();
  }

  async function createChannel(categoryName, name, visibility, token) {
    const ch = await _req('POST', '/channels', { category_name: categoryName, name, visibility }, token);
    ch.created = true;
    registry.channels.push(ch);
    return ch;
  }

  async function renameChannel(id, newName, token) {
    const ch = await _req('PUT', '/channels/' + encodeURIComponent(id), { name: newName }, token);
    const local = registry.channels.find((c) => c.id === id);
    if (local) local.name = ch.name;
    return ch;
  }

  async function setChannelVisibility(id, visibility, token) {
    const ch = await _req('PUT', '/channels/' + encodeURIComponent(id), { visibility }, token);
    const local = registry.channels.find((c) => c.id === id);
    if (local) local.visibility = ch.visibility;
    return ch;
  }

  async function retireChannel(id, token) {
    await _req('DELETE', '/channels/' + encodeURIComponent(id), null, token);
    if (registry.retired.indexOf(id) === -1) registry.retired.push(id);
    registry.channels = registry.channels.filter((c) => c.id !== id);
  }

  async function createCategory(name, token) {
    const res = await _req('POST', '/categories', { name }, token);
    const n = res.name || (name || '').trim();
    if (n && registry.categories.indexOf(n) === -1) registry.categories.push(n);
    return n;
  }

  async function renameCategory(oldName, newName, token) {
    const res = await _req('PUT', '/categories/' + encodeURIComponent(oldName), { name: newName }, token);
    const n = res.name || oldName;
    registry.categories = registry.categories.map((c) => (c === oldName ? n : c));
    registry.channels.forEach((c) => { if (c.categoryName === oldName) c.categoryName = n; });
    return n;
  }

  async function deleteCategory(name, token) {
    await _req('DELETE', '/categories/' + encodeURIComponent(name), null, token);
    registry.categories = registry.categories.filter((c) => c !== name);
    registry.channels = registry.channels.filter((c) => c.categoryName !== name);
  }

  window.SophiaChannels = {
    loadRegistry,
    flattenChannels,
    allChannels,
    allCategories,
    visibleChannels,
    createChannel,
    createCategory,
    retireChannel,
    renameChannel,
    setChannelVisibility,
    renameCategory,
    deleteCategory,
    isBuiltinChannel,
    isBuiltinCategory,
    isRetired,
  };
})();
