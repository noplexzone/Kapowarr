import { forwardRef, type HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './progress.module.css';

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
}

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ value, className, ...props }, ref) => {
    const clampedValue = Math.max(0, Math.min(100, value));

    return (
      <div
        ref={ref}
        className={clsx(styles.track, className)}
        role="progressbar"
        aria-valuenow={clampedValue}
        aria-valuemin={0}
        aria-valuemax={100}
        {...props}
      >
        <div
          className={styles.fill}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    );
  },
);

Progress.displayName = 'Progress';
