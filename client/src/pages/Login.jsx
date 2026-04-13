import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { authAPI } from '../services/api';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState(1); // 1 = email, 2 = otp
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSendOTP = async (e) => {
    e.preventDefault();
    if (!email) return toast.error('Please enter your email');
    setLoading(true);
    try {
      await authAPI.login(email);
      toast.success('OTP sent to your email!');
      setStep(2);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    if (!otp || otp.length !== 6) return toast.error('Please enter the 6-digit OTP');
    setLoading(true);
    try {
      const res = await authAPI.verifyOTP(email, otp);
      login(res.data.token, res.data.user);
      toast.success('Welcome back!');
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a1f36] via-[#2d1b69] to-[#1a1f36] p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl"></div>
      </div>
      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 mb-4 shadow-lg shadow-indigo-200">
              <span className="text-white font-bold text-2xl">PE</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Premier Energies</h1>
            <p className="text-sm text-gray-500 mt-1 tracking-wide">Applicant Tracking System</p>
          </div>

          {step === 1 ? (
            <form onSubmit={handleSendOTP}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field text-base py-3"
                  placeholder="you@premierenergies.com"
                  autoFocus
                />
              </div>
              <button type="submit" disabled={loading} className="w-full btn-primary py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Sending OTP...
                  </span>
                ) : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP}>
              <div className="mb-2 text-center">
                <p className="text-sm text-gray-500">OTP sent to <span className="font-medium text-gray-700">{email}</span></p>
              </div>
              <div className="mb-6 mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Enter OTP</label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="input-field text-center text-2xl tracking-[0.5em] py-3 font-mono"
                  placeholder="------"
                  maxLength={6}
                  autoFocus
                />
              </div>
              <button type="submit" disabled={loading} className="w-full btn-primary py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Verifying...
                  </span>
                ) : 'Verify & Login'}
              </button>
              <button type="button" onClick={() => { setStep(1); setOtp(''); }} className="w-full mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                  &lt; Back to email
                </button>
            </form>
          )}

          <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-400">Powered by Premier Energies IT</p>
          </div>
        </div>
      </div>
    </div>
  );
}
