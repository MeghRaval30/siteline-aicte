import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { Toaster } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import EVC from './pages/EVC';
import Compliance from './pages/Compliance';
import Institutions from './pages/Institutions';
import InstitutionDetail from './pages/InstitutionDetail';
import Alerts from './pages/Alerts';
import Reports from './pages/Reports';
import ImportStudio from './pages/ImportStudio';
import Letter from './pages/Letter';
import Verify from './pages/Verify';
import AIChat from './pages/AIChat';
import ActivityLogs from './pages/ActivityLogs';
import Settings from './pages/Settings';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" replace />;
}

const OFFICE = ['Admin', 'Officer'];
function Only({ roles, children }) {
  let role;
  try { role = JSON.parse(localStorage.getItem('user') || '{}').role; } catch { role = null; }
  return roles.includes(role) ? children : <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/verify/:code" element={<Verify />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="applications" element={<Applications />} />
          <Route path="applications/:id" element={<ApplicationDetail />} />
          <Route path="applications/:id/letter" element={<Letter />} />
          <Route path="evc" element={<Only roles={[...OFFICE, 'Expert']}><EVC /></Only>} />
          <Route path="compliance" element={<Only roles={[...OFFICE, 'Institution']}><Compliance /></Only>} />
          <Route path="institutions" element={<Only roles={OFFICE}><Institutions /></Only>} />
          <Route path="institutions/:id" element={<Only roles={OFFICE}><InstitutionDetail /></Only>} />
          <Route path="alerts" element={<Only roles={[...OFFICE, 'Institution']}><Alerts /></Only>} />
          <Route path="reports" element={<Only roles={OFFICE}><Reports /></Only>} />
          <Route path="import" element={<Only roles={OFFICE}><ImportStudio /></Only>} />
          <Route path="ai-chat" element={<AIChat />} />
          <Route path="activity-logs" element={<Only roles={OFFICE}><ActivityLogs /></Only>} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
