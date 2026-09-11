import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { YouTubeDashboard } from './components/YouTubeDashboard';
import { Navbar } from './components/Navbar';
import { getCurrentUser, type User } from './services/api';
import './App.css';

function MainApp() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('cms_token'));
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState<boolean>(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function verifySession() {
      if (!token) {
        setLoadingSession(false);
        return;
      }

      try {
        const currentUser = await getCurrentUser(token);
        setUser(currentUser);
      } catch (err) {
        console.warn('Session verification failed, logging out:', err);
        localStorage.removeItem('cms_token');
        setToken(null);
        setUser(null);
      } finally {
        setLoadingSession(false);
      }
    }

    verifySession();
  }, [token]);

  const handleLoginSuccess = (newToken: string, loggedInUser: User) => {
    localStorage.setItem('cms_token', newToken);
    setToken(newToken);
    setUser(loggedInUser);
    navigate('/instagram');
  };

  const handleLogout = () => {
    localStorage.removeItem('cms_token');
    setToken(null);
    setUser(null);
    navigate('/login');
  };

  const handleSwitchPlatform = (platform: 'instagram' | 'youtube') => {
    navigate(`/${platform}`);
  };

  if (loadingSession) {
    return (
      <div className="session-loader">
        <div className="spinner large"></div>
        <p>Connecting to CMS PostgreSQL Node.js Service...</p>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLoginSuccess={handleLoginSuccess} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="app-root">
      <Navbar user={user} onLogout={handleLogout} />
      <Routes>
        <Route path="/" element={<Navigate to="/instagram" replace />} />
        <Route
          path="/instagram"
          element={<Dashboard token={token} user={user} onSwitchPlatform={handleSwitchPlatform} />}
        />
        <Route
          path="/youtube"
          element={<YouTubeDashboard token={token} user={user} onSwitchPlatform={handleSwitchPlatform} />}
        />
        <Route path="/login" element={<Navigate to="/instagram" replace />} />
        <Route path="*" element={<Navigate to="/instagram" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MainApp />
    </BrowserRouter>
  );
}
