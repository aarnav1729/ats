// Candidate-facing offer letter view + digital signature flow.
// Loads the active offer, lets the candidate preview the PDF, sign on canvas,
// optionally reject with notes.

import { useEffect, useState } from 'react';
import { offersAPI } from '../services/api';
import SignaturePad from './SignaturePad';
import { fmtIST } from './ui/v2';
import toast from 'react-hot-toast';

export default function OfferSignaturePanel() {
  const [offer, setOffer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sig, setSig] = useState(null);
  const [decision, setDecision] = useState('accepted');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await offersAPI.myCurrent();
      setOffer(r.data.offer);
    } catch { setOffer(null); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return null;
  if (!offer) return null;

  const expired = offer.expires_at && new Date(offer.expires_at).getTime() < Date.now();
  const alreadyDecided = !!offer.decision_at;

  const submit = async () => {
    if (decision === 'accepted' && !sig) return toast.error('Please sign first');
    setBusy(true);
    try {
      await offersAPI.mySign({ signature_data: sig, decision, decision_notes: notes });
      toast.success(decision === 'accepted' ? 'Offer accepted. Welcome aboard.' : 'Response recorded.');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Submit failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm v2-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Offer Letter</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">{offer.file_name}</h2>
          <p className="mt-1 text-xs text-slate-500">
            Uploaded {fmtIST(offer.uploaded_at)} · Valid until <span className={expired ? 'text-rose-600 font-semibold' : 'font-semibold'}>{fmtIST(offer.expires_at)}</span>
          </p>
        </div>
        <a href={offer.file_path} target="_blank" rel="noreferrer" className="v2-btn-ghost">📄 Open PDF</a>
      </div>

      {alreadyDecided ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-900">You have already responded to this offer.</p>
          <p className="text-xs text-slate-500 mt-1">Decision: <strong>{offer.candidate_decision}</strong> on {fmtIST(offer.decision_at)}</p>
          {offer.candidate_decision_notes && <p className="text-xs text-slate-600 mt-2 italic">"{offer.candidate_decision_notes}"</p>}
        </div>
      ) : expired ? (
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">This offer has expired.</p>
          <p className="text-xs text-rose-600 mt-1">Please contact your recruiter to discuss next steps.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex gap-2">
            {['accepted', 'rejected'].map((d) => (
              <button
                key={d}
                onClick={() => setDecision(d)}
                className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                  decision === d
                    ? d === 'accepted'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 shadow-md'
                      : 'border-rose-400 bg-rose-50 text-rose-800 shadow-md'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {d === 'accepted' ? '✓ Accept the offer' : '✕ Decline'}
              </button>
            ))}
          </div>

          {decision === 'accepted' ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Your signature</p>
              <SignaturePad onChange={setSig} />
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Reason (optional)</p>
              <textarea className="input-field w-full" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Help us understand so we can do better next time." />
            </div>
          )}

          <div className="flex justify-end">
            <button className="v2-btn-primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : decision === 'accepted' ? 'Sign & accept offer' : 'Submit response'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
