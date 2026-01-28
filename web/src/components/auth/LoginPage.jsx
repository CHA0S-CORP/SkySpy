/**
 * Login Page Component
 *
 * Premium login experience with animated radar background and SkySpy branding.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { LogIn, KeyRound, AlertCircle, Loader2, Radio, Plane } from 'lucide-react';

// Generate random aircraft for background animation
function generateAircraft(count = 8) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    rotation: Math.random() * 360,
    speed: 15 + Math.random() * 25,
    delay: Math.random() * 10,
    size: 12 + Math.random() * 8,
  }));
}

function RadarBackground() {
  const [aircraft] = useState(() => generateAircraft(8));

  return (
    <div className="login-radar-bg">
      {/* Radar sweep */}
      <div className="radar-sweep" />

      {/* Concentric rings */}
      <div className="radar-rings">
        {[1, 2, 3, 4, 5].map((ring) => (
          <div
            key={ring}
            className="radar-ring-login"
            style={{ '--ring-size': `${ring * 20}%` }}
          />
        ))}
      </div>

      {/* Crosshairs */}
      <div className="radar-crosshair-login" />

      {/* Animated aircraft blips */}
      <div className="radar-aircraft">
        {aircraft.map((plane) => (
          <div
            key={plane.id}
            className="radar-blip"
            style={{
              '--start-x': `${plane.x}%`,
              '--start-y': `${plane.y}%`,
              '--rotation': `${plane.rotation}deg`,
              '--speed': `${plane.speed}s`,
              '--delay': `-${plane.delay}s`,
              '--size': `${plane.size}px`,
            }}
          >
            <Plane size={plane.size} />
          </div>
        ))}
      </div>

      {/* Grid overlay */}
      <div className="radar-grid-overlay" />
    </div>
  );
}

function SkySkyLogo({ size = 'large' }) {
  const iconSize = size === 'large' ? 48 : 32;

  return (
    <div className={`skyspy-logo ${size}`}>
      <div className="logo-icon-wrapper">
        <div className="logo-pulse-ring" />
        <div className="logo-pulse-ring delay" />
        <div className="logo-icon">
          <Radio size={iconSize} strokeWidth={1.5} />
        </div>
      </div>
      <div className="logo-text">
        <span className="logo-sky">Sky</span>
        <span className="logo-spy">Spy</span>
      </div>
      {size === 'large' && (
        <div className="logo-tagline">Aircraft Intelligence Platform</div>
      )}
    </div>
  );
}

export default function LoginPage() {
  const { login, loginWithOIDC, config, error, clearError, isLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    clearError();

    if (!username || !password) {
      setLocalError('Please enter username and password');
      return;
    }

    setIsSubmitting(true);
    const result = await login(username, password);
    setIsSubmitting(false);

    if (!result.success) {
      setLocalError(result.error || 'Login failed');
    }
  };

  const handleOIDCLogin = async () => {
    setLocalError('');
    clearError();
    setIsSubmitting(true);

    try {
      await loginWithOIDC();
    } catch (err) {
      setLocalError(err.message || 'OIDC login failed');
    }

    setIsSubmitting(false);
  };

  const displayError = localError || error;

  if (isLoading) {
    return (
      <div className="login-page">
        <RadarBackground />
        <div className={`login-card ${mounted ? 'mounted' : ''}`}>
          <div className="login-loading">
            <div className="loading-radar">
              <Radio size={32} className="pulse" />
            </div>
            <span>Initializing secure connection...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <RadarBackground />

      <div className={`login-card ${mounted ? 'mounted' : ''}`}>
        <div className="login-header">
          <SkySkyLogo size="large" />
        </div>

        {displayError && (
          <div className="login-error">
            <AlertCircle size={16} />
            <span>{displayError}</span>
          </div>
        )}

        <div className="login-content">
          {config.localAuthEnabled && (
            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label htmlFor="username">
                  <span className="label-text">Username or Email</span>
                </label>
                <div className="input-wrapper">
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your credentials"
                    disabled={isSubmitting}
                    autoComplete="username"
                    autoFocus
                  />
                  <div className="input-glow" />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="password">
                  <span className="label-text">Password</span>
                </label>
                <div className="input-wrapper">
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    disabled={isSubmitting}
                    autoComplete="current-password"
                  />
                  <div className="input-glow" />
                </div>
              </div>

              <button
                type="submit"
                className="login-button primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <LogIn size={18} />
                    <span>Sign In</span>
                  </>
                )}
                <div className="button-shine" />
              </button>
            </form>
          )}

          {config.localAuthEnabled && config.oidcEnabled && (
            <div className="login-divider">
              <span>or continue with</span>
            </div>
          )}

          {config.oidcEnabled && (
            <div className="login-oidc-section">
              <button
                type="button"
                className="login-button oidc"
                onClick={handleOIDCLogin}
                disabled={isSubmitting}
              >
                <KeyRound size={18} />
                <span>{config.oidcProviderName || 'Single Sign-On'}</span>
              </button>
            </div>
          )}
        </div>

        <div className="login-footer">
          <div className="footer-stats">
            <div className="stat">
              <Plane size={14} />
              <span>Real-time Tracking</span>
            </div>
            <div className="stat-divider" />
            <div className="stat">
              <Radio size={14} />
              <span>ADS-B Intelligence</span>
            </div>
          </div>
          <p className="footer-copyright">Secure Aircraft Monitoring System</p>
        </div>
      </div>

      {/* Version badge */}
      <div className="login-version">
        <span>SkySpy v2.0</span>
      </div>
    </div>
  );
}
