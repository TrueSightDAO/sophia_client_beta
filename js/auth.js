/**
 * auth.js — RSA proof-of-possession identity + per-message signing.
 *
 * v1 uses the brain's signed-payload path on `/chat` directly (the oracle
 * pattern) — there is no separate JWT step, and no `/auth/challenge` call.
 * (Note: `sophia.truesight.me/auth/challenge` is shadowed by nginx `/auth/` →
 * port 8002, so it is not reachable from the public host.)
 *
 *   - Reuse the DAO keypair from localStorage (`publicKey` / `privateKey`),
 *     shared with dapp / capoeira / oracle; generate only if absent.
 *   - Each message is signed as `{ message, timestamp, nonce, do_not_publish }`
 *     and POSTed to `/chat` with `X-Public-Key` + `{ payload, signature }`.
 *   - The brain's `verify_payload` gates on governor (403 for non-governor);
 *     the member/guest tiers need a server-side `POST /auth/tier` (PR4).
 */
(function () {
  'use strict';

  function baseUrl() {
    const cfg = window.AppConfig || {};
    return (cfg.sophiaBaseUrl || 'https://sophia.truesight.me').replace(/\/+$/, '');
  }

  function getStoredPublicKey() {
    return localStorage.getItem(window.SophiaCrypto.LS_PUBLIC_KEY) || null;
  }

  function getStoredPrivateKey() {
    return localStorage.getItem(window.SophiaCrypto.LS_PRIVATE_KEY) || null;
  }

  /** Reuse existing keypair, generate only if absent. */
  async function ensureKeypair() {
    let pub = getStoredPublicKey();
    let priv = getStoredPrivateKey();
    if (!pub || !priv) {
      const pair = await window.SophiaCrypto.generateKeyPair();
      pub = pair.publicKey;
      priv = pair.privateKey;
      localStorage.setItem(window.SophiaCrypto.LS_PUBLIC_KEY, pub);
      localStorage.setItem(window.SophiaCrypto.LS_PRIVATE_KEY, priv);
    }
    return { publicKey: pub, privateKey: priv };
  }

  function newNonce() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  /**
   * Build the signed request body for a chat message.
   * @returns {Promise<{body:{payload:object, signature:string}, publicKey:string}>}
   */
  async function signMessage(message, doNotPublish = false) {
    const { publicKey, privateKey } = await ensureKeypair();
    const payload = {
      message,
      timestamp: new Date().toISOString(),
      nonce: newNonce(),
      do_not_publish: !!doNotPublish,
    };
    const signature = await window.SophiaCrypto.signPayload(privateKey, payload);
    return { body: { payload, signature }, publicKey };
  }

  window.SophiaAuth = {
    baseUrl,
    ensureKeypair,
    getStoredPublicKey,
    signMessage,
  };
})();
