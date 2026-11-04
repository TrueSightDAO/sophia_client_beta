/**
 * Tests for the client's pure helpers: crypto round-trip, canonical JSON,
 * SSE parsing, and channel visibility. No network, no governor key needed.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// happy-dom exposes crypto.subtle via the webcrypto global; wire it in if absent.
let subtle: SubtleCrypto;

beforeAll(() => {
  subtle = (globalThis.crypto?.subtle || (globalThis as any).crypto?.subtle) as SubtleCrypto;
});

// Load the IIFE scripts into the happy-dom window by reading them from disk and
// evaluating them. Vitest's happy-dom provides `window`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadScript(name: string) {
  const src = readFileSync(join(ROOT, 'js', name), 'utf8');
  const fn = new Function('window', src);
  fn(window);
}

loadScript('crypto.js');
loadScript('channels.js');

declare global {
  interface Window {
    SophiaCrypto: any;
    SophiaChannels: any;
  }
}

const C = (window as any).SophiaCrypto;
const Ch = (window as any).SophiaChannels;

describe('canonicalPayloadJson', () => {
  it('produces compact, insertion-ordered JSON (no spaces)', () => {
    const out = C.canonicalPayloadJson({ timestamp: 't', nonce: 'n' });
    expect(out).toBe('{"timestamp":"t","nonce":"n"}');
  });

  it('matches python json.dumps(separators=(",", ":")) shape', () => {
    const out = C.canonicalPayloadJson({ b: 1, a: [1, 2, 3] });
    expect(out).toBe('{"b":1,"a":[1,2,3]}');
  });
});

describe('crypto sign/verify round-trip', () => {
  it('signs and verifies a payload with a generated keypair', async () => {
    const pair = await C.generateKeyPair();
    expect(pair.publicKey).toBeTruthy();
    expect(pair.privateKey).toBeTruthy();

    const payload = { timestamp: '2026-10-28T12:00:00.000Z', nonce: 'abc-123' };
    const sig = await C.signPayload(pair.privateKey, payload);
    const ok = await C.verifySignature(pair.publicKey, payload, sig);
    expect(ok).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const pair = await C.generateKeyPair();
    const payload = { timestamp: '2026-10-28T12:00:00.000Z', nonce: 'abc-123' };
    const sig = await C.signPayload(pair.privateKey, payload);
    const tampered = { ...payload, nonce: 'evil' };
    const ok = await C.verifySignature(pair.publicKey, tampered, sig);
    expect(ok).toBe(false);
  });

  it('base64 round-trips cleanly', () => {
    const b = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const round = new Uint8Array(C.base64ToBytes(C.bytesToBase64(b)));
    expect(Array.from(round)).toEqual([0, 1, 2, 253, 254, 255]);
  });
});

describe('channel visibility', () => {
  const config = {
    categories: [
      { id: 'ops', name: 'Ops', channels: [
        { id: 'general', name: 'general', visibility: 'private' },
        { id: 'cmds', name: 'cmds', visibility: 'private' },
      ] },
      { id: 'public', name: 'Public', channels: [
        { id: 'lobby', name: 'lobby', visibility: 'public' },
      ] },
    ],
  };

  it('governor/sentinel see all channels', () => {
    expect(Ch.visibleChannels(config, 'governor')).toHaveLength(3);
    expect(Ch.visibleChannels(config, 'sentinel')).toHaveLength(3);
  });

  it('member/guest see only public channels', () => {
    const visible = Ch.visibleChannels(config, 'guest');
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('lobby');
    expect(Ch.visibleChannels(config, 'member')).toHaveLength(1);
  });
});
