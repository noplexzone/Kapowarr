import { useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { Button } from './button';
import styles from './interaction.module.css';

interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange, className }: { label: string; value: T; options: readonly SegmentOption<T>[]; onChange: (value: T) => void; className?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function move(index: number, direction: number) {
    for (let step = 1; step <= options.length; step += 1) {
      const next = (index + direction * step + options.length) % options.length;
      if (!options[next].disabled) {
        onChange(options[next].value);
        refs.current[next]?.focus();
        return;
      }
    }
  }
  return <div className={clsx(styles.segmented, className)} role="radiogroup" aria-label={label}>
    {options.map((option, index) => <button
      key={option.value}
      ref={(node) => { refs.current[index] = node; }}
      type="button"
      role="radio"
      aria-checked={value === option.value}
      disabled={option.disabled}
      tabIndex={value === option.value ? 0 : -1}
      className={clsx(styles.segment, value === option.value && styles.segmentActive)}
      onClick={() => onChange(option.value)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(index, 1); }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(index, -1); }
        if (event.key === 'Home') { event.preventDefault(); move(-1, 1); }
        if (event.key === 'End') { event.preventDefault(); move(0, -1); }
      }}
    >{option.label}</button>)}
  </div>;
}

export function SelectionControl({ checked, onChange, label, className }: { checked: boolean; onChange: (checked: boolean) => void; label: string; className?: string }) {
  return <label className={clsx(styles.selectionTarget, className)}>
    <input className={styles.selectionInput} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} />
    <span className={styles.selectionIndicator} data-testid="selection-indicator" aria-hidden="true">{checked ? '✓' : ''}</span>
  </label>;
}

export function BulkActionBar({ count, onClear, children, className }: { count: number; onClear: () => void; children: ReactNode; className?: string }) {
  return <div className={clsx(styles.bulkBar, className)} data-testid="bulk-toolbar">
    <span role="status" aria-live="polite">{count} selected</span>
    <div className={styles.bulkActions}>{children}</div>
    <Button type="button" variant="ghost" onClick={onClear} disabled={count === 0} aria-label="Clear selection">Clear</Button>
  </div>;
}

export function Skeleton({ label = 'Loading', className }: { label?: string; className?: string }) {
  return <div className={clsx(styles.skeleton, className)} aria-label={label} aria-busy="true"><span className={styles.srOnly}>{label}</span></div>;
}
