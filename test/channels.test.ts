import { describe, it, expect, beforeEach, vi } from 'vitest';
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

loadScript('channels.js');

const Ch = (window as any).SophiaChannels;

(window as any).AppConfig = { sophiaBaseUrl: 'https://sophia.truesight.me' };

const config = {
  categories: [
    { id: 'ops', name: 'Ops', channels: [{ id: 'general', name: 'general', visibility: 'private' }] },
    { id: 'public', name: 'Public', channels: [{ id: 'lobby', name: 'lobby', visibility: 'public' }] },
  ],
};

// In-memory fake of the server registry, behind a mocked fetch.
let server: any;

function mockFetch() {
  let n = 0;
  (window as any).fetch = vi.fn(async (url: string, opts: any) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = (opts?.method || 'GET').toUpperCase();
    const body = opts?.body ? JSON.parse(opts.body) : null;
    let resp: any = {};
    if (path === '/channels' && method === 'GET') {
      resp = server;
    } else if (path === '/channels' && method === 'POST') {
      const ch = { id: 'ch_' + (++n).toString(36) + Math.random().toString(36).slice(2, 5), categoryName: body.category_name, name: body.name, visibility: body.visibility };
      server.channels.push(ch);
      resp = ch;
    } else if (/^\/channels\/[^/]+$/.test(path) && method === 'PUT') {
      const id = decodeURIComponent(path.split('/')[2]);
      const ch = server.channels.find((c: any) => c.id === id);
      if (ch) { if (body.name) ch.name = body.name; if (body.visibility) ch.visibility = body.visibility; }
      resp = ch || {};
    } else if (/^\/channels\/[^/]+$/.test(path) && method === 'DELETE') {
      const id = decodeURIComponent(path.split('/')[2]);
      if (!server.retired.includes(id)) server.retired.push(id);
      server.channels = server.channels.filter((c: any) => c.id !== id);
      resp = { ok: true };
    } else if (path === '/categories' && method === 'POST') {
      if (!server.categories.includes(body.name)) server.categories.push(body.name);
      resp = { name: body.name };
    } else if (/^\/categories\/[^/]+$/.test(path) && method === 'PUT') {
      const name = decodeURIComponent(path.split('/')[2]);
      server.categories = server.categories.map((c: any) => (c === name ? body.name : c));
      server.channels.forEach((c: any) => { if (c.categoryName === name) c.categoryName = body.name; });
      resp = { name: body.name };
    } else if (/^\/categories\/[^/]+$/.test(path) && method === 'DELETE') {
      const name = decodeURIComponent(path.split('/')[2]);
      server.categories = server.categories.filter((c: any) => c !== name);
      server.channels = server.channels.filter((c: any) => c.categoryName !== name);
      resp = { ok: true };
    }
    return { ok: true, status: 200, json: async () => resp };
  });
}

beforeEach(() => {
  server = { channels: [], categories: [], retired: [] };
  localStorage.clear();
  mockFetch();
});

describe('channel registry (server-backed)', () => {
  it('loadRegistry populates the cache from the server', async () => {
    server.channels.push({ id: 'ch_1', categoryName: 'Brazil', name: 'sunmint', visibility: 'private' });
    server.categories.push('Brazil');
    await Ch.loadRegistry('tok');
    expect(Ch.allChannels(config)).toHaveLength(3);
    expect(Ch.allCategories(config)).toEqual(['Ops', 'Public', 'Brazil']);
  });

  it('createChannel POSTs and updates the cache', async () => {
    await Ch.loadRegistry('tok');
    const ch = await Ch.createChannel('Ops', 'new', 'private', 'tok');
    expect(ch.id).toMatch(/^ch_/);
    expect(Ch.allChannels(config)).toHaveLength(3);
  });

  it('retireChannel removes from the cache and records retired', async () => {
    await Ch.loadRegistry('tok');
    const ch = await Ch.createChannel('Ops', 'temp', 'private', 'tok');
    await Ch.retireChannel(ch.id, 'tok');
    expect(Ch.allChannels(config).map((c: any) => c.id)).not.toContain(ch.id);
    expect(Ch.isRetired(ch.id)).toBe(true);
  });

  it('renameChannel and setChannelVisibility update the cache', async () => {
    await Ch.loadRegistry('tok');
    const ch = await Ch.createChannel('Ops', 'temp', 'private', 'tok');
    await Ch.renameChannel(ch.id, 'renamed', 'tok');
    await Ch.setChannelVisibility(ch.id, 'public', 'tok');
    const found = Ch.allChannels(config).find((c: any) => c.id === ch.id);
    expect(found.name).toBe('renamed');
    expect(found.visibility).toBe('public');
  });

  it('createCategory + renameCategory + deleteCategory', async () => {
    await Ch.loadRegistry('tok');
    await Ch.createCategory('Old', 'tok');
    await Ch.renameCategory('Old', 'New', 'tok');
    expect(Ch.allCategories(config)).toContain('New');
    await Ch.deleteCategory('New', 'tok');
    expect(Ch.allCategories(config)).not.toContain('New');
  });

  it('guest never sees private channels; governor sees all', async () => {
    await Ch.loadRegistry('tok');
    await Ch.createChannel('Ops', 'secret', 'private', 'tok');
    expect(Ch.visibleChannels(config, 'guest').map((c: any) => c.id)).toEqual(['lobby']);
    expect(Ch.visibleChannels(config, 'governor')).toHaveLength(3);
  });

  it('isBuiltinChannel / isBuiltinCategory flag correctly', async () => {
    await Ch.loadRegistry('tok');
    expect(Ch.isBuiltinChannel('general')).toBe(true);
    expect(Ch.isBuiltinCategory('Ops')).toBe(true);
    const ch = await Ch.createChannel('Ops', 'made', 'private', 'tok');
    expect(Ch.isBuiltinChannel(ch.id)).toBe(false);
  });
});
