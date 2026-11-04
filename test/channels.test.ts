import { describe, it, expect, beforeEach } from 'vitest';
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

const config = {
  categories: [
    { id: 'ops', name: 'Ops', channels: [
      { id: 'general', name: 'general', visibility: 'private' },
    ] },
    { id: 'public', name: 'Public', channels: [
      { id: 'lobby', name: 'lobby', visibility: 'public' },
    ] },
  ],
};

beforeEach(() => {
  localStorage.clear();
});

describe('channel management', () => {
  it('starts with config channels only', () => {
    expect(Ch.allChannels(config)).toHaveLength(2);
  });

  it('creates a channel in a new category', () => {
    const ch = Ch.createChannel('Brazil', 'sunmint-signatures', 'private');
    expect(ch.id).toMatch(/^ch_/);
    expect(ch.categoryName).toBe('Brazil');
    expect(ch.visibility).toBe('private');
    const all = Ch.allChannels(config);
    expect(all).toHaveLength(3);
    const cats = new Set(all.map((c: any) => c.categoryName));
    expect(cats.has('Brazil')).toBe(true);
  });

  it('retiring hides a built-in channel', () => {
    Ch.retireChannel('general');
    const all = Ch.allChannels(config);
    expect(all.map((c: any) => c.id)).not.toContain('general');
    expect(all).toHaveLength(1); // only lobby remains
  });

  it('restore brings a retired channel back', () => {
    Ch.retireChannel('general');
    Ch.restoreChannel('general');
    expect(Ch.allChannels(config)).toHaveLength(2);
  });

  it('guest/member never see private channels (created or built-in)', () => {
    Ch.createChannel('Ops', 'secret-ops', 'private');
    const guest = Ch.visibleChannels(config, 'guest');
    expect(guest.map((c: any) => c.id)).toEqual(['lobby']);
    const gov = Ch.visibleChannels(config, 'governor');
    expect(gov).toHaveLength(3);
  });

  it('creates categories (idempotent) and lists them after config', () => {
    expect(Ch.allCategories(config)).toEqual(['Ops', 'Public']);
    expect(Ch.createCategory('Brazil')).toBe('Brazil');
    expect(Ch.createCategory('Brazil')).toBe('Brazil'); // idempotent
    expect(Ch.allCategories(config)).toEqual(['Ops', 'Public', 'Brazil']);
  });

  it('a channel created under a new category lands in allCategories', () => {
    Ch.createCategory('Brazil');
    Ch.createChannel('Brazil', 'sunmint-sigs', 'private');
    expect(Ch.allCategories(config)).toContain('Brazil');
    const all = Ch.allChannels(config);
    expect(all.some((c: any) => c.categoryName === 'Brazil' && c.name === 'sunmint-sigs')).toBe(true);
  });

  it('renames and changes visibility of a created channel', () => {
    const ch = Ch.createChannel('Ops', 'temp', 'private');
    Ch.renameChannel(ch.id, 'renamed');
    Ch.setChannelVisibility(ch.id, 'public');
    const found = Ch.allChannels(config).find((c: any) => c.id === ch.id);
    expect(found.name).toBe('renamed');
    expect(found.visibility).toBe('public');
  });

  it('renames and deletes a created category (and its channels)', () => {
    Ch.createCategory('Old');
    Ch.createChannel('Old', 'c1', 'private');
    Ch.renameCategory('Old', 'New');
    expect(Ch.allCategories(config)).toContain('New');
    expect(Ch.allChannels(config).some((c: any) => c.categoryName === 'New')).toBe(true);
    Ch.deleteCategory('New');
    expect(Ch.allCategories(config)).not.toContain('New');
    expect(Ch.allChannels(config).some((c: any) => c.categoryName === 'New')).toBe(false);
  });

  it('built-in channels/categories are flagged non-editable', () => {
    expect(Ch.isBuiltinChannel('general')).toBe(true);
    expect(Ch.isBuiltinCategory('Ops')).toBe(true);
    const ch = Ch.createChannel('Ops', 'made', 'private');
    expect(Ch.isBuiltinChannel(ch.id)).toBe(false);
  });
});
