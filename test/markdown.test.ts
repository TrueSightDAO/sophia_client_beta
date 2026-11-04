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

loadScript('markdown.js');

const md = (window as any).SophiaMarkdown;

describe('markdown renderer', () => {
  it('renders bold and inline code', () => {
    const out = md.renderMarkdown('**bold** and `code`');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<code>code</code>');
  });

  it('renders headings', () => {
    const out = md.renderMarkdown('## Title');
    expect(out).toContain('<h2>Title</h2>');
  });

  it('renders fenced code blocks', () => {
    const out = md.renderMarkdown('```\nline1\n<b>raw</b>\n```');
    expect(out).toContain('<pre><code>');
    expect(out).toContain('&lt;b&gt;raw&lt;/b&gt;'); // escaped, not executed
    expect(out).not.toContain('<b>raw</b>');
  });

  it('renders links with target blank', () => {
    const out = md.renderMarkdown('[x](https://example.com)');
    expect(out).toContain('<a href="https://example.com"');
    expect(out).toContain('rel="noopener"');
  });

  it('renders unordered lists', () => {
    const out = md.renderMarkdown('- a\n- b');
    expect(out).toContain('<ul><li>a</li><li>b</li></ul>');
  });

  it('renders tables', () => {
    const out = md.renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('<table>');
    expect(out).toContain('<th>A</th>');
    expect(out).toContain('<td>1</td>');
  });

  it('escapes raw HTML (XSS-safe)', () => {
    const out = md.renderMarkdown('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('resolves /uploads/ image paths against the base', () => {
    (window as any).AppConfig = { sophiaBaseUrl: 'https://sophia.truesight.me' };
    const out = md.renderMarkdown('see /uploads/abc.png');
    expect(out).toContain('<img');
    expect(out).toContain('https://sophia.truesight.me/uploads/abc.png');
  });
});
