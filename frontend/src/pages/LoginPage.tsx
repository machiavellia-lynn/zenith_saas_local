import { useState } from "react";

interface Props {
  /** Called after a successful (mock) sign-in. */
  onSignedIn?: () => void;
}

/**
 * Gate screen for the terminal.
 *
 * This build has no backend, so it CANNOT authenticate anyone. Rather than
 * fake a login that appears to verify credentials, it accepts any non-empty
 * input and says plainly that it is a demo gate. Pretending otherwise would be
 * the one kind of dishonesty a trading tool must never ship.
 */
export default function LoginPage({ onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim() === "" || password === "") {
      setError("Enter any email and password to continue.");
      return;
    }
    setError(null);
    if (onSignedIn) onSignedIn();
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="login-mark">◤</span>
          <span className="login-title">ZENITH TERMINAL</span>
        </div>
        <div className="login-sub">IDX smart money dashboard</div>

        <label className="login-label" htmlFor="login-email">
          EMAIL
        </label>
        <input
          id="login-email"
          className="login-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="login-label" htmlFor="login-password">
          PASSWORD
        </label>
        <input
          id="login-password"
          className="login-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error !== null && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="btn login-submit">
          ENTER TERMINAL
        </button>

        <div className="login-note">
          Demo build · no backend. Any non-empty credentials open the terminal; nothing is
          verified or stored.
        </div>
      </form>
    </div>
  );
}
