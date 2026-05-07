import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { authAPI } from '../services/api';
import toast from 'react-hot-toast';
import haptic from '../utils/haptic';

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
    <div className="min-h-screen bg-white text-slate-950">
      <header className="h-[67px] border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-full max-w-[1220px] items-center px-6">
          <img src="/l.png" alt="Premier Energies" className="h-12 w-12 object-contain" />
          <div className="ml-3">
            <p className="text-xl font-bold leading-6 text-slate-950">Premier Energies</p>
            <p className="mt-1 text-sm font-medium text-slate-600">Applicant Tracking System</p>
          </div>
        </div>
      </header>

      <main className="flex min-h-[calc(100vh-123px)] items-center justify-center bg-[#eaf2ff] px-5 py-12">
        <div className="w-full max-w-[446px] rounded-md border border-slate-200 bg-white px-6 py-6 shadow-[0_10px_24px_rgba(15,23,42,0.12)] sm:px-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
            {step === 1 ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.9} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 7.5v9A2.25 2.25 0 0 1 19.5 18.75h-15A2.25 2.25 0 0 1 2.25 16.5v-9m19.5 0A2.25 2.25 0 0 0 19.5 5.25h-15A2.25 2.25 0 0 0 2.25 7.5m19.5 0-8.69 5.303a2.25 2.25 0 0 1-2.12 0L2.25 7.5" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.9} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            )}
          </div>

          <div className="mt-5 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">
              {step === 1 ? 'User Login' : 'Verify OTP'}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {step === 1
                ? 'Enter your email to receive an OTP'
                : <>Enter the OTP sent to <span className="font-medium text-slate-900">{email}</span></>}
            </p>
          </div>

          {step === 1 ? (
            <form onSubmit={handleSendOTP} className="mt-8 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-950">Email Address</label>
                <input
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  placeholder="Enter your email"
                  autoComplete="email"
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email}
                className="flex h-10 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Sending OTP...' : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="mt-8 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-950">Verification Code</label>
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
                      className="h-11 rounded-md border border-slate-300 text-center text-lg font-semibold text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                    />
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => { setStep(1); setOtp(['', '', '', '', '', '']); haptic.light(); }}
                    className="font-medium text-slate-600 hover:text-slate-950"
                  >
                    Use another email
                  </button>
                  <button
                    type="button"
                    onClick={handleSendOTP}
                    disabled={loading}
                    className="font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                  >
                    Resend OTP
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || otp.some((d) => !d)}
                className="flex h-10 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Verifying...' : 'Verify and Continue'}
              </button>
            </form>
          )}
        </div>
      </main>

      <footer className="h-14 border-t border-slate-200 bg-white">
        <div className="mx-auto flex h-full max-w-[1220px] items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <img src="/l.png" alt="Premier Energies" className="h-8 w-8 object-contain" />
            <div>
              <p className="text-sm font-bold leading-4 text-slate-950">ATS</p>
              <p className="mt-0.5 text-xs text-slate-600">Applicant Tracking System</p>
            </div>
          </div>
          <p className="text-xs text-slate-600">© {new Date().getFullYear()} Premier Energies</p>
        </div>
      </footer>
    </div>
  );
}
