import { useEffect, useState, useMemo } from 'react';
import { timelineAPI } from '../services/api';

/**
 * Timeline — universal event stream viewer for any entity.
 *
 * Props:
 *   entityType: 'requisition' | 'job' | 'application' | 'candidate'
 *   entityId:   string
 *   includeRelated: boolean (default true)
 *   maxHeight:  css value (default 'none')
 */
export default function Timeline({ entityType, entityId, includeRelated = true, maxHeight = 'none' }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPaused, setShowPaused] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!entityType || !entityId) return;
      try {
        setLoading(true);
        const res = await timelineAPI.forEntity(entityType, entityId, { include_related: includeRelated ? 1 : 0 });
        if (!cancelled) setEvents(res.data?.events || []);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [entityType, entityId, includeRelated]);

  const filtered = useMemo(
    () => (showPaused ? events : events.filter((e) => !e.hold_paused)),
    [events, showPaused]
  );

  const totals = useMemo(() => {
    const active = events.filter((e) => !e.hold_paused);
    const totalSecs = active.reduce((s, e) => s + Number(e.duration_since_prev_seconds || 0), 0);
    const pausedSecs = events.filter((e) => e.hold_paused).reduce((s, e) => s + Number(e.duration_since_prev_seconds || 0), 0);
    return {
      eventCount: events.length,
      activeDays: +(totalSecs / 86400).toFixed(2),
      pausedDays: +(pausedSecs / 86400).toFixed(2),
    };
  }, [events]);

  if (loading) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--text-faint)' }}>Loading timeline…</div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 12, fontSize: 13, color: 'var(--danger-text)' }}>Could not load timeline: {error}</div>
    );
  }
  if (events.length === 0) {
    return (
      <div
        style={{
          padding: 20,
          border: '1px dashed var(--line-strong)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-muted)',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>No events recorded yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-3"
        style={{
          marginBottom: 14,
          padding: '10px 14px',
          background: 'var(--surface-muted)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          fontSize: 12,
          color: 'var(--text-body)',
        }}
      >
        <span><strong style={{ color: 'var(--text-main)' }}>{totals.eventCount}</strong> events</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span><strong style={{ color: 'var(--success-text)' }}>{totals.activeDays}d</strong> active TAT</span>
        {totals.pausedDays > 0 && (
          <>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span><strong style={{ color: 'var(--warning-text)' }}>{totals.pausedDays}d</strong> on hold</span>
          </>
        )}
        <label style={{ marginLeft: 'auto', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={showPaused} onChange={(e) => setShowPaused(e.target.checked)} />
          Show hold-paused events
        </label>
      </div>

      <div
        style={{
          position: 'relative',
          paddingLeft: 24,
          maxHeight,
          overflowY: maxHeight !== 'none' ? 'auto' : 'visible',
        }}
      >
        {/* vertical rail */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 7,
            top: 4,
            bottom: 4,
            width: 2,
            background: 'var(--line)',
          }}
        />
        {filtered.map((ev, idx) => {
          const dur = Number(ev.duration_since_prev_seconds || 0);
          const durDays = dur ? (dur / 86400).toFixed(2) : null;
          const dotColor = ev.hold_paused
            ? 'var(--warning-text)'
            : /rejected|declined|fail/i.test(ev.event_type)
              ? 'var(--danger-text)'
              : /accepted|approved|cleared|joined|released/i.test(ev.event_type)
                ? 'var(--success-text)'
                : 'var(--accent-blue)';
          const isOpen = expandedId === ev.id;
          return (
            <div key={ev.id} style={{ position: 'relative', paddingBottom: 16 }}>
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  left: -23,
                  top: 6,
                  width: 14, height: 14, borderRadius: '50%',
                  background: 'var(--surface)',
                  border: `2px solid ${dotColor}`,
                  boxShadow: '0 0 0 3px var(--surface)',
                }}
              />
              <div
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-md)',
                  background: ev.hold_paused ? 'var(--surface-muted)' : 'var(--surface)',
                  padding: '10px 14px',
                  boxShadow: isOpen ? 'var(--shadow-sm)' : 'none',
                  transition: 'box-shadow 0.15s',
                }}
              >
                <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {ev.entity_type}
                  </span>
                  <span>·</span>
                  <code style={{ fontSize: 11, background: 'var(--surface-muted)', padding: '1px 6px', borderRadius: 4, color: 'var(--text-body)' }}>
                    {ev.event_type}
                  </code>
                  {ev.stage && <span style={{ fontSize: 11, background: 'var(--accent-blue-soft)', color: 'var(--accent-blue)', padding: '1px 8px', borderRadius: 10, fontWeight: 500 }}>{ev.stage}</span>}
                  <span style={{ marginLeft: 'auto' }}>{new Date(ev.occurred_at).toLocaleString()}</span>
                </div>
                <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-main)', lineHeight: 1.55, wordBreak: 'break-word' }}>
                  {ev.summary || `${ev.event_type} by ${ev.actor_email || 'system'}`}
                </p>
                <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}>
                  {ev.actor_email && <span>by <strong style={{ color: 'var(--text-body)' }}>{ev.actor_email}</strong>{ev.actor_role ? ` (${ev.actor_role})` : ''}</span>}
                  {(ev.from_state || ev.to_state) && (
                    <span>
                      {ev.from_state || '—'} → <strong style={{ color: 'var(--text-body)' }}>{ev.to_state || '—'}</strong>
                    </span>
                  )}
                  {durDays && idx > 0 && (
                    <span style={{ color: ev.hold_paused ? 'var(--warning-text)' : 'var(--text-body)' }}>
                      +{durDays}d since previous{ev.hold_paused ? ' (on hold)' : ''}
                    </span>
                  )}
                  {ev.payload && Object.keys(ev.payload || {}).length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : ev.id)}
                      style={{
                        marginLeft: 'auto',
                        fontSize: 11,
                        color: 'var(--accent-blue)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      {isOpen ? 'Hide details' : 'Show details'}
                    </button>
                  )}
                </div>
                {isOpen && (
                  <pre style={{ margin: '8px 0 0', padding: 10, background: 'var(--surface-muted)', borderRadius: 6, fontSize: 11.5, lineHeight: 1.55, overflow: 'auto', color: 'var(--text-body)' }}>
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
