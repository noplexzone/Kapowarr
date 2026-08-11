import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '@/components/primitives/button';
import { Notice } from '@/components/primitives/notice';
import { useAuthStore } from '@/platform/auth/auth-store';
import { runtimeConfig } from '@/app/runtime-config';
import styles from './login-page.module.css';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, isAuthenticated } = useAuthStore();
  const navigate = useNavigate();
  const rawSearch = useSearch({ strict: false }) as { redirect?: string };
  const redirectTo = rawSearch.redirect ?? '/';

  useEffect(() => {
    if (isAuthenticated) {
      navigate({ to: redirectTo as any });
    }
  }, [isAuthenticated, navigate, redirectTo]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate({ to: redirectTo as any });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.brand}>
          <img src={runtimeConfig.assetUrl('static/img/favicon.svg')} alt="Kapowarr" className={styles.brandIcon} />
          <span className={styles.brandTitle}>Kapowarr</span>
        </div>

        <div className={styles.card}>
          <h1 className={styles.title}>Sign In</h1>

          {error && (
            <Notice tone="danger" className={styles.notice}>
              {error}
            </Notice>
          )}

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.field}>
              <label htmlFor="username" className={styles.label}>
                Username
              </label>
              <input
                id="username"
                type="text"
                className={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={loading}
                required
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>
                Password
              </label>
              <input
                id="password"
                type="password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loading}
                required
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className={styles.submitBtn}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
