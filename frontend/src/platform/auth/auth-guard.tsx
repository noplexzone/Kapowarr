import { useEffect } from 'react';
import { useNavigate, useLocation } from '@tanstack/react-router';
import { useAuthStore } from './auth-store';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isChecking, authRequired, initialized, checkAuth } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (initialized && !isChecking && authRequired && !isAuthenticated) {
      navigate({ to: '/login', search: { redirect: pathname } });
    }
  }, [initialized, isAuthenticated, isChecking, authRequired, navigate, pathname]);

  if (!initialized || isChecking) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--surface)',
        color: 'var(--text-dim)',
        fontSize: '0.9rem',
        letterSpacing: '0.02em',
      }}>
        Loading…
      </div>
    );
  }

  if (authRequired && !isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
