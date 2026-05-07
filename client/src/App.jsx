import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import AppLayout from './layouts/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import UserManagement from './pages/UserManagement';
import Masters from './pages/Masters';
import AOP from './pages/AOP';
import Requisitions from './pages/Requisitions';
import CreateRequisition from './pages/CreateRequisition';
import RequisitionDetail from './pages/RequisitionDetail';
import Jobs from './pages/Jobs';
import CreateJob from './pages/CreateJob';
import JobDetail from './pages/JobDetail';
import TalentPool from './pages/TalentPool';
import AddCandidate from './pages/AddCandidate';
import BulkUpload from './pages/BulkUpload';
import InterviewerPage from './pages/InterviewerPage';
import InterviewWorkspace from './pages/InterviewWorkspace';
// InterviewSchedule was a stub page that no route was actually mounted for.
// Scheduling now happens inline in the Application Workflow page.
import CandidatePage from './pages/CandidatePage';
import AuditTrail from './pages/AuditTrail';
import AuditDeck from './pages/AuditDeck';
import TatExplorer from './pages/TatExplorer';
import ApproverInbox from './pages/ApproverInbox';
import MIS from './pages/MIS';
import ApplicationWorkflow from './pages/ApplicationWorkflow';
import AnalyticsCopilot from './pages/AnalyticsCopilot';
import Notifications from './pages/Notifications';
import PublicJobOpening from './pages/PublicJobOpening';
import CandidatePortal from './pages/CandidatePortal';
import DocumentReviewQueue from './pages/DocumentReviewQueue';
import Inbox from './pages/Inbox';

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>;
  if (!user) return <Navigate to="/login" />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" />;
  return children;
}

function RouteScrollReset() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname, location.search]);

  return null;
}

export default function App() {
  const { user } = useAuth();

  return (
    <>
      <RouteScrollReset />
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/careers/:jobId" element={<PublicJobOpening />} />
        <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="dashboard" element={<Navigate to="/" replace />} />
          <Route path="users" element={<ProtectedRoute roles={['hr_admin']}><UserManagement /></ProtectedRoute>} />
          <Route path="masters" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><Masters /></ProtectedRoute>} />
          <Route path="aop" element={<ProtectedRoute roles={['hr_admin']}><AOP /></ProtectedRoute>} />
          <Route path="requisitions" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'hod']}><Requisitions /></ProtectedRoute>} />
          <Route path="requisitions/create" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'hod']}><CreateRequisition /></ProtectedRoute>} />
          <Route path="requisitions/:id" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'hod']}><RequisitionDetail /></ProtectedRoute>} />
          <Route path="requisitions/:id/edit" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'hod']}><CreateRequisition /></ProtectedRoute>} />
          <Route path="jobs" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><Jobs /></ProtectedRoute>} />
          <Route path="jobs/create" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><CreateJob /></ProtectedRoute>} />
          <Route path="jobs/:id/edit" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><CreateJob /></ProtectedRoute>} />
          <Route path="jobs/:id" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><JobDetail /></ProtectedRoute>} />
          <Route path="talent-pool" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><TalentPool /></ProtectedRoute>} />
          <Route path="talent-pool/add" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><AddCandidate /></ProtectedRoute>} />
          <Route path="talent-pool/:id/edit" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><AddCandidate /></ProtectedRoute>} />
          <Route path="jobs/:jobId/add-candidate" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><AddCandidate /></ProtectedRoute>} />
          <Route path="jobs/:jobId/candidates/:id/edit" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><AddCandidate /></ProtectedRoute>} />
          <Route path="jobs/:jobId/bulk-upload" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><BulkUpload /></ProtectedRoute>} />
          <Route path="applications/:id/workflow" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'interviewer', 'hod']}><ApplicationWorkflow /></ProtectedRoute>} />
          <Route path="interviews" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'interviewer', 'hod']}><InterviewerPage /></ProtectedRoute>} />
          <Route path="interviews/:id/workspace" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'interviewer', 'hod']}><InterviewWorkspace /></ProtectedRoute>} />
          <Route path="my-tasks" element={<ProtectedRoute roles={['hr_admin', 'applicant']}><CandidatePage /></ProtectedRoute>} />
          <Route path="notifications" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'interviewer', 'applicant', 'hod']}><Notifications /></ProtectedRoute>} />
          <Route path="audit" element={<ProtectedRoute roles={['hr_admin']}><AuditDeck /></ProtectedRoute>} />
          <Route path="audit/legacy" element={<ProtectedRoute roles={['hr_admin']}><AuditTrail /></ProtectedRoute>} />
          <Route path="tat" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'hod']}><TatExplorer /></ProtectedRoute>} />
          {/* CTC approver inbox: any signed-in user can have approvals - the page itself filters by their email. */}
          <Route path="ctc-approvals" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'hod', 'interviewer']}><ApproverInbox /></ProtectedRoute>} />
          <Route path="mis" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><MIS /></ProtectedRoute>} />
          <Route path="analytics-copilot" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'hod']}><AnalyticsCopilot /></ProtectedRoute>} />
          <Route path="candidate" element={<ProtectedRoute roles={['applicant']}><CandidatePortal /></ProtectedRoute>} />
          <Route path="hr/document-queue" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter']}><DocumentReviewQueue /></ProtectedRoute>} />
          <Route path="inbox" element={<ProtectedRoute roles={['hr_admin', 'hr_recruiter', 'interviewer', 'hod']}><Inbox /></ProtectedRoute>} />
        </Route>
      </Routes>
    </>
  );
}
