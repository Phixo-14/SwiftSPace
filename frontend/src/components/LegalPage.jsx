import { Link } from 'react-router-dom';
import BrandLogo from './BrandLogo.jsx';

export default function LegalPage({ title, intro, sections }) {
  return (
    <div className="legal-page-shell">
      <div className="legal-page-card">
        <BrandLogo variant="wordmark" className="auth-card-brand" />
        <h1>{title}</h1>
        {intro && <p className="legal-page-intro">{intro}</p>}

        {sections.map((section) => (
          <section key={section.heading} className="legal-page-section">
            <h2>{section.heading}</h2>
            {section.content.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}

        <div className="legal-page-actions">
          <Link to="/register" className="btn-ghost">Back to sign up</Link>
        </div>
      </div>
    </div>
  );
}
