import { useEffect, useMemo, useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { misAPI } from '../services/api';
import InfoTip from '../components/InfoTip';

const STARTER_QUESTIONS = [
  'What are the biggest bottlenecks in our hiring funnel right now?',
  'Which recruiter is closing best and which one needs support?',
  'Which sourcing channels are turning into joins most efficiently?',
  'Which departments have the highest active hiring pressure?',
];

function compactNumber(value) {
  return new Intl.NumberFormat('en-IN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

/* ---- Typing dots animation ---- */
function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-sky-500 text-[10px] font-bold text-white shadow-sm">
        PE
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

/* ---- Render findings with light markdown (bold numbers, bullets) ---- */
function renderFinding(text) {
  // Bold numbers like **123** or standalone numbers at start
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <span key={i} className="font-semibold text-gray-900">
          {part.slice(2, -2)}
        </span>
      );
    }
    return part;
  });
}

/* ---- Chat message bubble ---- */
function ChatMessage({ message, onFollowUp }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 animate-fade-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      {isUser ? (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-900 text-[11px] font-bold text-white shadow-sm">
          Y
        </div>
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-sky-500 text-[10px] font-bold text-white shadow-sm">
          PE
        </div>
      )}

      {/* Bubble */}
      <div
        className={`max-w-[85%] ${
          isUser
            ? 'rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-3 text-sm leading-7 text-white'
            : 'rounded-2xl rounded-tl-sm bg-gray-100 px-4 py-3'
        }`}
      >
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">
                ATS Copilot
              </p>
              {message.confidenceNote && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  Local fallback
                </span>
              )}
            </div>
            <p className="mt-2 text-sm leading-7 text-gray-800">{message.content}</p>

            {/* Key findings */}
            {message.findings?.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {message.findings.map((finding, fi) => (
                  <li key={fi} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span className="leading-6">{renderFinding(finding)}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Follow-up chips */}
            {message.followUps?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {message.followUps.map((followUp) => (
                  <button
                    key={followUp}
                    type="button"
                    onClick={() => onFollowUp(followUp)}
                    className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-50"
                  >
                    {followUp}
                  </button>
                ))}
              </div>
            )}

            {message.confidenceNote && (
              <p className="mt-2 text-[11px] text-amber-600">{message.confidenceNote}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---- Collapsible sidebar section ---- */
function SidebarSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 hover:text-gray-700"
      >
        {title}
        <svg
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 pb-3">{children}</div>
      </div>
    </div>
  );
}

export default function AnalyticsCopilot() {
  const [dashboard, setDashboard] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Ask about requisitions, jobs, applicants, recruiters, sources, funnel movement, offers, joins, or hiring risk. Answers stay grounded in this ATS dataset and surface the operating evidence behind them.',
      findings: [],
      followUps: STARTER_QUESTIONS.slice(0, 3),
      confidenceNote: null,
    },
  ]);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  /* Auto-scroll on new messages or typing state change */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, submitting]);

  useEffect(() => {
    const load = async () => {
      try {
        const [dashRes, seedRes] = await Promise.all([
          misAPI.dashboard().catch(() => ({ data: null })),
          misAPI.assistant({ question: '', history: [] }).catch(() => ({ data: null })),
        ]);
        setDashboard(dashRes.data || null);
        setAiStatus(seedRes.data?.ai_status || dashRes.data?.ai_status || null);
        if (seedRes.data?.snapshot) {
          setSnapshot(seedRes.data.snapshot);
        }
      } catch {
        toast.error('Failed to load analytics overview');
      }
    };
    load();
  }, []);

  const headline = useMemo(() => {
    const liveSnapshot = snapshot?.headline;
    if (liveSnapshot) return liveSnapshot;
    if (!dashboard) return {};
    return {
      open_jobs: dashboard.open_jobs,
      active_candidates:
        Number(dashboard.total_applications || 0) - Number(dashboard.joined_this_month || 0),
      offers_in_flight: dashboard.offers_made,
      joined_candidates: dashboard.joined_this_month,
    };
  }, [dashboard, snapshot]);

  const visibleFunnel = useMemo(() => {
    const rows = Array.isArray(snapshot?.funnel) ? snapshot.funnel : [];
    const max = Math.max(...rows.map((row) => Number(row.count || 0)), 1);
    return rows.slice(0, 6).map((row) => ({
      ...row,
      width: `${Math.max(12, Math.round((Number(row.count || 0) / max) * 100))}%`,
    }));
  }, [snapshot]);

  const topRecruiters = useMemo(() => (snapshot?.recruiter_momentum || []).slice(0, 5), [snapshot]);
  const topSources = useMemo(() => (snapshot?.source_mix || []).slice(0, 5), [snapshot]);
  const departmentHealth = useMemo(
    () => (snapshot?.department_health || []).slice(0, 5),
    [snapshot],
  );

  const askQuestion = async (promptText) => {
    const trimmed = String(promptText || question).trim();
    if (!trimmed) return;

    const nextMessages = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setQuestion('');
    setSubmitting(true);
    try {
      const res = await misAPI.assistant({
        question: trimmed,
        history: nextMessages.slice(-8).map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
      const data = res.data || {};
      setSnapshot(data.snapshot || null);
      setAiStatus(data.ai_status || aiStatus);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer || 'I could not produce an answer from the current ATS snapshot.',
          findings: data.key_findings || [],
          followUps: data.suggested_follow_ups || [],
          confidenceNote: data.confidence_note || null,
        },
      ]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to get an analytics answer');
      setMessages((prev) => prev.slice(0, -1));
      setQuestion(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askQuestion(question);
    }
  };

  const stats = [
    { label: 'Open Jobs', value: compactNumber(headline.open_jobs), tone: 'indigo' },
    { label: 'Active Candidates', value: compactNumber(headline.active_candidates), tone: 'sky' },
    { label: 'Offers In Flight', value: compactNumber(headline.offers_in_flight), tone: 'amber' },
    { label: 'Recent Joins', value: compactNumber(headline.joined_candidates), tone: 'emerald' },
  ];

  const toneColors = {
    indigo: 'border-indigo-100 bg-indigo-50/60 text-indigo-700',
    sky: 'border-sky-100 bg-sky-50/60 text-sky-700',
    amber: 'border-amber-100 bg-amber-50/60 text-amber-700',
    emerald: 'border-emerald-100 bg-emerald-50/60 text-emerald-700',
  };

  return (
    <div className="workspace-shell">
      {/* Compact header */}
      <section className="aurora-panel">
        <div className="aurora-content">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200">
              Analytics Copilot
            </p>
            <InfoTip text="Ask plain-language questions grounded in live ATS data: funnel shape, recruiter load, source quality, offer conversion, and join risk." />
            <span className={`glass-chip border-white/15 ${aiStatus?.available ? 'bg-emerald-400/12 text-emerald-100' : 'bg-amber-400/12 text-amber-100'}`}>
              {aiStatus?.available
                ? `Local model live · ${aiStatus.model || 'Ollama'}`
                : `Fallback mode · ${aiStatus?.model || 'Ollama unavailable'}`}
            </span>
          </div>
          <h1 className="mt-2 font-['Fraunces'] text-[2.4rem] leading-[1] tracking-[-0.04em] text-white">
            ATS Intelligence
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/74">
            Ask for trends, anomalies, recruiter performance, candidate movement, sourcing mix, workload concentration, or stage leakage. This workspace is designed for operational review, not generic chatbot chatter.
          </p>
          {!aiStatus?.available && (
            <div className="mt-4 rounded-[24px] border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
              Ollama is currently unreachable from the server, so Copilot is answering from the grounded ATS fallback path. Runtime status is exposed from the server AI service through MIS and Copilot.
            </div>
          )}

          {/* Horizontal stat cards */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur-sm"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/80">
                  {s.label}
                </p>
                <p className="mt-0.5 text-xl font-semibold tracking-[-0.03em] text-white">
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            {[
              {
                title: 'Spot bottlenecks',
                prompts: [
                  'Where is the funnel slowing down most right now?',
                  'Which department has the slowest time to fill?',
                ],
              },
              {
                title: 'Coach recruiters',
                prompts: [
                  'Which recruiter is overloaded relative to closures?',
                  'Who should HR admin support this week and why?',
                ],
              },
              {
                title: 'Improve sourcing',
                prompts: [
                  'Which source is producing offers but not joins?',
                  'Which source is strongest for manufacturing roles?',
                ],
              },
            ].map((section) => (
              <div key={section.title} className="signal-card">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/80">{section.title}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {section.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => askQuestion(prompt)}
                      className="rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-semibold text-white/88 transition-colors hover:bg-white/14"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Main layout: chat + collapsible sidebar */}
      <div className="flex gap-4">
        {/* Chat area */}
        <section
          className={`workspace-card flex flex-col transition-all duration-300 ${
            sidebarOpen ? 'flex-1 min-w-0' : 'w-full'
          }`}
          style={{ minHeight: '60vh' }}
        >
          {/* Chat header with sidebar toggle */}
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">Analyst Conversation</p>
              <InfoTip text="Each answer is grounded in live ATS aggregates: recruiters, sources, requisitions, jobs, stages, offer events, and candidate signals." />
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              {sidebarOpen ? 'Hide evidence' : 'Show evidence'}
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto py-4 space-y-4" style={{ maxHeight: '55vh' }}>
            {messages.map((message, index) => (
              <ChatMessage
                key={`${message.role}-${index}`}
                message={message}
                onFollowUp={askQuestion}
              />
            ))}
            {submitting && <TypingIndicator />}
            <div ref={chatEndRef} />
          </div>

          {/* Suggestion chips */}
          {messages.length <= 2 && (
            <div className="flex flex-wrap gap-1.5 pb-2">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => askQuestion(q)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input area */}
          <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-gray-50/80 p-2 transition-colors focus-within:border-indigo-300 focus-within:bg-white">
            <textarea
              ref={inputRef}
              rows={1}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
              placeholder="Ask a business question about ATS performance, recruiter load, funnel movement, source quality, or offer conversion..."
              style={{ maxHeight: '120px' }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
            />
            <button
              type="button"
              onClick={() => askQuestion(question)}
              disabled={submitting || !question.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm transition-all hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600"
              aria-label="Send"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </section>

        {/* Collapsible sidebar */}
        <aside
          className={`shrink-0 overflow-hidden transition-all duration-300 ${
            sidebarOpen ? 'w-72 opacity-100' : 'w-0 opacity-0'
          }`}
        >
          <div className="w-72 rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Evidence Board</p>
              <p className="mt-1 text-sm text-gray-600">Live ATS snapshot supporting the current answers.</p>
            </div>
            {/* Funnel */}
            <SidebarSection title="Funnel shape">
              {visibleFunnel.length > 0 ? (
                <div className="space-y-2">
                  {visibleFunnel.map((row) => (
                    <div key={row.stage}>
                      <div className="flex items-center justify-between text-xs text-gray-600">
                        <span className="truncate">{row.stage}</span>
                        <span className="font-semibold text-gray-800">{row.count}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                        <div
                          className="h-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 transition-all duration-500"
                          style={{ width: row.width }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Loads after first question</p>
              )}
            </SidebarSection>

            {/* Recruiters */}
            <SidebarSection title="Recruiter momentum" defaultOpen={false}>
              {topRecruiters.length > 0 ? (
                <div className="space-y-1.5">
                  {topRecruiters.map((row) => (
                    <div key={row.recruiter} className="flex items-center justify-between text-xs">
                      <span className="truncate text-gray-600">{row.recruiter}</span>
                      <span className="shrink-0 font-semibold text-gray-800">
                        {row.closures} joins
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Loads after first question</p>
              )}
            </SidebarSection>

            {/* Sources */}
            <SidebarSection title="Source quality" defaultOpen={false}>
              {topSources.length > 0 ? (
                <div className="space-y-1.5">
                  {topSources.map((row) => (
                    <div key={row.source} className="flex items-center justify-between text-xs">
                      <span className="truncate text-gray-600">{row.source}</span>
                      <span className="shrink-0 font-semibold text-gray-800">
                        {row.joins} joins
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Loads after first question</p>
              )}
            </SidebarSection>

            {/* Departments */}
            <SidebarSection title="Department pressure" defaultOpen={false}>
              {departmentHealth.length > 0 ? (
                <div className="space-y-1.5">
                  {departmentHealth.map((row) => (
                    <div key={row.department} className="flex items-center justify-between text-xs">
                      <span className="truncate text-gray-600">{row.department}</span>
                      <span className="shrink-0 font-semibold text-gray-800">
                        {row.open_count} open
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Loads after first question</p>
              )}
            </SidebarSection>

            {/* Summary */}
            <SidebarSection title="At a glance" defaultOpen={false}>
              <div className="space-y-1.5">
                {stats.map((s) => (
                  <div key={s.label} className={`rounded-lg border px-2.5 py-1.5 ${toneColors[s.tone]}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.15em] opacity-70">
                      {s.label}
                    </p>
                    <p className="text-lg font-semibold tracking-[-0.03em]">{s.value}</p>
                  </div>
                ))}
              </div>
            </SidebarSection>
          </div>
        </aside>
      </div>

      {/* Inline styles for fade-in animation */}
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out both;
        }
      `}</style>
    </div>
  );
}
