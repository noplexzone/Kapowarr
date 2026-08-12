import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatHistoryState, HistoryRow, stateTone } from './history-page';

const failedEntry = {
  id: 1,
  title: 'Saga 055',
  source: 'GetComics',
  downloaded_at: 100_000,
  state: 'failed',
  failure_reason: 'All download links were rejected',
};

describe('history diagnostic rows', () => {
  it('formats state tones and labels for recovery-oriented history', () => {
    expect(stateTone('downloaded')).toBe('success');
    expect(stateTone('failed')).toBe('danger');
    expect(stateTone('cancelled')).toBe('warning');
    expect(formatHistoryState('all')).toBe('All');
    expect(formatHistoryState('failed')).toBe('Failed');
  });

  it('renders failure reason and mobile data labels', () => {
    render(<table><tbody><HistoryRow entry={failedEntry} /></tbody></table>);

    expect(screen.getByText('Saga 055')).toBeTruthy();
    expect(screen.getByText('GetComics')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('All download links were rejected')).toBeTruthy();
    for (const label of ['Title', 'Source', 'Downloaded At', 'State']) {
      expect(document.querySelector(`td[data-label="${label}"]`)).toBeTruthy();
    }
  });
});
