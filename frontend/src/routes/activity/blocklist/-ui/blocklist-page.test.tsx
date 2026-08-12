import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlocklistRow, displayTitle } from './blocklist-page';

const entry = {
  id: 4,
  web_link: 'https://example.test/release',
  web_title: 'Saga 055',
  web_sub_title: 'alternate title',
  download_link: 'https://example.test/file.cbz',
  reason: 'Source failed integrity checks',
  added_at: '2026-08-11T22:00:00Z',
};

describe('blocklist diagnostic rows', () => {
  it('prefers stable source titles for destructive confirmations', () => {
    expect(displayTitle(entry)).toBe('Saga 055');
    expect(displayTitle({ ...entry, web_title: undefined })).toBe('alternate title');
  });

  it('renders reason, source link, visible remove action, and mobile labels', () => {
    render(<table><tbody><BlocklistRow entry={entry} onDelete={vi.fn()} /></tbody></table>);

    expect(screen.getByText('Saga 055')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View source' }).getAttribute('href')).toBe('https://example.test/release');
    expect(screen.getByText('Source failed integrity checks')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Saga 055 from blocklist' }).textContent).toContain('Remove');
    for (const label of ['Title', 'Link', 'Reason', 'Added At', 'Actions']) {
      expect(document.querySelector(`td[data-label="${label}"]`)).toBeTruthy();
    }
  });
});
