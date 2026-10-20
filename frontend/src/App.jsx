import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import Login from './components/Login.jsx';
import Register from './components/Register.jsx';
import Dashboard from './components/Dashboard.jsx';
import RoomEditor from './components/RoomEditor.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import VerifyEmail from './components/VerifyEmail.jsx';
import SharedRoom from './components/SharedRoom.jsx';
import AccountSettings from './components/AccountSettings.jsx';
import LegalPage from './components/LegalPage.jsx';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, isAdmin } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/terms" element={<LegalPage title="Terms of Service" intro="These terms govern your use of SwiftSpace." sections={[
        { heading: '1. Acceptance of Terms', content: ['By creating an account or using SwiftSpace, you confirm that you accept these Terms of Service and agree to comply with them.'] },
        { heading: '2. Service Overview', content: ['SwiftSpace provides a room-planning and interior design workspace for creating, saving, and sharing room layouts.'] },
        { heading: '3. User Responsibilities', content: ['You are responsible for the content you create, the accuracy of your room data, and the security of your account credentials.'] },
        { heading: '4. Account and Privacy', content: ['We use your account data to provide the service, maintain secure access, and support your saved room plans.'] },
        { heading: '5. Changes to the Service', content: ['We may update functionality, interfaces, or policies to improve reliability, security, or user experience.'] },
      ]} />} />
      <Route path="/privacy" element={<LegalPage title="Privacy Policy" intro="This Privacy Policy explains how SwiftSpace handles your information." sections={[
        { heading: '1. Information We Collect', content: ['We collect account details, room data, and usage information needed to operate the service and maintain security.'] },
        { heading: '2. How We Use Information', content: ['We use your information to create and manage your account, save room designs, provide access to personal content, and improve reliability.'] },
        { heading: '3. Sharing', content: ['We only share your information with trusted service providers required to run SwiftSpace or when required by law.'] },
        { heading: '4. Your Controls', content: ['You may update account information, manage data, and request account support through the application.'] },
        { heading: '5. Security', content: ['We use reasonable technical safeguards to protect account and room data, but no system is completely immune to risk.'] },
      ]} />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/share/:token" element={<SharedRoom />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/account"
        element={
          <ProtectedRoute>
            <AccountSettings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/room/new"
        element={
          <ProtectedRoute>
            <RoomEditor />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/room/:id"
        element={
          <ProtectedRoute>
            <RoomEditor />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
