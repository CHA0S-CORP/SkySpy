/**
 * Login Page — "Ground Station Console"
 *
 * A tactical two-pane sign-in: a live radar scope hero (left) with HUD
 * telemetry read-outs, paired with an instrument-bezel auth console (right).
 * Styled in the v2 design language (IBM Plex, deep bg0, green/cyan accents)
 * so it reads as part of the SkySpy platform, not a bolt-on.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  LogIn,
  KeyRound,
  AlertCircle,
  Loader2,
  Radio,
  User,
  Lock,
  ChevronRight,
} from 'lucide-react';

// Deterministic-ish scatter of contacts for the scope. Bearings/ranges are
// spread so tracks don't clump; speeds vary so the sweep feels alive.
function generateContacts(count = 7) {
  return Array.from({ length: count }, (_, i) => {
    const bearing = (i * 360) / count + (Math.random() * 40 - 20);
    return {
      id: i,
      bearing, // degrees, 0 = up
      reach: 26 + Math.random() * 16, // % of scope radius the track travels
      speed: 9 + Math.random() * 10, // seconds per outbound run
      delay: -(Math.random() * 14), // desync the fleet
      kind: i % 3, // color band
    };
  });
}

function RadarScope() {
  const [contacts] = useState(() => generateContacts(7));

  return (
    <div className="lp-scope" aria-hidden="true">
      <div className="lp-scope__field">
        {/* Range rings */}
        {[1, 2, 3, 4].map((r) => (
          <div key={r} className="lp-ring" style={{ '--r': `${r * 25}%` }} />
        ))}

        {/* Cardinal crosshair */}
        <div className="lp-cross lp-cross--h" />
        <div className="lp-cross lp-cross--v" />

        {/* Rotating sweep beam */}
        <div className="lp-sweep" />

        {/* Contacts, emitted from the origin along a bearing */}
        {contacts.map((c) => (
          <div
            key={c.id}
            className="lp-track"
            data-kind={c.kind}
            style={{
              '--bearing': `${c.bearing}deg`,
              '--reach': `${c.reach}%`,
              '--speed': `${c.speed}s`,
              '--delay': `${c.delay}s`,
            }}
          >
            <span className="lp-track__trail" />
            <span className="lp-track__blip" />
          </div>
        ))}

        {/* Origin marker */}
        <div className="lp-origin" />
      </div>

      {/* Fine grid + scanline atmosphere */}
      <div className="lp-grid" />
      <div className="lp-scan" />
    </div>
  );
}

function useUtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}Z`;
}

function ScopeHud() {
  const utc = useUtcClock();
  return (
    <div className="lp-hud" aria-hidden="true">
      <div className="lp-hud__row lp-hud__row--top">
        <span className="lp-hud__tag">STATION · SKYSPY-1</span>
        <span className="lp-hud__tag">{utc}</span>
      </div>
      <div className="lp-hud__row lp-hud__row--bot">
        <span className="lp-hud__tag">1090 · 978 MHz</span>
        <span className="lp-hud__tag lp-hud__tag--live">
          <span className="lp-led" /> SIGNAL ACQUIRED
        </span>
      </div>
      <div className="lp-hud__corner lp-hud__corner--tl" />
      <div className="lp-hud__corner lp-hud__corner--tr" />
      <div className="lp-hud__corner lp-hud__corner--bl" />
      <div className="lp-hud__corner lp-hud__corner--br" />
    </div>
  );
}

function Wordmark() {
  return (
    <div className="lp-brand">
      <div className="lp-brand__mark">
        <Radio size={26} strokeWidth={1.6} />
      </div>
      <div className="lp-brand__type">
        <div className="lp-brand__word">
          <span className="lp-brand__sky">Sky</span>
          <span className="lp-brand__spy">Spy</span>
        </div>
        <div className="lp-brand__tag">Aircraft Intelligence Platform</div>
      </div>
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
      setLocalError('Enter username and password to continue');
      return;
    }

    setIsSubmitting(true);
    const result = await login(username, password);
    setIsSubmitting(false);

    if (!result.success) {
      setLocalError(result.error || 'Authentication failed');
    }
  };

  const handleOIDCLogin = async () => {
    setLocalError('');
    clearError();
    setIsSubmitting(true);

    try {
      await loginWithOIDC();
    } catch (err) {
      setLocalError(err.message || 'SSO sign-in failed');
    }

    setIsSubmitting(false);
  };

  const displayError = localError || error;

  return (
    <div className={`lp ${mounted ? 'lp--in' : ''}`}>
      {/* LEFT — radar scope hero */}
      <section className="lp-pane lp-pane--scope">
        <RadarScope />
        <ScopeHud />
        <div className="lp-pane__vignette" />
      </section>

      {/* RIGHT — auth console */}
      <section className="lp-pane lp-pane--console">
        <div className="lp-console">
          <div className="lp-console__bezel">
            <span className="lp-tick lp-tick--tl" />
            <span className="lp-tick lp-tick--tr" />
            <span className="lp-tick lp-tick--bl" />
            <span className="lp-tick lp-tick--br" />

            <header className="lp-console__head">
              <Wordmark />
              <div className="lp-console__status">
                <span className="lp-led lp-led--sm" />
                <span>{isLoading ? 'ESTABLISHING LINK' : 'SECURE CHANNEL'}</span>
              </div>
            </header>

            {isLoading ? (
              <div className="lp-boot">
                <Radio size={22} className="lp-boot__icon" />
                <span>Initializing secure connection…</span>
              </div>
            ) : (
              <>
                {displayError && (
                  <div className="lp-alert" role="alert">
                    <AlertCircle size={15} />
                    <span>{displayError}</span>
                  </div>
                )}

                <div className="lp-console__body">
                  {config.localAuthEnabled && (
                    <form onSubmit={handleSubmit} className="lp-form">
                      <div className="lp-field">
                        <label htmlFor="username" className="lp-label">
                          Operator ID
                        </label>
                        <div className="lp-input">
                          <User size={16} className="lp-input__glyph" />
                          <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="username or email"
                            disabled={isSubmitting}
                            autoComplete="username"
                            // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional for login form UX
                            autoFocus
                          />
                        </div>
                      </div>

                      <div className="lp-field">
                        <label htmlFor="password" className="lp-label">
                          Passphrase
                        </label>
                        <div className="lp-input">
                          <Lock size={16} className="lp-input__glyph" />
                          <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••••"
                            disabled={isSubmitting}
                            autoComplete="current-password"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="lp-btn lp-btn--primary"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 size={17} className="lp-spin" />
                            <span>Authenticating…</span>
                          </>
                        ) : (
                          <>
                            <LogIn size={17} />
                            <span>Sign In</span>
                            <ChevronRight size={17} className="lp-btn__go" />
                          </>
                        )}
                      </button>
                    </form>
                  )}

                  {config.localAuthEnabled && config.oidcEnabled && (
                    <div className="lp-divider">
                      <span>or continue with</span>
                    </div>
                  )}

                  {config.oidcEnabled && (
                    <button
                      type="button"
                      className="lp-btn lp-btn--oidc"
                      onClick={handleOIDCLogin}
                      disabled={isSubmitting}
                    >
                      <KeyRound size={17} />
                      <span>{config.oidcProviderName || 'Single Sign-On'}</span>
                    </button>
                  )}
                </div>
              </>
            )}

            <footer className="lp-console__foot">
              <div className="lp-caps">
                <span>Real-time Tracking</span>
                <i />
                <span>ADS-B Intelligence</span>
                <i />
                <span>Safety Monitoring</span>
              </div>
              <div className="lp-console__meta">
                <span>Secure Aircraft Monitoring System</span>
                <span className="lp-console__ver">v2.0</span>
              </div>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}
