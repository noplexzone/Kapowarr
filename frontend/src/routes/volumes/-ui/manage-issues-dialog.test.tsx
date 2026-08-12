import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { IssueDetail } from '../-volumes.types';
import { selectedIssueFileIds, selectedUnmatchedManualMatches } from './manage-issues-dialog';

const source = readFileSync('src/routes/volumes/-ui/manage-issues-dialog.tsx', 'utf8');

function issue(id: number, fileIds: number[], filenames: string[]): IssueDetail {
  return {
    id,
    issue_number: String(id),
    monitored: true,
    downloaded: fileIds.length > 0,
    size: 0,
    file_ids: fileIds,
    filenames,
  };
}

describe('Manage Issues destructive selection', () => {
  it('uses authoritative issue file IDs despite duplicate and suffix-colliding basenames', () => {
    const issues = [
      issue(1, [101], ['Saga 001.cbz']),
      issue(2, [202], ['Saga 001.cbz']),
      issue(3, [303], ['Special Saga 001.cbz']),
      issue(4, [101, 404], ['Saga 001.cbz', 'Saga 004.cbz']),
    ];

    expect(selectedIssueFileIds(issues, new Set([2, 3, 4]))).toEqual([202, 303, 101, 404]);
  });
});

describe('Manage Issues accessible controls', () => {
  it('names matched and unmatched selections and per-file Force Match selects', () => {
    expect(source).toContain('aria-label="Select all matched issues"');
    expect(source).toContain('aria-label={`Select matched issue #${issue.issue_number}`}');
    expect(source).toContain('aria-label="Select all unmatched files"');
    expect(source).toContain('aria-label={`Select unmatched file ${fn}`}');
    expect(source).toContain('aria-label={`Force match ${fn} to issue`}');
  });
});


describe('Manage Issues bulk unmatched force match', () => {
  it('builds bulk manual-match payloads only for selected files with targets', () => {
    const result = selectedUnmatchedManualMatches(
      new Set(['/library/Saga 001.cbz', '/library/Saga 003.cbz']),
      {
        '/library/Saga 001.cbz': 101,
        '/library/Saga 002.cbz': 102,
      },
    );

    expect(result).toEqual([
      {
        filepath: '/library/Saga 001.cbz',
        issue_ids: [101],
        general_file: false,
        forced_match: true,
      },
    ]);
  });

  it('exposes a selected unmatched bulk match action with a disabled state', () => {
    expect(source).toContain('Bulk Match Selected');
    expect(source).toContain('selectedUnmatchedMissingTargets');
    expect(source).toContain('onForceMatchUnmatchedSelected');
  });
});
