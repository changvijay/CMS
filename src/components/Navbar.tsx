import React from 'react';
import type { User } from '../services/api';

interface NavbarProps {
  user: User;
  onLogout: () => void;
  activePlatform: 'instagram' | 'youtube';
  onSwitchPlatform: (platform: 'instagram' | 'youtube') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onLogout,
  activePlatform,
  onSwitchPlatform,
}) => {
  return (
    <header className="navbar">
      <div className="nav-brand">
        <div className={`brand-icon-wrapper ${activePlatform === 'youtube' ? 'youtube-brand-icon' : ''}`}>
          {activePlatform === 'youtube' ? <IconYouTubePlay /> : <IconSparkles />}
        </div>
        <span className="brand-title">CMS Analytics Studio</span>
      </div>

      {/* Central Navigation Items: Only Instagram and YouTube */}
      <nav className="central-nav">
        <div className="platform-nav-tabs">
          <button
            className={`platform-tab ${activePlatform === 'instagram' ? 'active' : ''}`}
            onClick={() => onSwitchPlatform('instagram')}
            title="Switch to Instagram Page"
          >
            <IconInstagram />
            <span>Instagram</span>
          </button>

          <button
            className={`platform-tab ${activePlatform === 'youtube' ? 'active youtube-active' : ''}`}
            onClick={() => onSwitchPlatform('youtube')}
            title="Switch to YouTube Page"
          >
            <IconYouTubePlay />
            <span>YouTube</span>
          </button>
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
