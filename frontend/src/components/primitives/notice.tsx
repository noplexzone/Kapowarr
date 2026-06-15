import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './notice.module.css';

type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

export interface NoticeProps extends HTMLAttributes<HTMLDivElement> {
  tone?: NoticeTone;
  icon?: ReactNode;
}

export const Notice = forwardRef<HTMLDivElement, NoticeProps>(
  ({ tone = 'info', icon, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={clsx(styles.notice, styles[tone], className)}
      role="alert"
      {...props}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      <span className={styles.body}>{children}</span>
    </div>
  ),
);

Notice.displayName = 'Notice';
