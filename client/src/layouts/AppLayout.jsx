import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { notificationsAPI } from '../services/api';
import haptic from '../utils/haptic';

const navigationSections = [
  {
    label: 'Operate',
    items: [
      { name: 'Dashboard',        path: '/',               icon: 'HomeIcon',           roles: ['hr_admin', 'hr_recruiter', 'interviewer', 'applicant', 'hod'] },
      { name: 'Requisitions',     path: '/requisitions',   icon: 'DocumentPlusIcon',   roles: ['hr_admin', 'hr_recruiter', 'hod'] },
      { name: 'Jobs',             path: '/jobs',           icon: 'BriefcaseIcon',      roles: ['hr_admin', 'hr_recruiter'] },
      { name: 'Talent Pool',      path: '/talent-pool',    icon: 'UserGroupIcon',      roles: ['hr_admin', 'hr_recruiter'] },
      { name: 'Interview Hub',    path: '/interviews',     icon: 'VideoCameraIcon',    roles: ['hr_admin', 'hr_recruiter', 'interviewer', 'hod'] },
      { name: 'Document Queue',   path: '/hr/document-queue', icon: 'DocumentPlusIcon', roles: ['hr_admin', 'hr_recruiter'] },
      { name: 'My Portal',        path: '/candidate',      icon: 'UserGroupIcon',      roles: ['applicant'] },
      { name: 'Notifications',    path: '/notifications',  icon: 'BellIcon',           roles: ['hr_admin', 'hr_recruiter', 'interviewer', 'applicant', 'hod'] },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { name: 'Analytics Copilot', path: '/analytics-copilot', icon: 'SparklesIcon',  roles: ['hr_admin', 'hr_recruiter', 'hod'] },
      { name: 'MIS Reports',       path: '/mis',               icon: 'ChartPieIcon',  roles: ['hr_admin', 'hr_recruiter'] },
      { name: 'Audit Trail',       path: '/audit',             icon: 'ClockIcon',     roles: ['hr_admin'] },
    ],
  },
  {
    label: 'Configure',
    items: [
      { name: 'Masters',          path: '/masters', icon: 'Cog6ToothIcon', roles: ['hr_admin', 'hr_recruiter'] },
      { name: 'AOP',              path: '/aop',     icon: 'ChartBarIcon',  roles: ['hr_admin'] },
      { name: 'User Management',  path: '/users',   icon: 'UsersIcon',     roles: ['hr_admin'] },
    ],
  },
];

/* ── Inline SVG icons (stroke-current) ── */
function Icon({ name, className = 'w-[18px] h-[18px]' }) {
  const common = { className, fill: 'none', viewBox: '0 0 24 24', strokeWidth: 1.75, stroke: 'currentColor' };
  const p = (d) => <path strokeLinecap="round" strokeLinejoin="round" d={d} />;
  const icons = {
    HomeIcon: <svg {...common}>{p('M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25')}</svg>,
    BriefcaseIcon: <svg {...common}>{p('M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0')}</svg>,
    DocumentPlusIcon: <svg {...common}>{p('M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z')}</svg>,
    UserGroupIcon: <svg {...common}>{p('M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z')}</svg>,
    VideoCameraIcon: <svg {...common}>{p('M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z')}</svg>,
    BellIcon: <svg {...common}>{p('M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0')}</svg>,
    SparklesIcon: <svg {...common}>{p('M9.813 15.904L9 18l-.813-2.096a4.5 4.5 0 00-3.09-3.09L3.75 12l2.154-.813a4.5 4.5 0 003.09-3.09L9 6l.813 2.097a4.5 4.5 0 003.09 3.09L15.75 12l-2.154.813a4.5 4.5 0 00-3.09 3.09z')}</svg>,
    ChartPieIcon: <svg {...common}>{p('M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z')}{p('M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z')}</svg>,
    ClockIcon: <svg {...common}>{p('M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z')}</svg>,
    Cog6ToothIcon: <svg {...common}>{p('M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z')}{p('M15 12a3 3 0 11-6 0 3 3 0 016 0z')}</svg>,
    ChartBarIcon: <svg {...common}>{p('M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z')}</svg>,
    UsersIcon: <svg {...common}>{p('M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z')}</svg>,
    MagnifyingGlassIcon: <svg {...common}>{p('M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z')}</svg>,
    Bars3Icon: <svg {...common}>{p('M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5')}</svg>,
    XMarkIcon: <svg {...common}>{p('M6 18L18 6M6 6l12 12')}</svg>,
    LogoutIcon: <svg {...common}>{p('M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75')}</svg>,
    ChevronLeftIcon: <svg {...common}>{p('M15.75 19.5L8.25 12l7.5-7.5')}</svg>,
    ChevronRightIcon: <svg {...common}>{p('M8.25 4.5l7.5 7.5-7.5 7.5')}</svg>,
    ChevronDownIcon: <svg {...common}>{p('M19.5 8.25l-7.5 7.5-7.5-7.5')}</svg>,
    SearchIcon: <svg {...common}>{p('M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z')}</svg>,
    HelpIcon: <svg {...common}>{p('M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z')}</svg>,
  };
  return icons[name] || null;
}

function SidebarContent({ collapsed, onNavClick, unreadNotifications, filteredSections }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3">
      {filteredSections.map((section) => (
        <div key={section.label} className="mb-5">
          {!collapsed && (
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              {section.label}
            </p>
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={() => { haptic.light(); onNavClick?.(); }}
                className={({ isActive }) =>
                  `group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors
                  ${isActive
                    ? 'bg-white/[0.08] text-white'
                    : 'text-slate-300 hover:bg-white/[0.04] hover:text-white'
                  }
                  ${collapsed ? 'justify-center px-2' : ''}`
                }
                title={collapsed ? item.name : undefined}
              >
                {({ isActive }) => (
                  <>
                    {isActive && !collapsed && (
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-blue-400" />
                    )}
                    <Icon
                      name={item.icon}
                      className={`h-[17px] w-[17px] flex-shrink-0 ${isActive ? 'text-blue-300' : 'text-slate-400 group-hover:text-slate-200'}`}
                    />
                    {!collapsed && <span className="min-w-0 flex-1 break-words leading-tight">{item.name}</span>}
                    {!collapsed && item.name === 'Notifications' && unreadNotifications > 0 && (
                      <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {unreadNotifications > 99 ? '99+' : unreadNotifications}
                      </span>
                    )}
                    {collapsed && item.name === 'Notifications' && unreadNotifications > 0 && (
                      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-400" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function AppLayout() {
  const [collapsed, setCollapsed]        = useState(false);
  const [mobileOpen, setMobileOpen]      = useState(false);
  const [userMenuOpen, setUserMenuOpen]  = useState(false);
  const [unreadNotifications, setUnread] = useState(0);
  const { user, logout, hasRole }        = useAuth();
  const navigate                         = useNavigate();
  const location                         = useLocation();
  const mainRef                          = useRef(null);

  const filteredSections = useMemo(() =>
    navigationSections
      .map((s) => ({ ...s, items: s.items.filter((i) => i.roles.some((r) => hasRole(r))) }))
      .filter((s) => s.items.length > 0),
  [hasRole]);

  const currentNavItem = useMemo(() => {
    const all = filteredSections.flatMap((s) => s.items);
    return all.find((i) => (i.path === '/' ? location.pathname === '/' : location.pathname.startsWith(i.path)));
  }, [filteredSections, location.pathname]);

  const handleLogout = useCallback(() => {
    haptic.medium();
    logout();
    navigate('/login');
  }, [logout, navigate]);

  useEffect(() => { setMobileOpen(false); setUserMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname, location.search]);

  useEffect(() => {
    let cancelled = false;
    notificationsAPI.list({ page: 1, limit: 1 })
      .then((r) => { if (!cancelled) setUnread(Number(r.data?.unread || 0)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [location.pathname]);

  useEffect(() => {
    const onClick = () => setUserMenuOpen(false);
    if (userMenuOpen) document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [userMenuOpen]);

  const userInitial = (user?.name || user?.email || 'U').charAt(0).toUpperCase();
  const userName    = user?.name || user?.email?.split('@')[0] || '';
  const userRole    = (user?.role || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const userEmail   = user?.email || '';

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[var(--page-bg)]">

      {/* ── Desktop sidebar (dark navy, Workday-style) ── */}
      <aside
        className={`hidden md:flex ${collapsed ? 'w-[64px]' : 'w-[248px]'} flex-col flex-shrink-0 transition-[width] duration-200`}
        style={{ background: 'var(--sidebar-bg)', color: 'var(--sidebar-text)' }}
      >
        {/* Logo */}
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'px-4'} h-[60px] border-b border-white/5 flex-shrink-0`}>
          {collapsed ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-white">
              <span className="text-xs font-bold">PE</span>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600">
                <span className="text-xs font-bold text-white">PE</span>
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-tight text-white break-words">Premier Energies</p>
                <p className="text-[10px] leading-tight text-slate-400">Talent System</p>
              </div>
            </div>
          )}
        </div>

        <SidebarContent
          collapsed={collapsed}
          filteredSections={filteredSections}
          unreadNotifications={unreadNotifications}
        />

        {/* Collapse toggle */}
        <div className="border-t border-white/5 p-2">
          <button
            onClick={() => { haptic.light(); setCollapsed(!collapsed); }}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-200"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <Icon name={collapsed ? 'ChevronRightIcon' : 'ChevronLeftIcon'} className="h-3.5 w-3.5" />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ── Mobile sidebar ── */}
      {mobileOpen && (
        <>
          <div className="sidebar-overlay md:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="sidebar-mobile md:hidden w-[260px] flex flex-col" style={{ background: 'var(--sidebar-bg)', color: 'var(--sidebar-text)' }}>
            <div className="flex items-center justify-between h-[60px] px-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600">
                  <span className="text-xs font-bold text-white">PE</span>
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-white">Premier Energies</p>
                  <p className="text-[10px] text-slate-400">Talent System</p>
                </div>
              </div>
              <button onClick={() => setMobileOpen(false)} className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white">
                <Icon name="XMarkIcon" className="h-4 w-4" />
              </button>
            </div>
            <SidebarContent
              collapsed={false}
              filteredSections={filteredSections}
              unreadNotifications={unreadNotifications}
              onNavClick={() => setMobileOpen(false)}
            />
          </aside>
        </>
      )}

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-line bg-white px-4 sm:px-6" style={{ height: 'var(--topbar-height)' }}>
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              className="md:hidden rounded-md p-2 text-slate-500 hover:bg-slate-100"
              onClick={() => { haptic.light(); setMobileOpen(true); }}
              aria-label="Open menu"
            >
              <Icon name="Bars3Icon" className="h-5 w-5" />
            </button>
            {/* Search (enterprise command bar) */}
            <div className="relative hidden md:flex items-center max-w-md w-full">
              <Icon name="SearchIcon" className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
              <input
                type="search"
                placeholder="Search jobs, candidates, requisitions…"
                className="w-full rounded-md border border-line bg-slate-50 py-1.5 pl-9 pr-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100"
              />
            </div>
            <p className="md:hidden text-sm font-semibold text-navy-700">{currentNavItem?.name || 'ATS'}</p>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => { haptic.light(); navigate('/notifications'); }}
              className="relative rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100"
              title="Notifications"
            >
              <Icon name="BellIcon" className="h-[18px] w-[18px]" />
              {unreadNotifications > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              )}
            </button>
            <button
              className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100"
              title="Help"
            >
              <Icon name="HelpIcon" className="h-[18px] w-[18px]" />
            </button>

            <div className="mx-1 h-6 w-px bg-slate-200" />

            {/* User dropdown */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-slate-100"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-800 text-[11px] font-semibold text-white">
                  {userInitial}
                </div>
                <div className="hidden sm:block text-left leading-tight">
                  <p className="text-[12px] font-semibold text-slate-800">{userName}</p>
                  <p className="text-[10px] text-slate-500">{userRole}</p>
                </div>
                <Icon name="ChevronDownIcon" className="hidden sm:block h-3.5 w-3.5 text-slate-400" />
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-60 overflow-hidden rounded-lg border border-line bg-white shadow-lg z-50">
                  <div className="border-b border-line px-3 py-2.5">
                    <p className="text-sm font-semibold text-slate-800 break-words">{userName}</p>
                    <p className="text-xs text-slate-500 break-all">{userEmail}</p>
                    <span className="mt-1.5 inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-medium text-primary-700">
                      {userRole}
                    </span>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <Icon name="LogoutIcon" className="h-4 w-4 text-slate-500" />
                    <span>Sign out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main ref={mainRef} className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full px-4 sm:px-6 xl:px-8 py-5 sm:py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
