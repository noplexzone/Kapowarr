import type { Dispatch, SetStateAction } from 'react';
import { Badge, Button } from '@/components/primitives';
import { DialogFrame, DialogHeader, DialogBody } from '@/components/dialog';
import type { FileMatch, IssueDetail, VolumeDetailFull } from '../-volumes.types';
import styles from './volume-detail-page.module.css';
interface ManageIssuesDialogProps { open: boolean; volume: VolumeDetailFull; loading: boolean; checked: Set<number>; deleting: boolean; forceMatching: boolean; manualMatches: FileMatch[]; unmatchedFiles: FileMatch[]; unmatchedChecked: Set<string>; unmatchedDeleting: boolean; forceMatchTargets: Record<string, number>; setForceMatchTargets: Dispatch<SetStateAction<Record<string, number>>>; onClose: () => void; onToggleIssue: (issueId: number) => void; onToggleAllIssues: (checked: boolean, issueIds: number[]) => void; onToggleUnmatched: (filepath: string) => void; onToggleAllUnmatched: (checked: boolean, filepaths: string[]) => void; onForceMatchFile: (filepath: string) => void; onDeleteUnmatchedSelected: () => void; onDeleteAllUnmatched: () => void; onDeleteSelected: () => void; onForceMatchSelected: () => void; }

export function selectedIssueFileIds(
  issues: IssueDetail[],
  selectedIssueIds: ReadonlySet<number>,
): number[] {
  return [
    ...new Set(
      issues
        .filter(issue => selectedIssueIds.has(issue.id))
        .flatMap(issue => issue.file_ids),
    ),
  ];
}

export function ManageIssuesDialog({ open: manageIssuesOpen, volume, loading: manageLoading, checked: manageChecked, deleting: manageDeleting, forceMatching: manageForceMatching, manualMatches, unmatchedFiles, unmatchedChecked, unmatchedDeleting, forceMatchTargets, setForceMatchTargets, onClose: closeManageIssues, onToggleIssue: toggleManageCheck, onToggleAllIssues: toggleAllManage, onToggleUnmatched: toggleUnmatchedCheck, onToggleAllUnmatched: toggleAllUnmatched, onForceMatchFile: handleForceMatchFile, onDeleteUnmatchedSelected: handleDeleteUnmatchedSelected, onDeleteAllUnmatched: handleDeleteAllUnmatched, onDeleteSelected: handleDeleteSelected, onForceMatchSelected: handleForceMatchSelected }: ManageIssuesDialogProps) { return (
      <DialogFrame
        open={manageIssuesOpen}
        onOpenChange={(open) => {
          if (!open) closeManageIssues();
        }}
      >
        <DialogHeader
          title={`Manage Issues — ${volume.title}`}
          onClose={closeManageIssues}
        />
        <DialogBody>
          {manageLoading ? (
            <p className={styles.dialogStatus}>Loading…</p>
          ) : volume.issues.length === 0 && unmatchedFiles.length === 0 ? (
            <p className={styles.dialogStatus}>No issues to manage.</p>
          ) : (
            <>
              {volume.issues.length > 0 && (
                <>
                  <h4 className={styles.dialogSubhead}>Matched Issues</h4>
                  <table className={styles.renameTable}>
                    <thead>
                      <tr>
                        <th className={styles.renameCheck}>
                          <input
                            type="checkbox"
                            aria-label="Select all matched issues"
                            checked={
                              volume.issues.length > 0 &&
                              manageChecked.size === volume.issues.length
                            }
                            onChange={(e) =>
                              toggleAllManage(
                                e.target.checked,
                                volume.issues.map(i => i.id),
                              )
                            }
                          />
                        </th>
                        <th>#</th>
                        <th>Title</th>
                        <th>Filename</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {volume.issues.map((issue) => (
                        <tr key={issue.id}>
                          <td className={styles.renameCheck}>
                            <input
                              type="checkbox"
                              aria-label={`Select matched issue #${issue.issue_number}`}
                              checked={manageChecked.has(issue.id)}
                              onChange={() => toggleManageCheck(issue.id)}
                            />
                          </td>
                          <td className={styles.issueNum}>
                            #{issue.issue_number}
                          </td>
                          <td className={styles.issueTitle}>
                            {issue.title || '—'}
                          </td>
                          <td className={styles.issueFilename}>
                            {issue.filenames.length > 0
                              ? issue.filenames.map((f, i) => (
                                  <span
                                    key={i}
                                    className={styles.filenameLine}
                                  >
                                    {f}
                                  </span>
                                ))
                              : '—'}
                          </td>
                          <td>
                            <Badge
                              tone={
                                issue.downloaded
                                  ? 'success'
                                  : issue.monitored
                                    ? 'warning'
                                    : 'neutral'
                              }
                            >
                              {issue.downloaded
                                ? 'Downloaded'
                                : issue.monitored
                                  ? 'Wanted'
                                  : 'Unmonitored'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {unmatchedFiles.length > 0 && (
                <>
                  <h4 className={styles.dialogSubhead}>
                    Unmatched Files ({unmatchedFiles.length})
                  </h4>
                  <table className={styles.renameTable}>
                    <thead>
                      <tr>
                        <th className={styles.renameCheck}>
                          <input
                            type="checkbox"
                            aria-label="Select all unmatched files"
                            checked={
                              unmatchedFiles.length > 0 &&
                              unmatchedChecked.size === unmatchedFiles.length
                            }
                            onChange={(e) =>
                              toggleAllUnmatched(
                                e.target.checked,
                                unmatchedFiles.map(uf => uf.filepath),
                              )
                            }
                          />
                        </th>
                        <th>Filename</th>
                        <th className={styles.thActions}>
                          Force Match To
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmatchedFiles.map((uf) => {
                        const fn =
                          uf.filepath.split(/[/\\]/).pop() || uf.filepath;
                        const matchedIssueIds = new Set(
                          manualMatches.flatMap(m => m.issue_ids),
                        );
                        const unmatchedIssues = volume.issues.filter(
                          issue => !matchedIssueIds.has(issue.id),
                        );
                        return (
                          <tr key={uf.filepath}>
                            <td className={styles.renameCheck}>
                              <input
                                type="checkbox"
                                aria-label={`Select unmatched file ${fn}`}
                                checked={unmatchedChecked.has(uf.filepath)}
                                onChange={() =>
                                  toggleUnmatchedCheck(uf.filepath)
                                }
                              />
                            </td>
                            <td className={styles.issueFilename}>
                              <span className={styles.filenameLine}>
                                {fn}
                              </span>
                            </td>
                            <td className={styles.actionsCell}>
                              <select
                                className={styles.editSelect}
                                aria-label={`Force match ${fn} to issue`}
                                value={forceMatchTargets[uf.filepath] ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setForceMatchTargets((prev) => {
                                    const next = { ...prev };
                                    if (val) {
                                      next[uf.filepath] = Number(val);
                                    } else {
                                      delete next[uf.filepath];
                                    }
                                    return next;
                                  });
                                }}
                              >
                                <option value="">
                                  Select issue…
                                </option>
                                {unmatchedIssues.map((issue) => (
                                  <option
                                    key={issue.id}
                                    value={issue.id}
                                  >
                                    #{issue.issue_number}
                                    {issue.title
                                      ? ` — ${issue.title}`
                                      : ''}
                                  </option>
                                ))}
                              </select>
                              <Button
                                variant="primary"
                                disabled={
                                  !forceMatchTargets[uf.filepath]
                                }
                                onClick={() =>
                                  handleForceMatchFile(uf.filepath)
                                }
                              >
                                Match
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className={styles.inlineActions}>
                    <Button
                      variant="primary"
                      disabled={
                        unmatchedChecked.size === 0 || unmatchedDeleting
                      }
                      onClick={handleDeleteUnmatchedSelected}
                    >
                      {unmatchedDeleting
                        ? 'Deleting…'
                        : 'Delete Selected'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={unmatchedDeleting}
                      onClick={handleDeleteAllUnmatched}
                    >
                      Delete All
                    </Button>
                  </div>
                </>
              )}

              <div className={styles.manageDialogActions}>
                <Button
                  variant="secondary"
                  onClick={closeManageIssues}
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  disabled={
                    manageChecked.size === 0 ||
                    manageDeleting ||
                    manageForceMatching
                  }
                  onClick={handleDeleteSelected}
                >
                  {manageDeleting ? 'Deleting…' : 'Delete Selected'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    manageChecked.size === 0 ||
                    manageDeleting ||
                    manageForceMatching
                  }
                  onClick={handleForceMatchSelected}
                >
                  {manageForceMatching
                    ? 'Matching…'
                    : 'Force Match Selected'}
                </Button>
              </div>
            </>
          )}
        </DialogBody>
      </DialogFrame>
); }
