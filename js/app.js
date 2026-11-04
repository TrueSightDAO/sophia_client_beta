/**
 * app.js — bootstrap: load config, wire identity + channel list + chat pane,
 * attachments, and reactions.
 */
(function () {
  'use strict';

  let currentChannelId = null;
  let currentRole = 'guest';
  let creds = null; // { publicKey, privateKey }
  let pendingFiles = [];

  const REACTIONS = ['👍', '👀', '✅', '❌'];

  function el(id) { return document.getElementById(id); }

  function fingerprint(pub) {
    if (!pub) return '';
    return pub.replace(/[\r\n=]/g, '').slice(0, 12);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  async function loadConfig() {
    const resp = await fetch('./config.json');
    if (!resp.ok) throw new Error('config.json not found (HTTP ' + resp.status + ')');
    return resp.json();
  }

  function renderChannelList(config, role) {
    const sidebar = el('channelList');
    sidebar.innerHTML = '';
    const byCat = {};
    window.SophiaChannels.visibleChannels(config, role).forEach((ch) => {
      (byCat[ch.categoryName] = byCat[ch.categoryName] || []).push(ch);
    });
    Object.keys(byCat).forEach((catName) => {
      const catHeader = document.createElement('div');
      catHeader.className = 'category';
      catHeader.textContent = catName;
      sidebar.appendChild(catHeader);
      byCat[catName].forEach((ch) => {
        const item = document.createElement('div');
        item.className = 'channel';
        item.dataset.channelId = ch.id;
        item.textContent = '# ' + ch.name;
        item.addEventListener('click', () => selectChannel(ch.id));
        sidebar.appendChild(item);
      });
    });
  }

  async function selectChannel(channelId) {
    currentChannelId = channelId;
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

  /** Render message text, converting known image/file URLs into inline previews. */
  function renderContent(text) {
    const safe = escapeHtml(text);
    const attachments = window.SophiaChat.detectAttachments(text, window.AppConfig.sophiaBaseUrl);
    if (!attachments.length) return safe;

    // Replace each detected URL's escaped form with an <img>/link. EscapeHtml turns
    // "/uploads/x.png" into "/uploads/x.png" (no change) and "http://" stays safe;
    // we swap the plain URL back in carefully via a placeholder approach.
    let html = safe;
    attachments.forEach((att) => {
      const escapedUrl = escapeHtml(att.url);
      const tag = att.type === 'image'
        ? '<img class="attach" src="' + escapedUrl + '" alt="attachment" loading="lazy" />'
        : '<a class="attach-link" href="' + escapedUrl + '" target="_blank" rel="noopener">' + escapedUrl + '</a>';
      // Replace the first occurrence of the escaped URL (or its /uploads/ original)
      html = html.replace(escapedUrl, tag);
      if (att.url.startsWith((window.AppConfig.sophiaBaseUrl || '').replace(/\/+$/, ''))) {
        const rel = att.url.replace((window.AppConfig.sophiaBaseUrl || '').replace(/\/+$/, ''), '');
        html = html.replace(escapeHtml(rel), tag);
      }
    });
    return html;
  }

  function appendMessage(who, text, opts) {
    opts = opts || {};
    const box = el('messages');
    const row = document.createElement('div');
    row.className = 'msg ' + who;
    const content = document.createElement('div');
    content.className = 'bubble';
    if (who === 'system') {
      content.textContent = text;
    } else {
      content.innerHTML = renderContent(text);
    }
    row.appendChild(content);

    if (who === 'sophia' && opts.reactive !== false) {
      row.appendChild(buildReactionBar(text));
    }

    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    return content;
  }

  // ---- reactions (client-side, persisted in localStorage per channel) ----

  function reactionKey(text) {
    // Stable-ish key from the message content, so reactions survive a reload.
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
    } catch (e) { /* quota — non-fatal */ }
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
      creds = await window.SophiaAuth.ensureKeypair();
      currentRole = 'governor'; // v1: only governor keys pass verify_payload on /chat
      const cfg = window.AppConfig;
      renderChannelList(cfg, currentRole);
      el('identity').textContent = 'identity: ' + fingerprint(creds.publicKey);
      el('connectBtn').hidden = true;
      el('composer').hidden = false;
      setAuthBanner('Signed in as governor · identity ' + fingerprint(creds.publicKey), 'ok');
      const first = window.SophiaChannels.visibleChannels(cfg, currentRole)[0];
      if (first) selectChannel(first.id);
    } catch (e) {
      setAuthBanner('Identity failed: ' + e.message, 'error');
    }
  }

  async function onSend() {
    const input = el('messageInput');
    const text = input.value.trim();
    if ((!text && !pendingFiles.length) || !currentChannelId) return;
    if (!creds) { setAuthBanner('Not connected — connect first.', 'error'); return; }

    input.value = '';
    const files = pendingFiles.slice();
    pendingFiles = [];
    updateAttachLabel();

    if (text) appendMessage('you', text);
    if (files.length) appendMessage('you', '📎 ' + files.map((f) => f.name).join(', '));

    const thinking = appendMessage('sophia', '🔄 Thinking…', { reactive: false });

    try {
      const cb = {
        onEvent(evt) {
          if (evt.type === 'done' && evt.response != null) {
            thinking.innerHTML = renderContent(evt.response);
          } else if (evt.type === 'status') {
            thinking.textContent = '🔄 ' + ((evt.message) || 'processing…');
          }
        },
        onDone(t) {
          if (!t) thinking.textContent = '(no reply)';
          if (thinking.textContent && thinking.textContent.indexOf('🔄') === 0 && t) {
            thinking.innerHTML = renderContent(t);
          }
        },
      };
      if (files.length) {
        await window.SophiaChat.sendMessageWithFiles(currentChannelId, text, files, creds, cb);
      } else {
        await window.SophiaChat.sendMessage(currentChannelId, text, creds, cb);
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (/403|governor/i.test(msg)) {
        setAuthBanner('Send rejected — this key is not a registered governor. ' + msg, 'error');
      }
      thinking.textContent = 'Error: ' + msg;
    }
    el('messages').scrollTop = el('messages').scrollHeight;
  }

  function updateAttachLabel() {
    el('attachLabel').textContent = pendingFiles.length ? '📎 ' + pendingFiles.length : '📎';
  }

  function onFilesChosen() {
    const input = el('fileInput');
    pendingFiles = Array.from(input.files || []);
    input.value = '';
    updateAttachLabel();
  }

  async function boot() {
    try {
      window.AppConfig = await loadConfig();
      document.title = window.AppConfig.appTitle || 'TrueSight Ops Console';
      el('appTitle').textContent = window.AppConfig.appTitle || 'TrueSight Ops Console';
      el('deployment').textContent = 'deployment: ' + (window.AppConfig.deployment || 'local') +
        ' → ' + (window.AppConfig.sophiaBaseUrl || '');
      const pub = window.SophiaAuth.getStoredPublicKey();
      el('identity').textContent = 'identity: ' + (pub ? fingerprint(pub) : '(none)');
      renderChannelList(window.AppConfig, currentRole);
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
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
    boot();
  });
})();
