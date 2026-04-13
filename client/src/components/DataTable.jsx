import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';

// ── Icon helpers (inline SVGs to keep the component self-contained) ──────────

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

function IconChevronUp({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  );
}

function IconChevronDown({ className = 'w-3.5 h-3.5' }) {
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

// ── Utility: stable stringify for cell values ────────────────────────────────

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
  // ── State ────────────────────────────────────────────────────────────────

  const [globalSearch, setGlobalSearch] = useState('');
  const [columnFilters, setColumnFilters] = useState({});      // { [key]: string }
  const [openFilter, setOpenFilter] = useState(null);          // key of column with open filter
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');               // 'asc' | 'desc'
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [hiddenColumns, setHiddenColumns] = useState(new Set());
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(defaultPageSize);

  const filterInputRef = useRef(null);
  const columnMenuRef = useRef(null);
  const filterPopoverRef = useRef(null);

  // ── Close column-menu on outside click ───────────────────────────────────

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

  // Auto-focus filter input when opening
  useEffect(() => {
    if (openFilter && filterInputRef.current) {
      filterInputRef.current.focus();
    }
  }, [openFilter]);

  // ── Visible columns ─────────────────────────────────────────────────────

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c.key)),
    [columns, hiddenColumns],
  );

  // ── Filtering ────────────────────────────────────────────────────────────

  const filteredData = useMemo(() => {
    const globalLower = globalSearch.toLowerCase().trim();
    return data.filter((row) => {
      // Global search: match any visible column
      if (globalLower) {
        const matched = visibleColumns.some((col) =>
          cellToString(row[col.key]).toLowerCase().includes(globalLower),
        );
        if (!matched) return false;
      }
      // Per-column filters
      for (const [key, filterValue] of Object.entries(columnFilters)) {
        if (!filterValue) continue;
        const cell = cellToString(row[key]).toLowerCase();
        if (!cell.includes(filterValue.toLowerCase())) return false;
      }
      return true;
    });
  }, [data, globalSearch, columnFilters, visibleColumns]);

  // ── Sorting ──────────────────────────────────────────────────────────────

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

  // ── Pagination ───────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(sortedData.length / rowsPerPage));
  const safePage = Math.min(page, totalPages - 1);
  const pageData = useMemo(
    () => sortedData.slice(safePage * rowsPerPage, safePage * rowsPerPage + rowsPerPage),
    [sortedData, safePage, rowsPerPage],
  );

  // Reset page when data/filters change
  useEffect(() => { setPage(0); }, [globalSearch, columnFilters, sortKey, sortDir, data]);

  // ── Selection helpers ────────────────────────────────────────────────────

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

  // ── Sort handler ─────────────────────────────────────────────────────────

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  // ── Column filter handler ────────────────────────────────────────────────

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

  // ── Toggle column visibility ─────────────────────────────────────────────

  function toggleColumn(key) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Export ───────────────────────────────────────────────────────────────

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
  }

  // ── Active filters badge count ───────────────────────────────────────────

  const activeFilterCount = Object.values(columnFilters).filter(Boolean).length;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="workspace-card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* ── Header area ───────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 space-y-4">
        {/* Title row */}
        {(title || subtitle) && (
          <div className="mb-1">
            {title && (
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-gray-950">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
            )}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Global search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
              <IconSearch />
            </div>
            <input
              type="text"
              className="input-field !py-2.5 !pl-9 !pr-9 !rounded-xl"
              placeholder="Search all columns..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              aria-label="Search all columns"
            />
            {globalSearch && (
              <button
                type="button"
                className="absolute inset-y-0 right-2.5 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                onClick={() => setGlobalSearch('')}
                aria-label="Clear search"
              >
                <IconX />
              </button>
            )}
          </div>

          {/* Active column-filter badges */}
          {activeFilterCount > 0 && (
            <span className="glass-chip text-indigo-700">
              <IconFilter className="w-3.5 h-3.5" />
              {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
            </span>
          )}

          {/* Selected count */}
          {selectedIds.size > 0 && (
            <span className="glass-chip text-indigo-700">
              {selectedIds.size} selected
            </span>
          )}

          <div className="flex-1" />

          {/* Column visibility toggle */}
          <div className="relative" ref={columnMenuRef}>
            <button
              type="button"
              className="btn-secondary !px-3 !py-2 inline-flex items-center gap-1.5"
              onClick={() => setShowColumnMenu((v) => !v)}
              aria-haspopup="true"
              aria-expanded={showColumnMenu}
              aria-label="Toggle column visibility"
            >
              <IconColumns />
              <span className="hidden sm:inline">Columns</span>
            </button>
            {showColumnMenu && (
              <div
                className="absolute right-0 top-full z-30 mt-2 w-56 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl"
                role="menu"
              >
                <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                  Show / Hide
                </p>
                {columns.map((col) => (
                  <label
                    key={col.key}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-indigo-50"
                    role="menuitemcheckbox"
                    aria-checked={!hiddenColumns.has(col.key)}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      checked={!hiddenColumns.has(col.key)}
                      onChange={() => toggleColumn(col.key)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Export */}
          <button
            type="button"
            className="btn-primary !px-3.5 !py-2 inline-flex items-center gap-1.5"
            onClick={handleExport}
            aria-label={selectedIds.size > 0 ? `Export ${selectedIds.size} selected rows to Excel` : 'Export all rows to Excel'}
          >
            <IconDownload />
            <span className="hidden sm:inline">
              {selectedIds.size > 0 ? `Export (${selectedIds.size})` : 'Export'}
            </span>
          </button>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="table-container !rounded-none !border-x-0 !border-b-0 !shadow-none">
        <table className="w-full text-sm" role="grid">
          <thead>
            <tr className="table-header">
              {/* Checkbox column */}
              <th className="w-12 px-4 py-3 text-center" scope="col">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  checked={allPageSelected}
                  ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                  onChange={toggleSelectAll}
                  aria-label={allPageSelected ? 'Deselect all rows on this page' : 'Select all rows on this page'}
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
                    className="px-4 py-3 select-none"
                    scope="col"
                    aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <div className="flex items-center gap-1.5">
                      {/* Sort trigger */}
                      {isSortable ? (
                        <button
                          type="button"
                          className="group inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-indigo-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 rounded"
                          onClick={() => handleSort(col.key)}
                          aria-label={`Sort by ${col.label}`}
                        >
                          {col.label}
                          <span className={`inline-flex flex-col transition-opacity ${isSorted ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                            {isSorted && sortDir === 'asc' && <IconChevronUp className="w-3 h-3" />}
                            {isSorted && sortDir === 'desc' && <IconChevronDown className="w-3 h-3" />}
                            {!isSorted && <IconChevronUp className="w-3 h-3" />}
                          </span>
                        </button>
                      ) : (
                        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                          {col.label}
                        </span>
                      )}

                      {/* Column filter trigger */}
                      {isFilterable && (
                        <div className="relative">
                          <button
                            type="button"
                            data-filter-trigger
                            className={`p-0.5 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                              hasFilter
                                ? 'text-indigo-600'
                                : 'text-gray-300 hover:text-gray-500'
                            }`}
                            onClick={() => setOpenFilter((prev) => (prev === col.key ? null : col.key))}
                            aria-label={`Filter ${col.label}`}
                            aria-expanded={openFilter === col.key}
                          >
                            <IconFilter className="w-3.5 h-3.5" />
                          </button>

                          {/* Filter popover */}
                          {openFilter === col.key && (
                            <div
                              ref={filterPopoverRef}
                              className="absolute left-0 top-full z-30 mt-2 w-56 rounded-xl border border-gray-200 bg-white p-3 shadow-xl"
                              role="dialog"
                              aria-label={`Filter by ${col.label}`}
                            >
                              <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400 mb-1.5">
                                Filter {col.label}
                              </label>
                              <input
                                ref={filterInputRef}
                                type="text"
                                className="input-field !py-2 !text-sm"
                                placeholder={`Filter ${col.label}...`}
                                value={columnFilters[col.key] || ''}
                                onChange={(e) => setColumnFilter(col.key, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') setOpenFilter(null);
                                  if (e.key === 'Enter') setOpenFilter(null);
                                }}
                                aria-label={`Filter value for ${col.label}`}
                              />
                              {hasFilter && (
                                <button
                                  type="button"
                                  className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
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
                  className="px-6 py-16 text-center text-sm text-gray-400"
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
                    className={`table-row cursor-pointer ${isSelected ? '!bg-indigo-50/60' : ''}`}
                    onClick={() => onRowClick?.(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick?.(row);
                      }
                    }}
                    tabIndex={0}
                    role="row"
                    aria-selected={isSelected}
                  >
                    <td className="w-12 px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        checked={isSelected}
                        onChange={() => toggleSelect(id)}
                        aria-label={`Select row ${globalIdx + 1}`}
                      />
                    </td>
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-4 py-3 text-gray-700">
                        {col.render ? col.render(row) : cellToString(row[col.key])}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ────────────────────────────────────────────────── */}
      {sortedData.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-t border-gray-100 text-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <span>Rows per page:</span>
            <select
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none transition-all cursor-pointer"
              value={rowsPerPage}
              onChange={(e) => {
                setRowsPerPage(Number(e.target.value));
                setPage(0);
              }}
              aria-label="Rows per page"
            >
              {[5, 10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span className="ml-2 text-gray-400">
              {safePage * rowsPerPage + 1}
              &ndash;
              {Math.min((safePage + 1) * rowsPerPage, sortedData.length)}
              {' '}of{' '}
              {sortedData.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 !text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              disabled={safePage === 0}
              onClick={() => setPage(0)}
              aria-label="First page"
            >
              First
            </button>
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 !text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              aria-label="Previous page"
            >
              Prev
            </button>
            <span className="px-3 py-1.5 text-xs font-semibold text-gray-600">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 !text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              aria-label="Next page"
            >
              Next
            </button>
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 !text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
              aria-label="Last page"
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
