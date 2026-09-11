import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { User } from '../services/api';
import './Navbar.css';

interface NavbarProps {
  user: User;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onLogout,
}) => {
  const location = useLocation();
  const isYouTube = location.pathname.startsWith('/youtube');
  const [menuOpen, setMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className="navbar">
      <div className="nav-brand">
        <div className={`brand-icon-wrapper ${isYouTube ? 'youtube-brand-icon' : ''}`}>
          {isYouTube ? <IconYouTubePlay /> : <IconSparkles />}
        </div>
        <span className="brand-title">CMS Analytics Studio</span>
      </div>

      {/* Hamburger toggle - mobile only */}
      <button
        className="menu-toggle"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
      >
        {menuOpen ? <IconClose /> : <IconMenu />}
      </button>

      {/* Overlay behind mobile menu */}
      {menuOpen && <div className="nav-overlay" onClick={() => setMenuOpen(false)} />}

      <div className={`nav-collapsible ${menuOpen ? 'open' : ''}`}>
        {/* Central Navigation Items: Only Instagram and YouTube */}
        <nav className="central-nav">
          <div className="platform-nav-tabs">
            <NavLink
              to="/instagram"
              className={({ isActive }) => `platform-tab ${isActive ? 'active' : ''}`}
              title="Switch to Instagram Page"
            >
              <IconInstagram />
              <span>Instagram</span>
            </NavLink>

            <NavLink
              to="/youtube"
              className={({ isActive }) => `platform-tab ${isActive ? 'active youtube-active' : ''}`}
              title="Switch to YouTube Page"
            >
              <IconYouTubePlay />
              <span>YouTube</span>
            </NavLink>
          </div>
        </nav>

        {/* User Information & Logout Button */}
        <div className="nav-user">
          <div className="user-badge">
            <div className="avatar-circle">{user.username.charAt(0).toUpperCase()}</div>
            <div className="user-meta">
              <span className="user-name">@{user.username}</span>
              <span className="user-email">{user.email_address}</span>
            </div>
          </div>
          <button onClick={onLogout} className="logout-btn" title="Sign Out">
            <IconLogOut />
            <span className="logout-text">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};

/* SVG Icons */
function IconSparkles() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v3m0 12v3M3 12h3m12 0h3m-3.5-6.5l-2 2m-7 7l-2 2m0-11l2 2m7 7l2 2" />
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
    </svg>
  );
}

function IconYouTubePlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function IconLogOut() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}