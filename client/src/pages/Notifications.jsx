import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { notificationsAPI } from '../services/api';
import InfoTip from '../components/InfoTip';

function formatDateTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const now = new Date();
  const diff = now - parsed;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';
  return parsed.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

const TYPE_ICONS = {
  interview: (
    <svg className="h-5 w-5 text-violet-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
    </svg>
  ),
  clearance: (
    <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  document: (
    <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  default: (
    <svg className="h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  ),
};

function getNotifIcon(title) {
  const t = String(title || '').toLowerCase();
  if (t.includes('interview') || t.includes('schedule') || t.includes('round')) return TYPE_ICONS.interview;
  if (t.includes('clearance') || t.includes('approve') || t.includes('cxo')) return TYPE_ICONS.clearance;
  if (t.includes('document') || t.includes('upload')) return TYPE_ICONS.document;
  return TYPE_ICONS.default;
}

export default function Notifications() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({ total: 0, unread: 0 });
  const [query, setQuery] = useState('');
  const [view, setView] = useState('all');

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await notificationsAPI.list({ page: 1, limit: 200 });
      setRows(res.data?.notifications || []);
      setStats({
        total: Number(res.data?.total || 0),
        unread: Number(res.data?.unread || 0),
      });
    } catch {
      toast.error('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const filteredRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (view === 'unread' && row.read_flag) return false;
      if (!search) return true;
      return [row.title, row.message, row.link]
        .map((v) => String(v || '').toLowerCase())
        .some((v) => v.includes(search));
    });
  }, [query, rows, view]);

  const markRead = async (id) => {
    try {
      await notificationsAPI.markRead(id);
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, read_flag: true } : r)));
      setStats((cur) => ({ ...cur, unread: Math.max(0, cur.unread - 1) }));
    } catch {
      toast.error('Failed to mark as read');
    }
  };

  const markAllRead = async () => {
    try {
      await notificationsAPI.markAllRead();
      setRows((cur) => cur.map((r) => ({ ...r, read_flag: true })));
      setStats((cur) => ({ ...cur, unread: 0 }));
      toast.success('All marked as read');
    } catch {
      toast.error('Failed to mark all as read');
    }
  };

  const openLink = (row) => {
    if (!row?.link) return;
    const link = row.link === '/dashboard' ? '/' : row.link;
    if (!row.read_flag) markRead(row.id);
    if (link.startsWith('http')) {
      window.open(link, '_blank', 'noopener,noreferrer');
    } else {
      navigate(link);
    }
  };

  return (
    <div className="workspace-shell">
      {/* Compact hero */}
      <section className="aurora-panel animate-fade-in-up">
        <div className="aurora-content">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200">Notifications</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">Inbox</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-white">{stats.unread}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-200">Unread</p>
              </div>
              <div className="h-8 w-px bg-white/20" />
              <div className="text-center">
                <p className="text-2xl font-bold text-white">{stats.total}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Total</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-fade-in-up stagger-1">
        <div className="flex gap-2">
          {[['all', 'All'], ['unread', 'Unread']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                view === key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
              {key === 'unread' && stats.unread > 0 && (
                <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-white/20 px-1 text-[10px] font-bold">
                  {stats.unread}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input-field pl-10 sm:w-72"
              placeholder="Search notifications..."
            />
          </div>
          <button type="button" onClick={markAllRead} className="btn-secondary whitespace-nowrap">
            Mark all read
          </button>
          <button type="button" onClick={loadData} className="btn-secondary">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
          </button>
        </div>
      </div>

      {/* Notification feed */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="workspace-card animate-fade-in-up stagger-2">
          <div className="py-16 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            <p className="mt-4 text-sm font-semibold text-gray-500">No notifications</p>
            <p className="mt-1 text-sm text-gray-400">
              {view === 'unread' ? 'All caught up!' : 'Notifications will appear here as workflow actions happen.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2 animate-fade-in-up stagger-2">
          {filteredRows.map((row, idx) => (
            <div
              key={row.id}
              onClick={() => openLink(row)}
              className={`group flex items-start gap-4 rounded-2xl border p-4 transition-all duration-200 animate-fade-in-up ${
                row.read_flag
                  ? 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
                  : 'border-indigo-100 bg-indigo-50/40 hover:border-indigo-200 hover:bg-indigo-50/60'
              } ${row.link ? 'cursor-pointer' : ''}`}
              style={{ animationDelay: `${Math.min(idx, 10) * 40}ms` }}
            >
              {/* Icon */}
              <div className={`flex-shrink-0 mt-0.5 rounded-xl p-2 ${row.read_flag ? 'bg-gray-100' : 'bg-white shadow-sm'}`}>
                {getNotifIcon(row.title)}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`text-sm truncate ${row.read_flag ? 'font-medium text-gray-700' : 'font-semibold text-gray-900'}`}>
                      {row.title || 'Notification'}
                    </p>
                    {row.message && (
                      <p className="mt-1 text-sm text-gray-500 line-clamp-2">{row.message}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <span className="text-xs text-gray-400 whitespace-nowrap">{formatDateTime(row.created_at)}</span>
                    {!row.read_flag && (
                      <span className="h-2 w-2 rounded-full bg-indigo-500 flex-shrink-0" />
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {row.link && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openLink(row); }}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      Open
                    </button>
                  )}
                  {!row.read_flag && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); markRead(row.id); }}
                      className="text-xs font-semibold text-gray-500 hover:text-gray-700"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
