import { Link, useLocation } from '@tanstack/react-router';
import { useEffect } from 'react';
import { NavIcon } from './nav-icons';
import { getActivePrimary, getStoredLibrarySearch, PRIMARY_NAV } from './navigation';
import styles from './mobile-navigation.module.css';

export function MobileNavigation() {
  const { pathname } = useLocation();
  const active = getActivePrimary(pathname);

  useEffect(() => {
    document.querySelectorAll('[aria-label="Mobile primary navigation"] [aria-current]').forEach((node) => node.removeAttribute('aria-current'));
  }, [pathname]);

  return (
    <nav className={styles.nav} aria-label="Mobile primary navigation">
      {PRIMARY_NAV.map((item) => {
        const isActive = active === item.label;
        return (
          <Link
            key={item.label}
            to={item.to as never}
            search={(item.label === 'Comics' || item.label === 'Manga') ? getStoredLibrarySearch() as never : undefined}
            activeOptions={item.parent ? { exact: true } : undefined}
            className={styles.link}
            data-active={isActive || undefined}
          >
            <NavIcon name={item.label} className={styles.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
