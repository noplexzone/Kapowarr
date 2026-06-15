import { forwardRef, type HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={clsx(styles.card, className)} {...props} />
  ),
);

Card.displayName = 'Card';
