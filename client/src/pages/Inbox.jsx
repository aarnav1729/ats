// Thin dispatcher - routes to the dedicated role-home page based on user role.
// All actual UX lives in AdminHome / RecruiterHome / InterviewerHome so each
// role's screen stands on its own and can evolve independently.

import { useAuth } from '../hooks/useAuth';
import AdminHome from './AdminHome';
import RecruiterHome from './RecruiterHome';
import InterviewerHome from './InterviewerHome';

export default function Inbox() {
  const { user } = useAuth();
  switch (user?.role) {
    case 'hr_admin':     return <AdminHome />;
    case 'hr_recruiter': return <RecruiterHome />;
    case 'interviewer':  return <InterviewerHome />;
    case 'hod':          return <RecruiterHome />; // HOD shares recruiter view
    default:             return <RecruiterHome />;
  }
}
