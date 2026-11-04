/**
 * crypto.js — RSA keygen + signing via native WebCrypto. No CDN dependency.
 *
 * Byte-identical to `dapp/scripts/edgar_payload_helper.js`:
 *   - keypair: RSASSA-PKCS1-v1_5 / SHA-256, 2048-bit, publicExponent [1,0,1]
 *   - public key  = SPKI DER  → base64  (localStorage key `publicKey`)
 *   - private key = PKCS#8 DER → base64 (localStorage key `privateKey`)
 *   - sign        = RSASSA-PKCS1-v1_5 + SHA-256 over the UTF-8 canonical string
 *
 * The server (`app/auth.py::verify_payload`) serializes the payload with
 * `json.dumps(payload, separators=(",", ":"), ensure_ascii=False)` and verifies the
 * signature over that exact byte string. So the caller MUST sign
 * `JSON.stringify(payload)` — compact, insertion-order keys, ASCII-only — for the
 * signature to verify. `canonicalPayloadJson()` is the single source of that.
 */
(function () {
  'use strict';

  const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const LS_PUBLIC_KEY = 'publicKey';
  const LS_PRIVATE_KEY = 'privateKey';

  function bytesToBase64(bytes) {
    const arr = new Uint8Array(bytes);
    let binary = '';
    for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const normalized = String(base64)
      .replace(/[\r\n]+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function getCrypto() {
    if (globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto;
    throw new Error('WebCrypto (crypto.subtle) is unavailable in this environment.');
  }

  async function generateKeyPair() {
    const crypto = getCrypto();
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const publicSpki = await crypto.subtle.exportKey('spki', pair.publicKey);
    const privatePkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    return { publicKey: bytesToBase64(publicSpki), privateKey: bytesToBase64(privatePkcs8) };
  }

  async function importPrivateKey(privateKeyB64) {
    if (!privateKeyB64) throw new Error('Private key (base64 PKCS#8) is required to sign.');
    return getCrypto().subtle.importKey(
      'pkcs8',
      base64ToBytes(privateKeyB64),
      ALGO,
      false,
      ['sign']
    );
  }

  async function importPublicKey(publicKeyB64) {
    if (!publicKeyB64) throw new Error('Public key (base64 SPKI) is required to verify.');
    return getCrypto().subtle.importKey(
      'spki',
      base64ToBytes(publicKeyB64),
      ALGO,
      false,
      ['verify']
    );
  }

  /** Canonical JSON string the server will re-serialize and verify against. */
  function canonicalPayloadJson(payload) {
    return JSON.stringify(payload);
  }

  /** Sign a JSON payload object → base64 signature (matches server verify_payload). */
  async function signPayload(privateKeyB64, payload) {
    const key = await importPrivateKey(privateKeyB64);
    const canonical = canonicalPayloadJson(payload);
    const sig = await getCrypto().subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(canonical)
    );
    return bytesToBase64(sig);
  }

  /** Sign an arbitrary UTF-8 string → base64 signature (Edgar event payloads). */
  async function signString(privateKeyB64, str) {
    const key = await importPrivateKey(privateKeyB64);
    const sig = await getCrypto().subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(str)
    );
    return bytesToBase64(sig);
  }

  /** Verify a signature over a payload (round-trip self-test helper). */
  async function verifySignature(publicKeyB64, payload, signatureB64) {
    const key = await importPublicKey(publicKeyB64);
    return getCrypto().subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64ToBytes(signatureB64),
      new TextEncoder().encode(canonicalPayloadJson(payload))
    );
  }

  window.SophiaCrypto = {
    ALGO,
    LS_PUBLIC_KEY,
    LS_PRIVATE_KEY,
    bytesToBase64,
    base64ToBytes,
    generateKeyPair,
    importPrivateKey,
    importPublicKey,
    canonicalPayloadJson,
    signPayload,
    signString,
    verifySignature,
  };
})();
