import { useEffect, useMemo, useRef, useState } from 'react';
import { mastersAPI } from '../services/api';

function buildDisplayValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.name || value.employee_name || value.email || value.employee_email || '';
}

export default function EmployeeAutocompleteField({
  value,
  onSelect,
  placeholder = 'Search employee by name or email',
  disabled = false,
}) {
  const wrapperRef = useRef(null);
  const [query, setQuery] = useState(buildDisplayValue(value));
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const selectedLabel = useMemo(() => {
    if (!value) return '';
    const name = value.name || value.employee_name || '';
    const email = value.email || value.employee_email || '';
    return name && email ? `${name} · ${email}` : name || email || '';
  }, [value]);

  useEffect(() => {
    setQuery(buildDisplayValue(value));
  }, [value]);

  useEffect(() => {
    if (disabled) return undefined;
    if (!open || !query.trim()) {
      setResults([]);
      return undefined;
    }

    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await mastersAPI.employees({ search: query.trim() });
        const items = Array.isArray(res.data) ? res.data : res.data?.items || res.data?.data || [];
        setResults(items.slice(0, 20));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => clearTimeout(timeout);
  }, [disabled, open, query]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
        if (selectedLabel) setQuery(selectedLabel);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedLabel]);

  const emitSelection = (employee) => {
    onSelect?.(employee ? {
      employee_id: employee.employee_id || null,
      employee_name: employee.employee_name || '',
      employee_email: employee.employee_email || '',
      designation: employee.designation || '',
    } : null);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className={`rounded-xl border border-gray-300 bg-white shadow-sm transition-all ${open ? 'border-indigo-400 ring-2 ring-indigo-100' : ''}`}>
        <input
          type="text"
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          placeholder={placeholder}
          className="w-full rounded-xl border-0 bg-transparent px-3.5 py-3 text-sm text-gray-800 outline-none placeholder:text-gray-400"
        />
      </div>

      {value?.employee_email && (
        <div className="mt-2 flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          <span className="min-w-0 break-all">
            {selectedLabel}
            {value?.designation ? ` · ${value.designation}` : ''}
          </span>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                emitSelection(null);
              }}
              className="ml-3 shrink-0 font-semibold text-indigo-700 hover:text-indigo-900"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            Search SPOT employees
          </div>
          {loading ? (
            <div className="px-4 py-5 text-sm text-gray-500">Searching employees...</div>
          ) : results.length > 0 ? (
            <div className="max-h-72 overflow-y-auto">
              {results.map((employee) => (
                <button
                  key={`${employee.employee_id || employee.employee_email || employee.employee_name}`}
                  type="button"
                  onClick={() => {
                    setQuery(`${employee.employee_name || ''}${employee.employee_email ? ` · ${employee.employee_email}` : ''}`);
                    emitSelection(employee);
                  }}
                  className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-indigo-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 break-words">{employee.employee_name || '-'}</p>
                    <p className="text-xs text-gray-500 break-all">{employee.employee_email || 'No email found'}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {employee.designation && (
                      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">{employee.designation}</p>
                    )}
                    {employee.department_name && (
                      <p className="text-xs text-gray-500">{employee.department_name}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-5 text-sm text-gray-500">No matching employees found.</div>
          )}
        </div>
      )}
    </div>
  );
}
