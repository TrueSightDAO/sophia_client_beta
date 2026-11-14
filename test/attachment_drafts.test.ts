/**
 * Per-channel attachment drafts + multi-attach.
 *
 * js/app.js is a DOM-bound IIFE, so we assert on its structure rather than
 * importing it, then exercise the draft/merge semantics in a local harness.
 * This catches the regression we actually shipped: a single global
 * `pendingFiles` array leaked attachments across channels.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const appSrc = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

describe('per-channel attachment drafts', () => {
  it('no longer keeps a single global pending array', () => {
    expect(appSrc).not.toMatch(/\blet\s+pendingFiles\b/);
    expect(appSrc).not.toMatch(/\bpendingFiles\.(splice|push|concat)\b/);
  });

  it('declares a per-channel map and draft helpers', () => {
    expect(appSrc).toMatch(/attachmentsByChannel/);
    expect(appSrc).toMatch(/function getPending\(/);
    expect(appSrc).toMatch(/function setPending\(/);
    expect(appSrc).toMatch(/function clearPending\(/);
    expect(appSrc).toMatch(/function draftKey\(/);
  });

  it('refreshes the attach preview on channel switch', () => {
    expect(appSrc).toMatch(/async function selectChannel[\s\S]{0,600}updateAttachLabel\(\)/);
  });

  it('appends on file pick instead of replacing', () => {
    expect(appSrc).not.toMatch(/pendingFiles = Array\.from\(input\.files/);
    expect(appSrc).toMatch(/function onFilesChosen\(/);
  });

  it('keeps multiple on the file input', () => {
    expect(htmlSrc).toMatch(/id="fileInput"[^>]*multiple/);
  });
});

describe('draft semantics (harness mirroring getPending/setPending)', () => {
  const make = () => {
    const map: Record<string, any[]> = Object.create(null);
    const get = (ch: string) => {
      const k = ch || '__none__';
      if (!map[k]) map[k] = [];
      return map[k];
    };
    const set = (ch: string, list: any[]) => {
      map[ch || '__none__'] = (list || []).filter(Boolean);
    };
    const sig = (f: any) => [f.name, f.size, f.lastModified].join(':');
    const merge = (ch: string, chosen: any[]) => {
      const seen: Record<string, boolean> = Object.create(null);
      get(ch).forEach((f) => {
        seen[sig(f)] = true;
      });
      const merged = get(ch).slice();
      let dupes = 0;
      chosen.forEach((f) => {
        if (seen[sig(f)]) {
          dupes += 1;
          return;
        }
        seen[sig(f)] = true;
        merged.push(f);
      });
      set(ch, merged);
      return dupes;
    };
    return { map, get, set, merge };
  };
  const f = (name: string, size: number) => ({ name, size, lastModified: 1 });

  it('does not leak a draft from one channel into another', () => {
    const d = make();
    d.merge('A', [f('a.png', 1)]);
    expect(d.get('A').length).toBe(1);
    expect(d.get('B').length).toBe(0);
  });

  it('restores the draft when switching back', () => {
    const d = make();
    d.merge('A', [f('a.png', 1)]);
    d.merge('B', [f('b.pdf', 2)]);
    expect(d.get('A')[0].name).toBe('a.png');
    expect(d.get('B')[0].name).toBe('b.pdf');
  });

  it('accumulates multiple picks and skips duplicates', () => {
    const d = make();
    d.merge('A', [f('a.png', 1)]);
    d.merge('A', [f('c.png', 3)]);
    expect(d.get('A').map((x: any) => x.name)).toEqual(['a.png', 'c.png']);
    expect(d.merge('A', [f('a.png', 1)])).toBe(1);
    expect(d.get('A').length).toBe(2);
  });

  it('clears only the active channel on send', () => {
    const d = make();
    d.merge('A', [f('a.png', 1)]);
    d.merge('B', [f('b.pdf', 2)]);
    d.set('A', []);
    expect(d.get('A').length).toBe(0);
    expect(d.get('B').length).toBe(1);
  });
});
