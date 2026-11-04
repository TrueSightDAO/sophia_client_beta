/**
 * chat.js — talk to Sophia over SSE (`POST /chat`) and read history (`GET /session`).
 *
 * v1 sends signed messages (see auth.js::signMessage) and reads history by
 * `X-Public-Key` + `X-Session-Id`. The brain streams SSE events shaped
 * `data: {"type": ..., ...}\n\n`; `done.response` carries the final text,
 * `heartbeat` is a keep-alive during long tool runs.
 */
(function () {
  'use strict';

  function sessionIdFor(channelId) {
    return 'client:' + channelId;
  }

  /**
   * Parse an SSE byte stream into a list of events.
   * Handles events split across chunk boundaries and CRLF/LF line endings.
   */
  function parseSSE(text) {
    const events = [];
    const lines = text.split(/\r?\n/);
    let dataLines = [];
    for (const line of lines) {
      if (line === '') {
        if (dataLines.length) {
          const raw = dataLines.join('\n');
          dataLines = [];
          if (raw.startsWith('data:')) {
            const json = raw.slice(5).trim();
            if (json && json !== '[DONE]') {
              try { events.push(JSON.parse(json)); } catch (e) { /* ignore malformed */ }
            }
          }
        }
        continue;
      }
      if (line.startsWith('data:')) dataLines.push(line);
    }
    return events;
  }

  /**
   * POST a signed message and stream the reply.
   * @param {string} channelId
   * @param {string} message
   * @param {object} creds {publicKey, privateKey}
   * @param {object} callbacks {onEvent(evt), onDone(text), onError(err)}
   */
  async function sendMessage(channelId, message, creds, callbacks) {
    const { body, publicKey } = await window.SophiaAuth.signMessage(message);
    const url = window.SophiaAuth.baseUrl() + '/chat';

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Public-Key': publicKey,
        'X-Session-Id': sessionIdFor(channelId),
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok || !resp.body) {
      let detail = 'HTTP ' + resp.status;
      try {
        const j = await resp.json();
        if (j && j.detail) detail = j.detail;
      } catch (e) { /* ignore */ }
      throw new Error(detail);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalText = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = parseSSE(buffer);
      const lastNewline = buffer.lastIndexOf('\n\n');
      if (lastNewline >= 0) buffer = buffer.slice(lastNewline + 2);
      for (const evt of events) {
        if (callbacks.onEvent) callbacks.onEvent(evt);
        if (evt.type === 'done' && evt.response != null) finalText = evt.response;
      }
    }

    if (callbacks.onDone) callbacks.onDone(finalText || '');
    return finalText || '';
  }

  /** Load conversation history for a channel (public-key keyed). */
  async function loadHistory(channelId, publicKey) {
    const resp = await fetch(window.SophiaAuth.baseUrl() + '/session', {
      headers: {
        'X-Public-Key': publicKey,
        'X-Session-Id': sessionIdFor(channelId),
      },
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' loading history');
    return resp.json();
  }

  window.SophiaChat = { sendMessage, loadHistory, parseSSE, sessionIdFor };
})();
