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

  // Linkify bare URLs. Anchors/images/code already produced above are split out
  // first so a URL used as link text, an <img src> or a code span is never
  // wrapped twice or linkified into broken HTML. Trailing punctuation is trimmed
  // the way a human leaves it after pasting a link.
  var AUTOLINK_RE = /(https?:\/\/[^\s<>"'`]+)/gi;
  var WWW_RE = /(?<![\w.\/-])(www\.[^\s<>"'`]+)/gi;
  var PROTECTED_RE = /(<a\s[^>]*>[\s\S]*?<\/a>|<img\b[^>]*>|<iframe\b[^>]*>[\s\S]*?<\/iframe>|<code>[\s\S]*?<\/code>)/g;

  function autolink(html, copyBtn) {
    var parts = html.split(PROTECTED_RE);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) continue; // protected: already an anchor / img / code
      parts[i] = parts[i].replace(AUTOLINK_RE, function (m, url) {
        var tail = (url.match(/[.,;:!?]+$/) || [''])[0];
        var clean = tail ? url.slice(0, -tail.length) : url;
        var trail = '';
        while (clean.slice(-1) === ')' &&
               (clean.split('(').length - 1) < (clean.split(')').length - 1)) {
          clean = clean.slice(0, -1);
          trail += ')';
        }
        if (clean.length < 12) return m; // not a plausible URL
        return '<span class="url-wrap"><a class="autolink" href="' + clean +
          '" target="_blank" rel="noopener noreferrer">' + clean +
          '</a>' + copyBtn + '</span>' + trail + tail;
      });
      parts[i] = parts[i].replace(WWW_RE, function (m, url) {
        var tail = (url.match(/[.,;:!?]+$/) || [''])[0];
        var clean = tail ? url.slice(0, -tail.length) : url;
        if (!clean) return m;
        return '<span class="url-wrap"><a class="autolink" href="https://' + clean +
          '" target="_blank" rel="noopener noreferrer">' + clean +
          '</a>' + copyBtn + '</span>' + tail;
      });
    }
    return parts.join('');
  }

  // Non-image attachments currently render as a bare text link. Give them a
  // file card instead (glyph + name + open-in-new-tab), and for PDFs an opt-in
  // first-page preview so you can see what the document is.
  var NON_IMAGE_EXT = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|md|zip|json|log|rtf|odt)$/i;

  function fileLabel(url) {
    var clean = String(url || '').split('?')[0].split('#')[0];
    var name = clean.split('/').pop() || clean;
    try { name = decodeURIComponent(name); } catch (e) { /* keep raw */ }
    return name;
  }

  function fileGlyph(name) {
    var ext = (String(name).match(/\.([a-z0-9]+)$/i) || ['', 'file'])[1].toUpperCase();
    return ext.length > 4 ? ext.slice(0, 4) : ext;
  }

  function fileCard(url, name, copyBtn) {
    var label = name || fileLabel(url);
    var isPdf = /\.pdf(\?|#|$)/i.test(url);
    var card = '<span class="file-card' + (isPdf ? ' is-pdf' : '') + '">' +
      '<a class="file-card-link" href="' + url + '" target="_blank" rel="noopener noreferrer">' +
      '<span class="file-glyph">' + escapeHtml(fileGlyph(label)) + '</span>' +
      '<span class="file-name">' + escapeHtml(label) + '</span>' +
      '</a>' + copyBtn;
    if (isPdf) {
      card += '<details class="pdf-preview-wrap"><summary>Preview first page</summary>' +
        '<iframe class="pdf-preview" src="' + url + '#page=1&view=FitH&toolbar=0" ' +
        'loading="lazy" title="' + escapeHtml(label) + '"></iframe></details>';
    }
    return card + '</span>';
  }

    function inline(s) {
      let h = escapeHtml(s);
      const copyBtn = '<button class="url-copy" title="Copy link" aria-label="Copy link">⧉</button>';
      // inline code (before bold/italic so `**` inside code stays literal)
      h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
      // markdown image ![alt](url)
      h = h.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/uploads\/[^\s)]+)\)/g, (m, alt, url) => {
        const full = url.charAt(0) === '/' ? base + url : url;
        return '<span class="attach-fig"><img class="attach" src="' + full + '" alt="' + escapeHtml(alt) + '" loading="lazy" />' + copyBtn + '</span>';
      });
      // links [text](url)
      h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, (m, txt, url) => {
        const full = url.charAt(0) === '/' ? base + url : url;
        if (NON_IMAGE_EXT.test(full)) return '<span class="url-wrap">' + fileCard(full, txt, copyBtn) + '</span>';
        return '<span class="url-wrap"><a href="' + full + '" target="_blank" rel="noopener">' + txt + '</a>' + copyBtn + '</span>';
      });
      // bold
      h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // italic (non-greedy, non-space boundaries)
      h = h.replace(/(^|[^*])\*([^*\s][^*]*?)\*([^*]|$)/g, '$1<em>$2</em>$3');
      // bare /uploads/ paths (image or file)
      h = h.replace(/(^|[\s(])(\/uploads\/[A-Za-z0-9._-]+)/g, (m, pre, p) => {
        const full = base + p;
        if (IMG_EXT.test(p)) return pre + '<span class="attach-fig"><img class="attach" src="' + full + '" loading="lazy" />' + copyBtn + '</span>';
        return pre + '<span class="url-wrap">' + fileCard(full, fileLabel(full), copyBtn) + '</span>';
      });
      // bare http(s) image URLs (not already inside a generated href/src)
      h = h.replace(/(?<!["'=])(https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s<>"']*)?)/gi, (m, url) => {
        return '<span class="attach-fig"><img class="attach" src="' + url + '" loading="lazy" />' + copyBtn + '</span>';
      });
      h = autolink(h, copyBtn);
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
        out.push('<div class="code-block"><button class="copy-btn" title="Copy code">Copy</button><pre><code>' + buf.join('\n') + '</code></pre></div>');
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
