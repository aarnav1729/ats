import { useEffect, useMemo, useRef, useState } from 'react';
import { mastersAPI } from '../services/api';
import haptic from '../utils/haptic';

function normalizeItems(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item) return null;
        if (typeof item === 'string') {
          return { label: item, email: item, source: 'manual' };
        }
        return {
          label: item.label || item.employee_name || item.employee_email || item.email,
          email: item.email || item.employee_email || '',
          employee_id: item.employee_id || null,
          designation: item.designation || null,
          source: item.source || 'spot',
        };
      })
      .filter((item) => item?.email);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((email) => ({ label: email, email, source: 'manual' }));
  }

  return [];
}

function uniqByEmail(items) {
  const seen = new Set();
  return items.filter((item) => {
    const email = String(item?.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function SuggestionRow({ item, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="interactive-card flex w-full items-start justify-between gap-3 rounded-2xl px-3 py-3 text-left"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 break-words">{item.employee_name || item.label || item.email}</p>
        <p className="text-xs text-gray-500 break-all">{item.employee_email || item.email}</p>
      </div>
      <div className="shrink-0 text-right">
        {item.designation && <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">{item.designation}</p>}
        {item.department_name && <p className="text-xs text-gray-500">{item.department_name}</p>}
      </div>
    </button>
  );
}

export default function EmailAutocompleteTags({
  value,
  onChange,
  placeholder = 'Search employee by name or add an external email',
  helperText,
  disabled = false,
  max = null,
}) {
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const selected = useMemo(() => uniqByEmail(normalizeItems(value)), [value]);

  useEffect(() => {
    if (disabled) return undefined;
    if (!query.trim()) {
      setResults([]);
      return undefined;
    }

    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await mastersAPI.employees({ search: query.trim() });
        const items = res.data?.items || res.data?.data || res.data || [];
        setResults(items);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => clearTimeout(timeout);
  }, [disabled, query]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const emitChange = (items) => {
    onChange?.(uniqByEmail(items).map((item) => ({
      label: item.label || item.employee_name || item.email,
      email: item.email || item.employee_email,
      employee_id: item.employee_id || null,
      designation: item.designation || null,
      source: item.source || (item.employee_id ? 'spot' : 'manual'),
    })));
  };

  const addItem = (candidate) => {
    const email = String(candidate?.email || candidate?.employee_email || '').trim();
    if (!email) return;
    const nextItem = {
      label: candidate.employee_name || candidate.label || email,
      email,
      employee_id: candidate.employee_id || null,
      designation: candidate.designation || null,
      source: candidate.source || (candidate.employee_id ? 'spot' : 'manual'),
    };
    if (max === 1) {
      emitChange([nextItem]);
    } else {
      if (typeof max === 'number' && selected.length >= max) return;
      emitChange([...selected, nextItem]);
    }
    haptic.light();
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const addManualIfPossible = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (!isEmail(trimmed)) return;
    addItem({ email: trimmed, label: trimmed, source: 'manual' });
  };

  const removeItem = (email) => {
    haptic.light();
    emitChange(selected.filter((item) => item.email !== email));
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addManualIfPossible();
    }
    if (event.key === 'Backspace' && !query && selected.length) {
      removeItem(selected[selected.length - 1].email);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div
        className={`flex min-h-[52px] w-full flex-wrap items-center gap-2 rounded-[24px] border px-3.5 py-2.5 shadow-[0_16px_32px_-30px_rgba(15,23,42,0.2)] transition-all ${
          open
            ? 'border-[rgba(82,103,255,0.28)] bg-white ring-4 ring-[rgba(82,103,255,0.08)]'
            : 'border-[rgba(29,33,41,0.1)] bg-[rgba(248,250,252,0.92)]'
        } ${disabled ? 'cursor-not-allowed bg-gray-50 opacity-70' : ''}`}
        onClick={() => {
          if (disabled) return;
          inputRef.current?.focus();
          setOpen(true);
          haptic.light();
        }}
      >
        {selected.map((item) => (
          <span
            key={item.email}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-[rgba(82,103,255,0.16)] bg-[rgba(82,103,255,0.08)] px-3 py-1.5 text-sm text-slate-900"
          >
            <span className="max-w-full break-all">
              {item.label && item.label !== item.email ? `${item.label} · ${item.email}` : item.email}
            </span>
            {!disabled && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeItem(item.email);
                }}
                className="text-slate-500 transition-colors hover:text-slate-900"
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={(typeof max === 'number' && selected.length >= max) ? 'Selection limit reached' : (selected.length ? 'Add another interviewer' : placeholder)}
          className="min-w-[220px] flex-1 border-0 bg-transparent p-0 text-sm text-gray-800 outline-none placeholder:text-gray-400"
        />
      </div>

      {helperText && <p className="mt-1 text-xs text-gray-500">{helperText}</p>}

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-40 mt-3 overflow-hidden rounded-[26px] border border-[rgba(29,33,41,0.08)] bg-white shadow-[0_28px_60px_-36px_rgba(15,23,42,0.32)]">
          <div className="border-b border-[rgba(29,33,41,0.06)] bg-[rgba(248,250,252,0.96)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Search SPOT employees or type an external email and press Enter
          </div>
          {loading ? (
            <div className="px-4 py-6 text-sm text-gray-500">Searching employees...</div>
          ) : results.length > 0 ? (
            <div className="max-h-64 overflow-y-auto p-2">
              {results.map((item) => (
                <SuggestionRow
                  key={`${item.employee_id || item.employee_email || item.employee_name}`}
                  item={item}
                  onSelect={(selectedItem) => addItem({
                    label: selectedItem.employee_name,
                    email: selectedItem.employee_email,
                    employee_id: selectedItem.employee_id,
                    designation: selectedItem.designation,
                    source: 'spot',
                  })}
                />
              ))}
            </div>
          ) : (
            <div className="px-4 py-5 text-sm text-gray-500">
              {query.trim() && isEmail(query.trim())
                ? 'Press Enter to add this external email.'
                : 'Start typing a name or email to search SPOT EMP.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
