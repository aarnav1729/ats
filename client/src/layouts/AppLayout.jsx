import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { notificationsAPI } from '../services/api';

const navigationSections = [
  {
    label: 'Operate',
    items: [
      { name: 'Dashboard', path: '/', icon: 'HomeIcon', roles: ['hr_admin', 'hr_recruiter', 'interviewer', 'applicant', 'hod'] },
      { name: 'Requisitions', path: '/requisitions', icon: 'DocumentPlusIcon', roles: ['hr_admin', 'hr_recruiter', 'hod'] },
      { name: 'Jobs', path: '/jobs', icon: 'BriefcaseIcon', roles: ['hr_admin', 'hr_recruiter'] },
      { name: 'Talent Pool', path: '/talent-pool', icon: 'UserGroupIcon', roles: ['hr_admin', 'hr_recruiter'] },
      { name: 'Interview Hub', path: '/interviews', icon: 'VideoCameraIcon', roles: ['hr_admin', 'hr_recruiter', 'interviewer', 'hod'] },
      { name: 'My Tasks', path: '/my-tasks', icon: 'ClipboardDocumentListIcon', roles: ['hr_admin', 'applicant'] },
      { name: 'Notifications', path: '/notifications', icon: 'BellIcon', roles: ['hr_admin', 'hr_recruiter', 'interviewer', 'applicant', 'hod'] },
    ],
  },
  {
    label: 'Track',
    items: [
      { name: 'Analytics Copilot', path: '/analytics-copilot', icon: 'SparklesIcon', roles: ['hr_admin', 'hr_recruiter', 'hod'] },
      { name: 'MIS Reports', path: '/mis', icon: 'ChartPieIcon', roles: ['hr_admin', 'hr_recruiter'] },
      { name: 'Audit Trail', path: '/audit', icon: 'ClockIcon', roles: ['hr_admin'] },
    ],
  },
  {
    label: 'Configure',
    items: [
      { name: 'Masters', path: '/masters', icon: 'Cog6ToothIcon', roles: ['hr_admin', 'hr_recruiter'] },
      { name: 'AOP', path: '/aop', icon: 'ChartBarIcon', roles: ['hr_admin'] },
      { name: 'User Management', path: '/users', icon: 'UsersIcon', roles: ['hr_admin'] },
    ],
  },
];

// Inline SVG icons to avoid import issues - create a simple icon component
function Icon({ name, className = "w-5 h-5" }) {
  const icons = {
    HomeIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>,
    BriefcaseIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>,
    DocumentPlusIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>,
    UserGroupIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" /></svg>,
    VideoCameraIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>,
    ClipboardDocumentListIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" /></svg>,
    Cog6ToothIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    ChartBarIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>,
    ChartPieIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" /><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" /></svg>,
    SparklesIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18l-.813-2.096A4.5 4.5 0 0 0 5.904 13.5L3.75 12l2.154-1.5A4.5 4.5 0 0 0 8.187 8.096L9 6l.813 2.096A4.5 4.5 0 0 0 12.096 10.5L14.25 12l-2.154 1.5a4.5 4.5 0 0 0-2.283 2.404ZM18.259 8.715 18 9.75l-.259-1.035A2.25 2.25 0 0 0 16.035 7L15 6.75l1.035-.259A2.25 2.25 0 0 0 17.741 4.785L18 3.75l.259 1.035A2.25 2.25 0 0 0 19.965 6.49L21 6.75l-1.035.25a2.25 2.25 0 0 0-1.706 1.715ZM18 16.5l.202.81a2.25 2.25 0 0 0 1.488 1.49l.81.2-.81.203a2.25 2.25 0 0 0-1.49 1.488L18 21.5l-.202-.809a2.25 2.25 0 0 0-1.488-1.49l-.81-.201.81-.202a2.25 2.25 0 0 0 1.49-1.488L18 16.5Z" /></svg>,
    ClockIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    UsersIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>,
    BellIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /></svg>,
    ChevronLeftIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>,
    ChevronRightIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>,
    ArrowRightOnRectangleIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" /></svg>,
    MagnifyingGlassIcon: <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>,
  };
  return icons[name] || null;
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(true);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [ambient, setAmbient] = useState({ x: '12%', y: '10%' });
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const filteredSections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.roles.some((role) => hasRole(role))),
    }))
    .filter((section) => section.items.length > 0);

  const currentNavItem = useMemo(() => {
    const allItems = filteredSections.flatMap((section) => section.items);
    return allItems.find((item) => (
      item.path === '/'
        ? location.pathname === '/'
        : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)
    ));
  }, [filteredSections, location.pathname]);

  const currentSectionLabel = useMemo(() => (
    filteredSections.find((section) => section.items.some((item) => item.path === currentNavItem?.path))?.label || 'Workspace'
  ), [currentNavItem?.path, filteredSections]);

  const todayLabel = useMemo(() => (
    new Intl.DateTimeFormat('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date())
  ), []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  useEffect(() => {
    let cancelled = false;
    const loadUnread = async () => {
      try {
        const res = await notificationsAPI.list({ page: 1, limit: 8 });
        if (!cancelled) {
          setUnreadNotifications(Number(res.data?.unread || 0));
        }
      } catch {
        if (!cancelled) setUnreadNotifications(0);
      }
    };
    loadUnread();
    return () => { cancelled = true; };
  }, [location.pathname]);

  const shellStyle = useMemo(() => ({
    '--cursor-x': ambient.x,
    '--cursor-y': ambient.y,
  }), [ambient.x, ambient.y]);

  return (
    <div
      className="app-ambient flex h-screen overflow-hidden bg-gray-50"
      style={shellStyle}
      onMouseMove={(event) => {
        const x = `${Math.round((event.clientX / window.innerWidth) * 100)}%`;
        const y = `${Math.round((event.clientY / window.innerHeight) * 100)}%`;
        setAmbient({ x, y });
      }}
    >
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-[68px]' : 'w-[260px]'} relative z-10 flex flex-col overflow-hidden bg-[linear-gradient(180deg,#0c1527_0%,#111d35_45%,#0b1628_100%)] transition-all duration-300 ease-in-out flex-shrink-0`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.10),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(37,99,235,0.10),transparent_28%)]" />
        {/* Logo */}
        <div className={`relative flex items-center ${collapsed ? 'justify-center' : 'px-4'} h-14 border-b border-white/8`}>
          {!collapsed ? (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#2563eb] to-[#0891b2] flex items-center justify-center shadow-lg shadow-blue-950/30">
                <span className="text-white font-bold text-xs">PE</span>
              </div>
              <div>
                <h1 className="text-white font-semibold text-[13px] leading-tight tracking-[-0.01em]">Premier Energies</h1>
                <p className="text-gray-500 text-[9px] tracking-[0.2em] uppercase">Talent Platform</p>
              </div>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#2563eb] to-[#0891b2] flex items-center justify-center shadow-lg shadow-blue-950/30">
              <span className="text-white font-bold text-xs">PE</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="relative flex-1 overflow-y-auto py-3 px-2">
          {filteredSections.map((section) => (
            <div key={section.label} className="mb-4">
              {!collapsed && (
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-600">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 group relative
                      ${isActive
                        ? 'bg-white/10 text-white'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                      }
                      ${collapsed ? 'justify-center' : ''}`
                    }
                    title={collapsed ? item.name : undefined}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-cyan-400" />}
                        <Icon name={item.icon} className={`w-[18px] h-[18px] flex-shrink-0 ${isActive ? 'text-cyan-300' : ''}`} />
                        {!collapsed && (
                          <span className="truncate">{item.name}</span>
                        )}
                        {!collapsed && item.name === 'Notifications' && unreadNotifications > 0 && (
                          <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 py-0.5 text-[9px] font-bold text-white">
                            {unreadNotifications > 99 ? '99+' : unreadNotifications}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="relative border-t border-white/8 p-2">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-all text-xs"
          >
            <Icon name={collapsed ? 'ChevronRightIcon' : 'ChevronLeftIcon'} className="w-3.5 h-3.5" />
            {!collapsed && <span className="text-[11px] font-medium">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="relative z-10 flex-1 flex flex-col overflow-hidden">
        {/* Top header bar - Keka-style clean topbar */}
        <header className="border-b border-gray-200/80 bg-white flex items-center justify-between px-4 py-2.5 sm:px-6 xl:px-8 2xl:px-10 flex-shrink-0" style={{ minHeight: '56px' }}>
          <div className="flex min-w-0 items-center gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-gray-900">
                  {currentNavItem?.name || 'Premier Energies ATS'}
                </h2>
                <span className="hidden sm:inline-flex rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{currentSectionLabel}</span>
              </div>
              <p className="hidden sm:block text-xs text-gray-400 mt-0.5">{todayLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Global search */}
            <div className="relative hidden lg:block">
              <Icon name="MagnifyingGlassIcon" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                className="pl-9 pr-4 py-2 w-56 xl:w-72 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
              />
            </div>
            <button
              onClick={() => navigate('/notifications')}
              className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              title="Notifications"
            >
              <Icon name="BellIcon" className="w-5 h-5" />
              {unreadNotifications > 0 && (
                <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 py-0.5 text-[10px] font-bold text-white shadow-sm">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              )}
            </button>
            <div className="h-6 w-px bg-gray-200 mx-1" />
            <div className="flex items-center gap-2.5 cursor-default">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#2563eb] to-[#06b6d4] flex items-center justify-center shadow-sm">
                <span className="text-white text-xs font-bold">{user?.name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase()}</span>
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-semibold text-gray-800 leading-tight">{user?.name || user?.email?.split('@')[0]}</p>
                <p className="text-[11px] text-gray-400">{user?.role?.replace('_', ' ')?.replace(/\b\w/g, c => c.toUpperCase())}</p>
              </div>
              <button onClick={handleLogout} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors" title="Logout">
                <Icon name="ArrowRightOnRectangleIcon" className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 xl:px-7 2xl:px-10 xl:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
