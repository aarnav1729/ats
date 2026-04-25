import axios from 'axios';

const API_URL = '/api';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ats_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ats_token');
      localStorage.removeItem('ats_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authAPI = {
  login: (email) => api.post('/auth/login', { email }),
  verifyOTP: (email, otp) => api.post('/auth/verify-otp', { email, otp }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

// Users
export const usersAPI = {
  list: (params) => api.get('/users', { params }),
  recruiterOptions: () => api.get('/users/recruiter-options'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
};

// Masters
export const mastersAPI = {
  list: (type, params) => api.get(`/masters/${type}`, { params }),
  create: (type, data) => api.post(`/masters/${type}`, data),
  update: (type, id, data) => api.put(`/masters/${type}/${id}`, data),
  delete: (type, id) => api.delete(`/masters/${type}/${id}`),
  subDepartmentsByDept: (deptName) => api.get(`/masters/sub-departments-by-dept/${encodeURIComponent(deptName)}`),
  phasesByLocation: (locName) => api.get(`/masters/phases-by-location/${encodeURIComponent(locName)}`),
  locationsByBU: (buShortName) => api.get(`/masters/locations-by-bu/${encodeURIComponent(buShortName)}`),
  employees: (params) => api.get('/masters/employees', { params }),
};

// AOP
export const aopAPI = {
  list: (params) => api.get('/aop', { params }),
  create: (data) => api.post('/aop', data),
  update: (id, data) => api.put(`/aop/${id}`, data),
  delete: (id) => api.delete(`/aop/${id}`),
  summary: () => api.get('/aop/summary'),
};

// Requisitions
export const requisitionsAPI = {
  list: (params) => api.get('/requisitions', { params }),
  previewId: (params) => api.get('/requisitions/preview-id', { params }),
  approvalPreview: (params) => api.get('/requisitions/approval-preview', { params }),
  get: (id) => api.get(`/requisitions/${id}`),
  create: (data) => api.post('/requisitions', data),
  update: (id, data) => api.put(`/requisitions/${id}`, data),
  approve: (id, data) => api.post(`/requisitions/${id}/approve`, data || {}),
  reject: (id, data) => api.post(`/requisitions/${id}/reject`, data || {}),
  assignRecruiter: (id, data) => api.post(`/requisitions/${id}/assign-recruiter`, data || {}),
  delete: (id) => api.delete(`/requisitions/${id}`),
  generateJD: (data) => api.post('/requisitions/generate-jd', data),
  export: (params) => api.get('/requisitions/export', { params }),
};

// Jobs
export const jobsAPI = {
  list: (params) => api.get('/jobs', { params }),
  get: (id) => api.get(`/jobs/${id}`),
  create: (data) => api.post('/jobs', data),
  update: (id, data) => api.put(`/jobs/${id}`, data),
  delete: (id) => api.delete(`/jobs/${id}`),
  publish: (id) => api.post(`/jobs/${id}/publish`),
  applicants: (id, params) => api.get(`/jobs/${id}/applicants`, { params }),
  stageCounts: (id) => api.get(`/jobs/${id}/stage-counts`),
  qrCode: (id, data) => api.post(`/jobs/${id}/qr-code`, data),
  export: (params) => api.get('/jobs/export', { params }),
};

// Applications
export const applicationsAPI = {
  list: (params) => api.get('/applications', { params }),
  get: (id) => api.get(`/applications/${id}`),
  create: (data) => api.post('/applications', data),
  bulkCreate: (data) => api.post('/applications/bulk-create', data),
  update: (id, data) => api.put(`/applications/${id}`, data),
  updateStatus: (id, data) => api.put(`/applications/${id}/status`, data),
  parseExcel: (formData) => api.post('/applications/parse-excel', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  uploadResume: (formData) => api.post('/applications/upload-resume', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  bulkUploadExcel: (formData) => api.post('/applications/bulk-upload-excel', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  bulkUploadResumes: (formData) => api.post('/applications/bulk-upload-resumes', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  moveJob: (id, data) => api.post(`/applications/${id}/move-job`, data),
  moveStage: (id, data) => api.post(`/applications/${id}/move-stage`, data),
  talentPool: (params) => api.get('/applications/talent-pool', { params }),
  jobMatches: (id) => api.get(`/applications/job-matches/${id}`),
  duplicates: (params) => api.get('/applications/duplicates', { params }),
  bulkStatus: (data) => api.post('/applications/bulk-status', data),
  updateInterviewPlan: (id, data) => api.put(`/applications/${id}/interview-plan`, data),
  keepInTalentPool: (id) => api.post(`/applications/${id}/keep-in-talent-pool`),
  ban: (id, data) => api.post(`/applications/${id}/ban`, data),
  delete: (id) => api.delete(`/applications/${id}`),
  export: (params) => api.get('/applications/export', { params }),
};

// Interviews
export const interviewsAPI = {
  list: (params) => api.get('/interviews', { params }),
  get: (id) => api.get(`/interviews/${id}`),
  suggestSlots: (id, data) => api.put(`/interviews/${id}/suggest-slots`, data),
  feedback: (id, data) => api.put(`/interviews/${id}/feedback`, data),
  reschedule: (id, data) => api.put(`/interviews/${id}/reschedule`, data),
  markNoShow: (id, data) => api.put(`/interviews/${id}/mark-no-show`, data),
  requestAdditionalRounds: (id, data) => api.put(`/interviews/${id}/request-additional-rounds`, data),
  remind: (id, data) => api.post(`/interviews/${id}/remind`, data),
  sendMessage: (id, data) => api.post(`/interviews/${id}/message`, data),
  messages: (id) => api.get(`/interviews/${id}/messages`),
};

// Candidates
export const candidatesAPI = {
  myTasks: () => api.get('/candidates/my-tasks'),
  documents: (appId) => api.get(`/candidates/${appId}/documents`),
  createDocRequest: (appId, data) => api.post(`/candidates/${appId}/documents`, data),
  uploadDocument: (appId, docId, formData) => api.post(`/candidates/${appId}/documents/${docId}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  reviewDocument: (appId, docId, data) => api.put(`/candidates/${appId}/documents/${docId}/review`, data),
  remind: (appId, docId, data) => api.post(`/candidates/${appId}/documents/${docId}/remind`, data || {}),
  // Post-document approval flow
  submitClearance: (appId, data) => api.post(`/candidates/${appId}/clearance`, data),
  getClearance: (appId) => api.get(`/candidates/${appId}/clearance`),
  clearanceAction: (appId, data) => api.put(`/candidates/${appId}/clearance`, data),
};

// Audit
export const auditAPI = {
  list: (params) => api.get('/audit', { params }),
  export: (params) => api.get('/audit/export', { params }),
  stats: () => api.get('/audit/stats'),
};

// MIS
export const misAPI = {
  funnel: (params) => api.get('/mis/funnel', { params }),
  drilldownSummary: (groupBy, params) => api.get('/mis/drilldown-summary', { params: { ...params, group_by: groupBy } }),
  drilldownDetails: (params) => api.get('/mis/drilldown-details', { params }),
  entitySummary: (params) => api.get('/mis/entity-summary', { params }),
  backfillSummary: (params) => api.get('/mis/backfill-summary', { params }),
  newPositionsSummary: (params) => api.get('/mis/new-positions-summary', { params }),
  tat: (params) => api.get('/mis/tat', { params }),
  monthlyOffers: (params) => api.get('/mis/monthly-offers', { params }),
  openPositionsTat: (params) => api.get('/mis/open-positions-tat', { params }),
  offersTat: (params) => api.get('/mis/offers-tat', { params }),
  selectionToOffer: (params) => api.get('/mis/selection-to-offer', { params }),
  recruiterSourcing: (params) => api.get('/mis/recruiter-sourcing', { params }),
  backoutsSummary: (params) => api.get('/mis/backouts-summary', { params }),
  timeToFill: (params) => api.get('/mis/time-to-fill', { params }),
  timeToJoin: (params) => api.get('/mis/time-to-join', { params }),
  offerAcceptanceRate: (params) => api.get('/mis/offer-acceptance-rate', { params }),
  offerJoinRatio: (params) => api.get('/mis/offer-join-ratio', { params }),
  dashboard: (params) => api.get('/mis/dashboard', { params }),
  assistant: (data) => api.post('/mis/assistant', data),
  tatPhases: (params) => api.get('/mis/tat-phases', { params }),
  ninetyDaysRecruiter: (params) => api.get('/mis/ninety-days-recruiter', { params }),
  detailedOpenPositions: (params) => api.get('/mis/detailed-open-positions', { params }),
  rawExport: (params) => api.get('/mis/raw-export', { params }),
};

// Notifications
export const notificationsAPI = {
  list: (params) => api.get('/notifications', { params }),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
  draftEmail: (data) => api.post('/notifications/draft-email', data),
  sendEmail: (data) => api.post('/notifications/send-email', data),
};

// Org / CXO Directory
export const orgAPI = {
  cxoDirectory: (params) => api.get('/org/cxo-directory', { params }),
  cxoSearch: (params) => api.get('/org/cxo-directory', { params }),
  approversMaster: (params) => api.get('/org/approvers-master', { params }),
};

export const timelineAPI = {
  forEntity: (entityType, entityId, params) => api.get(`/timeline/${entityType}/${encodeURIComponent(entityId)}`, { params }),
  stepTat: (params) => api.get('/timeline/tat/step-pairs', { params }),
  rawEvents: (params) => api.get('/timeline/events/raw', { params }),
};

export const requisitionHoldsAPI = {
  place: (requisitionId, data) => api.post(`/requisition-holds/${requisitionId}`, data),
  release: (requisitionId) => api.post(`/requisition-holds/${requisitionId}/release`),
  history: (requisitionId) => api.get(`/requisition-holds/${requisitionId}/history`),
};

export const candidatePortalAPI = {
  invite: (applicationId) => api.post(`/candidate-portal/${applicationId}/invite`),
  me: () => api.get('/candidate-portal/me'),
  uploadDocument: (docId, formData) => api.post(`/candidate-portal/documents/${docId}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  reviewQueue: () => api.get('/candidate-portal/review-queue'),
  reviewDocument: (docId, data) => api.post(`/candidate-portal/documents/${docId}/review`, data),
  requestDocument: (applicationId, data) => api.post(`/candidate-portal/${applicationId}/documents/request`, data),
  requestCtc: (applicationId, data) => api.post(`/candidate-portal/${applicationId}/ctc-request`, data),
  respondCtc: (requestId, data) => api.post(`/candidate-portal/ctc-request/${requestId}/respond`, data),
};

export const demoAPI = {
  seed: () => api.post('/demo/seed'),
  clear: () => api.delete('/demo/seed'),
  runFullDemo: () => api.post('/demo/run-full'),
  story: () => api.get('/demo/story'),
};

export default api;
