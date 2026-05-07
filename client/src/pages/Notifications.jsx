import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { notificationsAPI } from '../services/api';
import InfoTip from '../components/InfoTip';

function formatRelativeTime(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const now = new Date();
  const diff = now - parsed;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';
  return parsed.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
}

const CATEGORY_CONFIG = {
  interview: {
    color: 'violet',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
  },
  clearance: {
    color: 'emerald',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  document: {
    color: 'blue',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  offer: {
    color: 'amber',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
      </svg>
    ),
  },
  rejection: {
    color: 'red',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
  },
  default: {
    color: 'slate',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
  },
};

function getCategoryConfig(title) {
  const t = String(title || '').toLowerCase();
  if (t.includes('interview') || t.includes('schedule') || t.includes('round')) return CATEGORY_CONFIG.interview;
  if (t.includes('clearance') || t.includes('approve') || t.includes('cxo')) return CATEGORY_CONFIG.clearance;
  if (t.includes('document') || t.includes('upload') || t.includes('uploaded')) return CATEGORY_CONFIG.document;
  if (t.includes('offer') || t.includes('ctc')) return CATEGORY_CONFIG.offer;
  if (t.includes('reject') || t.includes('declined')) return CATEGORY_CONFIG.rejection;
  return CATEGORY_CONFIG.default;
}

const COLOR_VARIANTS = {
  violet: { bg: 'bg-violet-100', text: 'text-violet-600', border: 'border-violet-200' },
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600', border: 'border-emerald-200' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-200' },
  amber: { bg: 'bg-amber-100', text: 'text-amber-600', border: 'border-amber-200' },
  red: { bg: 'bg-red-100', text: 'text-red-600', border: 'border-red-200' },
  slate: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
};

function formatMessage(message) {
  if (!message) return '';
  let formatted = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  formatted = formatted
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-slate-800">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
    .replace(/`(.*?)`/g, '<code class="px-1.5 py-0.5 bg-slate-100 rounded text-xs font-mono text-pink-600">$1</code>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="text-indigo-600 hover:text-indigo-800 underline" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br/>');
  
  return formatted;
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
      toast.success('All notifications marked as read');
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
      {/* Enhanced Hero Section */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMtOS45NDEgMC0xOCA4LjA1OS0xOCAxOHM4LjA1OSAxOCAxOCAxOCAxOC04LjA1OSAxOC0xOC04LjA1OS0xOC0xOC0xOHptMCAzMmMtNy43MzIgMC0xNC02LjI2OC0xNC0xNHM2LjI2OC0xNCAxNC0xNCAxNCA2LjI2OCAxNCAxNC02LjI2OCAxNC0xNCAxNHoiIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iLjA1Ii8+PC9nPjwvc3ZnPg==')] opacity-30"></div>
        <div className="relative">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">Notifications</p>
              </div>
              <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white">Your Inbox</h1>
              <p className="mt-2 text-base font-medium text-slate-300">Stay updated on candidate progress and actions</p>
            </div>
            
            {/* Stats Cards */}
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-indigo-600/30 backdrop-blur-sm border border-indigo-500/30 p-4 min-w-[110px] text-center">
                <p className="text-4xl font-extrabold text-white">{stats.unread}</p>
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-300">Unread</p>
              </div>
              <div className="h-12 w-px bg-white/20"></div>
              <div className="rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 p-4 min-w-[110px] text-center">
                <p className="text-4xl font-extrabold text-white">{stats.total}</p>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-300">Total</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Controls */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {[
            { key: 'all', label: 'All', count: stats.total },
            { key: 'unread', label: 'Unread', count: stats.unread },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all ${
                view === item.key
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'bg-white text-slate-700 border-2 border-slate-200 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {item.label}
              {item.count > 0 && (
                <span className={`inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                  view === item.key ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input-field pl-10 sm:w-72 border-2 border-slate-200 focus:border-indigo-500"
              placeholder="Search notifications..."
            />
          </div>
          {stats.unread > 0 && (
            <button 
              type="button" 
              onClick={markAllRead} 
              className="btn-primary whitespace-nowrap"
            >
              <svg className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Mark all read
            </button>
          )}
          <button type="button" onClick={loadData} className="btn-secondary p-2.5" title="Refresh">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
          </button>
        </div>
      </div>

      {/* Notification feed */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600"></div>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="mt-6 rounded-3xl bg-white border border-slate-200 p-16 text-center">
          <div className="mx-auto w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <svg className="h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-slate-800">No notifications</h3>
          <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">
            {view === 'unread' 
              ? "You're all caught up! Check back later for new updates." 
              : "You don't have any notifications yet. They'll appear here when important actions happen."}
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {filteredRows.map((row, idx) => {
            const category = getCategoryConfig(row.title);
            const colors = COLOR_VARIANTS[category.color];
            
            return (
              <div
                key={row.id}
                onClick={() => openLink(row)}
                className={`group relative overflow-hidden rounded-2xl border-2 transition-all duration-200 hover:shadow-lg ${
                  row.read_flag
                    ? 'border-slate-200 bg-white hover:border-slate-300'
                    : 'border-indigo-200 bg-gradient-to-r from-indigo-50 to-white shadow-md hover:shadow-xl'
                } ${row.link ? 'cursor-pointer' : ''}`}
                style={{ animationDelay: `${Math.min(idx, 10) * 30}ms` }}
              >
                {!row.read_flag && (
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-indigo-600"></div>
                )}
                
                <div className="flex items-start gap-4 p-4">
                  {/* Icon */}
                  <div className={`flex-shrink-0 rounded-xl p-2.5 ${colors.bg} ${colors.text}`}>
                    {category.icon}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`text-sm break-words ${row.read_flag ? 'font-medium text-slate-800' : 'font-bold text-slate-950'}`}>
                          {row.title || 'Notification'}
                        </p>
                        {row.message && (
                          <div 
                            className="mt-1.5 text-sm text-slate-600 whitespace-normal break-words line-clamp-2"
                            dangerouslySetInnerHTML={{ __html: formatMessage(row.message) }}
                          />
                        )}
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-2">
                        <span className="text-xs font-medium text-slate-500 whitespace-nowrap">{formatRelativeTime(row.created_at)}</span>
                      </div>
                    </div>

                    {/* Action buttons - always visible with better contrast */}
                    <div className="mt-3 flex items-center gap-2">
                      {row.link && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openLink(row); }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                          </svg>
                          View
                        </button>
                      )}
                      {!row.read_flag && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); markRead(row.id); }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 border border-slate-200"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75" />
                          </svg>
                          Done
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Unread indicator dot */}
                  {!row.read_flag && (
                    <div className="absolute top-4 right-4 h-2.5 w-2.5 rounded-full bg-indigo-500 ring-2 ring-white"></div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}