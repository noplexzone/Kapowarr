import { forwardRef, type HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './progress.module.css';

export type ProgressTone = 'accent' | 'success' | 'danger';

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  tone?: ProgressTone;
}

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ value, tone = 'accent', className, ...props }, ref) => {
    const clampedValue = Math.max(0, Math.min(100, value));

    return (
      <div
        ref={ref}
        className={clsx(styles.track, className)}
        role="progressbar"
        aria-valuenow={clampedValue}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${clampedValue}% complete`}
        {...props}
      >
        <div
          className={clsx(styles.fill, styles[tone])}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    );
  },
);

Progress.displayName = 'Progress';
