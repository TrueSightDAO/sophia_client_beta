/**
 * channels.js — the config-driven category/channel model + governor management,
 * with a localStorage overlay.
 *
 * Channel/category authority (locked with Gary): public channels viewable by guest;
 * private channels require governor/sentinel; channel + category creation/retirement
 * is governor/sentinel-only. Built-in channels come from `config.json` (per-deployment);
 * a governor/sentinel may create additional channels and categories, and retire
 * (hide) any channel. The overlay is stored in localStorage, so it is per-browser —
 * a server-side channel registry is a later PR.
 */
(function () {
  'use strict';

  const LS_CREATED = 'sophia_channels_created';
  const LS_RETIRED = 'sophia_channels_retired';
  const LS_CATEGORIES = 'sophia_categories_created';

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

  function getCreated() {
    try { return JSON.parse(localStorage.getItem(LS_CREATED) || '[]'); } catch (e) { return []; }
  }
  function setCreated(list) {
    try { localStorage.setItem(LS_CREATED, JSON.stringify(list)); } catch (e) { /* quota */ }
  }
  function getRetired() {
    try { return JSON.parse(localStorage.getItem(LS_RETIRED) || '[]'); } catch (e) { return []; }
  }
  function setRetired(list) {
    try { localStorage.setItem(LS_RETIRED, JSON.stringify(list)); } catch (e) { /* quota */ }
  }
  function getCreatedCategories() {
    try { return JSON.parse(localStorage.getItem(LS_CATEGORIES) || '[]'); } catch (e) { return []; }
  }
  function setCreatedCategories(list) {
    try { localStorage.setItem(LS_CATEGORIES, JSON.stringify(list)); } catch (e) { /* quota */ }
  }

  /** All categories = config category names + created (deduped, order-preserving). */
  function allCategories(config) {
    const built = (config.categories || []).map((c) => c.name);
    const created = getCreatedCategories().filter((n) => built.indexOf(n) === -1);
    return built.concat(created);
  }

  /** Create a category (idempotent by name). Returns the normalized name, or null if empty. */
  function createCategory(name) {
    const n = (name || '').trim();
    if (!n) return null;
    const list = getCreatedCategories();
    if (list.indexOf(n) === -1) {
      list.push(n);
      setCreatedCategories(list);
    }
    return n;
  }

  /** All channels = config (minus retired) + created (minus retired). */
  function allChannels(config) {
    const retired = new Set(getRetired());
    const built = flattenChannels(config).filter((c) => !retired.has(c.id));
    const created = getCreated().filter((c) => !retired.has(c.id));
    return built.concat(created);
  }

  /**
   * @param {string} role — 'governor' | 'sentinel' | 'member' | 'guest'
   * @returns channels visible to that role.
   */
  function visibleChannels(config, role) {
    const all = allChannels(config);
    if (role === 'governor' || role === 'sentinel') return all;
    return all.filter((ch) => ch.visibility !== 'private');
  }

  /** Create a channel under an existing category (name from the dropdown). */
  function createChannel(categoryName, name, visibility) {
    const id = 'ch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ch = {
      id,
      categoryId: null,
      categoryName: (categoryName || 'General').trim() || 'General',
      name: (name || '').trim() || id,
      visibility: visibility === 'public' ? 'public' : 'private',
      created: true,
    };
    const list = getCreated();
    list.push(ch);
    setCreated(list);
    return ch;
  }

  /** Retire (hide) a channel. */
  function retireChannel(id) {
    const retired = getRetired();
    if (retired.indexOf(id) === -1) {
      retired.push(id);
      setRetired(retired);
    }
  }

  function restoreChannel(id) {
    setRetired(getRetired().filter((r) => r !== id));
  }

  function isRetired(id) {
    return getRetired().indexOf(id) !== -1;
  }

  /** Find a created (user) channel by id. Built-in config channels are not editable. */
  function findCreated(id) {
    return getCreated().find((c) => c.id === id) || null;
  }

  function isBuiltinChannel(id) {
    return !findCreated(id);
  }

  function renameChannel(id, newName) {
    const list = getCreated();
    const ch = list.find((c) => c.id === id);
    if (!ch) return null;
    ch.name = (newName || '').trim() || ch.name;
    setCreated(list);
    return ch;
  }

  function setChannelVisibility(id, visibility) {
    const list = getCreated();
    const ch = list.find((c) => c.id === id);
    if (!ch) return null;
    ch.visibility = visibility === 'public' ? 'public' : 'private';
    setCreated(list);
    return ch;
  }

  function isBuiltinCategory(name) {
    return getCreatedCategories().indexOf(name) === -1;
  }

  function renameCategory(oldName, newName) {
    const n = (newName || '').trim();
    if (!n || n === oldName) return null;
    const cats = getCreatedCategories();
    const idx = cats.indexOf(oldName);
    if (idx >= 0) {
      cats[idx] = n;
      setCreatedCategories(cats);
    }
    const list = getCreated();
    list.forEach((c) => { if (c.categoryName === oldName) c.categoryName = n; });
    setCreated(list);
    return n;
  }

  function deleteCategory(name) {
    setCreatedCategories(getCreatedCategories().filter((c) => c !== name));
    setCreated(getCreated().filter((c) => c.categoryName !== name));
  }

  window.SophiaChannels = {
    flattenChannels,
    allChannels,
    allCategories,
    visibleChannels,
    createChannel,
    createCategory,
    retireChannel,
    restoreChannel,
    isRetired,
    renameChannel,
    setChannelVisibility,
    renameCategory,
    deleteCategory,
    isBuiltinChannel,
    isBuiltinCategory,
    getCreated,
    getRetired,
    getCreatedCategories,
  };
})();
