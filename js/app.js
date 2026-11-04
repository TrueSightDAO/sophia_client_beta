/**
 * app.js — bootstrap: load config, wire identity + channel list + chat pane,
 * attachments, streaming replies, reactions, and channel management.
 */
(function () {
  'use strict';

  let currentChannelId = null;
  let currentRole = 'guest';
  let creds = null; // { publicKey, privateKey } (for signed upload path)
  let token = null; // JWT from /auth-tier (for text chat)
  let pendingFiles = [];
  let config = null;

  const REACTIONS = ['👍', '👀', '✅', '❌'];

  function el(id) { return document.getElementById(id); }

  function fingerprint(pub) {
    if (!pub) return '';
    return pub.replace(/[\r\n=]/g, '').slice(0, 12);
  }

  function isPrivileged(role) {
    return role === 'governor' || role === 'sentinel';
  }

  function channelFromHash() {
    const h = (window.location.hash || '').replace(/^#/, '');
    if (h.indexOf('channel=') === 0) {
      try { return decodeURIComponent(h.slice('channel='.length)); } catch (e) { return null; }
    }
    return null;
  }

  function setChannelHash(channelId) {
    const target = '#channel=' + encodeURIComponent(channelId);
    if (window.location.hash !== target) {
      history.replaceState(null, '', target);
    }
  }

  function selectChannelOrFirst() {
    const wanted = channelFromHash();
    const visible = window.SophiaChannels.visibleChannels(config, currentRole);
    if (wanted && visible.some((c) => c.id === wanted)) {
      selectChannel(wanted);
    } else if (visible.length) {
      selectChannel(visible[0].id);
    }
  }

  async function loadConfig() {
    const resp = await fetch('./config.json');
    if (!resp.ok) throw new Error('config.json not found (HTTP ' + resp.status + ')');
    return resp.json();
  }

  // ---- channel list ----

  function renderChannelList() {
    const sidebar = el('channelList');
    sidebar.innerHTML = '';
    const byCat = {};
    window.SophiaChannels.visibleChannels(config, currentRole).forEach((ch) => {
      (byCat[ch.categoryName] = byCat[ch.categoryName] || []).push(ch);
    });
    window.SophiaChannels.allCategories(config).forEach((catName) => {
      const catHeader = document.createElement('div');
      catHeader.className = 'category';
      catHeader.textContent = catName;
      sidebar.appendChild(catHeader);
      (byCat[catName] || []).forEach((ch) => {
        sidebar.appendChild(buildChannelItem(ch));
      });
    });
    const priv = isPrivileged(currentRole);
    el('newChannelBtn').hidden = !priv;
    el('newCategoryBtn').hidden = !priv;
  }

  function buildChannelItem(ch) {
    const item = document.createElement('div');
    item.className = 'channel';
    item.dataset.channelId = ch.id;
    const name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = '# ' + ch.name;
    item.appendChild(name);
    item.addEventListener('click', () => selectChannel(ch.id));

    if (isPrivileged(currentRole)) {
      const retire = document.createElement('button');
      retire.className = 'channel-retire';
      retire.textContent = '✕';
      retire.title = 'Retire channel';
      retire.addEventListener('click', (e) => {
        e.stopPropagation();
        window.SophiaChannels.retireChannel(ch.id);
        if (currentChannelId === ch.id) { currentChannelId = null; el('messages').innerHTML = ''; el('chatHeader').textContent = '# select a channel'; }
        renderChannelList();
      });
      item.appendChild(retire);
    }
    return item;
  }

  function openNewChannelModal() {
    const sel = el('channelCategory');
    sel.innerHTML = '';
    window.SophiaChannels.allCategories(config).forEach((catName) => {
      const opt = document.createElement('option');
      opt.value = catName;
      opt.textContent = catName;
      sel.appendChild(opt);
    });
    el('channelName').value = '';
    el('channelVisibility').value = 'private';
    el('channelModal').hidden = false;
    el('channelName').focus();
  }

  function closeNewChannelModal() {
    el('channelModal').hidden = true;
  }

  function onCreateChannel() {
    const name = el('channelName').value.trim();
    const category = el('channelCategory').value;
    if (!name) { el('channelName').focus(); return; }
    const visibility = el('channelVisibility').value;
    const ch = window.SophiaChannels.createChannel(category, name, visibility);
    closeNewChannelModal();
    renderChannelList();
    selectChannel(ch.id);
  }

  function openCategoryModal() {
    el('categoryName').value = '';
    el('categoryModal').hidden = false;
    el('categoryName').focus();
  }

  function closeCategoryModal() {
    el('categoryModal').hidden = true;
  }

  function onCreateCategory() {
    const name = el('categoryName').value.trim();
    if (!name) { el('categoryName').focus(); return; }
    window.SophiaChannels.createCategory(name);
    closeCategoryModal();
    renderChannelList();
  }

  async function selectChannel(channelId) {
    currentChannelId = channelId;
    setChannelHash(channelId);
    document.querySelectorAll('.channel').forEach((n) => n.classList.toggle('active', n.dataset.channelId === channelId));
    el('chatHeader').textContent = '#' + channelId;
    el('messages').innerHTML = '';
    appendMessage('system', 'Loading history…');
    try {
      if (!creds) throw new Error('Not connected');
      const history = await window.SophiaChat.loadHistory(channelId, creds.publicKey);
      el('messages').innerHTML = '';
      renderHistory(history);
    } catch (e) {
      appendMessage('system', 'Could not load history: ' + e.message);
    }
  }

  function renderHistory(history) {
    const messages = Array.isArray(history)
      ? history
      : (history && Array.isArray(history.messages)) ? history.messages : [];
    messages.forEach((m) => {
      const content = typeof m === 'string' ? m : (m.content || m.text || '');
      const role = (m && (m.role || m.from)) || 'assistant';
      const who = (role === 'user' || role === 'human') ? 'you' : 'sophia';
      appendMessage(who, String(content));
    });
  }

  /** Render message text as Markdown (headings, code, lists, tables, images…). */
  function renderContent(text) {
    return window.SophiaMarkdown.renderMarkdown(text);
  }

  function scrollToBottom() {
    const box = el('messages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function appendMessage(who, text, opts) {
    opts = opts || {};
    const box = el('messages');
    const row = document.createElement('div');
    row.className = 'msg ' + who;
    const stack = document.createElement('div');
    stack.className = 'msg-stack';

    if (who === 'you' || who === 'sophia') {
      const sender = document.createElement('div');
      sender.className = 'sender';
      sender.textContent = who === 'you' ? 'You' : 'Sophia';
      stack.appendChild(sender);
    }

    const content = document.createElement('div');
    content.className = 'bubble';
    if (who === 'system') {
      content.textContent = text;
    } else {
      content.innerHTML = renderContent(text);
    }
    stack.appendChild(content);

    if (who === 'sophia' && opts.reactive !== false) {
      stack.appendChild(buildReactionBar(text));
    }

    row.appendChild(stack);
    box.appendChild(row);
    scrollToBottom();
    return content;
  }

  // ---- reactions (client-side, persisted in localStorage per channel) ----

  function reactionKey(text) {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function readReactions(channelId, key) {
    try {
      const raw = localStorage.getItem('sophia_reactions_' + channelId);
      const map = raw ? JSON.parse(raw) : {};
      return map[key] || {};
    } catch (e) { return {}; }
  }

  function writeReactions(channelId, key, map) {
    try {
      const raw = localStorage.getItem('sophia_reactions_' + channelId);
      const all = raw ? JSON.parse(raw) : {};
      all[key] = map;
      localStorage.setItem('sophia_reactions_' + channelId, JSON.stringify(all));
    } catch (e) { /* non-fatal */ }
  }

  function buildReactionBar(text) {
    const bar = document.createElement('div');
    bar.className = 'reactions';
    const key = reactionKey(text);
    const state = currentChannelId ? readReactions(currentChannelId, key) : {};
    REACTIONS.forEach((emoji) => {
      const btn = document.createElement('button');
      btn.className = 'reaction' + (state[emoji] ? ' active' : '');
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        const cur = readReactions(currentChannelId, key);
        if (cur[emoji]) delete cur[emoji]; else cur[emoji] = true;
        writeReactions(currentChannelId, key, cur);
        btn.classList.toggle('active', !!cur[emoji]);
      });
      bar.appendChild(btn);
    });
    return bar;
  }

  function setAuthBanner(text, kind) {
    const banner = el('authBanner');
    banner.textContent = text;
    banner.className = 'auth-banner ' + (kind || '');
    banner.hidden = false;
  }

  async function onConnect() {
    try {
      const auth = await window.SophiaAuth.authenticate();
      token = auth.token;
      creds = await window.SophiaAuth.ensureKeypair();
      currentRole = auth.role;
      renderChannelList();
      el('identity').textContent = 'identity: ' + fingerprint(creds.publicKey);
      el('connectBtn').hidden = true;
      el('composer').hidden = false;
      setAuthBanner('Signed in as ' + auth.role + ' · identity ' + fingerprint(creds.publicKey), 'ok');
      selectChannelOrFirst();
    } catch (e) {
      setAuthBanner('Identity failed: ' + e.message, 'error');
    }
  }

  function makeCallbacks(thinking, streamed) {
    return {
      onEvent(evt) {
        switch (evt.type) {
          case 'token': {
            const t = evt.content || '';
            if (t && t !== 'Thinking…' && t !== 'Thinking...') {
              streamed.value += t;
              thinking.textContent = streamed.value;
            }
            break;
          }
          case 'tool':
            thinking.textContent = '🔧 ' + (evt.tool || 'tool') + (evt.status === 'calling' ? ' …' : ' done');
            break;
          case 'status':
            thinking.textContent = '🔄 ' + (evt.message || evt.stage || 'processing…');
            break;
          case 'error':
            thinking.textContent = '⚠️ ' + (evt.content || evt.message || 'error');
            break;
          case 'cancelled':
            thinking.textContent = (streamed.value || '') + (evt.reason ? ' (cancelled)' : '');
            break;
          case 'done':
            if (evt.response != null) thinking.innerHTML = renderContent(evt.response);
            break;
        }
        requestAnimationFrame(scrollToBottom);
      },
      onDone(t) {
        if (t) thinking.innerHTML = renderContent(t);
        else if (!streamed.value) thinking.textContent = '(no reply)';
        scrollToBottom();
      },
    };
  }

  async function onSend() {
    const input = el('messageInput');
    const text = input.value.trim();
    if ((!text && !pendingFiles.length) || !currentChannelId) return;
    if (!token || !creds) { setAuthBanner('Not connected — connect first.', 'error'); return; }

    const files = pendingFiles.slice();
    pendingFiles = [];
    resetComposer();

    if (text) appendMessage('you', text);
    if (files.length) appendMessage('you', '📎 ' + files.map((f) => f.name).join(', '));

    const thinking = appendMessage('sophia', '🔄 Thinking…', { reactive: false });
    const streamed = { value: '' };
    const cb = makeCallbacks(thinking, streamed);

    try {
      if (files.length) {
        await window.SophiaChat.sendMessageWithFiles(currentChannelId, text, files, creds, cb);
      } else {
        await window.SophiaChat.sendMessage(currentChannelId, text, token, cb);
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (/403|governor|sentinel/i.test(msg)) {
        setAuthBanner('Send rejected — insufficient rights for this key. ' + msg, 'error');
      }
      thinking.textContent = 'Error: ' + msg;
    }
    scrollToBottom();
  }

  function updateAttachLabel() {
    el('attachBtn').textContent = pendingFiles.length ? '📎 ' + pendingFiles.length : '📎';
  }

  function autoResizeTextarea() {
    const t = el('messageInput');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 220) + 'px';
  }

  function resetComposer() {
    const t = el('messageInput');
    t.value = '';
    t.style.height = 'auto';
    updateAttachLabel();
  }

  function onFilesChosen() {
    const input = el('fileInput');
    pendingFiles = Array.from(input.files || []);
    input.value = '';
    updateAttachLabel();
  }

  async function boot() {
    try {
      config = await loadConfig();
      window.AppConfig = config;
      document.title = config.appTitle || 'TrueSight Ops Console';
      el('appTitle').textContent = config.appTitle || 'TrueSight Ops Console';
      el('deployment').textContent = 'deployment: ' + (config.deployment || 'local') +
        ' → ' + (config.sophiaBaseUrl || '');
      const pub = window.SophiaAuth.getStoredPublicKey();
      el('identity').textContent = 'identity: ' + (pub ? fingerprint(pub) : '(none)');
      renderChannelList();
      if (pub) onConnect(); // already have a key → connect immediately
    } catch (e) {
      setAuthBanner('Boot error: ' + e.message, 'error');
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    el('connectBtn').addEventListener('click', onConnect);
    el('sendBtn').addEventListener('click', onSend);
    el('attachBtn').addEventListener('click', () => el('fileInput').click());
    el('fileInput').addEventListener('change', onFilesChosen);
    el('messageInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend(); }
    });
    el('messageInput').addEventListener('input', autoResizeTextarea);
    el('newChannelBtn').addEventListener('click', openNewChannelModal);
    el('channelCreateBtn').addEventListener('click', onCreateChannel);
    el('channelCancelBtn').addEventListener('click', closeNewChannelModal);
    el('newCategoryBtn').addEventListener('click', openCategoryModal);
    el('categoryCreateBtn').addEventListener('click', onCreateCategory);
    el('categoryCancelBtn').addEventListener('click', closeCategoryModal);
    window.addEventListener('hashchange', () => {
      const wanted = channelFromHash();
      if (wanted && wanted !== currentChannelId && creds) {
        selectChannel(wanted);
      }
    });
    boot();
  });
})();
