import { useId, type ReactNode } from 'react';
import styles from './patterns.module.css';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className={styles.pageHeader}>
      <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <section className={styles.emptyState} aria-labelledby={undefined}>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </section>
  );
}

export function StatusBanner({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={error ? styles.error : styles.status} role={error ? 'alert' : 'status'}>{children}</div>;
}

export function FormField({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) => ReactNode;
}) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {help && <p id={helpId} className={styles.help}>{help}</p>}
      {error && <p id={errorId} className={styles.fieldError} role="alert">{error}</p>}
    </div>
  );
}
