/**
 * app.js — bootstrap: load config, wire identity + channel list + chat pane.
 */
(function () {
  'use strict';

  let currentChannelId = null;
  let currentRole = 'guest';
  let creds = null; // { publicKey, privateKey }

  function el(id) { return document.getElementById(id); }

  function fingerprint(pub) {
    if (!pub) return '';
    return pub.replace(/[\r\n=]/g, '').slice(0, 12);
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
        item.addEventListener('click', () => selectChannel(ch.id, config));
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

  function appendMessage(who, text) {
    const box = el('messages');
    const row = document.createElement('div');
    row.className = 'msg ' + who;
    const content = document.createElement('div');
    content.className = 'bubble';
    content.textContent = text;
    row.appendChild(content);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    return content;
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
    if (!text || !currentChannelId) return;
    if (!creds) { setAuthBanner('Not connected — connect first.', 'error'); return; }
    input.value = '';
    appendMessage('you', text);
    const thinking = appendMessage('sophia', '🔄 Thinking…');
    try {
      await window.SophiaChat.sendMessage(currentChannelId, text, creds, {
        onEvent(evt) {
          if (evt.type === 'done' && evt.response != null) {
            thinking.textContent = evt.response;
          }
        },
        onDone(t) {
          if (!t) thinking.textContent = '(no reply)';
        },
      });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (/403|governor/i.test(msg)) {
        setAuthBanner('Send rejected — this key is not a registered governor. ' + msg, 'error');
      }
      thinking.textContent = 'Error: ' + msg;
    }
    el('messages').scrollTop = el('messages').scrollHeight;
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
    el('messageInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
    boot();
  });
})();
