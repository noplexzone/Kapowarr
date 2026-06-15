import type { ReactNode } from 'react';

interface ShowProps<T> {
  when: T | undefined | null | false;
  fallback?: ReactNode;
  children: ReactNode | ((value: NonNullable<T>) => ReactNode);
}

export function Show<T>({ when, fallback = null, children }: ShowProps<T>): ReactNode {
  if (!when) return fallback;

  if (typeof children === 'function') {
    return (children as (value: NonNullable<T>) => ReactNode)(when as NonNullable<T>);
  }

  return children;
}
