import { useState, type FormEvent } from 'react';
import { login, loginGuest, register } from '../auth/authApi.ts';
import { useAuthStore } from '../auth/authStore.ts';

type AuthMode = 'login' | 'register';

export function AuthPage() {
  const setSession = useAuthStore((state) => state.setSession);
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function completeAuth(action: () => Promise<{ token: string; userId: string }>): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const session = await action();
      setSession(session.token, session.userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setPending(false);
    }
  }

  function onGuest(): void {
    void completeAuth(loginGuest);
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      setError('username and password are required');
      return;
    }
    void completeAuth(() =>
      mode === 'register' ? register(trimmedUser, password) : login(trimmedUser, password),
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Shooter 2D</h1>
        <button type="button" className="auth-guest" disabled={pending} onClick={onGuest}>
          Play as Guest
        </button>
        <div className="auth-divider">Login / Register</div>
        <div className="auth-mode">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            disabled={pending}
            onClick={() => setMode('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            disabled={pending}
            onClick={() => setMode('register')}
          >
            Register
          </button>
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              value={username}
              disabled={pending}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              disabled={pending}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pending}>
            {mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>
        {error ? <p className="auth-error">{error}</p> : null}
      </section>
    </main>
  );
}
