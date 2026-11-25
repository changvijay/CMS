import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Login } from './components/Login';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { pageLoaders } from './pageLoaders';
const PlatformPage = lazy(pageLoaders.platform);
const Overview = lazy(pageLoaders.overview);
const Accounts = lazy(pageLoaders.accounts);
const Profile = lazy(pageLoaders.profile);
const Automation = lazy(pageLoaders.automation);
const PublishWizard = lazy(pageLoaders.publish);
const FacebookPage = lazy(pageLoaders.facebook);
const ScriptsPage = lazy(pageLoaders.scripts);
const VideoAiHome = lazy(pageLoaders.videoAi);
const AnalysisPage = lazy(pageLoaders.videoAiReport);
import { getCurrentUser, type User } from './services/api';
import { clearLiveCache, hydrateLiveCache } from './components/workspace/useLive';
import { clearSession, getAccessToken, logoutSession, onTokenChange, saveSession } from './services/client';
import './App.css';
import { PageSkeleton } from './components/Skeleton';

/** Old /trends/:platform links now live inside the platform workspace. */
function TrendsRedirect() {
  const { platform } = useParams();
  return <Navigate to={platform === 'youtube' || platform === 'linkedin' ? `/${platform}` : '/instagram'} replace />;
}

const USER_KEY = 'cms_user';

function readCachedUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* storage blocked */
  }
}

function MainApp() {
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState<boolean>(true);
  const navigate = useNavigate();
  const location = useLocation();

  // Follow token changes made by silent refreshes (and by other tabs), and sign out when the session ends.
  useEffect(() => {
    const stopLocal = onTokenChange((next) => {
      setToken(next);
      if (!next) {
        writeCachedUser(null);
        clearLiveCache();
        setUser(null);
      }
    });
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cms_token') {
        setToken(e.newValue);
        if (!e.newValue) {
          clearLiveCache();
          setUser(null);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      stopLocal();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Runs once on load: the session is checked a single time, later token swaps don't re-run it.
  useEffect(() => {
    async function verifySession() {
      const stored = getAccessToken();
      if (!stored) {
        setLoadingSession(false);
        return;
      }

      try {
        // getCurrentUser refreshes an expired access token by itself (apiFetch).
        const currentUser = await getCurrentUser(stored);
        await hydrateLiveCache(currentUser.id);
        writeCachedUser(currentUser);
        setUser(currentUser);
      } catch (err) {
        // apiFetch already tried a refresh. A token still being here means the server couldn't be reached
        // (offline, deploy in progress): stay signed in with the last known profile instead of logging out.
        const cachedUser = getAccessToken() ? readCachedUser() : null;
        if (cachedUser) {
          await hydrateLiveCache(cachedUser.id);
          setUser(cachedUser);
          return;
        }
        console.warn('Session verification failed, logging out:', err);
        clearSession();
        clearLiveCache();
        setToken(null);
        setUser(null);
      } finally {
        setLoadingSession(false);
      }
    }

    verifySession();
  }, []);

  const handleLoginSuccess = (newToken: string, loggedInUser: User, refreshToken?: string) => {
    clearLiveCache();
    saveSession(newToken, refreshToken ?? null);
    void hydrateLiveCache(loggedInUser.id);
    writeCachedUser(loggedInUser);
    setToken(newToken);
    setUser(loggedInUser);
    navigate('/overview');
  };

  const handleLogout = () => {
    void logoutSession();
    writeCachedUser(null);
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
        <Route
          path="/scripts/:tab?/:id?"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <ScriptsPage token={token} user={user} />
            </Suspense>
          }
        />
        <Route
          path="/analysis"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <VideoAiHome token={token} />
            </Suspense>
          }
        />
        <Route
          path="/analysis/:platform/:accountId/:mediaId"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <AnalysisPage token={token} />
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
