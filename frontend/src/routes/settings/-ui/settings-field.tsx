import { Children, cloneElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import styles from './settings-page.module.css';

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; children?: ReactNode };

function bindControl(element: ReactElement<ControlProps>, props: ControlProps): ReactElement<ControlProps> {
  if (typeof element.type === 'string' && ['input', 'select', 'textarea'].includes(element.type)) {
    return cloneElement(element, props);
  }
  let bound = false;
  const nextChildren = Children.map(element.props.children, (child) => {
    if (bound || child == null || typeof child !== 'object' || !('type' in child)) return child;
    const candidate = child as ReactElement<ControlProps>;
    if (typeof candidate.type === 'string' && ['input', 'select', 'textarea'].includes(candidate.type)) {
      bound = true;
      return cloneElement(candidate, props);
    }
    return child;
  });
  return cloneElement(element, {}, nextChildren);
}

export function SettingsField({ label, help, error, children, id: requestedId }: { label: string; help?: string; error?: string; children: ReactElement<ControlProps>; id?: string }) {
  const generatedId = useId();
  const id = requestedId ?? `setting-${generatedId.replace(/:/g, '')}`;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const control = bindControl(children, { id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) || undefined });
  return <div className={styles.field}><label className={styles.fieldLabel} htmlFor={id}>{label}</label>{help && <p id={helpId} className={styles.fieldHelp}>{help}</p>}<div>{control}</div>{error && <p id={errorId} role="alert" className={styles.fieldError}>{error}</p>}</div>;
}
export function ToggleField({ label, help, checked, onChange, id: requestedId }: { label: string; help?: string; checked: boolean; onChange: (value: boolean) => void; id?: string }) {
  const generatedId = useId();
  const id = requestedId ?? `setting-${generatedId.replace(/:/g, '')}`;
  const helpId = help ? `${id}-help` : undefined;
  return <div className={styles.toggleField}><div><label className={styles.fieldLabel} htmlFor={id}>{label}</label>{help && <p id={helpId} className={styles.fieldHelp}>{help}</p>}</div><input id={id} aria-describedby={helpId} type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /></div>;
}
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return <section className={styles.section} aria-labelledby={headingId}><h2 id={headingId} className={styles.sectionHeader}>{title}</h2><div className={styles.sectionBody}>{children}</div></section>;
}
