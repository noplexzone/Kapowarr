import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

import { IssueRow } from './issue-row';
import type { IssueDetail } from '../-volumes.types';

const baseIssue: IssueDetail = {
  id: 7,
  comicvine_id: 12345,
  issue_number: '12',
  title: 'The Cover Story',
  release_date: '1940-01-01',
  monitored: true,
  downloaded: false,
  size: 0,
  file_ids: [],
  filenames: [],
};

function renderRow(issue: IssueDetail = baseIssue) {
  return render(
    <table>
      <tbody>
        <IssueRow
          issue={issue}
          volumeId={99}
          onAutoSearch={vi.fn()}
          onManualSearch={vi.fn()}
          onHistory={vi.fn()}
          onAddCover={vi.fn()}
          isAutoSearching={false}
        />
      </tbody>
    </table>,
  );
}

describe('IssueRow ComicVine links', () => {
  it('links the visible issue entry to the ComicVine issue page', () => {
    renderRow();

    const links = screen.getAllByRole('link', {
      name: 'Open ComicVine page for issue #12 — The Cover Story',
    });

    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('https://comicvine.gamespot.com/issue/4000-12345/');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer');
    }
  });

  it('leaves issues without a ComicVine id as plain text', () => {
    renderRow({ ...baseIssue, comicvine_id: 0 });

    expect(screen.queryByRole('link', { name: /Open ComicVine page/ })).toBeNull();
    expect(screen.getByText('#12')).toBeTruthy();
  });
});
