import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { applicationsAPI, jobsAPI } from '../services/api';
import toast from 'react-hot-toast';
import AppModal from '../components/AppModal';
import InfoTip from '../components/InfoTip';
import DataTable from '../components/DataTable';
import { PageHeader, StatCard, SectionCard, StatusPill, toneForStatus } from '../components/ui';

const STATUS_COLORS = {
  InQueue: 'bg-gray-100 text-gray-700', Applied: 'bg-blue-100 text-blue-700',
  Shortlisted: 'bg-indigo-100 text-indigo-700', Selected: 'bg-emerald-100 text-emerald-700',
  Offered: 'bg-teal-100 text-teal-700', Joined: 'bg-green-200 text-green-800',
  HRRejected: 'bg-red-100 text-red-700', Withdrawn: 'bg-gray-200 text-gray-600',
  Active: 'bg-emerald-100 text-emerald-700', Expired: 'bg-red-100 text-red-700',
};

const SOURCES = ['Direct', 'Referral', 'Job Portal', 'LinkedIn', 'Campus', 'Agency', 'Walk-in', 'Other'];

function ResumePreview({ url }) {
  if (!url) return <p className="text-sm text-gray-400 italic py-8 text-center">No resume uploaded</p>;
  const lower = url.toLowerCase();
  const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(lower);
  if (isImage) {
    return <img src={url} alt="Resume" className="max-w-full rounded-lg border border-gray-200 shadow-sm" />;
  }
  return (
    <iframe
      src={url}
      title="Resume preview"
      className="w-full rounded-lg border border-gray-200 shadow-sm"
      style={{ height: '600px' }}
    />
  );
}

function DetailRow({ label, value, children }) {
  const display = children || value;
  if (!display && display !== 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</span>
      <span className="text-sm text-gray-900">{display}</span>
    </div>
  );
}

function TimelineItem({ label, date, detail }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-indigo-400" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        {detail && <p className="text-xs text-gray-500">{detail}</p>}
        {date && <p className="text-xs text-gray-400 mt-0.5">{new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>}
      </div>
    </div>
  );
}

export default function TalentPool() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetJobId = searchParams.get('target_job_id');

  const [candidates, setCandidates] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [educationFilter, setEducationFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [expMin, setExpMin] = useState('');
  const [expMax, setExpMax] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');

  // Stats
  const [stats, setStats] = useState({ total: 0, expiringSoon: 0, aiSuggestions: 0, poolOnly: 0, linkedToJobs: 0 });

  // Modals
  const [showAddToJob, setShowAddToJob] = useState(null);
  const [showAIMatch, setShowAIMatch] = useState(null);
  const [aiMatches, setAiMatches] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [openJobs, setOpenJobs] = useState([]);
  const [targetJob, setTargetJob] = useState(null);

  // Candidate detail modal
  const [detailCandidate, setDetailCandidate] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await applicationsAPI.talentPool({
        page, limit: 20, search: search || undefined, source: sourceFilter || undefined,
        education: educationFilter || undefined, location: locationFilter || undefined,
        exp_min: expMin || undefined, exp_max: expMax || undefined,
        job_id: jobFilter || undefined,
        sort_by: sortBy, sort_order: sortOrder,
      });
      const data = res.data;
      const items = data?.data || data?.candidates || data?.applications || [];
      const totalCount = data?.pagination?.total || data?.total || items.length;
      setCandidates(items);
      setTotal(totalCount);
      const summary = data?.summary || {};
      setStats({
        total: totalCount,
        expiringSoon: Number(summary.expiring_soon_count || 0),
        aiSuggestions: data?.ai_suggestions_count || 0,
        poolOnly: Number(summary.pool_only_count || 0),
        linkedToJobs: Number(summary.linked_to_job_count || 0),
      });
    } catch (err) {
      toast.error('Failed to load talent pool');
    } finally {
      setLoading(false);
    }
  }, [page, search, sourceFilter, educationFilter, locationFilter, expMin, expMax, jobFilter, sortBy, sortOrder]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!targetJobId) {
      setTargetJob(null);
      return;
    }
    jobsAPI.get(targetJobId)
      .then((res) => setTargetJob(res.data || null))
      .catch(() => setTargetJob({ id: targetJobId, job_id: targetJobId }));
  }, [targetJobId]);

  const getExpiryDate = (candidate) => {
    if (!candidate?.talent_pool_only && !candidate?.pool_expires_at && !candidate?.talent_pool_expires_at) {
      return null;
    }
    if (candidate.pool_expires_at) return new Date(candidate.pool_expires_at);
    if (candidate.talent_pool_expires_at) return new Date(candidate.talent_pool_expires_at);
    if (candidate.expires_at) return new Date(candidate.expires_at);
    if (candidate.created_at) {
      const d = new Date(candidate.created_at);
      d.setMonth(d.getMonth() + 6);
      return d;
    }
    return null;
  };

  const isExpiringSoon = (candidate) => {
    const expiresAt = getExpiryDate(candidate);
    if (!expiresAt) return false;
    const daysLeft = (expiresAt.getTime() - Date.now()) / 86400000;
    return daysLeft > 0 && daysLeft <= 30;
  };

  const isExpired = (candidate) => {
    const expiresAt = getExpiryDate(candidate);
    return expiresAt && expiresAt.getTime() < Date.now();
  };

  const getLifespanLabel = (candidate) => {
    const expiresAt = getExpiryDate(candidate);
    if (!expiresAt) return '-';
    const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / 86400000);
    if (daysLeft <= 0) return 'Expired';
    if (daysLeft <= 30) return `${daysLeft}d left`;
    return `${Math.floor(daysLeft / 30)}mo left`;
  };

  const handleSort = (field) => {
    if (sortBy === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortOrder('asc'); }
  };

  const sortIcon = (field) => {
    if (sortBy !== field) return <span className="text-gray-300 ml-1">&#8597;</span>;
    return <span className="text-indigo-600 ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  const handleAddToJob = async (candidateId, jobId) => {
    try {
      await applicationsAPI.moveJob(candidateId, { target_job_id: jobId });
      toast.success(targetJobId ? 'Candidate imported into job' : 'Candidate added to job');
      setShowAddToJob(null);
      loadData();
    } catch { toast.error('Failed to add to job'); }
  };

  const handleAIMatch = async (candidate) => {
    setShowAIMatch(candidate);
    setAiLoading(true);
    setAiMatches([]);
    try {
      const res = await applicationsAPI.jobMatches(candidate.id);
      setAiMatches(res.data?.matches || res.data || []);
    } catch { toast.error('Failed to get AI match suggestions'); }
    finally { setAiLoading(false); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remove this candidate from the talent pool?')) return;
    try {
      await applicationsAPI.update(id, { status: 'Withdrawn', active_flag: false });
      toast.success('Candidate removed');
      setDetailCandidate(null);
      loadData();
    } catch { toast.error('Failed to remove candidate'); }
  };

  const handleBan = async (id) => {
    if (!confirm('Ban this candidate? They will be marked as rejected.')) return;
    try {
      await applicationsAPI.update(id, { status: 'HRRejected', active_flag: false, banned: true });
      toast.success('Candidate banned');
      setDetailCandidate(null);
      loadData();
    } catch { toast.error('Failed to ban candidate'); }
  };

  const handleKeepInPool = async (id) => {
    try {
      await applicationsAPI.update(id, { talent_pool_only: true, status: 'Active' });
      toast.success('Candidate kept in pool');
      loadData();
    } catch { toast.error('Failed to update candidate'); }
  };

  const loadOpenJobs = async () => {
    if (openJobs.length > 0) return;
    try {
      const res = await jobsAPI.list({ status: 'open', limit: 100 });
      setOpenJobs(res.data?.jobs || []);
    } catch { setOpenJobs([]); }
  };

  const openCandidateDetail = async (candidate) => {
    setDetailCandidate(candidate);
    setDetailLoading(true);
    try {
      const res = await applicationsAPI.get(candidate.id);
      setDetailCandidate(res.data || candidate);
    } catch {
      // keep the row-level data if full fetch fails
    } finally {
      setDetailLoading(false);
    }
  };

  const totalPages = Math.ceil(total / 20);

  const formatDate = (d) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatCurrency = (val) => {
    if (val == null || val === '') return null;
    const n = Number(val);
    if (isNaN(n)) return String(val);
    if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
    return String(n);
  };

  return (
    <div className="page-container">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Talent Pool' }]}
        title="Talent Pool"
        subtitle="Reusable candidate inventory with source lineage, linked-job context, and full profile views."
        meta={[{ label: `${stats.total} candidates` }]}
        actions={
          <>
            <InfoTip text="Open any row to review resumes, update data, or import into a job." />
            <button onClick={() => loadData()} className="btn-secondary">Refresh</button>
            {targetJobId && (
              <button onClick={() => navigate(`/jobs/${targetJobId}`)} className="btn-secondary">Back to Job</button>
            )}
            <button onClick={() => navigate('/talent-pool/add')} className="btn-primary">+ Add to Pool</button>
          </>
        }
      />

      {targetJobId && (
        <div style={{ border: '1px solid var(--info-hover)', background: 'var(--info-soft)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--info-text)' }}>Import into active job</p>
              <p style={{ fontSize: 13, color: 'var(--info-text)' }}>Click any candidate row, then use Import to attach them.</p>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--info-text)' }}>
              {targetJob?.job_title || targetJob?.job_id || targetJobId}
            </div>
          </div>
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="Total" value={stats.total} hint="All candidates in the pool." />
        <StatCard label="Linked to jobs" value={stats.linkedToJobs} deltaTone="info" hint="Currently attached to an open role." />
        <StatCard label="Pool only" value={stats.poolOnly} deltaTone="success" hint="Available for re-deployment to any job." />
        <StatCard label="Expiring soon" value={stats.expiringSoon} deltaTone="warning" hint="Pool lifespan ending within 30 days." />
      </div>

      <SectionCard title="Filter candidates" subtitle="Narrow by source, education, location, job, or experience range.">
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2.5">
          <input type="text" placeholder="Search name or email…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="input-field col-span-2" style={{ height: 36 }} />
          <select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(1); }} className="input-field" style={{ height: 36 }}>
            <option value="">All sources</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="text" placeholder="Education…" value={educationFilter} onChange={e => { setEducationFilter(e.target.value); setPage(1); }} className="input-field" style={{ height: 36 }} />
          <input type="text" placeholder="Location…" value={locationFilter} onChange={e => { setLocationFilter(e.target.value); setPage(1); }} className="input-field" style={{ height: 36 }} />
          <select value={jobFilter} onChange={e => { setJobFilter(e.target.value); setPage(1); }} className="input-field" style={{ height: 36 }}>
            <option value="">All jobs</option>
            {openJobs.map(j => <option key={j.job_id} value={j.job_id}>{j.job_id} - {j.job_title}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="number" placeholder="Exp min" value={expMin} onChange={e => { setExpMin(e.target.value); setPage(1); }} className="input-field w-1/2" min="0" style={{ height: 36 }} />
            <input type="number" placeholder="Exp max" value={expMax} onChange={e => { setExpMax(e.target.value); setPage(1); }} className="input-field w-1/2" min="0" style={{ height: 36 }} />
          </div>
        </div>
      </SectionCard>

      {/* Table */}
      <div className="animate-fade-in-up">
        {loading ? (
          <div className="workspace-card flex items-center justify-center py-14"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div></div>
        ) : (
          <DataTable
            title="Talent Pool Candidates"
            subtitle="Open any profile to review the resume, edit details, move to a job, or run AI matching. Filters, selection, export, and column controls are available directly in the table."
            collapsible
            data={candidates.map((candidate) => {
              const expiring = isExpiringSoon(candidate);
              const expired = isExpired(candidate);
              return {
                ...candidate,
                expiry_label: getLifespanLabel(candidate),
                expiry_state: expired ? 'Expired' : expiring ? 'Expiring Soon' : 'Active',
              };
            })}
            exportFileName="talent-pool"
            emptyMessage="No candidates in talent pool"
            onRowClick={(row) => navigate(`/talent-pool/${row.id}/edit`)}
            columns={[
              {
                key: 'candidate_name',
                label: 'Candidate',
                render: (row) => (
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{row.candidate_name}</p>
                    <p className="text-xs text-gray-500">{row.candidate_email}</p>
                  </div>
                ),
              },
              {
                key: 'candidate_years_of_experience',
                label: 'Experience',
                render: (row) => row.candidate_years_of_experience != null ? `${row.candidate_years_of_experience} yrs` : '-',
              },
              { key: 'current_location', label: 'Location' },
              { key: 'source', label: 'Source' },
              {
                key: 'recruiter_email',
                label: 'Recruiter',
                render: (row) => row.owning_recruiter_email || row.recruiter_email || '-',
              },
              {
                key: 'created_by',
                label: 'Added By',
                render: (row) => row.created_by || '-',
              },
              {
                key: 'pool_membership',
                label: 'Pool Status',
                render: (row) => (
                  <span className={`badge ${row.talent_pool_only ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                    {row.talent_pool_only ? 'Pool Only' : 'Linked to Job'}
                  </span>
                ),
              },
              {
                key: 'status',
                label: 'Application Status',
                render: (row) => (
                  <span className={`badge ${row.expiry_state === 'Expired' ? 'bg-red-100 text-red-700' : row.expiry_state === 'Expiring Soon' ? 'bg-amber-100 text-amber-700' : STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-700'}`}>
                    {row.expiry_state === 'Expired' ? 'Expired' : row.status || 'Active'}
                  </span>
                ),
              },
              { key: 'expiry_label', label: 'Pool Lifespan' },
              {
                key: 'actions',
                label: 'Actions',
                sortable: false,
                filterable: false,
                render: (row) => (
                  <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    <button onClick={() => openCandidateDetail(row)} className="btn-secondary !px-3 !py-2 !text-xs">Quick View</button>
                    {targetJobId ? (
                      <button onClick={() => handleAddToJob(row.id, targetJobId)} className="btn-secondary !px-3 !py-2 !text-xs">Import</button>
                    ) : (
                      <button
                        onClick={() => {
                          setShowAddToJob(row);
                          loadOpenJobs();
                        }}
                        className="btn-secondary !px-3 !py-2 !text-xs"
                      >
                        Move
                      </button>
                    )}
                    <button onClick={() => handleAIMatch(row)} className="btn-secondary !px-3 !py-2 !text-xs">AI Match</button>
                    <button onClick={() => navigate(`/talent-pool/${row.id}/edit`)} className="btn-secondary !px-3 !py-2 !text-xs">Edit</button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 animate-fade-in-up">
          <p className="text-sm text-gray-500">Showing {(page - 1) * 20 + 1}-{Math.min(page * 20, total)} of {total}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary text-sm py-1 disabled:opacity-50">Previous</button>
            <span className="text-sm text-gray-500 py-1">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-secondary text-sm py-1 disabled:opacity-50">Next</button>
          </div>
        </div>
      )}

      {/* ===================== Candidate Detail Modal ===================== */}
      {detailCandidate && (
        <AppModal
          open={!!detailCandidate}
          onClose={() => setDetailCandidate(null)}
          title={detailCandidate.candidate_name || 'Candidate'}
          subtitle={[detailCandidate.candidate_email, detailCandidate.candidate_phone].filter(Boolean).join('  |  ')}
          width="full"
          bodyClassName="p-0"
          footer={
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  setShowAddToJob(detailCandidate);
                  loadOpenJobs();
                }}
                className="btn-primary text-sm"
              >
                Move to Job
              </button>
              <button onClick={() => handleAIMatch(detailCandidate)} className="btn-secondary text-sm">
                AI Match
              </button>
              <button onClick={() => navigate(`/talent-pool/${detailCandidate.id}/edit`)} className="btn-secondary text-sm">
                Edit
              </button>
              <button onClick={() => handleKeepInPool(detailCandidate.id)} className="btn-secondary text-sm">
                Keep in Pool
              </button>
              <div className="flex-1" />
              <button onClick={() => handleBan(detailCandidate.id)} className="btn-secondary text-sm text-amber-700 border-amber-300 hover:bg-amber-50">
                Ban
              </button>
              <button onClick={() => handleDelete(detailCandidate.id)} className="btn-secondary text-sm text-red-600 border-red-300 hover:bg-red-50">
                Delete
              </button>
            </div>
          }
        >
          {detailLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
              {/* Left: Resume preview */}
              <div className="lg:col-span-2 p-6 bg-gray-50/50">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Resume</h4>
                <ResumePreview url={detailCandidate.resume_path || detailCandidate.resume_url} />
              </div>

              {/* Right: Details */}
              <div className="lg:col-span-3 p-6 overflow-y-auto" style={{ maxHeight: '80vh' }}>
                {/* Contact & basics */}
                <div className="space-y-6">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Contact</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <DetailRow label="Name" value={detailCandidate.candidate_name} />
                      <DetailRow label="Email" value={detailCandidate.candidate_email} />
                      <DetailRow label="Phone" value={detailCandidate.candidate_phone} />
                      <DetailRow label="Location" value={detailCandidate.current_location} />
                      <DetailRow label="Current Org" value={detailCandidate.current_organization} />
                      <DetailRow label="Source" value={detailCandidate.source} />
                    </div>
                  </div>

                  <hr className="border-gray-100" />

                  {/* Professional */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Professional</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <DetailRow label="Experience" value={detailCandidate.candidate_years_of_experience != null ? `${detailCandidate.candidate_years_of_experience} years` : null} />
                      <DetailRow label="Notice Period" value={detailCandidate.notice_period || detailCandidate.notice_period_days ? `${detailCandidate.notice_period || detailCandidate.notice_period_days} days` : null} />
                      <DetailRow label="Current CTC" value={formatCurrency(detailCandidate.current_ctc || detailCandidate.current_salary)} />
                      <DetailRow label="Expected CTC" value={formatCurrency(detailCandidate.expected_ctc || detailCandidate.expected_salary)} />
                      <DetailRow label="Designation" value={detailCandidate.current_designation || detailCandidate.designation} />
                      <DetailRow label="Department" value={detailCandidate.department || detailCandidate.department_name} />
                    </div>
                  </div>

                  <hr className="border-gray-100" />

                  {/* Education */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Education</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <DetailRow label="Level" value={detailCandidate.education_level} />
                      <DetailRow label="Degree" value={detailCandidate.education_other || detailCandidate.degree} />
                      <DetailRow label="Institution" value={detailCandidate.institution || detailCandidate.college_name} />
                      <DetailRow label="Specialization" value={detailCandidate.specialization} />
                      <DetailRow label="Year" value={detailCandidate.graduation_year || detailCandidate.passing_year} />
                    </div>
                    {detailCandidate.education_details && Array.isArray(detailCandidate.education_details) && (
                      <div className="mt-3 space-y-2">
                        {detailCandidate.education_details.map((edu, i) => (
                          <div key={i} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                            {edu.degree || edu.level}{edu.institution ? ` - ${edu.institution}` : ''}{edu.year ? ` (${edu.year})` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <hr className="border-gray-100" />

                  {/* Experience details */}
                  {detailCandidate.experience_details && Array.isArray(detailCandidate.experience_details) && detailCandidate.experience_details.length > 0 && (
                    <>
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Experience History</h4>
                        <div className="space-y-2">
                          {detailCandidate.experience_details.map((exp, i) => (
                            <div key={i} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                              <p className="font-medium">{exp.title || exp.designation}{exp.company ? ` at ${exp.company}` : ''}</p>
                              {(exp.start_date || exp.duration) && <p className="text-xs text-gray-500">{exp.start_date}{exp.end_date ? ` - ${exp.end_date}` : ''}{exp.duration ? ` (${exp.duration})` : ''}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                      <hr className="border-gray-100" />
                    </>
                  )}

                  {/* Skills */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Skills</h4>
                    {(detailCandidate.skills || detailCandidate.key_skills) ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(Array.isArray(detailCandidate.skills || detailCandidate.key_skills)
                          ? (detailCandidate.skills || detailCandidate.key_skills)
                          : String(detailCandidate.skills || detailCandidate.key_skills).split(',')
                        ).map((skill, i) => (
                          <span key={i} className="badge bg-indigo-50 text-indigo-700 text-xs">{typeof skill === 'string' ? skill.trim() : skill}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No skills listed</p>
                    )}
                  </div>

                  <hr className="border-gray-100" />

                  {/* Job Linkages */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Job Linkages</h4>
                    {detailCandidate.linked_jobs && Array.isArray(detailCandidate.linked_jobs) && detailCandidate.linked_jobs.length > 0 ? (
                      <div className="space-y-2">
                        {detailCandidate.linked_jobs.map((job, i) => (
                          <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{job.job_title || job.job_id}</p>
                              <p className="text-xs text-gray-500">{job.department || ''}{job.location ? ` - ${job.location}` : ''}</p>
                            </div>
                            {job.status && <span className={`badge ${STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-700'}`}>{job.status}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">
                        {!detailCandidate.talent_pool_only && (detailCandidate.linked_job_id || detailCandidate.ats_job_id) ? (
                          <div className="bg-gray-50 rounded-lg px-3 py-2">
                            <p className="font-medium text-gray-900">{detailCandidate.job_title || detailCandidate.linked_job_id || detailCandidate.ats_job_id}</p>
                          </div>
                        ) : (
                          <p className="text-gray-400">Not linked to any job</p>
                        )}
                      </div>
                    )}
                  </div>

                  <hr className="border-gray-100" />

                  {/* Status Timeline */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Timeline</h4>
                    <div className="space-y-3">
                      {detailCandidate.status_history && Array.isArray(detailCandidate.status_history) && detailCandidate.status_history.length > 0 ? (
                        detailCandidate.status_history.map((entry, i) => (
                          <TimelineItem
                            key={i}
                            label={entry.status || entry.action || 'Status change'}
                            date={entry.changed_at || entry.created_at || entry.date}
                            detail={entry.changed_by || entry.user || entry.note}
                          />
                        ))
                      ) : (
                        <>
                          {detailCandidate.created_at && (
                            <TimelineItem label="Added to pool" date={detailCandidate.created_at} detail={detailCandidate.created_by ? `by ${detailCandidate.created_by}` : undefined} />
                          )}
                          {detailCandidate.status && detailCandidate.status !== 'Active' && (
                            <TimelineItem label={`Status: ${detailCandidate.status}`} date={detailCandidate.updated_at} />
                          )}
                        </>
                      )}
                      {(() => {
                        const exp = getExpiryDate(detailCandidate);
                        if (!exp) return null;
                        const expired = exp.getTime() < Date.now();
                        return (
                          <TimelineItem
                            label={expired ? 'Pool membership expired' : 'Pool membership expires'}
                            date={exp.toISOString()}
                          />
                        );
                      })()}
                    </div>
                  </div>

                  {/* Meta */}
                  <hr className="border-gray-100" />
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Meta</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <DetailRow label="Added" value={formatDate(detailCandidate.created_at)} />
                      <DetailRow label="Added By" value={detailCandidate.created_by} />
                      <DetailRow label="Recruiter" value={detailCandidate.owning_recruiter_email || detailCandidate.recruiter_email} />
                      <DetailRow label="Application ID" value={detailCandidate.application_id || detailCandidate.id} />
                      <DetailRow label="Pool Membership">
                        <span className={`badge ${detailCandidate.talent_pool_only ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                          {detailCandidate.talent_pool_only ? 'Pool Only' : 'Linked to Job'}
                        </span>
                      </DetailRow>
                      <DetailRow label="Expires" value={getLifespanLabel(detailCandidate)} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </AppModal>
      )}

      {/* Add to Job Modal */}
      {showAddToJob && (
        <AppModal
          open={!!showAddToJob}
          onClose={() => setShowAddToJob(null)}
          title="Move to Job"
          subtitle={`Select an open job for ${showAddToJob.candidate_name}`}
          width="wide"
        >
          {openJobs.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No open jobs available</p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-2">
              {openJobs.map(j => (
                <button key={j.id} onClick={() => handleAddToJob(showAddToJob.id, j.id)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 border border-gray-200 text-sm transition-colors">
                  <p className="font-medium text-gray-900">{j.job_title || j.job_id}</p>
                  <p className="text-xs text-gray-500">{j.department_name || '-'} - {j.location_name || '-'} ({j.bu_name || '-'})</p>
                </button>
              ))}
            </div>
          )}
        </AppModal>
      )}

      {/* AI Match Modal */}
      {showAIMatch && (
        <AppModal
          open={!!showAIMatch}
          onClose={() => setShowAIMatch(null)}
          title="AI Match Suggestions"
          subtitle={`Best job matches for ${showAIMatch.candidate_name}`}
          width="wide"
        >
          {aiLoading ? (
            <div className="flex items-center justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div></div>
          ) : aiMatches.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No match suggestions available</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {aiMatches.map((match, idx) => (
                <div key={match.job_id || idx} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{match.job_title || `Job ${match.job_id}`}</p>
                      <p className="text-xs text-gray-500">{match.department || 'Unassigned department'}</p>
                    </div>
                    {match.score != null && (
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${match.score >= 80 ? 'bg-emerald-100 text-emerald-700' : match.score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>
                        {match.score}% match
                      </span>
                    )}
                  </div>
                  {match.reason && <p className="text-xs text-gray-500 mt-1">{match.reason}</p>}
                  <button onClick={() => { handleAddToJob(showAIMatch.id, match.job_id); setShowAIMatch(null); }} className="text-xs text-indigo-600 hover:text-indigo-800 mt-2">Add to this job</button>
                </div>
              ))}
            </div>
          )}
        </AppModal>
      )}
    </div>
  );
}
