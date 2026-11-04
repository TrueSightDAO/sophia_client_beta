/**
 * auth.js — RSA proof-of-possession → tiered JWT, against the configured Sophia.
 *
 * Flow (tiered auth, /auth-tier):
 *   1. Reuse the DAO keypair from localStorage (`publicKey` / `privateKey`) if
 *      present (identity shared with dapp / capoeira / oracle), else generate one.
 *   2. Sign a challenge `{ timestamp, nonce }` and POST `/auth-tier` with
 *      `X-Public-Key` + `{ payload, signature }`.
 *   3. The brain resolves the ledger tier (guest/member/sentinel/governor) and
 *      returns a JWT whose `author_role` claim carries that tier. Subsequent
 *      requests send it as `Authorization: Bearer`.
 *
 * The JWT is also usable on `/chat` (text), `/chat/upload` (attachments), and
 * `/session` (history) — all accept `Authorization: Bearer`.
 */
(function () {
  'use strict';

  const TOKEN_KEY = 'sophia_client_jwt';
  const ROLE_KEY = 'sophia_client_role';
  const EXPIRY_KEY = 'sophia_client_jwt_expiry';

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

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || null;
  }

  function getRole() {
    return sessionStorage.getItem(ROLE_KEY) || 'guest';
  }

  function isAuthenticated() {
    return !!getToken();
  }

  function clearAuth() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    sessionStorage.removeItem(EXPIRY_KEY);
  }

  /** True if the stored JWT is still within its lifetime (with a 30s buffer). */
  function isTokenFresh() {
    const exp = sessionStorage.getItem(EXPIRY_KEY);
    if (!exp) return false;
    return Date.now() < parseInt(exp, 10) - 30000;
  }

  /**
   * Return a valid token, re-authenticating if the current one is missing or
   * near/at expiry. Used before every authenticated request so a long-lived tab
   * never sends an expired JWT.
   */
  async function ensureFreshToken() {
    if (isTokenFresh()) return getToken();
    const auth = await authenticate();
    return auth.token;
  }

  /**
   * Authenticate via /auth-tier: sign a challenge, exchange it for a JWT whose
   * author_role is the ledger-resolved tier for this key.
   * @returns {Promise<{token:string, role:string, publicKey:string}>}
   */
  async function authenticate() {
    const { publicKey, privateKey } = await ensureKeypair();
    const payload = { timestamp: new Date().toISOString(), nonce: newNonce() };
    const signature = await window.SophiaCrypto.signPayload(privateKey, payload);

    const resp = await fetch(baseUrl() + '/auth-tier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Public-Key': publicKey },
      body: JSON.stringify({ payload, signature }),
    });

    if (!resp.ok) {
      let detail = 'HTTP ' + resp.status;
      try { const j = await resp.json(); if (j && j.detail) detail = j.detail; } catch (e) { /* non-JSON */ }
      throw new Error(detail);
    }

    const body = await resp.json();
    if (!body.token) throw new Error('No token returned from /auth-tier');
    const role = body.author_role || 'guest';
    const expiresAt = Date.now() + (body.expires_in || 1800) * 1000;
    sessionStorage.setItem(TOKEN_KEY, body.token);
    sessionStorage.setItem(ROLE_KEY, role);
    sessionStorage.setItem(EXPIRY_KEY, String(expiresAt));
    return { token: body.token, role, publicKey };
  }

  /** Build a signed request body (used by the multipart upload path). */
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
    authenticate,
    signMessage,
    getToken,
    getRole,
    isAuthenticated,
    isTokenFresh,
    ensureFreshToken,
    clearAuth,
  };
})();
