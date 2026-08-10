import styles from './pagination.module.css';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export function Pagination({ page, pageSize, total, onPageChange, disabled = false }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 0), pageCount - 1);
  const start = total === 0 ? 0 : current * pageSize + 1;
  const end = Math.min(total, (current + 1) * pageSize);

  return (
    <nav className={styles.pagination} aria-label="Library pages">
      <span className={styles.summary} aria-live="polite">
        {start}–{end} of {total}
      </span>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.button}
          onClick={() => onPageChange(current - 1)}
          disabled={disabled || current === 0}
        >
          Previous
        </button>
        <span className={styles.page}>Page {current + 1} of {pageCount}</span>
        <button
          type="button"
          className={styles.button}
          onClick={() => onPageChange(current + 1)}
          disabled={disabled || current >= pageCount - 1}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
