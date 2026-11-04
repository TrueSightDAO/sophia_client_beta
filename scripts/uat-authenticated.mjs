#!/usr/bin/env node
/**
 * Authenticated self-UAT: drive a real chat round-trip against the live brain
 * using the DeepSeek Local DAO identity keypair.
 *
 * Usage: node scripts/uat-authenticated.mjs [message]
 *
 * Loads PUBLIC_KEY / PRIVATE_KEY from ~/Applications/deepseek_dao_identity/.env
 * (same format the browser client stores: SPKI / PKCS#8 base64), signs a test
 * message, POSTs to /chat, and streams the SSE events back — proving the full
 * auth + stream path works, and exposing the exact event vocabulary.
 */
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '..', 'config.json'), 'utf8'));
const BASE = config.sophiaBaseUrl.replace(/\/+$/, '');

// Load identity keypair from the DeepSeek identity .env (no secrets printed).
const env = readFileSync(join(homedir(), 'Applications', 'deepseek_dao_identity', '.env'), 'utf8');
const kv = {};
for (const line of env.split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const PUBLIC_KEY = kv.PUBLIC_KEY;
const PRIVATE_KEY = kv.PRIVATE_KEY;
if (!PUBLIC_KEY || !PRIVATE_KEY) {
  console.error('Missing PUBLIC_KEY/PRIVATE_KEY in deepseek_dao_identity/.env');
  process.exit(1);
}

const subtle = webcrypto.subtle;
const ALGO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

async function signPayload(privateKeyB64, payload) {
  const key = await subtle.importKey('pkcs8', Buffer.from(privateKeyB64, 'base64'), ALGO, false, ['sign']);
  const sig = await subtle.sign(ALGO.name, key, new TextEncoder().encode(JSON.stringify(payload)));
  return Buffer.from(sig).toString('base64');
}

const message = process.argv[2] || 'UAT connectivity test — reply with just "pong".';
const payload = {
  message,
  timestamp: new Date().toISOString(),
  nonce: crypto.randomUUID(),
  do_not_publish: true,
};
const signature = await signPayload(PRIVATE_KEY, payload);

console.log('Identity email:', kv.EMAIL);
console.log('Public key prefix:', PUBLIC_KEY.slice(0, 16) + '…');
console.log('Message:', message);

const resp = await fetch(BASE + '/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Public-Key': PUBLIC_KEY,
    'X-Session-Id': 'client:uat-general',
  },
  body: JSON.stringify({ payload, signature }),
});

console.log('\nHTTP status:', resp.status);
if (resp.status !== 200) {
  let b = '';
  try { b = JSON.stringify(await resp.json()); } catch { b = '(non-JSON)'; }
  console.log('Body:', b);
  process.exit(resp.status === 403 ? 3 : 1);
}

// Stream SSE events.
const decoder = new TextDecoder();
let buffer = '';
let events = [];
const seen = new Set();

for await (const chunk of resp.body) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (line.startsWith('data:')) {
      const json = line.slice(5).trim();
      if (!json || json === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(json); } catch { continue; }
      events.push(evt);
      if (!seen.has(evt.type)) {
        seen.add(evt.type);
        console.log('  event type:', evt.type, evt.type === 'done' ? '' : JSON.stringify(evt).slice(0, 90));
      }
    }
  }
}

const done = events.filter((e) => e.type === 'done');
const tokens = events.filter((e) => e.type === 'token');
console.log('\n=== summary ===');
console.log('token events:', tokens.length, '| done events:', done.length);
if (done.length) console.log('final response:', JSON.stringify(done[done.length - 1].response).slice(0, 400));
console.log('\n✅ authenticated round-trip completed.' + (done.length ? '' : ' (no done event seen — check above)'));
