import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import haptic from '../utils/haptic';

// ── Inline icon helpers ──────────────────────────────────────────────────────

function IconSearch({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
    </svg>
  );
}

function IconFilter({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
    </svg>
  );
}

function IconChevronUp({ className = 'w-3 h-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  );
}

function IconChevronDown({ className = 'w-3 h-3' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function IconDownload({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

function IconColumns({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4h6M9 20h6M4 9v6M20 9v6M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" />
    </svg>
  );
}

function IconX({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function cellToString(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ── Main component ───────────────────────────────────────────────────────────

export default function DataTable({
  columns = [],
  data = [],
  onRowClick,
  title,
  subtitle,
  exportFileName = 'export',
  pageSize: defaultPageSize = 10,
  emptyMessage = 'No data to display.',
}) {
  const [globalSearch, setGlobalSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState({});
  const [openFilter, setOpenFilter] = useState(null);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [hiddenColumns, setHiddenColumns] = useState(new Set());
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(defaultPageSize);

  const filterInputRef = useRef(null);
  const columnMenuRef = useRef(null);
  const filterPopoverRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target)) {
        setShowColumnMenu(false);
      }
      if (
        filterPopoverRef.current &&
        !filterPopoverRef.current.contains(e.target) &&
        !e.target.closest('[data-filter-trigger]')
      ) {
        setOpenFilter(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (openFilter && filterInputRef.current) {
      filterInputRef.current.focus();
    }
  }, [openFilter]);

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c.key)),
    [columns, hiddenColumns],
  );

  const filteredData = useMemo(() => {
    const globalLower = globalSearch.toLowerCase().trim();
    return data.filter((row) => {
      if (globalLower) {
        const matched = visibleColumns.some((col) =>
          cellToString(row[col.key]).toLowerCase().includes(globalLower),
        );
        if (!matched) return false;
      }
      for (const [key, filterValue] of Object.entries(columnFilters)) {
        if (!filterValue) continue;
        const cell = cellToString(row[key]).toLowerCase();
        if (!cell.includes(filterValue.toLowerCase())) return false;
      }
      return true;
    });
  }, [data, globalSearch, columnFilters, visibleColumns]);

  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    const copy = [...filteredData];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredData, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / rowsPerPage));
  const safePage = Math.min(page, totalPages - 1);
  const pageData = useMemo(
    () => sortedData.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage),
    [sortedData, safePage, rowsPerPage],
  );

  useEffect(() => { setPage(0); }, [globalSearch, columnFilters, sortKey, sortDir, data]);

  const rowId = useCallback((row, idx) => {
    if (row.id != null) return row.id;
    if (row._id != null) return row._id;
    return idx;
  }, []);

  const allPageSelected = pageData.length > 0 && pageData.every((r, i) => selectedIds.has(rowId(r, safePage * rowsPerPage + i)));
  const somePageSelected = pageData.some((r, i) => selectedIds.has(rowId(r, safePage * rowsPerPage + i)));

  function toggleSelectAll() {
    const next = new Set(selectedIds);
    if (allPageSelected) {
      pageData.forEach((r, i) => next.delete(rowId(r, safePage * rowsPerPage + i)));
    } else {
      pageData.forEach((r, i) => next.add(rowId(r, safePage * rowsPerPage + i)));
    }
    setSelectedIds(next);
  }

  function toggleSelect(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function setColumnFilter(key, value) {
    setColumnFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearColumnFilter(key) {
    setColumnFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setOpenFilter(null);
  }

  function toggleColumn(key) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleExport() {
    const selectedRows = sortedData.filter((r, i) => selectedIds.has(rowId(r, i)));
    const exportRows = selectedRows.length > 0 ? selectedRows : sortedData;
    const wsData = exportRows.map((row) => {
      const obj = {};
      visibleColumns.forEach((col) => {
        obj[col.label] = row[col.key] ?? '';
      });
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, `${exportFileName}.xlsx`);
    haptic.success();
  }

  const activeFilterCount = Object.values(columnFilters).filter(Boolean).length;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      {/* Header */}
      {(title || subtitle) && (
        <div style={{ padding: '18px 20px 0' }}>
          {title && (
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-main)', letterSpacing: '-0.01em' }}>
              {title}
            </h2>
          )}
          {subtitle && (
            <p style={{ marginTop: 4, fontSize: 13, color: 'var(--text-faint)' }}>{subtitle}</p>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center gap-2.5"
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--line-subtle)',
        }}
      >
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center" style={{ color: 'var(--text-faint)' }}>
            <IconSearch />
          </div>
          <input
            type="text"
            className="input-field"
            style={{ paddingLeft: 36, paddingRight: 32, height: 36 }}
            placeholder="Search…"
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            aria-label="Search all columns"
          />
          {globalSearch && (
            <button
              type="button"
              className="absolute inset-y-0 right-2 flex items-center"
              style={{ color: 'var(--text-faint)' }}
              onClick={() => setGlobalSearch('')}
              aria-label="Clear search"
            >
              <IconX />
            </button>
          )}
        </div>

        {activeFilterCount > 0 && (
          <span
            className="inline-flex items-center gap-1"
            style={{
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--info-soft)',
              color: 'var(--info-text)',
            }}
          >
            <IconFilter className="w-3 h-3" />
            {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
          </span>
        )}

        {selectedIds.size > 0 && (
          <span
            style={{
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--info-soft)',
              color: 'var(--info-text)',
            }}
          >
            {selectedIds.size} selected
          </span>
        )}

        <div className="flex-1" />

        <div className="relative" ref={columnMenuRef}>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5"
            style={{ height: 36, padding: '0 12px', fontSize: 13 }}
            onClick={() => {
              haptic.light();
              setShowColumnMenu((v) => !v);
            }}
            aria-haspopup="true"
            aria-expanded={showColumnMenu}
          >
            <IconColumns />
            <span className="hidden sm:inline">Columns</span>
          </button>
          {showColumnMenu && (
            <div
              className="absolute right-0 top-full z-30 mt-1.5"
              style={{
                width: 220,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                padding: 6,
              }}
              role="menu"
            >
              <p style={{ padding: '6px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)' }}>
                Show / Hide
              </p>
              {columns.map((col) => (
                <label
                  key={col.key}
                  className="flex cursor-pointer items-center gap-2"
                  style={{
                    padding: '6px 8px',
                    fontSize: 13,
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-body)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <input
                    type="checkbox"
                    checked={!hiddenColumns.has(col.key)}
                    onChange={() => {
                      haptic.light();
                      toggleColumn(col.key);
                    }}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="btn-primary inline-flex items-center gap-1.5"
          style={{ height: 36, padding: '0 12px', fontSize: 13 }}
          onClick={handleExport}
        >
          <IconDownload />
          <span className="hidden sm:inline">
            {selectedIds.size > 0 ? `Export (${selectedIds.size})` : 'Export'}
          </span>
        </button>
      </div>

      {/* Table */}
      <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
        <table className="data-table" role="grid" style={{ width: 'auto', minWidth: '100%', tableLayout: 'auto' }}>
          <thead>
            <tr>
              <th style={{ width: 44, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                  onChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              {visibleColumns.map((col) => {
                const isSortable = col.sortable !== false;
                const isFilterable = col.filterable !== false;
                const isSorted = sortKey === col.key;
                const hasFilter = Boolean(columnFilters[col.key]);

                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{ whiteSpace: 'nowrap', minWidth: 120, maxWidth: 320 }}
                  >
                    <div className="flex items-center gap-1">
                      {isSortable ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1"
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            color: isSorted ? 'var(--text-main)' : 'var(--text-faint)',
                          }}
                          onClick={() => { haptic.light(); handleSort(col.key); }}
                        >
                          {col.label}
                          {isSorted && (sortDir === 'asc' ? <IconChevronUp /> : <IconChevronDown />)}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>
                          {col.label}
                        </span>
                      )}

                      {isFilterable && (
                        <div className="relative">
                          <button
                            type="button"
                            data-filter-trigger
                            style={{
                              padding: 2,
                              borderRadius: 4,
                              color: hasFilter ? 'var(--accent-blue)' : 'var(--line-strong)',
                            }}
                            onClick={() => {
                              haptic.light();
                              setOpenFilter((prev) => (prev === col.key ? null : col.key));
                            }}
                            aria-label={`Filter ${col.label}`}
                          >
                            <IconFilter className="w-3 h-3" />
                          </button>

                          {openFilter === col.key && (
                            <div
                              ref={filterPopoverRef}
                              className="absolute left-0 top-full z-30 mt-1.5"
                              style={{
                                width: 220,
                                background: 'var(--surface)',
                                border: '1px solid var(--line)',
                                borderRadius: 'var(--radius-md)',
                                boxShadow: 'var(--shadow-lg)',
                                padding: 10,
                              }}
                              role="dialog"
                            >
                              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 6 }}>
                                Filter {col.label}
                              </label>
                              <input
                                ref={filterInputRef}
                                type="text"
                                className="input-field"
                                style={{ height: 32, fontSize: 13 }}
                                placeholder={`Filter ${col.label}…`}
                                value={columnFilters[col.key] || ''}
                                onChange={(e) => setColumnFilter(col.key, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape' || e.key === 'Enter') setOpenFilter(null);
                                }}
                              />
                              {hasFilter && (
                                <button
                                  type="button"
                                  style={{ marginTop: 8, fontSize: 12, fontWeight: 500, color: 'var(--accent-blue)' }}
                                  onClick={() => clearColumnFilter(col.key)}
                                >
                                  Clear filter
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {pageData.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  style={{ padding: '48px 24px', textAlign: 'center', fontSize: 13, color: 'var(--text-faint)' }}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageData.map((row, idx) => {
                const globalIdx = safePage * rowsPerPage + idx;
                const id = rowId(row, globalIdx);
                const isSelected = selectedIds.has(id);

                return (
                  <tr
                    key={id}
                    style={{
                      cursor: onRowClick ? 'pointer' : 'default',
                      background: isSelected ? 'var(--info-soft)' : undefined,
                    }}
                    onClick={() => {
                      if (onRowClick) haptic.light();
                      onRowClick?.(row);
                    }}
                    tabIndex={onRowClick ? 0 : -1}
                    role="row"
                    aria-selected={isSelected}
                  >
                    <td style={{ width: 44, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => { haptic.light(); toggleSelect(id); }}
                        aria-label={`Select row ${globalIdx + 1}`}
                      />
                    </td>
                    {visibleColumns.map((col) => {
                      const raw = col.render ? col.render(row) : cellToString(row[col.key]);
                      const titleAttr = typeof raw === 'string' ? raw : undefined;
                      return (
                        <td
                          key={col.key}
                          title={titleAttr}
                          style={{
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: 320,
                            minWidth: 120,
                          }}
                        >
                          {raw}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {sortedData.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3"
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--line-subtle)',
            fontSize: 13,
          }}
        >
          <div className="flex items-center gap-2" style={{ color: 'var(--text-faint)' }}>
            <span>Rows per page:</span>
            <select
              value={rowsPerPage}
              onChange={(e) => {
                haptic.light();
                setRowsPerPage(Number(e.target.value));
                setPage(0);
              }}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px',
                fontSize: 13,
                background: 'var(--surface)',
                color: 'var(--text-body)',
              }}
            >
              {[5, 10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span style={{ marginLeft: 8 }}>
              {safePage * rowsPerPage + 1}–{Math.min((safePage + 1) * rowsPerPage, sortedData.length)} of {sortedData.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-secondary"
              style={{ height: 30, padding: '0 10px', fontSize: 12 }}
              disabled={safePage === 0}
              onClick={() => { haptic.light(); setPage(0); }}
            >
              First
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ height: 30, padding: '0 10px', fontSize: 12 }}
              disabled={safePage === 0}
              onClick={() => { haptic.light(); setPage((p) => Math.max(0, p - 1)); }}
            >
              Prev
            </button>
            <span style={{ padding: '0 10px', fontSize: 12, fontWeight: 600, color: 'var(--text-body)' }}>
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="btn-secondary"
              style={{ height: 30, padding: '0 10px', fontSize: 12 }}
              disabled={safePage >= totalPages - 1}
              onClick={() => { haptic.light(); setPage((p) => Math.min(totalPages - 1, p + 1)); }}
            >
              Next
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{ height: 30, padding: '0 10px', fontSize: 12 }}
              disabled={safePage >= totalPages - 1}
              onClick={() => { haptic.light(); setPage(totalPages - 1); }}
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
