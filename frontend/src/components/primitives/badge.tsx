import { forwardRef, type HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './badge.module.css';

type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ tone = 'neutral', className, ...props }, ref) => (
    <span
      ref={ref}
      className={clsx(styles.badge, styles[tone], className)}
      data-tone={tone}
      {...props}
    />
  ),
);

Badge.displayName = 'Badge';
