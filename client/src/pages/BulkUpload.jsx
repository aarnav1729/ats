import { useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { applicationsAPI } from '../services/api';
import toast from 'react-hot-toast';
import { useDropzone } from 'react-dropzone';

const TEMPLATE_HEADERS = [
  'candidate_name', 'candidate_email', 'candidate_phone', 'candidate_gender',
  'candidate_age', 'candidate_years_of_experience', 'current_organization',
  'current_ctc', 'current_location', 'education_level', 'source',
];
const SOURCES = ['LinkedIn', 'Naukri', 'Indeed', 'Employee Referral', 'Consultant', 'Walk-in', 'Company Website', 'Agency', 'Direct', 'Other'];

export default function BulkUpload() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('type') || 'excel';

  // Excel mode state
  const [rows, setRows] = useState([]);
  const [duplicates, setDuplicates] = useState(new Set());
  const [excelFile, setExcelFile] = useState(null);
  const [excelSource, setExcelSource] = useState('');

  // Resume mode state
  const [resumeFiles, setResumeFiles] = useState([]);
  const [parsedCandidates, setParsedCandidates] = useState([]);
  const [parseProgress, setParseProgress] = useState({});
  const [resumeSource, setResumeSource] = useState('');

  // Shared state
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);

  // Excel drop handler
  const onExcelDrop = useCallback(async (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setExcelFile(file);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await applicationsAPI.parseExcel(formData);
      const parsed = res.data.rows || [];
      setRows(parsed);
      // Detect duplicates by email
      const emails = parsed.map(r => r.candidate_email?.toLowerCase());
      const dupeSet = new Set();
      emails.forEach((email, i) => {
        if (email && emails.indexOf(email) !== i) {
          dupeSet.add(i);
          dupeSet.add(emails.indexOf(email));
        }
      });
      setDuplicates(dupeSet);
      toast.success(`Parsed ${parsed.length} rows from Excel`);
    } catch (err) {
      toast.error('Failed to parse Excel file');
    }
  }, []);

  // Resume drop handler
  const onResumeDrop = useCallback(async (acceptedFiles) => {
    if (!acceptedFiles.length) return;
    setResumeFiles(prev => [...prev, ...acceptedFiles]);

    for (const file of acceptedFiles) {
      const fileId = `${file.name}-${Date.now()}`;
      setParseProgress(prev => ({ ...prev, [fileId]: 'parsing' }));
      try {
        const formData = new FormData();
        formData.append('resume', file);
        const res = await applicationsAPI.uploadResume(formData);
        const parsed = res.data.parsed || {};
        setParsedCandidates(prev => [...prev, {
          _fileId: fileId,
          _fileName: file.name,
          _uploadedPath: res.data.file?.path || '',
          _uploadedFilename: res.data.file?.filename || file.name,
          _parseQuality: parsed.parse_quality || '',
          _missingFields: parsed.missing_fields || [],
          _skills: parsed.skills || [],
          _summary: parsed.resume_summary || '',
          candidate_name: parsed.candidate_name || '',
          candidate_email: parsed.candidate_email || '',
          candidate_phone: parsed.candidate_phone || '',
          candidate_age: parsed.candidate_age || '',
          candidate_gender: parsed.candidate_gender || '',
          candidate_years_of_experience: parsed.candidate_years_of_experience || '',
          current_organization: parsed.current_organization || '',
          current_ctc: parsed.current_ctc || '',
          current_location: parsed.current_location || '',
          candidate_aadhar: parsed.candidate_aadhar || '',
          candidate_pan: parsed.candidate_pan || '',
          willing_to_relocate: parsed.willing_to_relocate_flag ?? false,
          education_level: parsed.education_level || '',
          education_other: parsed.education_other || '',
          source: resumeSource || '',
        }]);
        setParseProgress(prev => ({ ...prev, [fileId]: 'done' }));
      } catch {
        setParseProgress(prev => ({ ...prev, [fileId]: 'error' }));
        setParsedCandidates(prev => [...prev, {
          _fileId: fileId, _fileName: file.name,
          _uploadedPath: '',
          _uploadedFilename: file.name,
          _parseQuality: 'low',
          _missingFields: [],
          _skills: [],
          _summary: '',
          candidate_name: '', candidate_email: '', candidate_phone: '',
          candidate_age: '', candidate_gender: '',
          candidate_years_of_experience: '', current_organization: '',
          current_ctc: '', current_location: '', candidate_aadhar: '',
          candidate_pan: '', willing_to_relocate: false,
          education_level: '', education_other: '',
          source: resumeSource || '',
        }]);
      }
    }
  }, [resumeSource]);

  const excelDropzone = useDropzone({
    onDrop: onExcelDrop,
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] },
    maxFiles: 1, maxSize: 20 * 1024 * 1024,
  });

  const resumeDropzone = useDropzone({
    onDrop: onResumeDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxSize: 10 * 1024 * 1024,
  });

  const removeRow = (index) => {
    setRows(prev => prev.filter((_, i) => i !== index));
    setDuplicates(prev => {
      const next = new Set();
      prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
  };

  const removeParsedCandidate = (fileId) => {
    setParsedCandidates(prev => prev.filter(c => c._fileId !== fileId));
  };

  const updateParsedField = (fileId, field, value) => {
    setParsedCandidates(prev => prev.map(c =>
      c._fileId === fileId ? { ...c, [field]: value } : c
    ));
  };

  const updateExcelRow = (index, field, value) => {
    setRows((prev) => prev.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )));
  };

  const downloadTemplate = () => {
    const csv = TEMPLATE_HEADERS.join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'bulk_upload_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmitExcel = async () => {
    if (!rows.length) return toast.error('No rows to submit');
    setSubmitting(true);
    try {
      const payload = rows.map(row => ({
        ...row,
        source: row.source || excelSource || 'Bulk Upload',
        ats_job_id: jobId !== 'pool' ? jobId : undefined,
        talent_pool_only: jobId === 'pool',
        created_by: user.email,
      }));
      const res = await applicationsAPI.bulkCreate(payload);
      setResults(res.data);
      toast.success(`Bulk upload complete!`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Bulk upload failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitResumes = async () => {
    const valid = parsedCandidates.filter(c => c.candidate_name && c.candidate_email);
    if (!valid.length) return toast.error('No valid candidates to submit');
    setSubmitting(true);
    try {
      const payload = valid.map((candidate) => {
        const {
          _fileId,
          _fileName,
          _uploadedPath,
          _uploadedFilename,
          _parseQuality,
          _missingFields,
          _skills,
          _summary,
          ...rest
        } = candidate;

        return {
          ...rest,
          source: rest.source || resumeSource || 'Bulk Resume Upload',
          ats_job_id: jobId !== 'pool' ? jobId : undefined,
          talent_pool_only: jobId === 'pool',
          resume_flag: true,
          resume_file_name: _uploadedFilename || _fileName,
          resume_path: _uploadedPath || undefined,
          created_by: user.email,
        };
      });
      const res = await applicationsAPI.bulkCreate(payload);
      setResults(res.data);
      toast.success('Bulk upload complete!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Bulk upload failed');
    } finally {
      setSubmitting(false);
    }
  };

  const parsingCount = Object.values(parseProgress).filter(s => s === 'parsing').length;

  // Results summary view
  if (results) {
    return (
      <div className="page-shell">
        <h1 className="page-title mb-6">Upload Results</h1>
        <div className="card">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center p-4 bg-emerald-50 rounded-lg">
              <p className="text-3xl font-bold text-emerald-600">{results.created || 0}</p>
              <p className="text-sm text-emerald-700 mt-1">Created</p>
            </div>
            <div className="text-center p-4 bg-amber-50 rounded-lg">
              <p className="text-3xl font-bold text-amber-600">{results.skipped || 0}</p>
              <p className="text-sm text-amber-700 mt-1">Skipped (Duplicates)</p>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <p className="text-3xl font-bold text-red-600">{results.errors || 0}</p>
              <p className="text-sm text-red-700 mt-1">Errors</p>
            </div>
          </div>
          {results.errorDetails?.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-red-700 mb-2">Error Details:</h4>
              <ul className="text-sm text-red-600 space-y-1">
                {results.errorDetails.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
              </ul>
            </div>
          )}
          <button onClick={() => navigate(jobId === 'pool' ? '/talent-pool' : `/jobs/${jobId}`)} className="btn-primary">
            Go to {jobId === 'pool' ? 'Talent Pool' : 'Job Detail'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Bulk Upload Candidates</h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'excel' ? 'Upload via Excel spreadsheet' : 'Upload multiple resumes for AI parsing'}
            {' '}&middot; {jobId === 'pool' ? 'Talent Pool' : `Job: ${jobId}`}
          </p>
        </div>
        <button onClick={() => navigate(-1)} className="btn-secondary">&larr; Back</button>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => navigate(`/jobs/${jobId}/bulk-upload?type=excel`, { replace: true })}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'excel' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Excel Upload
        </button>
        <button onClick={() => navigate(`/jobs/${jobId}/bulk-upload?type=resumes`, { replace: true })}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'resumes' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Bulk Resumes
        </button>
      </div>

      {mode === 'excel' ? (
        <>
          {/* Excel dropzone */}
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="section-title">Upload Excel File</h3>
              <button onClick={downloadTemplate} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
                Download Template
              </button>
            </div>
            <div className="mb-4 max-w-sm">
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Source</label>
              <select value={excelSource} onChange={(e) => setExcelSource(e.target.value)} className="input-field w-full">
                <option value="">Select source for rows that do not have one</option>
                {SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
              </select>
            </div>
            <div {...excelDropzone.getRootProps()} className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${excelDropzone.isDragActive ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300'}`}>
              <input {...excelDropzone.getInputProps()} />
              {excelFile ? (
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="text-sm font-medium text-gray-700">{excelFile.name}</p>
                  <p className="text-xs text-gray-400">{rows.length} rows parsed. Drop a new file to replace.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                  <p className="text-sm text-gray-600">Drag & drop Excel file here, or <span className="text-indigo-600 font-medium">browse</span></p>
                  <p className="text-xs text-gray-400">XLSX, XLS up to 20MB</p>
                </div>
              )}
            </div>
          </div>

          {/* Excel preview table */}
          {rows.length > 0 && (
            <div className="card mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="section-title">{rows.length} Candidates Preview</h3>
                {duplicates.size > 0 && (
                  <span className="text-sm text-red-600 font-medium">{duplicates.size} duplicate emails detected</span>
                )}
              </div>
              <div className="overflow-hidden">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-2 font-medium text-gray-600">#</th>
                      <th className="text-left p-2 font-medium text-gray-600">Name</th>
                      <th className="text-left p-2 font-medium text-gray-600">Email</th>
                      <th className="text-left p-2 font-medium text-gray-600">Phone</th>
                      <th className="text-left p-2 font-medium text-gray-600">Experience</th>
                      <th className="text-left p-2 font-medium text-gray-600">Location</th>
                      <th className="text-left p-2 font-medium text-gray-600">Source</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={`border-b ${duplicates.has(i) ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                        <td className="p-2 text-gray-400">{i + 1}</td>
                        <td className="p-2">{row.candidate_name || '-'}</td>
                        <td className="p-2">
                          {row.candidate_email || '-'}
                          {duplicates.has(i) && <span className="ml-1 text-xs text-red-500 font-medium">DUPLICATE</span>}
                        </td>
                        <td className="p-2">{row.candidate_phone || '-'}</td>
                        <td className="p-2">{row.candidate_years_of_experience || '-'}</td>
                        <td className="p-2">{row.current_location || '-'}</td>
                        <td className="p-2 min-w-[180px]">
                          <select
                            value={row.source || excelSource || ''}
                            onChange={(e) => updateExcelRow(i, 'source', e.target.value)}
                            className="input-field text-sm"
                          >
                            <option value="">Select source</option>
                            {SOURCES.map((source) => <option key={`${i}-${source}`} value={source}>{source}</option>)}
                          </select>
                        </td>
                        <td className="p-2">
                          <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600" title="Remove row">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3 mt-4 pt-4 border-t">
                <button onClick={handleSubmitExcel} disabled={submitting} className="btn-primary disabled:opacity-50">
                  {submitting ? 'Uploading...' : `Upload ${rows.length} Candidates`}
                </button>
                <button onClick={() => { setRows([]); setExcelFile(null); setDuplicates(new Set()); }} className="btn-secondary">Clear</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Resume dropzone */}
          <div className="card mb-6">
            <h3 className="section-title mb-3">Upload Resumes</h3>
            <div className="mb-4 max-w-sm">
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Source</label>
              <select value={resumeSource} onChange={(e) => setResumeSource(e.target.value)} className="input-field w-full">
                <option value="">Select source for parsed resumes</option>
                {SOURCES.map((source) => <option key={`resume-${source}`} value={source}>{source}</option>)}
              </select>
            </div>
            <div {...resumeDropzone.getRootProps()} className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${resumeDropzone.isDragActive ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 hover:border-indigo-300'}`}>
              <input {...resumeDropzone.getInputProps()} />
              <div className="flex flex-col items-center gap-2">
                <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                <p className="text-sm text-gray-600">Drag & drop multiple resumes here, or <span className="text-indigo-600 font-medium">browse</span></p>
                <p className="text-xs text-gray-400">PDF, DOC, DOCX files up to 10MB each</p>
                {resumeFiles.length > 0 && <p className="text-xs text-indigo-600">{resumeFiles.length} file(s) uploaded</p>}
              </div>
            </div>
            {parsingCount > 0 && (
              <div className="flex items-center gap-2 mt-3">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                <p className="text-sm text-indigo-600">Parsing {parsingCount} resume(s) with AI...</p>
              </div>
            )}
          </div>

          {/* Parsed candidate cards */}
          {parsedCandidates.length > 0 && (
            <div className="space-y-4 mb-6">
              <h3 className="section-title">{parsedCandidates.length} Parsed Candidates</h3>
              {parsedCandidates.map((c) => (
                <div key={c._fileId} className="card">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                      <span className="text-sm text-gray-500">{c._fileName}</span>
                      {c._parseQuality && <span className="text-xs text-slate-500 uppercase">{c._parseQuality} confidence</span>}
                      {parseProgress[c._fileId] === 'error' && <span className="text-xs text-red-500 font-medium">Parse failed - fill manually</span>}
                    </div>
                    <button onClick={() => removeParsedCandidate(c._fileId)} className="text-red-400 hover:text-red-600 text-sm">Remove</button>
                  </div>
                  {c._summary && <p className="text-sm text-gray-600 mb-3">{c._summary}</p>}
                  {c._skills?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {c._skills.slice(0, 8).map((skill) => (
                        <span key={`${c._fileId}-${skill}`} className="badge bg-slate-100 text-slate-700">{skill}</span>
                      ))}
                    </div>
                  )}
                  {c._missingFields?.length > 0 && (
                    <p className="text-xs text-amber-600 mb-3">Review recommended for: {c._missingFields.join(', ')}</p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Name *</label><input type="text" value={c.candidate_name} onChange={e => updateParsedField(c._fileId, 'candidate_name', e.target.value)} className="input-field text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Email *</label><input type="email" value={c.candidate_email} onChange={e => updateParsedField(c._fileId, 'candidate_email', e.target.value)} className="input-field text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Phone</label><input type="text" value={c.candidate_phone} onChange={e => updateParsedField(c._fileId, 'candidate_phone', e.target.value)} className="input-field text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Age</label><input type="number" value={c.candidate_age} onChange={e => updateParsedField(c._fileId, 'candidate_age', e.target.value)} className="input-field text-sm" min="16" max="70" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Gender</label><input type="text" value={c.candidate_gender} onChange={e => updateParsedField(c._fileId, 'candidate_gender', e.target.value)} className="input-field text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Experience (yrs)</label><input type="number" value={c.candidate_years_of_experience} onChange={e => updateParsedField(c._fileId, 'candidate_years_of_experience', e.target.value)} className="input-field text-sm" min="0" step="0.5" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Organization</label><input type="text" value={c.current_organization} onChange={e => updateParsedField(c._fileId, 'current_organization', e.target.value)} className="input-field text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Current CTC</label><input type="number" value={c.current_ctc} onChange={e => updateParsedField(c._fileId, 'current_ctc', e.target.value)} className="input-field text-sm" min="0" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Location</label><input type="text" value={c.current_location} onChange={e => updateParsedField(c._fileId, 'current_location', e.target.value)} className="input-field text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Education</label><input type="text" value={c.education_level} onChange={e => updateParsedField(c._fileId, 'education_level', e.target.value)} className="input-field text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Education Details</label><input type="text" value={c.education_other} onChange={e => updateParsedField(c._fileId, 'education_other', e.target.value)} className="input-field text-sm" /></div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
                      <select value={c.source || resumeSource || ''} onChange={e => updateParsedField(c._fileId, 'source', e.target.value)} className="input-field text-sm">
                        <option value="">Select source</option>
                        {SOURCES.map((source) => <option key={`${c._fileId}-${source}`} value={source}>{source}</option>)}
                      </select>
                    </div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">PAN</label><input type="text" value={c.candidate_pan} onChange={e => updateParsedField(c._fileId, 'candidate_pan', e.target.value)} className="input-field text-sm" /></div>
                    <div><label className="block text-xs font-medium text-gray-500 mb-1">Aadhar</label><input type="text" value={c.candidate_aadhar} onChange={e => updateParsedField(c._fileId, 'candidate_aadhar', e.target.value)} className="input-field text-sm" /></div>
                    <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                      <input type="checkbox" checked={!!c.willing_to_relocate} onChange={e => updateParsedField(c._fileId, 'willing_to_relocate', e.target.checked)} />
                      Willing to relocate
                    </label>
                  </div>
                </div>
              ))}
              <div className="flex gap-3">
                <button onClick={handleSubmitResumes} disabled={submitting || parsingCount > 0} className="btn-primary disabled:opacity-50">
                  {submitting ? 'Uploading...' : `Upload ${parsedCandidates.filter(c => c.candidate_name && c.candidate_email).length} Candidates`}
                </button>
                <button onClick={() => { setParsedCandidates([]); setResumeFiles([]); setParseProgress({}); }} className="btn-secondary">Clear All</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
