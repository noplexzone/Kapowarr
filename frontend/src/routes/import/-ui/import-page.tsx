import { useState, useCallback } from 'react';
import { Badge, Button, Notice } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody, DialogFooter } from '@/components/dialog';
import { scanBulk, importSelected, deleteUnmatched } from '../-import.api';
import type { BulkScanItem, ImportSelection } from '../-import.types';
import styles from './import-page.module.css';

interface ImportPageProps {
  section: 'comic' | 'manga';
}

export function ImportPage({ section }: ImportPageProps) {
  const [folderFilter, setFolderFilter] = useState('');
  const [fuzzyFallback, setFuzzyFallback] = useState(false);
  const [quick, setQuick] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [items, setItems] = useState<BulkScanItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [success, setSuccess] = useState('');

  const startScan = useCallback(async () => {
    setScanning(true);
    setScanComplete(false);
    setItems([]);
    setSelected(new Set());
    setError('');
    setSuccess('');

    try {
      for await (const item of scanBulk(folderFilter, fuzzyFallback, quick)) {
        setItems(prev => [...prev, item]);
      }
      setScanComplete(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setScanning(false);
    }
  }, [folderFilter, fuzzyFallback, quick]);

  const toggleSelect = (folder: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(items.filter(i => i.matched).map(i => i.folder)));
  };

  const handleImport = async () => {
    setImporting(true);
    setError('');
    try {
      const payload: ImportSelection[] = items
        .filter(item => selected.has(item.folder) && item.matched && item.cv_id != null)
        .map(item => ({
          folder: item.folder,
          cv_id: String(item.cv_id),
          file_title: item.file_title,
        }));
      await importSelected(payload);
      setSuccess(`Imported ${payload.length} item${payload.length !== 1 ? 's' : ''}.`);
      setSelected(new Set());
    } catch (err) {
      setError(String(err));
    } finally {
      setImporting(false);
    }
  };

  const unmatchedFolders = items.filter(i => !i.matched).map(i => i.folder);

  const openDeleteDialog = () => {
    if (!scanComplete) return;
    setDeleteError('');
    setConfirmDelete(true);
  };

  const closeDeleteDialog = () => {
    if (deleting) return;
    setDeleteError('');
    setConfirmDelete(false);
  };

  const handleDelete = async () => {
    if (deleting || !scanComplete) return;

    const foldersToDelete = [...unmatchedFolders];
    const deletedFolders = new Set(foldersToDelete);

    setDeleting(true);
    setDeleteError('');
    setError('');
    setSuccess('');
    try {
      await deleteUnmatched(foldersToDelete);
      setItems(prev => prev.filter(item => item.matched || !deletedFolders.has(item.folder)));
      setSuccess(`Deleted ${foldersToDelete.length} unmatched folder${foldersToDelete.length !== 1 ? 's' : ''}.`);
      setConfirmDelete(false);
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeleting(false);
    }
  };

  const unmatchedCount = unmatchedFolders.length;
  const matchedCount = items.filter(i => i.matched).length;
  const selectedMatchedCount = items.filter(i => selected.has(i.folder) && i.matched).length;
  const scanState = scanning ? 'Scanning' : scanComplete ? 'Scan complete' : 'Ready to scan';

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="import-heading">
        <div>
          <p className={styles.kicker}>Activity Diagnostics</p>
          <h1 id="import-heading">Library Import</h1>
          <p>Scan staged folders, verify metadata matches, and import only confirmed {section === 'comic' ? 'comic' : 'manga'} volumes.</p>
        </div>
        <div className={styles.heroStats} aria-label="Import scan summary">
          <div><span>State</span><strong>{scanState}</strong></div>
          <div><span>Matched</span><strong>{matchedCount}</strong></div>
          <div><span>Unmatched</span><strong>{unmatchedCount}</strong></div>
        </div>
      </section>

      <div className={styles.scanForm}>
        <div className={styles.formRow}>
          <label className={styles.label}>Folder Filter</label>
          <input
            className={styles.input}
            placeholder="/path/to/filter"
            value={folderFilter}
            onChange={e => setFolderFilter(e.target.value)}
            disabled={scanning}
          />
        </div>
        <div className={styles.checkboxRow}>
          <label>
            <input type="checkbox" checked={fuzzyFallback} onChange={e => setFuzzyFallback(e.target.checked)} disabled={scanning} />
            {' '}Fuzzy Fallback
          </label>
          <label>
            <input type="checkbox" checked={quick} onChange={e => setQuick(e.target.checked)} disabled={scanning} />
            {' '}Quick Scan
          </label>
        </div>
        <div>
          <Button variant="primary" onClick={startScan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Start Scan'}
          </Button>
        </div>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {success && <Notice tone="success">{success}</Notice>}

      {scanning && items.length > 0 && (
        <div className={styles.scanProgress}>Scanned {items.length} folders…</div>
      )}

      {!scanning && items.length === 0 ? (
        <div className={styles.empty}>Start a scan to detect volumes</div>
      ) : (
        <>
          <div className={styles.resultToolbar}>
            <span className={styles.resultCount}>
              {items.length} folders found · {matchedCount} matched · {unmatchedCount} unmatched · {selectedMatchedCount} selected
            </span>
            <div className={styles.resultActions}>
              {matchedCount > 0 && (
                <Button variant="ghost" onClick={selectAll} disabled={scanning}>
                  Select All
                </Button>
              )}
              <Button
                variant="primary"
                onClick={handleImport}
                disabled={selected.size === 0 || importing}
              >
                {importing ? 'Importing…' : `Import Selected (${selected.size})`}
              </Button>
              {unmatchedCount > 0 && (
                <Button variant="secondary" onClick={openDeleteDialog} disabled={!scanComplete || scanning || deleting}>
                  Delete Unmatched ({unmatchedCount})
                </Button>
              )}
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th></th>
                  <th>Folder</th>
                  <th>Title</th>
                  <th>Matched Title</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.folder}>
                    <td data-label="Select">
                      {item.matched && (
                        <input
                          type="checkbox"
                          checked={selected.has(item.folder)}
                          onChange={() => toggleSelect(item.folder)}
                        />
                      )}
                    </td>
                    <td data-label="Folder" className={styles.folderCell}>{item.folder}</td>
                    <td data-label="Title">{item.file_title}</td>
                    <td data-label="Matched Title">{item.match_title ?? '—'}</td>
                    <td data-label="Status">
                      <Badge tone={item.matched ? 'success' : 'danger'}>
                        {item.matched ? 'Matched' : 'Unmatched'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirmDelete && (
        <DialogFrame open onOpenChange={open => !open && closeDeleteDialog()}>
          <DialogHeader
            title="Delete Unmatched Folders"
            onClose={deleting ? undefined : closeDeleteDialog}
          />
          <DialogBody>
            <p>
              Delete {unmatchedCount} unmatched folder{unmatchedCount !== 1 ? 's' : ''}?
              This cannot be undone.
            </p>
            <ul className={styles.deletePathList} aria-label="Folders to delete">
              {unmatchedFolders.map(folder => (
                <li key={folder}><code>{folder}</code></li>
              ))}
            </ul>
            {deleteError && <Notice tone="danger">{deleteError}</Notice>}
          </DialogBody>
          <DialogFooter>
            <div className={styles.dialogActions}>
              <Button variant="ghost" onClick={closeDeleteDialog} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </DialogFooter>
        </DialogFrame>
      )}
    </div>
  );
}
