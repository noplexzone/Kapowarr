import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AllSettings } from '../-settings.types';

const { cancelMetronBackfill, fetchMetronReviews, startMetronBackfill } = vi.hoisted(() => ({
  cancelMetronBackfill: vi.fn(),
  fetchMetronReviews: vi.fn(),
  startMetronBackfill: vi.fn(),
}));

vi.mock('../-settings.api', () => ({
  cancelMetronBackfill,
  dismissMetronReview: vi.fn(),
  fetchMetronReviews,
  selectMetronCandidate: vi.fn(),
  startMetronBackfill,
  testMetronConnection: vi.fn(),
}));

import { SettingsCategoryPanel } from './settings-category-panels';

function renderMetadata(backfillStatus = 'idle') {
  const form = {
    comicvine_api_key: '',
    metron_api_token: '',
    metron_enabled: true,
    metron_last_enrichment_run: 0,
    metron_last_successful_connection: 0,
    metron: {
      enabled: true,
      token_configured: true,
      token_masked: '********',
      last_successful_connection: null,
      last_enrichment: null,
      backfill: { status: backfillStatus },
    },
  } as unknown as AllSettings;

  return render(<SettingsCategoryPanel
    category="metadata"
    form={form}
    set={vi.fn()}
    errors={{}}
    theme="dark-mode"
    setTheme={vi.fn()}
    suwayomiSources={[]}
    suwayomiSourcesLoading={false}
  />);
}

describe('MetronSettingsPanel backfill controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMetronReviews.mockResolvedValue({ total: 0, candidates: [], limit: 50, offset: 0 });
    startMetronBackfill.mockResolvedValue({ task_id: 42, status: 'queued' });
    cancelMetronBackfill.mockResolvedValue({ status: 'cancelled' });
  });

  it('offers cancellation immediately after starting a backfill', async () => {
    renderMetadata();

    fireEvent.click(screen.getByRole('button', { name: 'Backfill Existing Comics' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel Backfill' });
    fireEvent.click(cancel);

    await waitFor(() => expect(cancelMetronBackfill).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toBe('Backfill cancelled.');
    expect(screen.getByText('cancelled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel Backfill' })).toBeNull();
  });

  it.each(['running', 'rate_limit_paused'])('offers cancellation after reload when status is %s', async (status) => {
    renderMetadata(status);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Backfill' }));

    await waitFor(() => expect(cancelMetronBackfill).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Backfill Existing Comics' })).toHaveProperty('disabled', false);
  });

  it('disables both backfill controls while cancellation is pending', async () => {
    let resolveCancel!: (value: { status: string }) => void;
    cancelMetronBackfill.mockReturnValueOnce(new Promise((resolve) => { resolveCancel = resolve; }));
    renderMetadata('running');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Backfill' }));

    expect(screen.getByRole('button', { name: 'Cancel Backfill' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Backfill Existing Comics' })).toHaveProperty('disabled', true);

    await act(async () => resolveCancel({ status: 'cancelling' }));
  });
});