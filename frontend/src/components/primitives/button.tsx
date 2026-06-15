import { forwardRef, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', className, ...props }, ref) => (
    <button
      ref={ref}
      className={clsx(styles.button, styles[variant], className)}
      {...props}
    />
  ),
);

Button.displayName = 'Button';
