import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Login } from './components/Login';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
const PlatformPage = lazy(() => import('./components/workspace/PlatformPage'));
const Overview = lazy(() => import('./components/Overview'));
const Accounts = lazy(() => import('./components/Accounts'));
const Profile = lazy(() => import('./components/Profile'));
const Automation = lazy(() => import('./components/Automation'));
const PublishWizard = lazy(() => import('./components/publish/PublishWizard'));
const FacebookPage = lazy(() => import('./components/workspace/FacebookPage'));
import { getCurrentUser, type User } from './services/api';
import { clearLiveCache } from './components/workspace/useLive';
import './App.css';
import { PageSkeleton } from './components/Skeleton';

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
  const location = useLocation();

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
      <div className="app-root">
        <PageSkeleton />
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
      {/* A crash in one page shows an error there instead of a blank screen; moving to another page clears it. */}
      <ErrorBoundary resetKey={location.pathname}>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route
          path="/overview"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <Overview token={token} />
            </Suspense>
          }
        />
        <Route
          path="/accounts"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <Accounts token={token} />
            </Suspense>
          }
        />
        <Route
          path="/automation"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <Automation token={token} />
            </Suspense>
          }
        />
        {['/publish', '/publish/:postId'].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <Suspense fallback={<PageSkeleton />}>
                <PublishWizard token={token} />
              </Suspense>
            }
          />
        ))}
        <Route
          path="/profile"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <Profile user={user} token={token} onLogout={handleLogout} />
            </Suspense>
          }
        />
        <Route
          path="/facebook/:tab?"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <FacebookPage token={token} />
            </Suspense>
          }
        />
        <Route path="/trends" element={<Navigate to="/instagram" replace />} />
        <Route path="/trends/:platform" element={<TrendsRedirect />} />
        <Route
          path="/:platform/:tab?"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <PlatformPage token={token} />
            </Suspense>
          }
        />
        <Route path="/login" element={<Navigate to="/overview" replace />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
      </ErrorBoundary>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <MainApp />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
