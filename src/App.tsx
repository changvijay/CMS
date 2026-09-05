import { useState, useEffect } from 'react';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { YouTubeDashboard } from './components/YouTubeDashboard';
import { Navbar } from './components/Navbar';
import { getCurrentUser, type User } from './services/api';
import './App.css';

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('cms_token'));
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState<boolean>(true);
  const [activePlatform, setActivePlatform] = useState<'instagram' | 'youtube'>('instagram');

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
  };

  const handleLogout = () => {
    localStorage.removeItem('cms_token');
    setToken(null);
    setUser(null);
  };

  if (loadingSession) {
    return (
      <div className="session-loader">
        <div className="spinner large"></div>
        <p>Connecting to CMS PostgreSQL Node.js Service...</p>
      </div>
    );
  }

  return (
    <div className="app-root">
      {token && user ? (
        <>
          <Navbar
            user={user}
            onLogout={handleLogout}
            activePlatform={activePlatform}
            onSwitchPlatform={setActivePlatform}
          />
          {activePlatform === 'youtube' ? (
            <YouTubeDashboard token={token} user={user} />
          ) : (
            <Dashboard token={token} user={user} />
          )}
        </>
      ) : (
        <Login onLoginSuccess={handleLoginSuccess} />
      )}
    </div>
  );
}

export default App;
