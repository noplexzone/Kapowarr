import { Link, useLocation } from '@tanstack/react-router';
import { NavIcon } from './nav-icons';
import { getActivePrimary, getStoredLibrarySearch, PRIMARY_NAV } from './navigation';
import styles from './mobile-navigation.module.css';

export function MobileNavigation() {
  const { pathname } = useLocation();
  const active = getActivePrimary(pathname);

  return (
    <nav className={styles.nav} aria-label="Mobile primary navigation">
      {PRIMARY_NAV.map((item) => {
        const isActive = active === item.label;
        return (
          <Link
            key={item.label}
            to={item.to as never}
            search={item.label === 'Library' ? getStoredLibrarySearch() as never : undefined}
            activeOptions={item.parent ? { exact: true } : undefined}
            className={styles.link}
            data-active={isActive || undefined}
            activeProps={{ 'aria-current': item.parent ? false : 'page' }}
            aria-current={isActive && !item.parent ? 'page' : undefined}
          >
            <NavIcon name={item.label} className={styles.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
