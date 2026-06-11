import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './store/useAuth';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import SettingsPage from './pages/Settings';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { username, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400 text-sm tracking-widest uppercase">
        Authenticating...
      </div>
    );
  }
  if (!username) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const { check } = useAuth();

  useEffect(() => {
    check();
  }, [check]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <AuthGuard>
              <DashboardPage />
            </AuthGuard>
          }
        />
        <Route
          path="/settings"
          element={
            <AuthGuard>
              <SettingsPage />
            </AuthGuard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
