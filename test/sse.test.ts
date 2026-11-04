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
loadScript('chat.js');

const Chat = (window as any).SophiaChat;

describe('SSE parsing', () => {
  it('parses a single done event', () => {
    const evts = Chat.parseSSE('data: {"type":"done","response":"hi"}\n\n');
    expect(evts).toHaveLength(1);
    expect(evts[0].type).toBe('done');
    expect(evts[0].response).toBe('hi');
  });

  it('parses multiple events including heartbeat', () => {
    const s = 'data: {"type":"heartbeat"}\n\ndata: {"type":"done","response":"ok"}\n\n';
    const evts = Chat.parseSSE(s);
    expect(evts.map((e: any) => e.type)).toEqual(['heartbeat', 'done']);
  });

  it('ignores [DONE] sentinel and malformed lines', () => {
    const evts = Chat.parseSSE('data: [DONE]\n\n: keep-alive\n\ndata: not-json\n\n');
    expect(evts).toHaveLength(0);
  });

  it('handles CRLF line endings', () => {
    const evts = Chat.parseSSE('data: {"type":"done","response":"a"}\r\n\r\n');
    expect(evts).toHaveLength(1);
    expect(evts[0].response).toBe('a');
  });
});
