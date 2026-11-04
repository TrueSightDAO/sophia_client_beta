/**
 * channels.js — the config-driven category/channel model + governor channel
 * management, with a localStorage overlay.
 *
 * Channel authority (locked with Gary): public channels viewable by guest;
 * private channels require governor/sentinel; channel creation/retirement is
 * governor/sentinel-only. Built-in channels come from `config.json`
 * (per-deployment); a governor/sentinel may create additional channels and
 * retire (hide) any channel. The overlay is stored in localStorage, so it is
 * per-browser — a server-side channel registry is a later PR.
 */
(function () {
  'use strict';

  const LS_CREATED = 'sophia_channels_created';
  const LS_RETIRED = 'sophia_channels_retired';

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

  /** Create a channel. A category name that doesn't exist yet becomes a new category. */
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

  /** Retire (hide) a channel. Built-in channels are hidden locally; created ones hidden too. */
  function retireChannel(id) {
    const retired = getRetired();
    if (retired.indexOf(id) === -1) {
      retired.push(id);
      setRetired(retired);
    }
  }

  /** Restore a retired channel. */
  function restoreChannel(id) {
    setRetired(getRetired().filter((r) => r !== id));
  }

  function isRetired(id) {
    return getRetired().indexOf(id) !== -1;
  }

  window.SophiaChannels = {
    flattenChannels,
    allChannels,
    visibleChannels,
    createChannel,
    retireChannel,
    restoreChannel,
    isRetired,
    getCreated,
    getRetired,
  };
})();
