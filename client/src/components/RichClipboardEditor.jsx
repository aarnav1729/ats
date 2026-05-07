// Format-preserving paste editor.
//
// Excel/Google Sheets put TWO clipboard payloads on copy:
//   - text/html  (the styled <table> with merged cells, bold, alignment)
//   - text/plain (a tab-separated fallback)
//
// A plain <textarea> only ever receives the plain-text fallback so all the
// Excel formatting is dropped on the floor. By using a contentEditable div
// and intercepting the `paste` event we can grab the `text/html` payload
// directly, sanitise it, and let the recruiter see exactly what the
// candidate is going to see.
//
// On every change we expose both representations to the parent:
//   onChange({ html, text })
//
// The parent decides which one to send to the server (we send both - the
// HR view renders breakup_html, the candidate-portal renders breakup_html,
// and breakup_text is kept as a plain-text fallback for old mail clients).

import { useEffect, useRef } from 'react';

// Minimal HTML allow-list. We keep table structure + basic inline styling
// (font-weight, text-align, background, border) and strip everything else
// (Excel emits a lot of <o:p> / mso-* noise that bloats the row).
const ALLOWED_TAGS = new Set([
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'COL', 'COLGROUP',
  'CAPTION', 'B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'SPAN', 'DIV',
]);
const ALLOWED_ATTRS = new Set(['colspan', 'rowspan', 'align', 'valign', 'width']);

function sanitize(node) {
  // Walk and prune.
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n.childNodes) continue;
    for (const child of Array.from(n.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          // Replace disallowed tags with a span keeping the inner content.
          const span = document.createElement('span');
          span.innerHTML = child.innerHTML;
          child.replaceWith(span);
          stack.push(span);
          continue;
        }
        // Filter attributes
        for (const attr of Array.from(child.attributes)) {
          const name = attr.name.toLowerCase();
          if (ALLOWED_ATTRS.has(name)) continue;
          if (name === 'style') {
            // Keep only safe declarations
            const safe = (attr.value || '')
              .split(';')
              .map((d) => d.trim())
              .filter((d) => /^(font-weight|font-style|text-align|background|background-color|color|border|border-[a-z-]+|width|padding|padding-[a-z-]+|vertical-align)\s*:/i.test(d))
              .join('; ');
            if (safe) child.setAttribute('style', safe);
            else child.removeAttribute('style');
          } else {
            child.removeAttribute(attr.name);
          }
        }
        stack.push(child);
      } else if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
      }
    }
  }
  return node;
}

// Promote the pasted HTML to a tidy <table> with our own minimal CSS so it
// renders consistently in the recruiter view + the candidate portal +
// transactional email - those three surfaces will share the same blob.
function applyHouseStyles(root) {
  for (const tbl of root.querySelectorAll('table')) {
    tbl.setAttribute('style', 'border-collapse:collapse;width:100%;font-family:Inter,Segoe UI,sans-serif;font-size:13px');
    tbl.setAttribute('cellpadding', '0');
    tbl.setAttribute('cellspacing', '0');
  }
  for (const cell of root.querySelectorAll('th, td')) {
    const existing = cell.getAttribute('style') || '';
    cell.setAttribute('style', `${existing};border:1px solid #d1d5db;padding:8px 10px;vertical-align:top`);
  }
  for (const th of root.querySelectorAll('th')) {
    const existing = th.getAttribute('style') || '';
    th.setAttribute('style', `${existing};background:#f1f5f9;color:#0f172a;font-weight:600;text-align:left`);
  }
  return root;
}

export default function RichClipboardEditor({ initialHtml = '', onChange, minHeight = 220, placeholder = 'Paste your breakup table from Excel here…' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && !ref.current.innerHTML && initialHtml) {
      ref.current.innerHTML = initialHtml;
    }
  // eslint-disable-next-line
  }, []);

  const emit = () => {
    if (!ref.current) return;
    const html = ref.current.innerHTML.trim();
    const text = ref.current.innerText;
    onChange?.({ html, text });
  };

  const handlePaste = (e) => {
    const cb = e.clipboardData;
    if (!cb) return;
    // Prefer HTML (Excel/Sheets give us styled tables here)
    const html = cb.getData('text/html');
    const text = cb.getData('text/plain');

    if (html && /<\s*table[\s>]/i.test(html)) {
      e.preventDefault();
      // Wrap in a container so we can sanitise without touching the live editor.
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      sanitize(wrap);
      applyHouseStyles(wrap);
      // Insert at the caret
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const frag = document.createDocumentFragment();
        for (const n of Array.from(wrap.childNodes)) frag.appendChild(n);
        range.insertNode(frag);
        // Move caret to end
        sel.collapseToEnd();
      } else {
        ref.current.innerHTML += wrap.innerHTML;
      }
      emit();
      return;
    }
    // Fall back to plain-text paste with tab→cell promotion. If the user
    // pasted a TSV blob we still build a table for them.
    if (text && text.includes('\t')) {
      e.preventDefault();
      const rows = text.replace(/\r/g, '').split('\n').filter((l) => l.length);
      const tbl = document.createElement('table');
      tbl.setAttribute('style', 'border-collapse:collapse;width:100%;font-family:Inter,Segoe UI,sans-serif;font-size:13px');
      const tbody = document.createElement('tbody');
      rows.forEach((line, i) => {
        const tr = document.createElement('tr');
        line.split('\t').forEach((cell) => {
          const td = document.createElement(i === 0 ? 'th' : 'td');
          td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      applyHouseStyles(tbl);
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(tbl);
        sel.collapseToEnd();
      } else {
        ref.current.appendChild(tbl);
      }
      emit();
      return;
    }
    // Plain-text default - let the browser handle but emit after.
    setTimeout(emit, 0);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Paste a table from Excel, Google Sheets, or Word - formatting is preserved.
        </p>
        <button
          type="button"
          onClick={() => { if (ref.current) { ref.current.innerHTML = ''; emit(); } }}
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
        >Clear</button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        className="rich-clipboard-editor input-field w-full overflow-auto bg-white"
        style={{
          minHeight,
          maxHeight: 480,
          padding: 14,
          lineHeight: 1.5,
          fontSize: 13,
          color: 'var(--text-main)',
        }}
      />
      <style>{`
        .rich-clipboard-editor:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
        .rich-clipboard-editor table { border-collapse: collapse; }
        .rich-clipboard-editor th, .rich-clipboard-editor td {
          border: 1px solid #d1d5db; padding: 6px 10px; vertical-align: top;
        }
        .rich-clipboard-editor th { background: #f1f5f9; font-weight: 600; }
      `}</style>
    </div>
  );
}
