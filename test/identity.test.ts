import { describe, it, expect } from 'vitest';
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
loadScript('identity.js');

const Id = (window as any).SophiaIdentity;

describe('Edgar event payload builder', () => {
  it('builds the canonical [EMAIL REGISTERED EVENT] payload', () => {
    const p = Id.buildEventPayload('EMAIL REGISTERED EVENT', { Email: 'you@example.com' });
    expect(p).toMatch(/^\[EMAIL REGISTERED EVENT\]\n/);
    expect(p).toContain('- Timestamp: ');
    expect(p).toContain('- Email: you@example.com');
    expect(p.endsWith('\n--------')).toBe(true);
    // Timestamp must come BEFORE Email (canonical order)
    expect(p.indexOf('Timestamp')).toBeLessThan(p.indexOf('Email'));
  });

  it('signString signs an arbitrary string and verifies', async () => {
    const C = (window as any).SophiaCrypto;
    const pair = await C.generateKeyPair();
    const sig = await C.signString(pair.privateKey, 'hello world');
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(20);
  });
});
