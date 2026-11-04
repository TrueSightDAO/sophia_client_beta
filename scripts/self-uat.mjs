#!/usr/bin/env node
/**
 * Self-UAT: prove the client's RSA signing scheme matches the live brain,
 * WITHOUT needing Gary's governor key.
 *
 * A freshly generated (non-governor) key POSTs a signed message to `/chat`
 * (the signed-payload path — the same one `js/auth.js` uses; `/auth/challenge`
 * is shadowed by nginx `/auth/`→8002 so it is not used). The server verifies
 * the signature BEFORE checking governor status, so:
 *   - HTTP 403 "Access restricted to authorized governors"  => signature VERIFIED (crypto correct)
 *   - HTTP 401 "Invalid signature"                          => crypto MISMATCH
 *   - HTTP 200                                              => unexpected (fresh key is not a governor)
 *
 * This is the same RSASSA-PKCS1-v1_5 / SHA-256 + SPKI-base64 + canonical-JSON
 * scheme as `js/crypto.js` (mirrors `dapp/scripts/edgar_payload_helper.js`).
 */
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf8'));
const BASE = config.sophiaBaseUrl.replace(/\/+$/, '');

const subtle = webcrypto.subtle;
const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function generateKeyPair() {
  const pair = await subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const publicKey = bytesToBase64(await subtle.exportKey('spki', pair.publicKey));
  const privateKey = bytesToBase64(await subtle.exportKey('pkcs8', pair.privateKey));
  return { publicKey, privateKey };
}

async function signPayload(privateKeyB64, payload) {
  const key = await subtle.importKey(
    'pkcs8',
    Buffer.from(privateKeyB64, 'base64'),
    ALGO,
    false,
    ['sign']
  );
  const canonical = JSON.stringify(payload);
  const sig = await subtle.sign(ALGO.name, key, new TextEncoder().encode(canonical));
  return bytesToBase64(sig);
}

const { publicKey, privateKey } = await generateKeyPair();
const payload = {
  message: 'self-uat: crypto correctness probe',
  timestamp: new Date().toISOString(),
  nonce: crypto.randomUUID(),
  do_not_publish: false,
};
const signature = await signPayload(privateKey, payload);

console.log('Sophia instance:', BASE);
console.log('Fresh public key (SPKI b64, first 16):', publicKey.slice(0, 16) + '…');

const resp = await fetch(BASE + '/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Public-Key': publicKey,
    'X-Session-Id': 'client:self-uat',
  },
  body: JSON.stringify({ payload, signature }),
});

let body = '';
try { body = JSON.stringify(await resp.json()); } catch { body = '(non-JSON)'; }

console.log('HTTP status:', resp.status);
console.log('Body:', body);

if (resp.status === 403) {
  console.log('\n✅ PASS — signature verified; server correctly rejected the non-governor key.');
  console.log('   The client crypto matches the brain. (Remaining auth leg requires a governor key.)');
  process.exit(0);
} else if (resp.status === 401) {
  console.log('\n❌ FAIL — "Invalid signature": the client crypto does NOT match the server.');
  process.exit(1);
} else if (resp.status === 200) {
  console.log('\n⚠️ UNEXPECTED — a freshly generated key authenticated as a governor. Investigate.');
  process.exit(2);
} else {
  console.log('\n⚠️ Unexpected status. Inspect body above.');
  process.exit(2);
}
