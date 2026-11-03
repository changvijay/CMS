import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Login } from './components/Login';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
const PlatformPage = lazy(() => import('./components/workspace/PlatformPage'));
const Overview = lazy(() => import('./components/Overview'));
const Accounts = lazy(() => import('./components/Accounts'));
const Profile = lazy(() => import('./components/Profile'));
const Automation = lazy(() => import('./components/Automation'));
const PublishWizard = lazy(() => import('./components/publish/PublishWizard'));
import { getCurrentUser, type User } from './services/api';
import { clearLiveCache } from './components/workspace/useLive';
import './App.css';

/** Old /trends/:platform links now live inside the platform workspace. */
function TrendsRedirect() {
  const { platform } = useParams();
  return <Navigate to={platform === 'youtube' || platform === 'linkedin' ? `/${platform}` : '/instagram'} replace />;
}

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
        clearLiveCache();
        setToken(null);
        setUser(null);
      } finally {
        setLoadingSession(false);
      }
    }

    verifySession();
  }, [token]);

  const handleLoginSuccess = (newToken: string, loggedInUser: User) => {
    clearLiveCache();
    localStorage.setItem('cms_token', newToken);
    setToken(newToken);
    setUser(loggedInUser);
    navigate('/overview');
  };

  const handleLogout = () => {
    localStorage.removeItem('cms_token');
    clearLiveCache();
    setToken(null);
    setUser(null);
    navigate('/login');
  };

  if (loadingSession) {
    return (
      <div className="session-loader">
        <div className="spinner large"></div>
        <p>Loading your dashboard…</p>
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
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route
          path="/overview"
          element={
            <Suspense fallback={<div className="session-loader"><div className="spinner large"></div></div>}>
              <Overview token={token} />
            </Suspense>
          }
        />
        <Route
          path="/accounts"
          element={
            <Suspense fallback={<div className="session-loader"><div className="spinner large"></div></div>}>
              <Accounts token={token} />
            </Suspense>
          }
        />
        <Route
          path="/automation"
          element={
            <Suspense fallback={<div className="session-loader"><div className="spinner large"></div></div>}>
              <Automation token={token} />
            </Suspense>
          }
        />
        {['/publish', '/publish/:postId'].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <Suspense fallback={<div className="session-loader"><div className="spinner large"></div></div>}>
                <PublishWizard token={token} />
              </Suspense>
            }
          />
        ))}
        <Route
          path="/profile"
          element={
            <Suspense fallback={<div className="session-loader"><div className="spinner large"></div></div>}>
              <Profile user={user} token={token} onLogout={handleLogout} />
            </Suspense>
          }
        />
        <Route path="/trends" element={<Navigate to="/instagram" replace />} />
        <Route path="/trends/:platform" element={<TrendsRedirect />} />
        <Route
          path="/:platform/:tab?"
          element={
            <Suspense fallback={<div className="session-loader"><div className="spinner large"></div></div>}>
              <PlatformPage token={token} />
            </Suspense>
          }
        />
        <Route path="/login" element={<Navigate to="/overview" replace />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
      <Footer />
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
