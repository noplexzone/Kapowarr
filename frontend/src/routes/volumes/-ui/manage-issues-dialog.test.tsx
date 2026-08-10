import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { IssueDetail } from '../-volumes.types';
import { selectedIssueFileIds } from './manage-issues-dialog';

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
