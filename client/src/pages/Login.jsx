import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { authAPI } from '../services/api';
import toast from 'react-hot-toast';
import haptic from '../utils/haptic';

const FEATURES = [
  { title: 'Demand and approvals', desc: 'Raise requisitions, route decisions, and keep ownership clear across business units.' },
  { title: 'Interview operations', desc: 'Coordinate panels, scheduling, and feedback without switching between trackers.' },
  { title: 'Offers and reporting', desc: 'Monitor conversion, joins, and aging signals from the same hiring workspace.' },
];

const TRUST_POINTS = [
  'Passwordless access for internal users',
  'One-time code expires in 5 minutes',
  'Purpose-built for enterprise hiring operations',
];

export default function Login() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();
  const otpRefs = useRef([]);
  const emailRef = useRef(null);

  useEffect(() => { if (step === 1) emailRef.current?.focus(); }, [step]);

  const handleSendOTP = async (e) => {
    e.preventDefault();
    if (!email) return toast.error('Enter your email');
    haptic.medium();
    setLoading(true);
    try {
      await authAPI.login(email);
      haptic.success();
      toast.success('Code sent. Check your inbox.');
      setStep(2);
      setTimeout(() => otpRefs.current[0]?.focus(), 80);
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Failed to send code');
    } finally { setLoading(false); }
  };

  const handleOtpChange = (index, value) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
    if (digit && index === 5 && next.every(Boolean)) handleVerifyOTP(null, next.join(''));
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
    if (e.key === 'ArrowLeft' && index > 0) otpRefs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpPaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(''));
      otpRefs.current[5]?.focus();
      setTimeout(() => handleVerifyOTP(null, pasted), 80);
    }
  };

  const handleVerifyOTP = async (e, directOtp) => {
    if (e) e.preventDefault();
    const code = directOtp || otp.join('');
    if (code.length !== 6) return toast.error('Enter the 6-digit code');
    haptic.medium();
    setLoading(true);
    try {
      const res = await authAPI.verifyOTP(email, code);
      haptic.success();
      login(res.data.token, res.data.user);
      toast.success(`Welcome, ${res.data.user?.name || 'there'}`);
      navigate('/');
    } catch (err) {
      haptic.error();
      toast.error(err.response?.data?.error || 'Invalid or expired code');
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpRefs.current[0]?.focus(), 60);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[var(--page-bg)]">
      <div className="grid min-h-screen w-full lg:grid-cols-[1.1fr,0.9fr]">
        {/* Brand panel */}
        <section className="relative hidden overflow-hidden bg-navy-800 text-white lg:flex lg:flex-col lg:justify-between px-12 py-12 xl:px-16">
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
          <div className="absolute -top-32 -right-20 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />

          <div className="relative z-10 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-600">
              <span className="text-xs font-bold text-white">PE</span>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Premier Energies</p>
              <p className="text-sm font-semibold text-white">Talent Operations Suite</p>
            </div>
          </div>

          <div className="relative z-10 max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Secure Access</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-white xl:text-5xl">
              Secure access to Premier Energies Talent Operations.
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-300">
              Use your work email to open requisitions, jobs, interviews, offers, and reporting in one protected workspace.
            </p>

            <div className="mt-10 space-y-3">
              {FEATURES.map((feature, idx) => (
                <div key={feature.title} className={`flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-4 animate-fade-in-up stagger-${idx + 1}`}>
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-500/20 text-blue-300">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{feature.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 flex items-center gap-3 text-xs text-slate-400">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
            <span>OTP sign-in only</span>
            <span className="mx-2 text-slate-600">•</span>
            <span>Internal workspace for Premier Energies employees</span>
          </div>
        </section>

        {/* Form panel */}
        <section className="relative flex items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-[440px]">
            <div className="mb-8 lg:hidden flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-navy-800">
                <span className="text-xs font-bold text-white">PE</span>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Premier Energies</p>
                <p className="text-sm font-semibold text-slate-900">Talent Operations Suite</p>
              </div>
            </div>

            <div className="rounded-xl border border-line bg-white shadow-sm">
              <div className="border-b border-line px-6 py-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {step === 1 ? 'Sign in' : 'Verify code'}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                      {step === 1 ? 'Access the hiring workspace' : 'Confirm your access code'}
                    </h2>
                    <p className="mt-1.5 text-sm text-slate-500">
                      {step === 1
                        ? 'We\'ll email you a one-time code for secure access.'
                        : <>Code sent to <span className="font-medium text-slate-900">{email}</span></>}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full border border-line bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                    Step {step} of 2
                  </span>
                </div>
              </div>

              <div className="px-6 py-6">
                {step === 1 ? (
                  <form onSubmit={handleSendOTP} className="animate-fade-in-up space-y-4">
                    <div>
                      <label className="input-label">Work email</label>
                      <input
                        ref={emailRef}
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="input-field"
                        placeholder="you@premierenergies.com"
                        autoComplete="email"
                        disabled={loading}
                      />
                      <p className="input-help">Use your Premier Energies work email.</p>
                    </div>

                    <button type="submit" disabled={loading || !email} className="btn-primary btn-lg w-full">
                      {loading ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Sending code…
                        </>
                      ) : 'Send verification code'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleVerifyOTP} className="animate-fade-in-up space-y-5">
                    <button
                      type="button"
                      onClick={() => { setStep(1); setOtp(['', '', '', '', '', '']); haptic.light(); }}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                      </svg>
                      Use another email
                    </button>

                    <div>
                      <label className="input-label">Verification code</label>
                      <div className="grid grid-cols-6 gap-2" onPaste={handleOtpPaste}>
                        {otp.map((digit, index) => (
                          <input
                            key={index}
                            ref={(el) => { otpRefs.current[index] = el; }}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={digit}
                            onChange={(e) => handleOtpChange(index, e.target.value)}
                            onKeyDown={(e) => handleOtpKeyDown(index, e)}
                            disabled={loading}
                            className={`h-12 rounded-md border text-center text-lg font-semibold outline-none transition-all ${
                              digit
                                ? 'border-primary-500 bg-primary-50 text-navy-800'
                                : 'border-line-strong bg-white text-slate-900 focus:border-primary-500 focus:shadow-[0_0_0_3px_rgba(37,99,235,0.2)]'
                            } disabled:opacity-50`}
                          />
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500">Code expires in 5 minutes.</span>
                        <button
                          type="button"
                          onClick={handleSendOTP}
                          disabled={loading}
                          className="font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50"
                        >
                          Resend code
                        </button>
                      </div>
                    </div>

                    <button type="submit" disabled={loading || otp.some((d) => !d)} className="btn-primary btn-lg w-full">
                      {loading ? (
                        <>
                          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Verifying…
                        </>
                      ) : 'Verify and continue'}
                    </button>
                  </form>
                )}
              </div>

              <div className="border-t border-line bg-surface-muted px-6 py-4 space-y-2">
                {TRUST_POINTS.map((point) => (
                  <div key={point} className="flex items-start gap-2 text-xs text-slate-600">
                    <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="mt-6 text-center text-xs text-slate-500">
              © {new Date().getFullYear()} Premier Energies Limited - Talent Operations
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
