import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { User } from '../services/api';
import './Navbar.css';

interface NavbarProps {
  user: User;
  onLogout: () => void;
}

function UserMenu({ user, onLogout }: NavbarProps) {
  const location = useLocation();
  // Open only while the route it was opened on is still current, so navigating closes it.
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const open = openedOnPath === location.pathname;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenedOnPath(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenedOnPath(null);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const items = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(index + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(index - 1 + list.length) % list.length]?.focus(); }
    if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
  };

  const toggle = () => {
    const next = !open;
    setOpenedOnPath(next ? location.pathname : null);
    if (next) requestAnimationFrame(() => items()[0]?.focus());
  };

  const initial = user.username.charAt(0).toUpperCase();

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        className="user-menu-trigger"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu-panel"
      >
        <span className="avatar-circle" aria-hidden="true">{initial}</span>
        <span className="user-menu-name">{user.username}</span>
        <IconChevron />
      </button>

      <div id="user-menu-panel" className="user-menu-panel" role="menu" aria-label="Account menu" hidden={!open} ref={panelRef} onKeyDown={onPanelKeyDown}>
        <div className="user-menu-head">
          <span className="avatar-circle large" aria-hidden="true">{initial}</span>
          <div>
            <strong>@{user.username}</strong>
            <span>{user.email_address}</span>
          </div>
        </div>
        <Link role="menuitem" to="/profile"><IconUser /> My profile</Link>
        <Link role="menuitem" to="/accounts"><IconLink /> Connected accounts</Link>
        <Link role="menuitem" to="/automation"><IconChat /> Auto-replies</Link>
        <div className="user-menu-sep" role="separator" />
        <button role="menuitem" className="user-menu-logout" onClick={onLogout}><IconLogOut /> Log out</button>
      </div>
    </div>
  );
}

export const Navbar: React.FC<NavbarProps> = ({ user, onLogout }) => {
  const location = useLocation();
  const isYouTube = location.pathname.startsWith('/youtube');
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const menuOpen = openedOnPath === location.pathname;
  const setMenuOpen = (value: boolean) => setOpenedOnPath(value ? location.pathname : null);

  return (
    <header className="navbar">
      <Link to="/overview" className="nav-brand" aria-label="CMS Analytics Studio, home">
        <span className={`brand-icon-wrapper ${isYouTube ? 'youtube-brand-icon' : ''}`}>
          {isYouTube ? <IconYouTubePlay /> : <IconSparkles />}
        </span>
        <span className="brand-title">CMS Analytics Studio</span>
      </Link>

      <button
        className="menu-toggle"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
      >
        {menuOpen ? <IconClose /> : <IconMenu />}
      </button>

      {menuOpen && <div className="nav-overlay" onClick={() => setMenuOpen(false)} />}

      <div className={`nav-collapsible ${menuOpen ? 'open' : ''}`}>
        <nav className="central-nav" aria-label="Main">
          <div className="platform-nav-tabs">
            <NavLink to="/overview" className={({ isActive }) => `platform-tab ${isActive ? 'active' : ''}`}>
              <span>Overview</span>
            </NavLink>
            <NavLink to="/instagram" className={({ isActive }) => `platform-tab ${isActive ? 'active' : ''}`}>
              <IconInstagram />
              <span>Instagram</span>
            </NavLink>
            <NavLink to="/youtube" className={({ isActive }) => `platform-tab ${isActive ? 'active youtube-active' : ''}`}>
              <IconYouTubePlay />
              <span>YouTube</span>
            </NavLink>
            <NavLink to="/linkedin" className={({ isActive }) => `platform-tab ${isActive ? 'active linkedin-active' : ''}`}>
              <IconLinkedIn />
              <span>LinkedIn</span>
            </NavLink>
            <NavLink to="/publish" className={({ isActive }) => `platform-tab ${isActive ? 'active' : ''}`}>
              <IconSend />
              <span>Social Post</span>
            </NavLink>
          </div>
        </nav>

        <UserMenu user={user} onLogout={onLogout} />
      </div>
    </header>
  );
};

function IconSend() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </svg>
  );
}

function IconSparkles() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3m0 12v3M3 12h3m12 0h3m-3.5-6.5l-2 2m-7 7l-2 2m0-11l2 2m7 7l2 2" />
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
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

function IconLinkedIn() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

const iconProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function IconLogOut() {
  return (<svg {...iconProps}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>);
}
function IconUser() {
  return (<svg {...iconProps}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
}
function IconLink() {
  return (<svg {...iconProps}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>);
}
function IconChat() {
  return (<svg {...iconProps}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>);
}
function IconChevron() {
  return (<svg {...iconProps} width={14} height={14}><polyline points="6 9 12 15 18 9" /></svg>);
}
function IconMenu() {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>);
}
function IconClose() {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
}
