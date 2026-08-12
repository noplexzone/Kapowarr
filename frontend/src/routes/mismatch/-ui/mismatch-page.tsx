import { useState, useCallback, useEffect } from 'react';
import { Badge, Button, Notice } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody, DialogFooter } from '@/components/dialog';
import { scanMismatch, matchItems, deleteFolders } from '../-mismatch.api';
import type { MismatchItem } from '../-mismatch.types';
import styles from './mismatch-page.module.css';

interface MismatchPageProps {
  section: 'comic' | 'manga';
}

export function MismatchPage({ section }: MismatchPageProps) {
  const [scanning, setScanning] = useState(false);
  const [items, setItems] = useState<MismatchItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startScan = useCallback(async () => {
    setScanning(true);
    setItems([]);
    setSelected(new Set());
    setError('');
    setSuccess('');
    try {
      for await (const item of scanMismatch(section)) {
        setItems((prev) => [...prev, item]);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setScanning(false);
    }
  }, [section]);

  useEffect(() => {
    startScan();
  }, [startScan]);

  const toggleSelect = (folder: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(items.map((i) => i.folder)));

  const handleMatchItem = async (item: MismatchItem) => {
    if (!item.cv_id) return;
    setError('');
    try {
      await matchItems([
        { folder: item.folder, cv_id: String(item.cv_id), file_title: item.file_title },
      ]);
      setSuccess(`Matched: ${item.file_title}`);
      setItems((prev) => prev.filter((i) => i.folder !== item.folder));
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDeleteSelected = async () => {
    setConfirmDelete(false);
    const folders = Array.from(selected);
    setError('');
    try {
      await deleteFolders(folders);
      setItems((prev) => prev.filter((i) => !selected.has(i.folder)));
      setSelected(new Set());
      setSuccess(`Deleted ${folders.length} folder${folders.length !== 1 ? 's' : ''}.`);
    } catch (err) {
      setError(String(err));
    }
  };

  const issueTotal = items.reduce((sum, item) => sum + (item.issue_count ?? 0), 0);
  const unmatchedCount = items.filter(item => item.status === 'unmatched').length;

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="mismatch-heading">
        <div>
          <p className={styles.kicker}>Activity Diagnostics</p>
          <h1 id="mismatch-heading">Mismatch Review</h1>
          <p>Audit folders whose disk names or publisher signals do not line up cleanly with the monitored {section === 'comic' ? 'comics' : 'manga'} library.</p>
        </div>
        <div className={styles.heroStats} aria-label="Mismatch scan summary">
          <div><span>State</span><strong>{scanning ? 'Scanning' : 'Ready'}</strong></div>
          <div><span>Folders</span><strong>{items.length}</strong></div>
          <div><span>Issues</span><strong>{issueTotal}</strong></div>
        </div>
      </section>

      <div className={styles.toolbar}>
        <Badge tone={section === 'comic' ? 'info' : 'neutral'}>
          {section === 'comic' ? 'Comics' : 'Manga'}
        </Badge>
        <Button variant="secondary" onClick={startScan} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Rescan'}
        </Button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {success && <Notice tone="success">{success}</Notice>}

      {scanning && items.length > 0 && (
        <div className={styles.scanProgress}>Scanned {items.length} folders…</div>
      )}

      {!scanning && items.length === 0 ? (
        <div className={styles.empty}>No mismatches found</div>
      ) : (
        <>
          <div className={styles.resultToolbar}>
            <span className={styles.resultCount}>{items.length} folders · {unmatchedCount} naming mismatches · {selected.size} selected</span>
            <div className={styles.resultActions}>
              <Button variant="ghost" onClick={selectAll} disabled={scanning}>
                Select All
              </Button>
              <Button
                variant="primary"
                onClick={() => setConfirmDelete(true)}
                disabled={selected.size === 0 || scanning}
              >
                Delete Selected ({selected.size})
              </Button>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thCheck}></th>
                  <th>Folder</th>
                  <th>Suggested Match</th>
                  <th className={styles.thCount}>Issues</th>
                  <th className={styles.thStatus}>Status</th>
                  <th className={styles.thActions}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.folder}>
                    <td data-label="Select" className={styles.checkCell}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.folder)}
                        onChange={() => toggleSelect(item.folder)}
                      />
                    </td>
                    <td data-label="Folder" className={styles.folderCell}>{item.folder}</td>
                    <td data-label="Suggested Match" className={styles.titleCell}>{item.file_title || '—'}</td>
                    <td data-label="Issues" className={styles.countCell}>{item.issue_count ?? '—'}</td>
                    <td data-label="Status">
                      <Badge
                        tone={
                          item.status === 'matched'
                            ? 'success'
                            : item.status === 'unmatched'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {item.status}
                      </Badge>
                    </td>
                    <td data-label="Actions">
                      <div className={styles.rowActions}>
                        {item.cv_id && (
                          <Button
                            variant="ghost"
                            onClick={() => handleMatchItem(item)}
                          >
                            Match
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setSelected(new Set([item.folder]));
                            setConfirmDelete(true);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirmDelete && (
        <DialogFrame open onOpenChange={(open) => !open && setConfirmDelete(false)}>
          <DialogHeader
            title="Delete Folders"
            onClose={() => setConfirmDelete(false)}
          />
          <DialogBody>
            <p>
              Delete {selected.size} folder{selected.size !== 1 ? 's' : ''}? This
              cannot be undone.
            </p>
          </DialogBody>
          <DialogFooter>
            <div className={styles.dialogActions}>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleDeleteSelected}>
                Delete
              </Button>
            </div>
          </DialogFooter>
        </DialogFrame>
      )}
    </div>
  );
}
