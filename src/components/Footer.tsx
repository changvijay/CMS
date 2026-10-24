import { Link } from 'react-router-dom';
import './Footer.css';

const SITE_URL = 'https://changtechs.com/';

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <strong>CMS Analytics Studio</strong>
          <p>Instagram and YouTube analytics in one place: see what is working, and what to post next.</p>
          <a className="footer-site-link" href={SITE_URL} target="_blank" rel="noopener">← Back to changtechs.com</a>
        </div>

        <nav className="footer-col" aria-label="Pages">
          <h4>Pages</h4>
          <Link to="/overview">Overview</Link>
          <Link to="/instagram">Instagram</Link>
          <Link to="/youtube">YouTube</Link>
          <Link to="/accounts">Accounts</Link>
          <Link to="/profile">My profile</Link>
          <Link to="/automation">Auto-replies</Link>
        </nav>

        <nav className="footer-col" aria-label="Instagram sections">
          <h4>Workspace</h4>
          <Link to="/instagram/strategy">Strategy</Link>
          <Link to="/instagram/audience">Audience</Link>
          <Link to="/instagram/research">Research</Link>
          <Link to="/instagram/data">Data and export</Link>
        </nav>

        <div className="footer-col">
          <h4>About the data</h4>
          <p>Numbers come from the Instagram API and the YouTube Analytics and Data APIs. Stored history refreshes every night at 2:30 AM IST, and stories are captured every 6 hours.</p>
          <a href="/api-docs" target="_blank" rel="noreferrer">API documentation ↗</a>
        </div>
      </div>
      <div className="footer-base">
        <span>© {new Date().getFullYear()} CMS Analytics Studio · A product of <a href={SITE_URL} target="_blank" rel="noopener">changtechs.com</a></span>
        <span>Dates and times are shown in India Standard Time</span>
      </div>
    </footer>
  );
}
