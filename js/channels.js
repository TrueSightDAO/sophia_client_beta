/**
 * channels.js — the config-driven category/channel model + visibility filter.
 *
 * Channel authority (locked with Gary): public channels viewable by guest; private
 * channels require governor/sentinel; channel creation is governor-only. In v1 the
 * role is resolved to `governor` on successful `/auth/challenge` (governor-only mint)
 * — the full `guest`/`member` tiers arrive with PR4's server endpoint.
 */
(function () {
  'use strict';

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
        });
      });
    });
    return out;
  }

  /**
   * @param {string} role — 'governor' | 'sentinel' | 'member' | 'guest'
   * @returns channels visible to that role.
   */
  function visibleChannels(config, role) {
    const all = flattenChannels(config);
    if (role === 'governor' || role === 'sentinel') return all;
    // member + guest see public channels only
    return all.filter((ch) => ch.visibility !== 'private');
  }

  window.SophiaChannels = { flattenChannels, visibleChannels };
})();
