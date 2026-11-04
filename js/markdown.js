/**
 * markdown.js — a minimal, dependency-free Markdown renderer for Sophia's replies.
 *
 * Escapes HTML first (XSS-safe), then renders the common Markdown Sophia emits:
 * code blocks, inline code, bold/italic, headings, links, lists, blockquotes,
 * tables, horizontal rules, and bare image/attachment URLs.
 */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const IMG_EXT = /\.(png|jpe?g|gif|webp|svg)(\?[^\s)]*)?$/i;

  function renderMarkdown(text) {
    const base = (window.AppConfig && window.AppConfig.sophiaBaseUrl
      ? window.AppConfig.sophiaBaseUrl.replace(/\/+$/, '')
      : '');

    const lines = String(text == null ? '' : text).split('\n');
    const out = [];
    let i = 0;

    function inline(s) {
      let h = escapeHtml(s);
      // inline code (before bold/italic so `**` inside code stays literal)
      h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
      // links [text](url)
      h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, (m, txt, url) => {
        const full = url.charAt(0) === '/' ? base + url : url;
        return '<a href="' + full + '" target="_blank" rel="noopener">' + txt + '</a>';
      });
      // markdown image ![alt](url)
      h = h.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/uploads\/[^\s)]+)\)/g, (m, alt, url) => {
        const full = url.charAt(0) === '/' ? base + url : url;
        return '<img class="attach" src="' + full + '" alt="' + escapeHtml(alt) + '" loading="lazy" />';
      });
      // bold
      h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // italic (non-greedy, non-space boundaries)
      h = h.replace(/(^|[^*])\*([^*\s][^*]*?)\*([^*]|$)/g, '$1<em>$2</em>$3');
      // bare /uploads/ paths (image or file)
      h = h.replace(/(^|[\s(])(\/uploads\/[A-Za-z0-9._-]+)/g, (m, pre, p) => {
        const full = base + p;
        if (IMG_EXT.test(p)) return pre + '<img class="attach" src="' + full + '" loading="lazy" />';
        return pre + '<a class="attach-link" href="' + full + '" target="_blank" rel="noopener">' + full + '</a>';
      });
      // bare http(s) image URLs
      h = h.replace(/(https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s<>"']*)?)/gi, '<img class="attach" src="$1" loading="lazy" />');
      return h;
    }

    function isTableSeparator(l) {
      return /^\s*\|?\s*:?-{2,}[\s:|:-]*\|?\s*$/.test(l) && l.indexOf('-') !== -1 && l.replace(/[^a-zA-Z0-9]/g, '').length === 0;
    }

    while (i < lines.length) {
      const line = lines[i];

      // code fence
      if (line.trim().startsWith('```')) {
        i++;
        const buf = [];
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          buf.push(escapeHtml(lines[i]));
          i++;
        }
        if (i < lines.length) i++; // closing fence
        out.push('<pre><code>' + buf.join('\n') + '</code></pre>');
        continue;
      }

      // heading
      const hd = line.match(/^(#{1,6})\s+(.*)$/);
      if (hd) {
        out.push('<h' + hd[1].length + '>' + inline(hd[2]) + '</h' + hd[1].length + '>');
        i++;
        continue;
      }

      // horizontal rule
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line) && line.replace(/[^-*_\s]/g, '') === line.trim()) {
        out.push('<hr/>');
        i++;
        continue;
      }

      // blockquote
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(inline(lines[i].replace(/^\s*>\s?/, '')));
          i++;
        }
        out.push('<blockquote>' + buf.join('<br/>') + '</blockquote>');
        continue;
      }

      // table (header + separator on next line)
      if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        const header = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          rows.push(lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
          i++;
        }
        out.push(
          '<table><thead><tr>' + header.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>'
        );
        continue;
      }

      // lists
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        const tag = ul ? 'ul' : 'ol';
        const items = [];
        while (i < lines.length) {
          const m = ul ? lines[i].match(/^\s*[-*]\s+(.*)$/) : lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
          if (!m) break;
          items.push('<li>' + inline(m[1]) + '</li>');
          i++;
        }
        out.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
        continue;
      }

      // blank
      if (line.trim() === '') { i++; continue; }

      // paragraph
      out.push('<p>' + inline(line) + '</p>');
      i++;
    }

    return out.join('');
  }

  window.SophiaMarkdown = { renderMarkdown, escapeHtml };
})();
