import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/primitives';
import { useAuthenticatedObjectUrl } from '@/components/authenticated-resource';
import { fileInfoQueryOptions } from '../-reader.api';
import styles from './reader-page.module.css';

// ── SVG icon components ──────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export function ReaderPage() {
  const { fileId: fileIdParam } = useParams({ strict: false }) as {
    fileId: string;
  };
  const fileId = parseInt(fileIdParam ?? '0', 10);
  const navigate = useNavigate();

  const [currentPage, setCurrentPage] = useState(0);
  const [showHints, setShowHints] = useState(true);
  const [fitMode, setFitMode] = useState<'page' | 'width'>('page');

  const { data: fileInfo, isLoading, error } = useQuery(
    fileInfoQueryOptions(fileId),
  );

  const handleClose = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate({ to: '/comics' });
    }
  }, [navigate]);

  const handlePrev = useCallback(() => {
    setCurrentPage((p) => Math.max(0, p - 1));
  }, []);

  const handleNext = useCallback(() => {
    setCurrentPage((p) =>
      fileInfo ? Math.min(fileInfo.page_count - 1, p + 1) : p,
    );
  }, [fileInfo]);

  useEffect(() => {
    const timer = setTimeout(() => setShowHints(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        handleNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        handlePrev();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, handleNext, handlePrev]);

  const filename = fileInfo ? basename(fileInfo.filepath) : '';
  const isPdf = fileInfo?.is_pdf ?? false;
  const pageCount = fileInfo?.page_count ?? 0;
  const pageLabel = useMemo(() => {
    if (!fileInfo) return '';
    return isPdf ? 'PDF document' : `Page ${currentPage + 1} of ${pageCount}`;
  }, [currentPage, fileInfo, isPdf, pageCount]);
  const pageSrc = useAuthenticatedObjectUrl(fileInfo && !isPdf && pageCount > 0 ? `files/${fileId}/page/${currentPage}` : null);
  const pdfSrc = useAuthenticatedObjectUrl(fileInfo && isPdf ? `files/${fileId}/raw` : null);

  return (
    <div className={styles.overlay}>
      <div className={styles.topBar}>
        <div className={styles.titleBlock}>
          <span className={styles.filename}>{filename}</span>
          <span className={styles.pageIndicator}>{pageLabel}</span>
        </div>
        {!isPdf && fileInfo && pageCount > 0 && (
          <button
            type="button"
            className={styles.fitBtn}
            aria-pressed={fitMode === 'width'}
            onClick={() => setFitMode((mode) => (mode === 'page' ? 'width' : 'page'))}
          >
            {fitMode === 'page' ? 'Fit Width' : 'Fit Page'}
          </button>
        )}
        <button
          type="button"
          className={styles.closeBtn}
          title="Close reader"
          aria-label="Close reader"
          onClick={handleClose}
        >
          <CloseIcon />
        </button>
      </div>

      {isLoading && (
        <div className={styles.centered}>
          <p>Loading…</p>
        </div>
      )}

      {!isLoading && (error || !fileInfo) && (
        <div className={styles.centered}>
          <p>File not found or failed to load.</p>
          <Link to="/comics" className={styles.backLink}>
            ← Back to Library
          </Link>
        </div>
      )}

      {!isLoading && fileInfo && !isPdf && pageCount === 0 && (
        <div className={styles.centered}>
          <p>No pages found in this file.</p>
        </div>
      )}

      {!isLoading && fileInfo && isPdf && (
        <div className={styles.content}>
          <iframe
            title={filename || 'PDF document'}
            src={pdfSrc ?? undefined}
            className={styles.pdfEmbed}
          />
        </div>
      )}

      {!isLoading && fileInfo && !isPdf && pageCount > 0 && (
        <>
          <div className={styles.content}>
            <button
              type="button"
              className={styles.navArrowLeft}
              title="Previous page"
              aria-label="Previous page"
              disabled={currentPage <= 0}
              onClick={(e) => {
                e.stopPropagation();
                handlePrev();
              }}
            >
              <ChevronLeftIcon />
            </button>

            <img
              key={currentPage}
              className={`${styles.pageImage} ${fitMode === 'width' ? styles.fitWidth : styles.fitPage}`}
              src={pageSrc ?? undefined}
              alt={`Page ${currentPage + 1}`}
              onClick={handleNext}
            />

            <button
              type="button"
              className={styles.navArrowRight}
              title="Next page"
              aria-label="Next page"
              disabled={currentPage >= pageCount - 1}
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
            >
              <ChevronRightIcon />
            </button>

            {showHints && (
              <div className={styles.hints}>
Tap page or use ← → · Esc closes
              </div>
            )}
          </div>

          <div className={styles.bottomBar}>
            <Button
              variant="secondary"
              onClick={handlePrev}
              disabled={currentPage <= 0}
            >
              Prev
            </Button>
            <div className={styles.scrubberWrap}>
              <span className={styles.pageCounter}>
                {currentPage + 1} / {pageCount}
              </span>
              <input
                className={styles.scrubber}
                type="range"
                aria-label="Reader page"
                min={1}
                max={pageCount}
                value={currentPage + 1}
                onChange={(event) => setCurrentPage(Number(event.target.value) - 1)}
              />
            </div>
            <Button
              variant="secondary"
              onClick={handleNext}
              disabled={currentPage >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
