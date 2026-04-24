import { useState, useEffect, useRef } from 'react';
import haptic from '../utils/haptic';

/**
 * CTCPasteTable — Format-preserving CTC entry component.
 *
 * The recruiter pastes any CTC breakdown from Excel / Word / email and the
 * component preserves whitespace, tabs, and line breaks exactly. The text
 * is also best-effort split into a 2D `rows` array for downstream analytics.
 *
 * Value shape (both produced):
 *   { text: string, rows: string[][] }
 *
 * Props:
 *   value      – { text?, rows? } | null
 *   onChange   – (next: { text, rows }) => void
 *   readOnly   – boolean
 *   placeholder
 *   minRows    – textarea min rows (default 14)
 */
export default function CTCPasteTable({ value, onChange, readOnly = false, placeholder, minRows = 14 }) {
  const derive = (v) => {
    if (typeof v?.text === 'string') return v.text;
    if (Array.isArray(v?.rows)) return v.rows.map((r) => r.join('\t')).join('\n');
    if (v && typeof v === 'object') {
      // Legacy flat { key: value } — render as two-column text
      return Object.entries(v)
        .filter(([k]) => !['rows', 'text'].includes(k))
        .map(([k, val]) => `${k}\t${val ?? ''}`)
        .join('\n');
    }
    return '';
  };

  const [text, setText] = useState(derive(value));
  const [mode, setMode] = useState('edit');
  const textareaRef = useRef(null);

  useEffect(() => {
    const external = derive(value);
    if (external !== text) setText(external);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.text, JSON.stringify(value?.rows || [])]);

  function parseRows(raw) {
    if (!raw) return [];
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const hasTab = lines.some((l) => l.includes('\t'));
    return lines.map((line) => (hasTab ? line.split('\t') : line.split(/ {2,}/)));
  }

  function emit(next) {
    onChange?.({ text: next, rows: parseRows(next) });
  }

  function handleChange(e) {
    const v = e.target.value;
    setText(v);
    emit(v);
  }

  function handlePaste() {
    setTimeout(() => haptic.success(), 0);
  }

  function handleClear() {
    if (!window.confirm('Clear the CTC table text?')) return;
    setText('');
    emit('');
    haptic.light();
  }

  function onKeyDown(e) {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const { selectionStart, selectionEnd } = el;
      const next = text.slice(0, selectionStart) + '\t' + text.slice(selectionEnd);
      setText(next);
      emit(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = selectionStart + 1;
      });
    }
  }

  if (readOnly) {
    return (
      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface)',
          padding: 16,
          overflow: 'auto',
          maxHeight: 560,
        }}
      >
        {text ? (
          <pre
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono, "SF Mono", Menlo, Consolas, monospace)',
              fontSize: 13,
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text-main)',
            }}
          >
            {text}
          </pre>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 13 }}>No CTC data submitted.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-2"
        style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--line-subtle)' }}
      >
        <div style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setMode('edit')}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: mode === 'edit' ? 'var(--accent-blue-soft)' : 'transparent',
              color: mode === 'edit' ? 'var(--accent-blue)' : 'var(--text-body)',
              border: 'none', cursor: 'pointer',
            }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: mode === 'preview' ? 'var(--accent-blue-soft)' : 'transparent',
              color: mode === 'preview' ? 'var(--accent-blue)' : 'var(--text-body)',
              border: 'none', borderLeft: '1px solid var(--line)', cursor: 'pointer',
            }}
          >
            Preview
          </button>
        </div>

        <button type="button" onClick={handleClear} className="btn-secondary btn-sm" style={{ color: 'var(--danger-text)' }}>
          Clear
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>
          Paste from Excel or type — whitespace, tabs, and line breaks preserved.
        </span>
      </div>

      {mode === 'edit' ? (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onPaste={handlePaste}
          onKeyDown={onKeyDown}
          placeholder={placeholder || 'Paste your CTC breakdown here. Tabs and line breaks kept exactly as pasted.\n\nExample:\nName\tJohn Doe\nDepartment\tSolar Cell Ops\nCurrent CTC\t18,00,000\nNegotiated CTC\t24,00,000'}
          rows={minRows}
          style={{
            width: '100%',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            background: 'var(--surface)',
            color: 'var(--text-main)',
            fontFamily: 'var(--font-mono, "SF Mono", Menlo, Consolas, monospace)',
            fontSize: 13,
            lineHeight: 1.65,
            whiteSpace: 'pre',
            overflow: 'auto',
            outline: 'none',
            resize: 'vertical',
            minHeight: 260,
          }}
        />
      ) : (
        <div
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-muted)',
            padding: 14,
            overflow: 'auto',
            maxHeight: 560,
          }}
        >
          {text ? (
            <pre
              style={{
                margin: 0,
                fontFamily: 'var(--font-mono, "SF Mono", Menlo, Consolas, monospace)',
                fontSize: 13, lineHeight: 1.65,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: 'var(--text-main)',
              }}
            >
              {text}
            </pre>
          ) : (
            <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 13 }}>Nothing to preview — switch to Edit and paste or type.</p>
          )}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
        {text.split('\n').filter((l) => l.trim().length > 0).length} non-empty line{text ? 's' : ''} · {text.length} characters
      </p>
    </div>
  );
}
